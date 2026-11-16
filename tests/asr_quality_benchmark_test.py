import io
import json
import sys
import tempfile
import types
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
import asr_quality_benchmark as benchmark  # noqa: E402


def silence_wav(seconds=1):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b"\0" * int(16000 * seconds) * 2)
    return buffer.getvalue()


class AsrQualityBenchmarkTests(unittest.TestCase):
    def test_manifest_resolves_relative_audio_and_reference_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "audio.wav").write_bytes(silence_wav())
            (root / "reference.txt").write_text("hello world", encoding="utf-8")
            manifest = root / "samples.json"
            manifest.write_text(json.dumps({"samples": [{"audio": "audio.wav", "reference": "reference.txt"}]}), encoding="utf-8")
            samples = benchmark.load_manifest(manifest)
        self.assertEqual(samples, [{"audio": root / "audio.wav", "reference": root / "reference.txt"}])

    def test_benchmark_runs_matrix_and_redacts_transcript(self):
        class Segment:
            text = "secret transcript"

        class Info:
            language = "en"

        class FakeModel:
            calls = []

            def __init__(self, _name, **_kwargs):
                pass

            def transcribe(self, _audio, **kwargs):
                FakeModel.calls.append(kwargs)
                return iter([Segment()]), Info()

        module = types.SimpleNamespace(__version__="fake-1", WhisperModel=FakeModel)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio = root / "audio.wav"
            reference = root / "reference.txt"
            audio.write_bytes(silence_wav())
            reference.write_text("secret transcript", encoding="utf-8")
            result = benchmark.run_benchmark(
                directory,
                [{"audio": audio, "reference": reference}],
                beam_sizes=(1, 5),
                vad_filters=(True, False),
                repeat=2,
                module=module,
                importer=None,
            )
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["results"]), 4)
        self.assertEqual(result["results"][0]["aggregate"]["sample_count"], 1)
        self.assertEqual(result["results"][0]["samples"][0]["cer_mean"], 0.0)
        self.assertEqual(len(FakeModel.calls), 8)
        self.assertNotIn("secret transcript", json.dumps(result))

    def test_invalid_beam_size_and_empty_manifest_are_rejected(self):
        with self.assertRaises(benchmark.BenchmarkError):
            benchmark.parse_beam_sizes("1,11")
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "empty.json"
            manifest.write_text(json.dumps({"samples": []}), encoding="utf-8")
            with self.assertRaises(benchmark.BenchmarkError):
                benchmark.load_manifest(manifest)


if __name__ == "__main__":
    unittest.main()
