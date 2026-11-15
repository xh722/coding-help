import io
import sys
import tempfile
import types
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
import asr_runtime_doctor as doctor  # noqa: E402


def silence_wav(seconds=1):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b"\0" * int(16000 * seconds) * 2)
    return buffer.getvalue()


class AsrRuntimeDoctorTests(unittest.TestCase):
    def test_missing_dependency_is_not_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            result = doctor.run_doctor(
                directory,
                module=None,
                importer=lambda _name: (_ for _ in ()).throw(ImportError()),
            )
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "faster-whisper is not installed")

    def test_local_model_load_reports_versions_and_elapsed_time(self):
        class FakeModel:
            def __init__(self, name, **kwargs):
                self.name = name
                self.kwargs = kwargs

        module = types.SimpleNamespace(__version__="fake-1", WhisperModel=FakeModel)
        with tempfile.TemporaryDirectory() as directory:
            result = doctor.run_doctor(directory, module=module, importer=None)
        self.assertTrue(result["ok"])
        self.assertEqual(result["provider"], "faster-whisper")
        self.assertEqual(result["versions"]["faster_whisper"], "fake-1")
        self.assertEqual(result["model"]["source"], "local")
        self.assertGreaterEqual(result["model"]["load_ms"], 0)

    def test_audio_probe_reports_format_language_and_text_length_without_text(self):
        class Segment:
            text = "secret transcript"

        class Info:
            language = "en"

        class FakeModel:
            def __init__(self, _name, **_kwargs):
                pass

            def transcribe(self, audio, **_kwargs):
                self.audio = audio
                return iter([Segment()]), Info()

        module = types.SimpleNamespace(__version__="fake-1", WhisperModel=FakeModel)
        with tempfile.TemporaryDirectory() as directory:
            audio_path = Path(directory) / "sample.wav"
            audio_path.write_bytes(silence_wav())
            result = doctor.run_doctor(directory, audio_path=str(audio_path), module=module, importer=None)
        self.assertTrue(result["ok"])
        self.assertEqual(result["audio"]["language"], "en")
        self.assertEqual(result["audio"]["transcript_chars"], len("secret transcript"))
        self.assertNotIn("secret transcript", str(result))
        self.assertEqual(result["audio"]["format"]["sampleRate"], 16000)

    def test_report_includes_process_cpu_and_peak_memory_metrics(self):
        class FakeModel:
            def __init__(self, _name, **_kwargs):
                pass

        usage = iter([
            {"user": 1.0, "system": 0.5, "maxrss": 1024},
            {"user": 1.25, "system": 0.75, "maxrss": 4096},
        ])
        module = types.SimpleNamespace(__version__="fake-1", WhisperModel=FakeModel)
        with tempfile.TemporaryDirectory() as directory:
            result = doctor.run_doctor(directory, module=module, importer=None, usage_reader=lambda: next(usage))
        self.assertTrue(result["ok"])
        self.assertEqual(result["process"]["cpu_user_ms"], 250.0)
        self.assertEqual(result["process"]["cpu_system_ms"], 250.0)
        self.assertEqual(result["process"]["max_rss_mb"], 4.0)

    def test_audio_probe_supports_repeat_benchmark_statistics(self):
        class Segment:
            text = "repeatable"

        class Info:
            language = "en"

        class FakeModel:
            calls = 0

            def __init__(self, _name, **_kwargs):
                pass

            def transcribe(self, _audio, **_kwargs):
                self.calls += 1
                return iter([Segment()]), Info()

        module = types.SimpleNamespace(__version__="fake-1", WhisperModel=FakeModel)
        with tempfile.TemporaryDirectory() as directory:
            audio_path = Path(directory) / "sample.wav"
            audio_path.write_bytes(silence_wav())
            result = doctor.run_doctor(directory, audio_path=str(audio_path), repeat=3, module=module, importer=None)
        self.assertTrue(result["ok"])
        self.assertEqual(result["audio"]["runs"], 3)
        self.assertEqual(result["audio"]["transcript_chars"], len("repeatable"))
        self.assertGreaterEqual(result["audio"]["inference_ms"], 0)
        self.assertGreaterEqual(result["audio"]["inference_ms_p95"], result["audio"]["inference_ms_min"])

    def test_repeat_count_must_be_positive(self):
        with tempfile.TemporaryDirectory() as directory:
            result = doctor.run_doctor(directory, repeat=0, module=types.SimpleNamespace(), importer=None)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "audio repeat count is invalid")

    def test_expected_transcript_reports_quality_without_raw_text(self):
        class Segment:
            text = "hello world"

        class Info:
            language = "en"

        class FakeModel:
            def __init__(self, _name, **_kwargs):
                pass

            def transcribe(self, _audio, **_kwargs):
                return iter([Segment()]), Info()

        module = types.SimpleNamespace(__version__="fake-1", WhisperModel=FakeModel)
        with tempfile.TemporaryDirectory() as directory:
            audio_path = Path(directory) / "sample.wav"
            audio_path.write_bytes(silence_wav())
            result = doctor.run_doctor(
                directory,
                audio_path=str(audio_path),
                expected_text="hello world",
                module=module,
                importer=None,
            )
        self.assertTrue(result["ok"])
        self.assertEqual(result["audio"]["quality"]["cer"], 0.0)
        self.assertEqual(result["audio"]["quality"]["wer"], 0.0)
        self.assertNotIn("hello world", str(result))


if __name__ == "__main__":
    unittest.main()
