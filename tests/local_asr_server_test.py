import io
import json
import unittest
import wave
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parents[1] / "services" / "local-asr"))
import faster_whisper_server as server  # noqa: E402


def wav_bytes() -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0" * 160)
    return output.getvalue()


class LocalAsrServerTests(unittest.TestCase):
    def test_validate_wav(self):
        result = server.validate_wav(wav_bytes())
        self.assertEqual(result["sampleRate"], 16000)
        self.assertEqual(result["bitsPerSample"], 16)
        with self.assertRaises(server.AudioError):
            server.validate_wav(b"not wav")

    def test_health_fails_closed_without_model(self):
        with self.assertRaises(RuntimeError):
            server.load_model(None, "cpu", "int8", False)


if __name__ == "__main__":
    unittest.main()
