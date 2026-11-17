#!/usr/bin/env python3
"""Run a bounded, redacted local ASR lifecycle and stability probe."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable

from asr_runtime_doctor import _default_usage, _elapsed_ms, _percentile_ms, _process_metrics
from asr_runtime_smoke import (
    DEFAULT_BEAM_SIZE,
    LOOPBACK_HOSTS,
    SmokeError,
    _allocate_port,
    _request_json,
    _stop_process,
    build_command,
    redact_health,
    silence_wav,
    validate_beam_size,
)


DEFAULT_ITERATIONS = 5
MAX_ITERATIONS = 100


class StabilityError(RuntimeError):
    """A fixed, safe error suitable for CLI output."""


def validate_iterations(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_ITERATIONS:
        raise StabilityError("iteration count must be an integer between 1 and 100")
    return value


def _latency_summary(values: list[float]) -> dict[str, Any]:
    if not values:
        return {"count": 0, "mean": None, "min": None, "p95": None}
    return {
        "count": len(values),
        "mean": round(sum(values) / len(values), 2),
        "min": min(values),
        "p95": _percentile_ms(values, 95),
    }


def _status_key(status: int | str) -> str:
    return str(status) if isinstance(status, int) and not isinstance(status, bool) else "error"


def _base_result(iterations: int) -> dict[str, Any]:
    return {
        "ok": False,
        "provider": "faster-whisper",
        "iterations": iterations,
        "successes": 0,
        "failures": 0,
        "latency_ms": _latency_summary([]),
        "health": {},
        "transcribe": {"status_counts": {}},
        "cleanup": {"terminated": False, "exit_code": None},
    }


def run_stability(
    model_name: str | None,
    *,
    iterations: int = DEFAULT_ITERATIONS,
    audio_path: str | None = None,
    host: str = "127.0.0.1",
    device: str = "cpu",
    compute_type: str = "int8",
    cpu_threads: int = 4,
    allow_download: bool = False,
    vad_filter: bool = True,
    beam_size: int = DEFAULT_BEAM_SIZE,
    timeout: float = 30.0,
    popen_factory: Callable[..., Any] = subprocess.Popen,
    requester: Callable[..., tuple[int, dict[str, Any]]] = _request_json,
    port_allocator: Callable[[str], int] = _allocate_port,
    clock: Callable[[], float] = time.monotonic,
    sleeper: Callable[[float], None] = time.sleep,
    usage_reader: Callable[[], dict[str, float] | None] | None = None,
) -> dict[str, Any]:
    validate_iterations(iterations)
    if host not in LOOPBACK_HOSTS:
        raise StabilityError("host must be a loopback address")
    if not isinstance(cpu_threads, int) or cpu_threads < 1:
        raise StabilityError("cpu thread count is invalid")
    validate_beam_size(beam_size)
    if timeout <= 0:
        raise StabilityError("stability timeout is invalid")
    try:
        body = Path(audio_path).read_bytes() if audio_path else silence_wav()
    except OSError as error:
        raise StabilityError("audio file could not be read") from error

    result = _base_result(iterations)
    usage_reader = usage_reader or _default_usage
    try:
        start_usage = usage_reader()
    except Exception:
        start_usage = None
    process = None
    latency_values: list[float] = []
    status_counts: dict[str, int] = {}
    languages: set[str] = set()
    format_metadata: dict[str, int] = {}

    try:
        try:
            port = port_allocator(host)
        except OSError as error:
            raise StabilityError("local ASR service could not allocate a port") from error
        command = build_command(host, port, model_name, device, compute_type, cpu_threads, allow_download, vad_filter, beam_size)
        try:
            process = popen_factory(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
        except OSError as error:
            raise StabilityError("local ASR service could not start") from error

        initial_health: tuple[int, dict[str, Any]] | None = None
        deadline = clock() + timeout
        while clock() < deadline:
            if process.poll() is not None:
                raise StabilityError("local ASR service exited before health check")
            try:
                initial_health = requester(host, port, "GET", timeout=min(2.0, max(0.1, deadline - clock())))
                break
            except (OSError, SmokeError, StabilityError):
                sleeper(0.1)
        if initial_health is None:
            raise StabilityError("local ASR health check timed out")
        initial_status, initial_payload = initial_health
        result["health"]["initial"] = {"status": initial_status, "payload": redact_health(initial_payload)}
        if initial_status != 200 or initial_payload.get("ok") is not True:
            result["error"] = "local ASR health check failed"
            return result

        for _ in range(iterations):
            if process.poll() is not None:
                result["failures"] += 1
                status_counts["error"] = status_counts.get("error", 0) + 1
                continue
            started = clock()
            status: int | str = "error"
            try:
                status, payload = requester(host, port, "POST", body=body, timeout=2.0)
                if status == 200 and isinstance(payload.get("text"), str):
                    result["successes"] += 1
                    language = payload.get("language")
                    if isinstance(language, str) and language:
                        languages.add(language)
                    safe_format = payload.get("format")
                    if isinstance(safe_format, dict) and not format_metadata:
                        format_metadata = {
                            key: value
                            for key, value in safe_format.items()
                            if key in ("sampleRate", "bitsPerSample", "channels", "frames")
                            and isinstance(value, int)
                            and not isinstance(value, bool)
                            and value >= 0
                        }
                else:
                    result["failures"] += 1
            except (OSError, SmokeError, StabilityError):
                result["failures"] += 1
            finally:
                latency_values.append(_elapsed_ms(clock, started))
                key = _status_key(status)
                status_counts[key] = status_counts.get(key, 0) + 1

        try:
            final_status, final_payload = requester(host, port, "GET", timeout=2.0)
            result["health"]["final"] = {"status": final_status, "payload": redact_health(final_payload)}
        except (OSError, SmokeError, StabilityError):
            result["health"]["final"] = {"status": None, "payload": {}}
        result["latency_ms"] = _latency_summary(latency_values)
        result["transcribe"] = {
            "status_counts": status_counts,
            "language": sorted(languages)[0] if len(languages) == 1 else None,
            "format": format_metadata,
        }
        final_health = result["health"].get("final", {})
        result["ok"] = (
            result["successes"] == iterations
            and result["failures"] == 0
            and final_health.get("status") == 200
            and final_health.get("payload", {}).get("ok") is True
        )
        if not result["ok"]:
            result["error"] = "local ASR stability probe failed"
        return result
    finally:
        if process is not None:
            _stop_process(process)
            try:
                result["cleanup"] = {
                    "terminated": process.poll() is not None,
                    "exit_code": process.poll(),
                }
            except Exception:
                result["cleanup"] = {"terminated": False, "exit_code": None}
        try:
            end_usage = usage_reader()
        except Exception:
            end_usage = None
        result["process"] = _process_metrics(start_usage, end_usage)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a bounded stability probe against a local faster-whisper service.")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL"))
    parser.add_argument("--audio", help="optional PCM WAV sample; defaults to generated silence")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--device", default=os.environ.get("WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"))
    parser.add_argument("--cpu-threads", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--iterations", type=int, default=DEFAULT_ITERATIONS)
    parser.add_argument("--allow-model-download", action="store_true", help="allow a named model to be downloaded")
    parser.add_argument("--no-vad-filter", action="store_true", help="disable VAD filtering")
    parser.add_argument("--beam-size", type=int, default=DEFAULT_BEAM_SIZE, help="faster-whisper beam size from 1 to 10")
    parser.add_argument("--json", action="store_true", dest="json_output", help="print a machine-readable JSON report")
    args = parser.parse_args(argv)
    try:
        result = run_stability(
            args.model,
            iterations=args.iterations,
            audio_path=args.audio,
            host=args.host,
            device=args.device,
            compute_type=args.compute_type,
            cpu_threads=args.cpu_threads,
            allow_download=args.allow_model_download,
            vad_filter=not args.no_vad_filter,
            beam_size=args.beam_size,
            timeout=args.timeout,
        )
    except StabilityError as error:
        result = _base_result(args.iterations if isinstance(args.iterations, int) else DEFAULT_ITERATIONS)
        result["error"] = str(error)
    if args.json_output:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    elif result["ok"]:
        latency = result["latency_ms"]
        print(f"ASR stability verified: {result['successes']}/{result['iterations']} probes, mean {latency['mean']:.2f} ms, P95 {latency['p95']:.2f} ms")
    else:
        print(f"NOT VERIFIED: {result['error']}")
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
