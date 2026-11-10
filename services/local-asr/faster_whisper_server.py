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
import signal
import tempfile
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MAX_BODY_BYTES = 32 * 1024 * 1024
MAX_TEXT_LENGTH = 20_000
ALLOWED_SAMPLE_RATES = range(8_000, 384_001)


class AudioError(ValueError):
    pass


def validate_wav(body: bytes) -> dict[str, int]:
    if not body or len(body) > MAX_BODY_BYTES:
        raise AudioError("audio body is outside the supported size")
    try:
        with wave.open(io.BytesIO(body), "rb") as wav:
            channels = wav.getnchannels()
            sample_rate = wav.getframerate()
            sample_width = wav.getsampwidth()
            frame_count = wav.getnframes()
            compression = wav.getcomptype()
            if compression != "NONE" or channels < 1 or channels > 32 or sample_rate not in ALLOWED_SAMPLE_RATES:
                raise AudioError("unsupported PCM WAV format")
            if sample_width not in (1, 2, 3, 4) or frame_count <= 0:
                raise AudioError("unsupported PCM WAV format")
            data = wav.readframes(frame_count)
            if len(data) != frame_count * channels * sample_width:
                raise AudioError("truncated PCM WAV data")
            return {"channels": channels, "sampleRate": sample_rate, "bitsPerSample": sample_width * 8, "frames": frame_count}
    except (wave.Error, EOFError) as error:
        raise AudioError("invalid PCM WAV container") from error


def load_model(model_name: str | None, device: str, compute_type: str, allow_download: bool):
    if not model_name:
        raise RuntimeError("WHISPER_MODEL or --model is required")
    model_path = Path(model_name).expanduser()
    if not allow_download and not model_path.exists():
        raise RuntimeError("model path is missing; pass --allow-model-download for a named model")
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise RuntimeError("faster-whisper is not installed") from error
    kwargs: dict[str, Any] = {"device": device, "compute_type": compute_type}
    if model_path.exists():
        model_name = str(model_path)
    return WhisperModel(model_name, **kwargs)


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
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/healthz":
            self.send_json(404, {"error": "not found"})
            return
        model_error = getattr(self.server, "model_error", None)
        self.send_json(503 if model_error else 200, {"ok": not bool(model_error), "provider": "faster-whisper"} if not model_error else {"ok": False, "error": "local ASR model is unavailable"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/transcribe":
            self.send_json(404, {"error": "not found"})
            return
        if getattr(self.server, "model_error", None) or getattr(self.server, "model", None) is None:
            self.send_json(503, {"error": "local ASR model is unavailable"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            content_length = -1
        if content_length <= 0 or content_length > MAX_BODY_BYTES:
            self.send_json(413, {"error": "audio body is outside the supported size"})
            return
        body = self.rfile.read(content_length)
        try:
            fmt = validate_wav(body)
            with tempfile.NamedTemporaryFile(prefix="coding-help-asr-", suffix=".wav", delete=False) as handle:
                handle.write(body)
                audio_path = handle.name
            try:
                segments, info = self.server.model.transcribe(audio_path, beam_size=5, vad_filter=True)
                text = " ".join(segment.text.strip() for segment in segments).strip()
            finally:
                Path(audio_path).unlink(missing_ok=True)
            if not text or len(text) > MAX_TEXT_LENGTH:
                self.send_json(422, {"error": "local ASR returned an invalid transcript"})
                return
            self.send_json(200, {"text": text, "provider": "faster-whisper", "language": getattr(info, "language", None), "format": fmt})
        except AudioError:
            self.send_json(400, {"error": "invalid PCM WAV input"})
        except Exception:
            self.send_json(502, {"error": "local ASR transcription failed"})


def create_server(host: str, port: int, model_name: str | None, device: str, compute_type: str, allow_download: bool) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), Handler)
    try:
        server.model = load_model(model_name, device, compute_type, allow_download)
        server.model_error = None
    except Exception as error:  # The server remains useful for /healthz diagnostics.
        server.model = None
        server.model_error = str(error)
    return server


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve a user-supplied faster-whisper model over loopback HTTP.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("CODING_HELP_ASR_PORT", "43123")))
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL"))
    parser.add_argument("--device", default=os.environ.get("WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"))
    parser.add_argument("--allow-model-download", action="store_true", help="allow faster-whisper to download a named model")
    args = parser.parse_args()
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        parser.error("--host must be a loopback address")
    server = create_server(args.host, args.port, args.model, args.device, args.compute_type, args.allow_model_download)
    def stop(_signum: int, _frame: Any) -> None:
        server.shutdown()
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print(f"faster-whisper ASR listening on http://{args.host}:{server.server_address[1]}", flush=True)
    if server.model_error:
        print("Model unavailable; /healthz will return 503 until configuration is fixed.", flush=True)
    server.serve_forever()
    server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
