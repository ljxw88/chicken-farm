#!/usr/bin/env python3
"""Run installed img2threejs reference admission without copying its code."""
import json
import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
skill = Path(os.environ.get(
    "IMG2THREEJS_SKILL",
    "/tmp/assetgen-img2threejs.REij4K/home/.config/opencode/skills/img2threejs",
))
sys.path.insert(0, str(skill / "forge/stage1_intake"))
from check_reference_admission import check_admission  # type: ignore[import-not-found]  # noqa: E402

results = {}
for name in ("barrel", "hay-bale", "round-oak"):
    image = root / "tools/assetgen/golden/img2threejs" / f"{name}.png"
    results[name] = check_admission(image)
try:
    head = subprocess.check_output(["git", "rev-parse", "--short=7", "HEAD"], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()
except (OSError, subprocess.CalledProcessError):
    head = "unversioned"
evidence = Path(os.environ.get("ASSETGEN_EVIDENCE_DIR", Path.home() / "OpenBot/Shared/farm-evidence/EBR-85" / head))
output = evidence / "ebr83-85/img2threejs/reference-admission.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
print(json.dumps(results, indent=2))
if any(not value["admitted"] for value in results.values()):
    raise SystemExit(1)
