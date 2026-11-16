#!/usr/bin/env python3
"""Local diagnostics and bounded benchmark for the optional faster-whisper runtime."""

from __future__ import annotations

import argparse
import importlib
import importlib.util
import io
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable

from asr_quality import score_transcript

DEFAULT_BEAM_SIZE = 5
MIN_BEAM_SIZE = 1
MAX_BEAM_SIZE = 10

try:
    import resource
except ImportError:  # pragma: no cover - unavailable on Windows
    resource = None


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


def _default_usage() -> dict[str, float] | None:
    if resource is None:
        return None
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return {
        "user": float(usage.ru_utime),
        "system": float(usage.ru_stime),
        "maxrss": float(usage.ru_maxrss),
    }


def _rss_mb(value: float) -> float:
    # Linux reports ru_maxrss in KiB while macOS reports bytes.
    divisor = 1024 * 1024 if sys.platform == "darwin" else 1024
    return round(max(0.0, value) / divisor, 2)


def _process_metrics(
    start_usage: dict[str, float] | None,
    end_usage: dict[str, float] | None,
) -> dict[str, Any]:
    if not start_usage or not end_usage:
        return {"available": False}
    return {
        "available": True,
        "cpu_user_ms": round(max(0.0, (end_usage["user"] - start_usage["user"]) * 1000), 2),
        "cpu_system_ms": round(max(0.0, (end_usage["system"] - start_usage["system"]) * 1000), 2),
        "max_rss_mb": _rss_mb(end_usage["maxrss"]),
    }


def _percentile_ms(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(percentile / 100 * len(ordered)) - 1))
    return round(ordered[index], 2)


def validate_beam_size(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not MIN_BEAM_SIZE <= value <= MAX_BEAM_SIZE:
        raise ValueError("beam size must be an integer between 1 and 10")
    return value


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
    usage_reader: Callable[[], dict[str, float] | None] | None = None,
    repeat: int = 1,
    expected_text: str | None = None,
    beam_size: int = DEFAULT_BEAM_SIZE,
) -> dict[str, Any]:
    result: dict[str, Any] = {"ok": False, "provider": "faster-whisper", "versions": {}}

    usage_reader = usage_reader or _default_usage
    try:
        start_usage = usage_reader()
    except Exception:
        start_usage = None

    def finish(payload: dict[str, Any]) -> dict[str, Any]:
        try:
            end_usage = usage_reader()
        except Exception:
            end_usage = None
        payload["process"] = _process_metrics(start_usage, end_usage)
        return payload

    if not model_name:
        result["error"] = "model path is required"
        return finish(result)
    if not isinstance(cpu_threads, int) or cpu_threads < 1:
        result["error"] = "cpu thread count is invalid"
        return finish(result)
    if not isinstance(repeat, int) or repeat < 1:
        result["error"] = "audio repeat count is invalid"
        return finish(result)
    try:
        validate_beam_size(beam_size)
    except ValueError:
        result["error"] = "beam size is invalid"
        return finish(result)
    if expected_text is not None and not audio_path:
        result["error"] = "expected transcript requires audio"
        return finish(result)

    model_path = Path(model_name).expanduser()
    is_local_model = model_path.exists()
    if is_local_model and not model_path.is_dir():
        result["error"] = "model path is not a directory"
        return finish(result)
    if not is_local_model and not allow_download:
        result["error"] = "model path is missing"
        return finish(result)

    if module is None:
        try:
            module = (importer or importlib.import_module)("faster_whisper")
        except ImportError:
            result["error"] = "faster-whisper is not installed"
            return finish(result)
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
        return finish(result)
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
            return finish(result)
        inference_times: list[float] = []
        transcript_chars = 0
        language = None
        quality = None
        for _ in range(repeat):
            started = clock()
            try:
                segments, info = model.transcribe(io.BytesIO(body), beam_size=beam_size, vad_filter=True)
                parts = []
                current_transcript_chars = 0
                for segment in segments:
                    part = str(getattr(segment, "text", "")).strip()
                    if part:
                        parts.append(part)
                        current_transcript_chars += len(part)
            except Exception:
                result["error"] = "faster-whisper audio probe failed"
                return finish(result)
            inference_times.append(_elapsed_ms(clock, started))
            if len(inference_times) == 1:
                transcript_chars = current_transcript_chars
                language = getattr(info, "language", None)
                if expected_text is not None:
                    quality = score_transcript(expected_text, " ".join(parts))
        audio_result: dict[str, Any] = {
            "format": audio_format,
            "duration_ms": round(audio_format["frames"] * 1000 / audio_format["sampleRate"], 2),
            "inference_ms": round(sum(inference_times) / len(inference_times), 2),
            "inference_ms_min": min(inference_times),
            "inference_ms_p95": _percentile_ms(inference_times, 95),
            "runs": repeat,
            "language": language,
            "transcript_chars": transcript_chars,
        }
        if quality is not None:
            audio_result["quality"] = quality
        result["audio"] = audio_result
    result["ok"] = True
    return finish(result)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Diagnose and benchmark the optional local faster-whisper runtime.")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL"))
    parser.add_argument("--audio", help="optional PCM WAV sample to benchmark without printing its transcript")
    parser.add_argument("--device", default=os.environ.get("WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"))
    parser.add_argument("--cpu-threads", type=int, default=4)
    parser.add_argument("--repeat", type=int, default=1, help="repeat the optional audio probe for stable timing statistics")
    expected = parser.add_mutually_exclusive_group()
    expected.add_argument("--expected-text", help="reference transcript for CER/WER without printing the hypothesis")
    expected.add_argument("--expected-file", help="UTF-8 file containing the reference transcript")
    parser.add_argument("--allow-model-download", action="store_true", help="allow a named model to be downloaded")
    parser.add_argument("--beam-size", type=int, default=DEFAULT_BEAM_SIZE, help="faster-whisper beam size from 1 to 10")
    parser.add_argument("--json", action="store_true", dest="json_output", help="print a machine-readable JSON report")
    args = parser.parse_args(argv)
    expected_text = args.expected_text
    if args.expected_file:
        try:
            expected_text = Path(args.expected_file).read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            result = {"ok": False, "provider": "faster-whisper", "versions": {}, "error": "expected transcript file could not be read"}
        else:
            result = run_doctor(
                args.model,
                audio_path=args.audio,
                device=args.device,
                compute_type=args.compute_type,
                cpu_threads=args.cpu_threads,
                allow_download=args.allow_model_download,
                repeat=args.repeat,
                expected_text=expected_text,
                beam_size=args.beam_size,
            )
    else:
        result = run_doctor(
            args.model,
            audio_path=args.audio,
            device=args.device,
            compute_type=args.compute_type,
            cpu_threads=args.cpu_threads,
            allow_download=args.allow_model_download,
            repeat=args.repeat,
            expected_text=expected_text,
            beam_size=args.beam_size,
        )
    if args.json_output:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    elif result["ok"]:
        model = result.get("model", {})
        audio = result.get("audio")
        message = f"ASR doctor verified: model load {model.get('load_ms', 0):.2f} ms"
        if audio:
            message += (
                f", inference avg/min/p95 {audio['inference_ms']:.2f}/{audio['inference_ms_min']:.2f}/"
                f"{audio['inference_ms_p95']:.2f} ms over {audio['runs']} run(s),"
                f" transcript chars {audio['transcript_chars']}"
            )
            if "quality" in audio:
                message += f", CER/WER {audio['quality']['cer']:.4f}/{audio['quality']['wer']:.4f}"
        process = result.get("process", {})
        if process.get("available"):
            message += (
                f", CPU user/system {process['cpu_user_ms']:.2f}/{process['cpu_system_ms']:.2f} ms"
                f", peak RSS {process['max_rss_mb']:.2f} MB"
            )
        print(message)
    else:
        print(f"NOT VERIFIED: {result['error']}")
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
