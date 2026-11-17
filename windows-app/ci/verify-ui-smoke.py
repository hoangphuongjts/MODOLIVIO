#!/usr/bin/env python3
"""Fail-closed validation of three actual packaged Electron renderer captures.

Do not accept Windows terminal/console screenshots or simulated UI artwork.
Capture source and trusted native mouse clicks must be evidenced in Electron report.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

import cv2
import numpy as np

EXPECTED = [
    ("main", "01-main.png"),
    ("lam-nhanh", "02-lam-nhanh.png"),
    ("tong-quan", "03-tong-quan.png"),
]


def verify(directory: Path, runtime: Path) -> dict:
    report = json.loads((directory / "smoke-report.json").read_text(encoding="utf-8-sig"))
    process = json.loads(runtime.read_text(encoding="utf-8-sig"))
    if report.get("status") != "PASS" or report.get("source") != "packaged-electron-renderer":
        raise ValueError("No successful packaged-Electron renderer report")
    if not process.get("launcherAliveObserved") or not process.get("electronProcessObserved"):
        raise ValueError("Packaged launcher and Electron child processes not observed")
    if process.get("launcherExitCode") != 0 or not process.get("launcherExited"):
        raise ValueError("Portable launcher not observed exiting cleanly")
    if not process.get("nativeWindowObservedByWindows"):
        raise ValueError("Windows did not observe a MODOLIVIO native app window")
    if report.get("errors"):
        raise ValueError("Electron runtime errors: " + str(report["errors"]))
    frames = report.get("frames") or []
    actions = report.get("actions") or []
    if len(frames) != 3 or len(actions) != 2:
        raise ValueError(f"Expected exactly three renderer frames and two clicks, got {len(frames)} / {len(actions)}")
    if [a.get("label") for a in actions] != ["Làm nhanh", "Tổng quan"]:
        raise ValueError(f"Wrong UI navigation sequence: {actions}")
    for a in actions:
        click = a.get("click") or {}
        if not click.get("isTrusted") or not str(click.get("text") or "").endswith(a["label"]):
            raise ValueError(f"No trusted native mouse click for {a['label']}: {click}")
    results = []
    for expected, (stage, filename) in zip(frames, EXPECTED):
        if expected.get("stage") != stage or expected.get("filename") != filename:
            raise ValueError(f"Unexpected frame order for {filename}: {expected}")
        info = expected.get("state") or {}
        window = expected.get("window") or {}
        if "modolivio" not in str(info.get("title", "")).lower():
            raise ValueError(f"Wrong renderer title for {stage}")
        if int(info.get("rootChildren", 0)) < 1 or len(info.get("bodyText") or "") < 100:
            raise ValueError(f"Empty app renderer for {stage}")
        text = info.get("bodyText") or ""
        if "Tổng quan" not in text or "Làm nhanh" not in text:
            raise ValueError(f"App navigation content absent for {stage}")
        handle = str(window.get("nativeHandle") or "")
        if not window.get("visible") or not handle or not any(c != "0" for c in handle):
            raise ValueError(f"Electron BrowserWindow handle invalid for {stage}")
        if stage != "main":
            clicks = info.get("clicks") or []
            if len(clicks) < (1 if stage == "lam-nhanh" else 2):
                raise ValueError(f"No click evidence in {stage} frame")
        image_path = directory / filename
        img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"Missing or unreadable PNG: {filename}")
        h, w = img.shape[:2]
        if w < 900 or h < 500:
            raise ValueError(f"Renderer screenshot unexpectedly small: {filename} ({w}x{h})")
        sample = cv2.resize(img, (240, 150), interpolation=cv2.INTER_AREA)
        arr = sample.astype(np.float32)
        bright_ratio = float(np.mean(np.mean(arr, axis=2) > 165))
        std = float(np.std(arr))
        colors = int(np.unique(sample.reshape(-1, 3), axis=0).shape[0])
        if bright_ratio < 0.32 or std < 12 or colors < 200:
            raise ValueError(f"BLACK/CONSOLE/BLANK screenshot {filename}: bright={bright_ratio:.3f} std={std:.2f} colors={colors}")
        results.append({"stage": stage, "file": filename, "width": w, "height": h,
                        "brightRatio": round(bright_ratio, 3), "pixelStd": round(std, 2), "uniqueColors": colors})
    return {"status": "PASS", "renderer": "packaged-electron", "clicks": ["Làm nhanh", "Tổng quan"],
            "screenshots": results, "launcherExitCode": process.get("launcherExitCode")}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dir", required=True, type=Path)
    p.add_argument("--runtime", required=True, type=Path)
    args = p.parse_args()
    try:
        print("UI_THREE_SCREEN_RESULT " + json.dumps(verify(args.dir, args.runtime), ensure_ascii=False))
        return 0
    except Exception as e:
        print("UI_THREE_SCREEN_FAIL " + str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())