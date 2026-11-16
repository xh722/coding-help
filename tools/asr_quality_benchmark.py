#!/usr/bin/env python3
"""Run a bounded, redacted local ASR quality matrix over a sample manifest."""

from __future__ import annotations

import argparse
import importlib
import io
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Iterable

from asr_quality import score_transcript
from asr_runtime_doctor import _default_usage, _elapsed_ms, _percentile_ms, _process_metrics, _validate_wav

MAX_SAMPLES = 32
MAX_REFERENCE_CHARS = 20_000
DEFAULT_BEAM_SIZES = (1, 5, 10)
DEFAULT_VAD_FILTERS = (True, False)
MIN_BEAM_SIZE = 1
MAX_BEAM_SIZE = 10


class BenchmarkError(ValueError):
    """A fixed, safe error suitable for CLI output."""


def parse_beam_sizes(value: str | Iterable[int]) -> tuple[int, ...]:
    if isinstance(value, str):
        items = [item.strip() for item in value.split(",") if item.strip()]
    else:
        items = list(value)
    if not items:
        raise BenchmarkError("beam size list is empty")
    sizes: list[int] = []
    for item in items:
        try:
            candidate = int(item)
        except (TypeError, ValueError) as error:
            raise BenchmarkError("beam size list is invalid") from error
        if isinstance(item, bool) or not MIN_BEAM_SIZE <= candidate <= MAX_BEAM_SIZE:
            raise BenchmarkError("beam size must be an integer between 1 and 10")
        if candidate not in sizes:
            sizes.append(candidate)
    return tuple(sizes)


def parse_vad_modes(value: str) -> tuple[bool, ...]:
    if value == "on":
        return (True,)
    if value == "off":
        return (False,)
    if value == "both":
        return DEFAULT_VAD_FILTERS
    raise BenchmarkError("VAD mode is invalid")


def load_manifest(path: str | Path) -> list[dict[str, Path]]:
    manifest_path = Path(path).expanduser()
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        raise BenchmarkError("sample manifest could not be read") from error
    entries = payload.get("samples") if isinstance(payload, dict) else payload
    if not isinstance(entries, list) or not entries or len(entries) > MAX_SAMPLES:
        raise BenchmarkError("sample manifest must contain 1 to 32 samples")
    samples: list[dict[str, Path]] = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("audio"), str) or not isinstance(entry.get("reference"), str):
            raise BenchmarkError("sample manifest entry is invalid")
        audio = entry["audio"].strip()
        reference = entry["reference"].strip()
        if not audio or not reference:
            raise BenchmarkError("sample manifest entry is invalid")
        samples.append({
            "audio": (manifest_path.parent / audio).resolve() if not Path(audio).is_absolute() else Path(audio).resolve(),
            "reference": (manifest_path.parent / reference).resolve() if not Path(reference).is_absolute() else Path(reference).resolve(),
        })
    return samples


def _load_model(model_name: str, device: str, compute_type: str, allow_download: bool, cpu_threads: int, importer: Callable[[str], Any] | None) -> tuple[Any, str]:
    model_path = Path(model_name).expanduser()
    is_local_model = model_path.exists()
    if is_local_model and not model_path.is_dir():
        raise BenchmarkError("model path is not a directory")
    if not is_local_model and not allow_download:
        raise BenchmarkError("model path is missing")
    try:
        module = (importer or importlib.import_module)("faster_whisper")
    except ImportError as error:
        raise BenchmarkError("faster-whisper is not installed") from error
    try:
        model = module.WhisperModel(
            str(model_path) if is_local_model else model_name,
            device=device,
            compute_type=compute_type,
            local_files_only=not allow_download or is_local_model,
            cpu_threads=cpu_threads,
        )
    except Exception as error:
        raise BenchmarkError("faster-whisper model could not be loaded") from error
    version = getattr(module, "__version__", None)
    return model, version if isinstance(version, str) and version else "unknown"


def _read_samples(samples: list[dict[str, Path]]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for sample in samples:
        try:
            body = sample["audio"].read_bytes()
            audio_format = _validate_wav(body)
            reference = sample["reference"].read_text(encoding="utf-8")
        except (OSError, UnicodeError, ValueError) as error:
            raise BenchmarkError("sample audio or reference could not be read") from error
        if not reference.strip() or len(reference) > MAX_REFERENCE_CHARS:
            raise BenchmarkError("sample reference is empty or too large")
        prepared.append({"body": body, "format": audio_format, "reference": reference})
    return prepared


def _transcribe(model: Any, body: bytes, beam_size: int, vad_filter: bool) -> tuple[str, str | None]:
    segments, info = model.transcribe(io.BytesIO(body), beam_size=beam_size, vad_filter=vad_filter)
    parts: list[str] = []
    for segment in segments:
        text = str(getattr(segment, "text", "")).strip()
        if text:
            parts.append(text)
    language = getattr(info, "language", None)
    return " ".join(parts), language if isinstance(language, str) else None


def _mean(values: list[float], digits: int = 4) -> float:
    return round(sum(values) / len(values), digits)


def run_benchmark(
    model_name: str | None,
    samples: list[dict[str, Path]],
    *,
    beam_sizes: Iterable[int] = DEFAULT_BEAM_SIZES,
    vad_filters: Iterable[bool] = DEFAULT_VAD_FILTERS,
    repeat: int = 1,
    module: Any = None,
    importer: Callable[[str], Any] | None = importlib.import_module,
    device: str = "cpu",
    compute_type: str = "int8",
    cpu_threads: int = 4,
    allow_download: bool = False,
    clock: Callable[[], float] = time.perf_counter,
    usage_reader: Callable[[], dict[str, float] | None] | None = None,
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
    if not isinstance(repeat, int) or repeat < 1 or repeat > 20:
        result["error"] = "repeat count is invalid"
        return finish(result)
    if not isinstance(samples, list) or not 1 <= len(samples) <= MAX_SAMPLES:
        result["error"] = "sample manifest must contain 1 to 32 samples"
        return finish(result)
    try:
        parsed_beam_sizes = parse_beam_sizes(beam_sizes)
        parsed_vad_filters = tuple(vad_filters)
        if not parsed_vad_filters or any(not isinstance(value, bool) for value in parsed_vad_filters):
            raise BenchmarkError("VAD mode list is invalid")
        prepared = _read_samples(samples)
        if module is None:
            model, version = _load_model(model_name, device, compute_type, allow_download, cpu_threads, importer)
        else:
            model_path = Path(model_name).expanduser()
            if not model_path.exists() or not model_path.is_dir():
                raise BenchmarkError("model path is missing")
            try:
                model = module.WhisperModel(
                    str(model_path),
                    device=device,
                    compute_type=compute_type,
                    local_files_only=True,
                    cpu_threads=cpu_threads,
                )
            except Exception as error:
                raise BenchmarkError("faster-whisper model could not be loaded") from error
            version = getattr(module, "__version__", "unknown") if isinstance(getattr(module, "__version__", "unknown"), str) else "unknown"
    except BenchmarkError as error:
        result["error"] = str(error)
        return finish(result)
    except Exception:
        result["error"] = "faster-whisper benchmark setup failed"
        return finish(result)

    result["versions"]["faster_whisper"] = version
    result["settings"] = {"beam_sizes": list(parsed_beam_sizes), "vad_filters": list(parsed_vad_filters), "repeat": repeat}
    result["samples"] = len(prepared)
    result["results"] = []

    try:
        for beam_size in parsed_beam_sizes:
            for vad_filter in parsed_vad_filters:
                sample_results: list[dict[str, Any]] = []
                all_times: list[float] = []
                for index, sample in enumerate(prepared, start=1):
                    times: list[float] = []
                    quality: list[dict[str, int | float]] = []
                    language = None
                    for _ in range(repeat):
                        started = clock()
                        transcript, language = _transcribe(model, sample["body"], beam_size, vad_filter)
                        times.append(_elapsed_ms(clock, started))
                        all_times.append(times[-1])
                        quality.append(score_transcript(sample["reference"], transcript))
                    sample_results.append({
                        "sample_index": index,
                        "format": sample["format"],
                        "duration_ms": round(sample["format"]["frames"] * 1000 / sample["format"]["sampleRate"], 2),
                        "language": language,
                        "runs": repeat,
                        "cer_mean": _mean([float(item["cer"]) for item in quality]),
                        "wer_mean": _mean([float(item["wer"]) for item in quality]),
                        "reference_chars": quality[0]["reference_chars"],
                        "hypothesis_chars_mean": _mean([float(item["hypothesis_chars"]) for item in quality], 2),
                        "inference_ms": _mean(times, 2),
                        "inference_ms_min": min(times),
                        "inference_ms_p95": _percentile_ms(times, 95),
                    })
                result["results"].append({
                    "beam_size": beam_size,
                    "vad_filter": vad_filter,
                    "samples": sample_results,
                    "aggregate": {
                        "sample_count": len(sample_results),
                        "cer_mean": _mean([float(item["cer_mean"]) for item in sample_results]),
                        "wer_mean": _mean([float(item["wer_mean"]) for item in sample_results]),
                        "inference_ms_mean": _mean([float(item["inference_ms"]) for item in sample_results], 2),
                        "inference_ms_p95": _percentile_ms(all_times, 95),
                    },
                })
    except Exception:
        result.pop("results", None)
        result["error"] = "faster-whisper benchmark failed"
        return finish(result)
    result["ok"] = True
    return finish(result)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Benchmark a local faster-whisper model against a redacted sample manifest.")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL"))
    parser.add_argument("--manifest", required=True, help="JSON manifest with samples containing audio and reference paths")
    parser.add_argument("--beam-sizes", default=",".join(str(value) for value in DEFAULT_BEAM_SIZES), help="comma-separated beam sizes from 1 to 10")
    parser.add_argument("--vad", choices=("on", "off", "both"), default="both")
    parser.add_argument("--device", default=os.environ.get("WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"))
    parser.add_argument("--cpu-threads", type=int, default=4)
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--allow-model-download", action="store_true")
    parser.add_argument("--json", action="store_true", dest="json_output")
    args = parser.parse_args(argv)
    try:
        samples = load_manifest(args.manifest)
        beam_sizes = parse_beam_sizes(args.beam_sizes)
        vad_filters = parse_vad_modes(args.vad)
        result = run_benchmark(
            args.model,
            samples,
            beam_sizes=beam_sizes,
            vad_filters=vad_filters,
            repeat=args.repeat,
            device=args.device,
            compute_type=args.compute_type,
            cpu_threads=args.cpu_threads,
            allow_download=args.allow_model_download,
        )
    except BenchmarkError as error:
        result = {"ok": False, "provider": "faster-whisper", "versions": {}, "error": str(error)}
    if args.json_output:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    elif result["ok"]:
        print(f"ASR benchmark verified: {result['samples']} sample(s), {result['settings']['repeat']} run(s) per case")
        for case in result["results"]:
            aggregate = case["aggregate"]
            print(
                f"beam={case['beam_size']} vad={'on' if case['vad_filter'] else 'off'} "
                f"CER={aggregate['cer_mean']:.4f} WER={aggregate['wer_mean']:.4f} "
                f"latency={aggregate['inference_ms_mean']:.2f} ms p95={aggregate['inference_ms_p95']:.2f} ms"
            )
    else:
        print(f"NOT VERIFIED: {result['error']}")
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
