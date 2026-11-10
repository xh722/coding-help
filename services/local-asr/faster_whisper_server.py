#!/usr/bin/env python3
"""Optional loopback ASR server for a locally installed faster-whisper model.

The repository does not install the model or the faster-whisper dependency. This
server fails closed with a health error until the user supplies both explicitly.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import signal
import socket
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MAX_PCM_BYTES = 32 * 1024 * 1024
MAX_BODY_BYTES = MAX_PCM_BYTES + 44
MAX_TEXT_LENGTH = 20_000
ALLOWED_SAMPLE_RATES = range(8_000, 384_001)


class AudioError(ValueError):
    pass


def validate_wav(body: bytes) -> dict[str, int]:
    if not body or len(body) > MAX_BODY_BYTES:
        raise AudioError("audio body is outside the supported size")
    if len(body) < 12 or body[:4] != b"RIFF" or body[8:12] != b"WAVE" or struct.unpack_from("<I", body, 4)[0] != len(body) - 8:
        raise AudioError("invalid PCM WAV container")
    offset, fmt, pcm_size = 12, None, None
    while offset < len(body):
        if offset + 8 > len(body):
            raise AudioError("invalid PCM WAV chunk")
        chunk, size = body[offset:offset + 4], struct.unpack_from("<I", body, offset + 4)[0]
        start, end = offset + 8, offset + 8 + size
        padded_end = end + (size % 2)
        if padded_end > len(body) or (size % 2 and body[end] != 0):
            raise AudioError("invalid PCM WAV chunk")
        if chunk == b"fmt ":
            if fmt is not None or size not in (16, 18):
                raise AudioError("unsupported PCM WAV format")
            if size == 18 and body[start + 16:end] != b"\0\0":
                raise AudioError("unsupported PCM WAV format")
            encoding, channels, rate, byte_rate, alignment, bits = struct.unpack_from("<HHIIHH", body, start)
            if encoding != 1 or not 1 <= channels <= 32 or rate not in ALLOWED_SAMPLE_RATES or bits not in (8, 16, 24, 32):
                raise AudioError("unsupported PCM WAV format")
            if alignment != channels * (bits // 8) or byte_rate != rate * alignment:
                raise AudioError("unsupported PCM WAV layout")
            fmt = {"channels": channels, "sampleRate": rate, "bitsPerSample": bits}
        elif chunk == b"data":
            if fmt is None or pcm_size is not None or not size or size > MAX_PCM_BYTES:
                raise AudioError("invalid PCM WAV data")
            alignment = fmt["channels"] * (fmt["bitsPerSample"] // 8)
            if size % alignment:
                raise AudioError("invalid PCM WAV frames")
            pcm_size = size
            fmt["frames"] = size // alignment
        offset = padded_end
    if fmt is None or pcm_size is None:
        raise AudioError("invalid PCM WAV container")
    return fmt


def load_model(model_name: str | None, device: str, compute_type: str, allow_download: bool, cpu_threads: int = 4):
    if not model_name:
        raise RuntimeError("WHISPER_MODEL or --model is required")
    model_path = Path(model_name).expanduser()
    if not allow_download and not model_path.exists():
        raise RuntimeError("model path is missing; pass --allow-model-download for a named model")
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise RuntimeError("faster-whisper is not installed") from error
    kwargs: dict[str, Any] = {"device": device, "compute_type": compute_type, "local_files_only": not allow_download, "cpu_threads": cpu_threads}
    if model_path.exists():
        model_name = str(model_path)
    return WhisperModel(model_name, **kwargs)


class BoundedHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 4

    def __init__(self, address, handler, *, max_handlers: int, request_timeout: float):
        self.handler_slots = threading.BoundedSemaphore(max_handlers)
        self.inference_lock = threading.Lock()
        self.request_timeout = request_timeout
        super().__init__(address, handler)

    def process_request(self, request, client_address):
        request.settimeout(self.request_timeout)
        if not self.handler_slots.acquire(blocking=False):
            # No new thread or request body allocation when all handlers are busy.
            try:
                payload = b'{"error":"local ASR is busy"}'
                headers = ("HTTP/1.0 503 Service Unavailable\r\nContent-Type: application/json\r\n"
                           f"Content-Length: {len(payload)}\r\nConnection: close\r\n\r\n").encode("ascii")
                request.sendall(headers + payload)
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.handler_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.handler_slots.release()

    def handle_error(self, request, client_address):
        # Never expose model paths, request contents, or exception text in logs.
        return


class IPv6HTTPServer(BoundedHTTPServer):
    address_family = socket.AF_INET6


class Handler(BaseHTTPRequestHandler):
    server_version = "CodingHelpLocalASR/1"

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        try:
            self.wfile.write(encoded)
        except OSError:
            pass

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/healthz":
            self.send_json(404, {"error": "not found"})
            return
        model_error = getattr(self.server, "model_error", None) or self.server.model is None
        self.send_json(503 if model_error else 200, {"ok": not bool(model_error), "provider": "faster-whisper"} if not model_error else {"ok": False, "error": "local ASR model is unavailable"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/transcribe":
            self.send_json(404, {"error": "not found"})
            return
        if getattr(self.server, "model_error", None) or getattr(self.server, "model", None) is None:
            self.send_json(503, {"error": "local ASR model is unavailable"})
            return
        if self.headers.get_all("Transfer-Encoding"):
            self.send_json(400, {"error": "unsupported audio request encoding"})
            return
        content_types = self.headers.get_all("Content-Type", [])
        if len(content_types) != 1 or content_types[0].strip().lower() != "audio/wav":
            self.send_json(415, {"error": "unsupported audio content type"})
            return
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]+", lengths[0]) or len(lengths[0]) > 12:
            self.send_json(400, {"error": "invalid audio content length"})
            return
        content_length = int(lengths[0])
        if not 0 < content_length <= MAX_BODY_BYTES:
            self.send_json(413, {"error": "audio body is outside the supported size"})
            return
        if not self.server.inference_lock.acquire(blocking=False):
            self.send_json(503, {"error": "local ASR is busy"})
            return
        try:
            try:
                body = self.rfile.read(content_length)
            except (TimeoutError, socket.timeout):
                self.send_json(408, {"error": "audio request timed out"})
                return
            if len(body) != content_length:
                self.send_json(400, {"error": "incomplete audio body"})
                return
            try:
                fmt = validate_wav(body)
            except AudioError:
                self.send_json(400, {"error": "invalid PCM WAV input"})
                return
            try:
                segments, info = self.server.model.transcribe(io.BytesIO(body), beam_size=5, vad_filter=True)
                parts, length = [], 0
                for segment in segments:
                    part = segment.text.strip()
                    if not part:
                        continue
                    length += len(part) + bool(parts)
                    if length > MAX_TEXT_LENGTH:
                        self.send_json(422, {"error": "local ASR returned an invalid transcript"})
                        return
                    parts.append(part)
                self.send_json(200, {"text": " ".join(parts), "provider": "faster-whisper", "language": getattr(info, "language", None), "format": fmt})
            except Exception:
                self.send_json(502, {"error": "local ASR transcription failed"})
        finally:
            self.server.inference_lock.release()


def create_server(host: str, port: int, model_name: str | None, device: str, compute_type: str, allow_download: bool, cpu_threads: int = 4, *, max_handlers: int = 4, request_timeout: float = 10) -> ThreadingHTTPServer:
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("host must be a loopback address")
    if not 1 <= max_handlers <= 32 or request_timeout <= 0 or cpu_threads < 1:
        raise ValueError("invalid local ASR resource limits")
    host = "127.0.0.1" if host == "localhost" else host
    server_class = IPv6HTTPServer if host == "::1" else BoundedHTTPServer
    server = server_class((host, port), Handler, max_handlers=max_handlers, request_timeout=request_timeout)
    try:
        server.model = load_model(model_name, device, compute_type, allow_download, cpu_threads)
        server.model_error = None
    except Exception:  # The server remains useful for /healthz diagnostics.
        server.model = None
        server.model_error = "local ASR model is unavailable"
    return server


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve a user-supplied faster-whisper model over loopback HTTP.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("CODING_HELP_ASR_PORT", "43123")))
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL"))
    parser.add_argument("--device", default=os.environ.get("WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"))
    parser.add_argument("--allow-model-download", action="store_true", help="allow faster-whisper to download a named model")
    parser.add_argument("--cpu-threads", type=int, default=4)
    args = parser.parse_args()
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        parser.error("--host must be a loopback address")
    if args.cpu_threads < 1:
        parser.error("--cpu-threads must be positive")
    server = create_server(args.host, args.port, args.model, args.device, args.compute_type, args.allow_model_download, args.cpu_threads)

    def stop(_signum: int, _frame: Any) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print(f"faster-whisper ASR listening on http://{args.host}:{server.server_address[1]}", flush=True)
    if server.model_error:
        print("Model unavailable; /healthz will return 503 until configuration is fixed.", flush=True)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
