#!/usr/bin/env python3
"""Extract and inventory the InterviewCoder installer without executing it.

The tool only invokes 7-Zip to unpack the NSIS/7z containers and reads the
Electron ASAR header. It does not launch any extracted executable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import subprocess
from pathlib import Path


def run_7z(sevenzip: str, args: list[str]) -> None:
    subprocess.run([sevenzip, *args], check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_asar(path: Path) -> tuple[dict, int]:
    data = path.read_bytes()
    if data[:4] != struct.pack("<I", 4):
        raise ValueError("unexpected ASAR pickle header")
    json_size = struct.unpack("<I", data[12:16])[0]
    json_start = 16
    header = json.loads(data[json_start : json_start + json_size])
    return header, json_start + json_size


def walk_files(node: dict, prefix: str = ""):
    for name, value in node.items():
        current = f"{prefix}/{name}" if prefix else name
        if "files" in value:
            yield from walk_files(value["files"], current)
        else:
            yield current, value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("installer", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--sevenzip", default="7zz")
    args = parser.parse_args()

    if not args.installer.is_file():
        parser.error(f"installer does not exist: {args.installer}")
    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)

    # NSIS container -> embedded 7z payload.
    run_7z(args.sevenzip, ["e", "-y", str(args.installer), "$PLUGINSDIR/app-64.7z", f"-o{args.out}"])
    payload = args.out / "app-64.7z"
    payload_dir = args.out / "payload"
    payload_dir.mkdir()

    # Keep the path structure so the provenance of each extracted file is clear.
    run_7z(
        args.sevenzip,
        [
            "x",
            "-y",
            str(payload),
            "interviewcoder.exe",
            "resources/app.asar",
            "resources/app.asar.unpacked/node_modules/@recallai/desktop-sdk/agent-windows.exe",
            "resources/app.asar.unpacked/node_modules/@recallai/desktop-sdk/libbot_desktop_rs.dll",
            "resources/app.asar.unpacked/node_modules/@recallai/desktop-sdk/index.js",
            "resources/app.asar.unpacked/node_modules/@recallai/desktop-sdk/package.json",
            "resources/app-update.yml",
            f"-o{payload_dir}",
        ],
    )

    asar = payload_dir / "resources/app.asar"
    header, data_start = parse_asar(asar)
    package_node = header["files"]["package.json"]
    package_bytes = asar.read_bytes()[data_start + int(package_node["offset"]) : data_start + int(package_node["offset"]) + int(package_node["size"])]
    (args.out / "package.json").write_bytes(package_bytes)

    inventory = []
    for path in sorted(args.out.rglob("*")):
        if path.is_file():
            inventory.append({"path": str(path.relative_to(args.out)), "size": path.stat().st_size, "sha256": sha256(path)})
    try:
        package = json.loads(package_bytes)
        package_parse_error = None
    except json.JSONDecodeError as exc:
        # Keep going: the supplied ASAR contains a package.json whose final
        # root brace is absent. Recording the parse error is useful evidence
        # and avoids silently repairing the sample.
        package = None
        package_parse_error = str(exc)
    result = {
        "installer": str(args.installer),
        "installer_sha256": sha256(args.installer),
        "asar_data_start": data_start,
        "package": package,
        "package_parse_error": package_parse_error,
        "asar_file_count": sum(1 for _ in walk_files(header["files"])),
        "files": inventory,
        "execution": "none",
    }
    (args.out / "static-summary.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({k: result[k] for k in ("installer_sha256", "asar_data_start", "asar_file_count", "execution")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
