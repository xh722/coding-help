import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
import asr_runtime_stability as stability  # noqa: E402


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


class FakeClock:
    def __init__(self):
        self.value = 100.0

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += seconds


class AsrRuntimeStabilityTests(unittest.TestCase):
    def test_repeats_redacted_probe_and_checks_health_afterward(self):
        process = FakeProcess()
        clock = FakeClock()
        requests = []

        def requester(host, port, method, body=None, timeout=0):
            requests.append((host, port, method, body, timeout))
            clock.advance(0.025 if method == "POST" else 0.001)
            if method == "GET":
                return 200, {"ok": True, "provider": "faster-whisper"}
            return 200, {
                "text": "secret transcript",
                "provider": "faster-whisper",
                "language": "zh",
                "format": {"sampleRate": 16000, "frames": 16000},
            }

        result = stability.run_stability(
            "tiny",
            iterations=3,
            popen_factory=lambda *args, **kwargs: process,
            requester=requester,
            port_allocator=lambda _host: 43210,
            clock=clock,
            sleeper=lambda _seconds: None,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["iterations"], 3)
        self.assertEqual(result["successes"], 3)
        self.assertEqual(result["failures"], 0)
        self.assertEqual([request[2] for request in requests], ["GET", "POST", "POST", "POST", "GET"])
        self.assertEqual(result["latency_ms"]["mean"], 25.0)
        self.assertTrue(result["cleanup"]["terminated"])
        self.assertNotIn("secret transcript", json.dumps(result))
        self.assertNotIn("tiny", json.dumps(result))

    def test_reports_failures_without_exposing_service_error(self):
        process = FakeProcess()
        calls = {"post": 0}

        def requester(_host, _port, method, body=None, timeout=0):
            if method == "GET":
                return 200, {"ok": True, "provider": "faster-whisper"}
            calls["post"] += 1
            if calls["post"] == 2:
                return 502, {"error": "/private/model/path"}
            return 200, {"text": "secret", "provider": "faster-whisper", "language": "zh", "format": {}}

        result = stability.run_stability(
            "tiny",
            iterations=3,
            popen_factory=lambda *args, **kwargs: process,
            requester=requester,
            port_allocator=lambda _host: 43210,
            sleeper=lambda _seconds: None,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["successes"], 2)
        self.assertEqual(result["failures"], 1)
        self.assertEqual(result["error"], "local ASR stability probe failed")
        self.assertNotIn("/private/model/path", json.dumps(result))
        self.assertTrue(process.terminated)

    def test_rejects_unbounded_options_before_starting_service(self):
        with self.assertRaises(stability.StabilityError):
            stability.run_stability("tiny", iterations=0)
        with self.assertRaises(stability.StabilityError):
            stability.run_stability("tiny", host="0.0.0.0")


if __name__ == "__main__":
    unittest.main()
