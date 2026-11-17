import tempfile
import types
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
import asr_runtime_preflight as preflight  # noqa: E402


class AsrRuntimePreflightTests(unittest.TestCase):
    def test_runtime_result_uses_fixed_codes_and_messages(self):
        self.assertEqual(
            preflight.runtime_result(False, "model path is missing"),
            {"ok": False, "code": "ASR_MODEL_MISSING", "message": "model path is missing"},
        )
        self.assertEqual(
            preflight.runtime_result(False, "/private/model failure"),
            {"ok": False, "code": "ASR_RUNTIME_UNAVAILABLE", "message": "ASR runtime is unavailable."},
        )
        self.assertEqual(
            preflight.runtime_result(True, "faster-whisper model loaded"),
            {"ok": True, "code": "ASR_READY", "message": "faster-whisper model loaded"},
        )

    def test_missing_dependency_is_not_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            ok, message = preflight.inspect_runtime(directory, module=None, importer=lambda _name: (_ for _ in ()).throw(ImportError()))
        self.assertFalse(ok)
        self.assertIn("faster-whisper is not installed", message)

    def test_missing_model_is_not_verified_without_loading(self):
        module = types.SimpleNamespace(WhisperModel=object)
        ok, message = preflight.inspect_runtime("/tmp/does-not-exist", module=module, importer=None)
        self.assertFalse(ok)
        self.assertIn("model path is missing", message)

    def test_existing_model_is_loaded_local_only(self):
        captured = {}

        class FakeModel:
            def __init__(self, name, **kwargs):
                captured.update(name=name, **kwargs)

        with tempfile.TemporaryDirectory() as directory:
            module = types.SimpleNamespace(WhisperModel=FakeModel)
            ok, message = preflight.inspect_runtime(directory, module=module, importer=None, cpu_threads=2)
        self.assertTrue(ok)
        self.assertEqual(message, "faster-whisper model loaded")
        self.assertTrue(captured["local_files_only"])
        self.assertEqual(captured["cpu_threads"], 2)

    def test_named_model_requires_explicit_download_opt_in(self):
        module = types.SimpleNamespace(WhisperModel=object)
        ok, message = preflight.inspect_runtime("tiny", module=module, importer=None)
        self.assertFalse(ok)
        self.assertIn("model path is missing", message)

    def test_named_model_can_be_loaded_with_download_opt_in(self):
        captured = {}

        class FakeModel:
            def __init__(self, name, **kwargs):
                captured.update(name=name, **kwargs)

        module = types.SimpleNamespace(WhisperModel=FakeModel)
        ok, message = preflight.inspect_runtime(
            "tiny", module=module, importer=None, allow_download=True, cpu_threads=3
        )
        self.assertTrue(ok)
        self.assertEqual(message, "faster-whisper model loaded")
        self.assertEqual(captured["name"], "tiny")
        self.assertFalse(captured["local_files_only"])
        self.assertEqual(captured["cpu_threads"], 3)


if __name__ == "__main__":
    unittest.main()
