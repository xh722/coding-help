#!/usr/bin/env python3
"""Fail-closed preflight for the optional local faster-whisper runtime."""

from __future__ import annotations

import argparse
import importlib
import os
from pathlib import Path
from typing import Any, Callable


def inspect_runtime(
    model_name: str | None,
    *,
    module: Any = None,
    importer: Callable[[str], Any] | None = importlib.import_module,
    device: str = "cpu",
    compute_type: str = "int8",
    cpu_threads: int = 4,
    allow_download: bool = False,
) -> tuple[bool, str]:
    if not model_name:
        return False, "model path is required"
    model_path = Path(model_name).expanduser()
    is_local_model = model_path.exists()
    if is_local_model and not model_path.is_dir():
        return False, "model path is not a directory"
    if not is_local_model and not allow_download:
        return False, "model path is missing"
    if module is None:
        try:
            module = (importer or importlib.import_module)("faster_whisper")
        except ImportError:
            return False, "faster-whisper is not installed"
    if not isinstance(cpu_threads, int) or cpu_threads < 1:
        return False, "cpu thread count is invalid"
    try:
        module.WhisperModel(
            str(model_path) if is_local_model else model_name,
            device=device,
            compute_type=compute_type,
            local_files_only=not allow_download or is_local_model,
            cpu_threads=cpu_threads,
        )
    except Exception:
        return False, "faster-whisper model could not be loaded"
    return True, "faster-whisper model loaded"


def main() -> int:
    parser = argparse.ArgumentParser(description="Check the optional local faster-whisper runtime and model.")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL"))
    parser.add_argument("--device", default=os.environ.get("WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"))
    parser.add_argument("--cpu-threads", type=int, default=4)
    parser.add_argument("--allow-model-download", action="store_true", help="allow a named model to be downloaded")
    args = parser.parse_args()
    ok, message = inspect_runtime(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        cpu_threads=args.cpu_threads,
        allow_download=args.allow_model_download,
    )
    if ok:
        print(f"ASR runtime verified: {message}")
        return 0
    print(f"NOT VERIFIED: {message}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
