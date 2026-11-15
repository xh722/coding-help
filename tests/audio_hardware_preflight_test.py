import os
import sys
import unittest
from pathlib import Path
from subprocess import CompletedProcess

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
import audio_hardware_preflight as preflight  # noqa: E402


class AudioHardwarePreflightTests(unittest.TestCase):
    def test_reports_available_alsa_and_pulse_without_device_names(self):
        def runner(command, **_kwargs):
            if command == ["arecord", "-l"]:
                return CompletedProcess(command, 0, "card 0: Mic [Private Mic], device 0: Capture\n", "")
            if command == ["pactl", "list", "short", "sources"]:
                return CompletedProcess(command, 0, "12\tsome-source\tmodule\n", "")
            raise AssertionError(command)

        result = preflight.probe_environment(
            runner=runner,
            path_exists=lambda path: path == "/dev/snd",
            env={"DISPLAY": ":99", "WAYLAND_DISPLAY": ""},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["alsa"]["cards"], 1)
        self.assertEqual(result["pulse"]["sources"], 1)
        self.assertNotIn("Private Mic", str(result))

    def test_reports_unavailable_when_commands_fail(self):
        def runner(command, **_kwargs):
            return CompletedProcess(command, 1, "", "connection refused /private/path")

        result = preflight.probe_environment(runner=runner, path_exists=lambda _path: False, env={})
        self.assertFalse(result["ok"])
        self.assertEqual(result["alsa"], {"available": False, "cards": 0})
        self.assertEqual(result["pulse"], {"available": False, "sources": 0})
        self.assertEqual(result["display"], {"available": False})
        self.assertNotIn("private", str(result).lower())

    def test_runner_failures_are_fixed_and_do_not_escape(self):
        def runner(_command, **_kwargs):
            raise OSError("/private/tool")

        result = preflight.probe_environment(runner=runner, path_exists=lambda _path: False, env=os.environ)
        self.assertFalse(result["ok"])
        self.assertIn(result["reason"], {"no audio input device detected", "audio probe unavailable"})
        self.assertNotIn("/private/tool", str(result))

    def test_cli_report_is_machine_readable(self):
        result = preflight.probe_environment(runner=lambda *_args, **_kwargs: CompletedProcess([], 1, "", ""), path_exists=lambda _path: False, env={})
        self.assertIn("ok", result)
        self.assertIn("reason", result)


if __name__ == "__main__":
    unittest.main()
