#!/usr/bin/env python3
"""Read-only local audio and display capability preflight."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from typing import Any, Callable, Mapping


_ALSA_CARD = re.compile(r"^\s*card\s+\d+:", re.IGNORECASE)


def _run_probe(
    command: list[str],
    *,
    runner: Callable[..., Any],
    timeout: float,
) -> tuple[bool, str]:
    try:
        completed = runner(command, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return False, ""
    if getattr(completed, "returncode", 1) != 0:
        return False, ""
    stdout = getattr(completed, "stdout", "")
    return True, stdout if isinstance(stdout, str) else ""


def _count_alsa_cards(output: str) -> int:
    return sum(1 for line in output.splitlines() if _ALSA_CARD.search(line))


def _count_pulse_sources(output: str) -> int:
    count = 0
    for line in output.splitlines():
        fields = line.split("\t")
        if fields and fields[0].isdigit():
            count += 1
    return count


def probe_environment(
    *,
    runner: Callable[..., Any] = subprocess.run,
    path_exists: Callable[[str], bool] = os.path.exists,
    env: Mapping[str, str] | None = None,
    timeout: float = 3.0,
) -> dict[str, Any]:
    environment = os.environ if env is None else env
    try:
        device_node_available = bool(path_exists("/dev/snd"))
    except OSError:
        device_node_available = False

    alsa_ok, alsa_output = _run_probe(["arecord", "-l"], runner=runner, timeout=timeout)
    pulse_ok, pulse_output = _run_probe(["pactl", "list", "short", "sources"], runner=runner, timeout=timeout)
    alsa_cards = _count_alsa_cards(alsa_output) if alsa_ok else 0
    pulse_sources = _count_pulse_sources(pulse_output) if pulse_ok else 0
    audio_available = alsa_cards > 0 or pulse_sources > 0
    if audio_available:
        reason = "audio input detected"
    elif not alsa_ok and not pulse_ok and not device_node_available:
        reason = "audio probe unavailable"
    else:
        reason = "no audio input device detected"
    return {
        "ok": audio_available,
        "reason": reason,
        "device_node": {"available": device_node_available},
        "alsa": {"available": alsa_cards > 0, "cards": alsa_cards},
        "pulse": {"available": pulse_sources > 0, "sources": pulse_sources},
        "display": {"available": bool(environment.get("DISPLAY") or environment.get("WAYLAND_DISPLAY"))},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check local audio hardware and display capability without opening a recording stream.")
    parser.add_argument("--json", action="store_true", dest="json_output", help="print a machine-readable JSON report")
    args = parser.parse_args(argv)
    result = probe_environment()
    if args.json_output:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    elif result["ok"]:
        print(f"Audio preflight verified: ALSA cards {result['alsa']['cards']}, PulseAudio sources {result['pulse']['sources']}")
    else:
        print(f"NOT VERIFIED: {result['reason']}")
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
