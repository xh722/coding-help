#!/usr/bin/env python3
"""Local diagnostics and bounded benchmark for the optional faster-whisper runtime."""

from __future__ import annotations

import argparse
import importlib
import importlib.util
import io
import json
import os
import time
from pathlib import Path
from typing import Any, Callable


def _validate_wav(body: bytes) -> dict[str, int]:
    server_path = Path(__file__).parents[1] / "services" / "local-asr" / "faster_whisper_server.py"
    spec = importlib.util.spec_from_file_location("coding_help_local_asr_server", server_path)
    if spec is None or spec.loader is None:
        raise ValueError("audio validator is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.validate_wav(body)


def _elapsed_ms(clock: Callable[[], float], started: float) -> float:
    return round(max(0.0, (clock() - started) * 1000), 2)


def run_doctor(
    model_name: str | None,
    *,
    audio_path: str | None = None,
    module: Any = None,
    importer: Callable[[str], Any] | None = importlib.import_module,
    device: str = "cpu",
    compute_type: str = "int8",
    cpu_threads: int = 4,
    allow_download: bool = False,
    clock: Callable[[], float] = time.perf_counter,
) -> dict[str, Any]:
    result: dict[str, Any] = {"ok": False, "provider": "faster-whisper", "versions": {}}
    if not model_name:
        result["error"] = "model path is required"
        return result
    if not isinstance(cpu_threads, int) or cpu_threads < 1:
        result["error"] = "cpu thread count is invalid"
        return result

    model_path = Path(model_name).expanduser()
    is_local_model = model_path.exists()
    if is_local_model and not model_path.is_dir():
        result["error"] = "model path is not a directory"
        return result
    if not is_local_model and not allow_download:
        result["error"] = "model path is missing"
        return result

    if module is None:
        try:
            module = (importer or importlib.import_module)("faster_whisper")
        except ImportError:
            result["error"] = "faster-whisper is not installed"
            return result
    version = getattr(module, "__version__", None)
    if isinstance(version, str) and version:
        result["versions"]["faster_whisper"] = version

    started = clock()
    try:
        model = module.WhisperModel(
            str(model_path) if is_local_model else model_name,
            device=device,
            compute_type=compute_type,
            local_files_only=not allow_download or is_local_model,
            cpu_threads=cpu_threads,
        )
    except Exception:
        result["error"] = "faster-whisper model could not be loaded"
        return result
    result["model"] = {
        "source": "local" if is_local_model else "named",
        "load_ms": _elapsed_ms(clock, started),
    }

    if audio_path:
        try:
            body = Path(audio_path).read_bytes()
            audio_format = _validate_wav(body)
        except Exception:
            result["error"] = "audio file could not be read or is not valid PCM WAV"
            return result
        started = clock()
        try:
            segments, info = model.transcribe(io.BytesIO(body), beam_size=5, vad_filter=True)
            transcript_chars = sum(len(str(getattr(segment, "text", "")).strip()) for segment in segments)
        except Exception:
            result["error"] = "faster-whisper audio probe failed"
            return result
        result["audio"] = {
            "format": audio_format,
            "duration_ms": round(audio_format["frames"] * 1000 / audio_format["sampleRate"], 2),
            "inference_ms": _elapsed_ms(clock, started),
            "language": getattr(info, "language", None),
            "transcript_chars": transcript_chars,
        }
    result["ok"] = True
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Diagnose and benchmark the optional local faster-whisper runtime.")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL"))
    parser.add_argument("--audio", help="optional PCM WAV sample to benchmark without printing its transcript")
    parser.add_argument("--device", default=os.environ.get("WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"))
    parser.add_argument("--cpu-threads", type=int, default=4)
    parser.add_argument("--allow-model-download", action="store_true", help="allow a named model to be downloaded")
    parser.add_argument("--json", action="store_true", dest="json_output", help="print a machine-readable JSON report")
    args = parser.parse_args(argv)
    result = run_doctor(
        args.model,
        audio_path=args.audio,
        device=args.device,
        compute_type=args.compute_type,
        cpu_threads=args.cpu_threads,
        allow_download=args.allow_model_download,
    )
    if args.json_output:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    elif result["ok"]:
        model = result.get("model", {})
        audio = result.get("audio")
        message = f"ASR doctor verified: model load {model.get('load_ms', 0):.2f} ms"
        if audio:
            message += f", inference {audio['inference_ms']:.2f} ms, transcript chars {audio['transcript_chars']}"
        print(message)
    else:
        print(f"NOT VERIFIED: {result['error']}")
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
