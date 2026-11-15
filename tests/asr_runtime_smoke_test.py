import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
import asr_runtime_smoke as smoke  # noqa: E402


class FakeProcess:
    def __init__(self):
        self.returncode = None
        self.terminated = False

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = 0

    def wait(self, timeout=None):
        self.returncode = 0
        return self.returncode

    def kill(self):
        self.returncode = -9


class AsrRuntimeSmokeTests(unittest.TestCase):
    def test_redacts_transcript_but_preserves_safe_result_metadata(self):
        payload = {
            "text": "secret transcript",
            "provider": "faster-whisper",
            "language": "en",
            "format": {"sampleRate": 16000},
        }
        result = smoke.redact_transcription(payload)
        self.assertEqual(result["text_chars"], len("secret transcript"))
        self.assertEqual(result["language"], "en")
        self.assertNotIn("secret transcript", json.dumps(result))

    def test_run_smoke_starts_loopback_service_and_reports_safe_probe(self):
        process = FakeProcess()
        requests = []

        def requester(host, port, method, body=None, timeout=0):
            requests.append((host, port, method, body, timeout))
            if method == "GET":
                return 200, {"ok": True, "provider": "faster-whisper"}
            return 200, {
                "text": "secret transcript",
                "provider": "faster-whisper",
                "language": "en",
                "format": {"sampleRate": 16000, "frames": 16000},
            }

        with tempfile.TemporaryDirectory() as directory:
            audio_path = Path(directory) / "sample.wav"
            audio_path.write_bytes(smoke.silence_wav())
            result = smoke.run_smoke(
                "tiny",
                audio_path=str(audio_path),
                popen_factory=lambda *args, **kwargs: process,
                requester=requester,
                port_allocator=lambda _host: 43210,
                sleeper=lambda _seconds: None,
            )
        self.assertTrue(result["ok"])
        self.assertEqual(result["health"]["status"], 200)
        self.assertEqual(result["transcribe"]["payload"]["text_chars"], len("secret transcript"))
        self.assertNotIn("secret transcript", json.dumps(result))
        self.assertEqual([request[2] for request in requests], ["GET", "POST"])
        self.assertTrue(process.terminated)

    def test_run_smoke_rejects_external_bind_target(self):
        with self.assertRaises(smoke.SmokeError) as context:
            smoke.run_smoke("tiny", host="0.0.0.0")
        self.assertEqual(str(context.exception), "host must be a loopback address")

    def test_port_allocation_failure_is_fixed(self):
        with self.assertRaises(smoke.SmokeError) as context:
            smoke.run_smoke("tiny", port_allocator=lambda _host: (_ for _ in ()).throw(OSError()))
        self.assertEqual(str(context.exception), "local ASR service could not allocate a port")


if __name__ == "__main__":
    unittest.main()
