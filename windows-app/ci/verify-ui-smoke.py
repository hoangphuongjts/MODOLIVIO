#!/usr/bin/env python3
"""Validate an actual packaged Electron BrowserWindow screenshot and state.

Fail closed on blank/error screens. Input is emitted by --smoke-test in the packaged EXE.
No credentials, network requests or synthetic screenshots are used here.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

import cv2
import numpy as np


def verify(shot: Path, report: Path, runtime: Path) -> dict:
    img = cv2.imread(str(shot), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Missing/unreadable PNG: {shot}")
    h, w = img.shape[:2]
    if w < 900 or h < 500:
        raise ValueError(f"Main-window screenshot unexpectedly small: {w}x{h}")
    sampled = cv2.resize(img, (240, 150), interpolation=cv2.INTER_AREA)
    pixel_std = float(np.std(sampled.astype(np.float32)))
    unique_colors = len(np.unique(sampled.reshape(-1, 3), axis=0))
    if pixel_std < 5 or unique_colors < 30:
        raise ValueError(f"Screenshot appears blank/unrendered: std={pixel_std:.2f}, colors={unique_colors}")
    info = json.loads(report.read_text(encoding="utf-8-sig"))
    process = json.loads(runtime.read_text(encoding="utf-8-sig"))
    state = info.get("state") or {}
    window = info.get("window") or {}
    if not process.get("launcherAliveObserved") or not process.get("electronProcessObserved"):
        raise ValueError("Missing packaged launcher or extracted Electron process evidence")
    handle = str(window.get("nativeHandle") or "").strip()
    if not window.get("visible") or not handle or not any(c != "0" for c in handle):
        raise ValueError("Electron did not report a visible native BrowserWindow")
    if not (str(state.get("title") or "").lower().find("modolivio") >= 0):
        raise ValueError(f"Unexpected document title: {state.get('title')!r}")
    if int(state.get("rootChildren") or 0) < 1:
        raise ValueError("Frontend root has no rendered children")
    if len(str(state.get("bodyText") or "").strip()) < 16:
        raise ValueError("Frontend body has insufficient rendered text")
    if (info.get("errors") or []):
        raise ValueError(f"Renderer console errors: {info['errors']!r}")
    return {"status": "PASS", "screenshot": shot.name, "width": w, "height": h,
            "uniqueColors": unique_colors, "pixelStd": round(pixel_std, 2),
            "windowTitle": window.get("title"), "nativeWindow": bool(window.get("nativeHandle")),
            "windowsHandleObserved": bool(process.get("nativeWindowObservedByWindows")),
            "rendererTitle": state.get("title"), "rootChildren": state.get("rootChildren"),
            "bodyTextChars": len(str(state.get("bodyText") or ""))}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--shot", required=True, type=Path)
    p.add_argument("--report", required=True, type=Path)
    p.add_argument("--runtime", required=True, type=Path)
    args = p.parse_args()
    try:
        print("UI_SMOKE_RESULT " + json.dumps(verify(args.shot, args.report, args.runtime), ensure_ascii=False))
        return 0
    except Exception as exc:
        print("UI_SMOKE_FAIL " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())