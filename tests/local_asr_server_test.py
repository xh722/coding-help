import contextlib
import http.client
import io
import json
from pathlib import Path
import select
import signal
import socket
import struct
import subprocess
import sys
import threading
import types
import unittest
from unittest.mock import patch
import wave

sys.path.insert(0, str(Path(__file__).parents[1] / "services" / "local-asr"))
import faster_whisper_server as server  # noqa: E402


def wav_bytes() -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
        wav.writeframes(b"\0\0" * 160)
    return output.getvalue()


class FakeModel:
    def __init__(self, texts=(" hello ", "world")):
        self.texts = texts; self.audio = None

    def transcribe(self, audio, **_kwargs):
        self.audio = audio
        return (types.SimpleNamespace(text=text) for text in self.texts), types.SimpleNamespace(language="en")


@contextlib.contextmanager
def running_server(model=None, **options):
    with patch.object(server, "load_model", return_value=model or FakeModel()):
        httpd = server.create_server("127.0.0.1", 0, None, "cpu", "int8", False, **options)
    worker = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
    worker.start()
    try:
        yield httpd
    finally:
        httpd.shutdown(); httpd.server_close(); worker.join(timeout=2)


def request(httpd, method="POST", body=None, headers=None, path="/transcribe"):
    connection = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=2)
    try:
        connection.request(method, path, body=wav_bytes() if body is None and method == "POST" else body,
                           headers={"Content-Type": "audio/wav"} if headers is None else headers)
        response = connection.getresponse()
        return response.status, json.loads(response.read())
    finally:
        connection.close()


class LocalAsrServerTests(unittest.TestCase):
    def test_validate_wav_strictly_checks_container_and_layout(self):
        self.assertEqual(server.validate_wav(wav_bytes()), {"sampleRate": 16000, "bitsPerSample": 16, "channels": 1, "frames": 160})
        original = bytearray(wav_bytes())
        for offset, value, code in [(4, 0, "I"), (28, 1, "I"), (32, 1, "H"), (20, 3, "H")]:
            body = bytearray(original); struct.pack_into("<" + code, body, offset, value)
            with self.subTest(offset=offset):
                with self.assertRaises(server.AudioError): server.validate_wav(body)
        with self.assertRaises(server.AudioError): server.validate_wav(bytes(original[:-1]))

    def test_wav_chunk_padding_and_actual_frames(self):
        original = wav_bytes()
        malformed = [original + b"junk", original[:44], original[:12] + b"JUNK\x01\0\0\0x" + original[12:]]
        for body in malformed:
            body = bytearray(body); struct.pack_into("<I", body, 4, len(body) - 8)
            with self.subTest(size=len(body)):
                with self.assertRaises(server.AudioError): server.validate_wav(body)
        padded = bytearray(original[:12] + b"JUNK\x01\0\0\0x\0" + original[12:])
        struct.pack_into("<I", padded, 4, len(padded) - 8)
        self.assertEqual(server.validate_wav(padded)["frames"], 160)

    def test_wav_accepts_full_32mib_pcm_plus_header_but_not_more(self):
        body = bytearray(wav_bytes()[:44]) + bytearray(32 * 1024 * 1024)
        struct.pack_into("<I", body, 4, len(body) - 8); struct.pack_into("<I", body, 40, 32 * 1024 * 1024)
        self.assertEqual(server.validate_wav(body)["frames"], 16 * 1024 * 1024)
        with self.assertRaises(server.AudioError): server.validate_wav(body + b"\0\0")

    def test_create_server_rejects_external_bind_before_loading(self):
        with patch.object(server, "load_model") as load:
            with self.assertRaises(ValueError): server.create_server("0.0.0.0", 0, None, "cpu", "int8", False)
            load.assert_not_called()

    def test_localhost_is_literal_ipv4_and_ipv6_loopback_supported(self):
        with patch.object(server, "load_model", return_value=FakeModel()):
            ipv4 = server.create_server("localhost", 0, None, "cpu", "int8", False)
        self.addCleanup(ipv4.server_close); self.assertEqual(ipv4.server_address[0], "127.0.0.1")
        with patch.object(server, "load_model", return_value=FakeModel()):
            ipv6 = server.create_server("::1", 0, None, "cpu", "int8", False)
        self.addCleanup(ipv6.server_close); self.assertEqual(ipv6.address_family, socket.AF_INET6)

    def test_load_model_is_local_only_with_four_cpu_threads(self):
        captured = {}
        def factory(name, **kwargs): captured.update(name=name, **kwargs); return FakeModel()
        with patch.dict(sys.modules, {"faster_whisper": types.SimpleNamespace(WhisperModel=factory)}):
            server.load_model(str(Path(__file__).parent), "cpu", "int8", False)
        self.assertTrue(captured["local_files_only"]); self.assertEqual(captured["cpu_threads"], 4)

    def test_model_download_requires_opt_in(self):
        with self.assertRaises(RuntimeError): server.load_model("missing-private-model", "cpu", "int8", False)
        captured = {}
        def factory(name, **kwargs): captured.update(name=name, **kwargs); return FakeModel()
        with patch.dict(sys.modules, {"faster_whisper": types.SimpleNamespace(WhisperModel=factory)}):
            server.load_model("tiny", "cpu", "int8", True, cpu_threads=2)
        self.assertFalse(captured["local_files_only"]); self.assertEqual(captured["cpu_threads"], 2)

    def test_http_transcribes_memory_file_and_empty_is_success(self):
        model = FakeModel()
        with running_server(model) as httpd:
            self.assertEqual(request(httpd, "GET", path="/healthz")[0], 200)
            status, payload = request(httpd)
        self.assertEqual(status, 200); self.assertEqual(payload["text"], "hello world"); self.assertIsInstance(model.audio, io.BytesIO)
        with running_server(FakeModel(())) as httpd:
            self.assertEqual(request(httpd)[1]["text"], "")

    def test_invalid_content_and_model_errors_have_fixed_responses(self):
        with running_server() as httpd:
            self.assertEqual(request(httpd, body=b"bad"), (400, {"error": "invalid PCM WAV input"}))
            self.assertIn(request(httpd, headers={"Content-Type": "application/json"})[0], (400, 415))
        class Broken:
            def transcribe(self, *_args, **_kwargs): raise RuntimeError("/private/secret")
        with running_server(Broken()) as httpd:
            self.assertEqual(request(httpd), (502, {"error": "local ASR transcription failed"}))

    def test_lazy_transcript_limit_stops_consumption(self):
        def too_long():
            yield "x" * 20001
            raise AssertionError("must stop consuming at text limit")
        with running_server(FakeModel(too_long())) as httpd:
            self.assertEqual(request(httpd), (422, {"error": "local ASR returned an invalid transcript"}))

    def test_lazy_model_audioerror_is_not_invalid_input(self):
        def broken():
            yield "hi"
            raise server.AudioError("/private/secret")
        with running_server(FakeModel(broken())) as httpd:
            self.assertEqual(request(httpd), (502, {"error": "local ASR transcription failed"}))

    def test_http_rejects_ambiguous_encoding_lengths_and_missing_type(self):
        with running_server() as httpd:
            self.assertEqual(request(httpd, headers={})[0], 415)
            self.assertEqual(request(httpd, headers={"Content-Type": "audio/wav", "Transfer-Encoding": "chunked"})[0], 400)
            for length in [b"Content-Length: 364\r\nContent-Length: 364", b"Content-Length: +364", b"Content-Length: invalid"]:
                with self.subTest(length=length):
                    with socket.create_connection(("127.0.0.1", httpd.server_port), timeout=2) as client:
                        client.sendall(b"POST /transcribe HTTP/1.0\r\nContent-Type: audio/wav\r\n" + length + b"\r\n\r\n" + wav_bytes())
                        self.assertIn(b" 400 ", client.recv(4096).split(b"\r\n")[0])

    def test_truncated_body_and_socket_timeout_release_inference(self):
        with running_server(request_timeout=0.1) as httpd:
            for truncate in (True, False):
                with self.subTest(truncate=truncate):
                    with socket.create_connection(("127.0.0.1", httpd.server_port), timeout=2) as client:
                        client.sendall(b"POST /transcribe HTTP/1.0\r\nContent-Type: audio/wav\r\nContent-Length: 999\r\n\r\n" + wav_bytes())
                        if truncate: client.shutdown(socket.SHUT_WR)
                        self.assertIn(b" 400 " if truncate else b" 408 ", client.recv(4096).split(b"\r\n")[0])
                    self.assertEqual(request(httpd)[0], 200)

    def test_handler_count_is_bounded_and_slot_recovers(self):
        entered, release = threading.Event(), threading.Event()
        class Slow(FakeModel):
            def transcribe(self, *args, **kwargs):
                entered.set(); release.wait(2); return super().transcribe(*args, **kwargs)
        with running_server(Slow(), max_handlers=1) as httpd:
            worker = threading.Thread(target=request, args=(httpd,)); worker.start()
            try:
                self.assertTrue(entered.wait(1))
                self.assertEqual(request(httpd, "GET", path="/healthz"), (503, {"error": "local ASR is busy"}))
            finally:
                release.set(); worker.join(2)
            self.assertEqual(request(httpd, "GET", path="/healthz")[0], 200)

    def test_busy_inference_returns_503_and_health_stays_responsive(self):
        entered, release = threading.Event(), threading.Event()
        class Slow(FakeModel):
            def transcribe(self, *args, **kwargs):
                entered.set(); release.wait(2); return super().transcribe(*args, **kwargs)
        with running_server(Slow()) as httpd:
            worker = threading.Thread(target=request, args=(httpd,)); worker.start()
            try:
                self.assertTrue(entered.wait(1))
                self.assertEqual(request(httpd)[0], 503); self.assertEqual(request(httpd, "GET", path="/healthz")[0], 200)
            finally:
                release.set(); worker.join(2)

    def test_cli_sigterm_and_sigint_exit_without_lingering_process(self):
        for stop_signal in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(signal=stop_signal):
                process = subprocess.Popen([sys.executable, server.__file__, "--port", "0", "--model", "/missing-private-model"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    self.assertTrue(select.select([process.stdout], [], [], 3)[0])
                    line = process.stdout.readline(); self.assertIn("listening", line); port = int(line.rstrip().rsplit(":", 1)[1])
                    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
                    connection.request("GET", "/healthz"); response = connection.getresponse()
                    self.assertEqual(response.status, 503); self.assertEqual(json.loads(response.read()), {"ok": False, "error": "local ASR model is unavailable"}); connection.close()
                    process.send_signal(stop_signal); self.assertEqual(process.wait(2), 0)
                    with self.assertRaises(OSError):
                        with socket.create_connection(("127.0.0.1", port), timeout=0.2): pass
                finally:
                    if process.poll() is None: process.kill()
                    process.communicate(timeout=2)



if __name__ == "__main__": unittest.main()
