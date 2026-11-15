#!/usr/bin/env python3
"""Start the local ASR service and exercise its health and WAV endpoints."""

from __future__ import annotations

import argparse
import http.client
import io
import json
import os
import socket
import subprocess
import sys
import time
import wave
from pathlib import Path
from typing import Any, Callable


SERVER_PATH = Path(__file__).parents[1] / "services" / "local-asr" / "faster_whisper_server.py"
MAX_RESPONSE_BYTES = 64 * 1024
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


class SmokeError(RuntimeError):
    """A fixed, safe error suitable for CLI output."""


def silence_wav(seconds: int = 1, sample_rate: int = 16_000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b"\0" * seconds * sample_rate * 2)
    return buffer.getvalue()


def _allocate_port(host: str) -> int:
    family = socket.AF_INET6 if host == "::1" else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as listener:
        listener.bind((host, 0))
        return int(listener.getsockname()[1])


def _request_json(
    host: str,
    port: int,
    method: str,
    body: bytes | None = None,
    timeout: float = 2.0,
) -> tuple[int, dict[str, Any]]:
    path = "/healthz" if method == "GET" else "/transcribe"
    headers: dict[str, str] = {}
    if body is not None:
        headers = {"Content-Type": "audio/wav", "Content-Length": str(len(body))}
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise SmokeError("local ASR response is too large")
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError) as error:
            raise SmokeError("local ASR returned invalid JSON") from error
        if not isinstance(payload, dict):
            raise SmokeError("local ASR returned an invalid response")
        return response.status, payload
    finally:
        connection.close()


def _safe_format(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, int] = {}
    for key in ("sampleRate", "bitsPerSample", "channels", "frames"):
        candidate = value.get(key)
        if isinstance(candidate, int) and not isinstance(candidate, bool) and candidate >= 0:
            result[key] = candidate
    return result


def redact_health(payload: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    if isinstance(payload.get("ok"), bool):
        result["ok"] = payload["ok"]
    if isinstance(payload.get("provider"), str):
        result["provider"] = payload["provider"]
    if isinstance(payload.get("error"), str):
        result["error"] = "local ASR model is unavailable"
    return result


def redact_transcription(payload: dict[str, Any]) -> dict[str, Any]:
    text = payload.get("text")
    return {
        "provider": payload.get("provider") if isinstance(payload.get("provider"), str) else None,
        "language": payload.get("language") if isinstance(payload.get("language"), str) else None,
        "format": _safe_format(payload.get("format")),
        "text_chars": len(text) if isinstance(text, str) else None,
    }


def build_command(
    host: str,
    port: int,
    model_name: str | None,
    device: str,
    compute_type: str,
    cpu_threads: int,
    allow_download: bool,
) -> list[str]:
    command = [
        sys.executable,
        str(SERVER_PATH),
        "--host",
        host,
        "--port",
        str(port),
        "--device",
        device,
        "--compute-type",
        compute_type,
        "--cpu-threads",
        str(cpu_threads),
    ]
    if model_name:
        command.extend(("--model", model_name))
    if allow_download:
        command.append("--allow-model-download")
    return command


def _stop_process(process: Any) -> None:
    if process.poll() is not None:
        return
    try:
        process.terminate()
        process.wait(timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        try:
            process.kill()
            process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            return


def run_smoke(
    model_name: str | None,
    *,
    audio_path: str | None = None,
    host: str = "127.0.0.1",
    device: str = "cpu",
    compute_type: str = "int8",
    cpu_threads: int = 4,
    allow_download: bool = False,
    timeout: float = 30.0,
    popen_factory: Callable[..., Any] = subprocess.Popen,
    requester: Callable[..., tuple[int, dict[str, Any]]] = _request_json,
    port_allocator: Callable[[str], int] = _allocate_port,
    clock: Callable[[], float] = time.monotonic,
    sleeper: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    if host not in LOOPBACK_HOSTS:
        raise SmokeError("host must be a loopback address")
    if not isinstance(cpu_threads, int) or cpu_threads < 1:
        raise SmokeError("cpu thread count is invalid")
    if timeout <= 0:
        raise SmokeError("smoke timeout is invalid")
    try:
        body = Path(audio_path).read_bytes() if audio_path else silence_wav()
    except OSError as error:
        raise SmokeError("audio file could not be read") from error

    try:
        port = port_allocator(host)
    except OSError as error:
        raise SmokeError("local ASR service could not allocate a port") from error
    command = build_command(host, port, model_name, device, compute_type, cpu_threads, allow_download)
    try:
        process = popen_factory(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
    except OSError as error:
        raise SmokeError("local ASR service could not start") from error

    try:
        health_response: tuple[int, dict[str, Any]] | None = None
        deadline = clock() + timeout
        while clock() < deadline:
            if process.poll() is not None:
                raise SmokeError("local ASR service exited before health check")
            try:
                health_response = requester(host, port, "GET", timeout=min(2.0, max(0.1, deadline - clock())))
                break
            except (OSError, SmokeError):
                sleeper(0.1)
        if health_response is None:
            raise SmokeError("local ASR health check timed out")

        health_status, health_payload = health_response
        safe_health = {"status": health_status, "payload": redact_health(health_payload)}
        if health_status != 200 or health_payload.get("ok") is not True:
            return {"ok": False, "error": "local ASR health check failed", "health": safe_health}

        transcribe_status, transcribe_payload = requester(host, port, "POST", body=body, timeout=2.0)
        report: dict[str, Any] = {
            "ok": transcribe_status == 200,
            "health": safe_health,
            "transcribe": {"status": transcribe_status, "payload": redact_transcription(transcribe_payload)},
        }
        if transcribe_status != 200:
            report["error"] = "local ASR transcription failed"
        return report
    finally:
        _stop_process(process)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Start and smoke-test the local faster-whisper loopback service.")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL"))
    parser.add_argument("--audio", help="optional PCM WAV sample; defaults to generated silence")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--device", default=os.environ.get("WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"))
    parser.add_argument("--cpu-threads", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--allow-model-download", action="store_true", help="allow a named model to be downloaded")
    parser.add_argument("--json", action="store_true", dest="json_output", help="print a machine-readable JSON report")
    args = parser.parse_args(argv)
    try:
        result = run_smoke(
            args.model,
            audio_path=args.audio,
            host=args.host,
            device=args.device,
            compute_type=args.compute_type,
            cpu_threads=args.cpu_threads,
            allow_download=args.allow_model_download,
            timeout=args.timeout,
        )
    except SmokeError as error:
        result = {"ok": False, "error": str(error)}
    if args.json_output:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    elif result["ok"]:
        transcribe = result["transcribe"]["payload"]
        print(f"ASR smoke verified: language {transcribe['language']}, transcript chars {transcribe['text_chars']}")
    else:
        print(f"NOT VERIFIED: {result['error']}")
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
