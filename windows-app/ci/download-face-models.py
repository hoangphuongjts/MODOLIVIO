#!/usr/bin/env python3
"""Fetch and integrity-verify OpenCV Zoo ONNX models for isolated Windows CI.

No tokens, user assets or model binaries are stored in Git. Verification uses
published SHA-256 values from the official opencv/opencv_zoo Hugging Face mirror.
Face test images come from a pinned revision of an open demo repository and
are only used on the ephemeral runner, never uploaded as artifacts.
"""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import tempfile
from urllib.request import urlopen, Request

ROOT = Path(__file__).resolve().parents[1] / "muse-engine" / "python"
MODELS_DIR = ROOT / "models"
FIXTURES_DIR = ROOT / "fixtures"
SOURCE = "https://huggingface.co/opencv/opencv_zoo/resolve/main/models"
FALLBACK = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models"
PHOTO_COMMIT = "9f3061aaeed9a8756d2c970f5dfe066617a8281d"
PHOTO_SOURCE = f"https://raw.githubusercontent.com/ageitgey/face_recognition/{PHOTO_COMMIT}/examples"
MODELS = {
    "face_detection_yunet_2023mar.onnx": (
        "face_detection_yunet", 200_000, 800_000,
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    "face_recognition_sface_2021dec.onnx": (
        "face_recognition_sface", 30_000_000, 50_000_000,
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
}


def sha256_file(filename: Path) -> str:
    digest = hashlib.sha256()
    with filename.open("rb") as stream:
        for part in iter(lambda: stream.read(1 << 20), b""):
            digest.update(part)
    return digest.hexdigest()


def download_verified(dest: Path, urls: list[str], *, low: int, high: int, sha256: str | None = None):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and low <= dest.stat().st_size <= high:
        if sha256 is None or sha256_file(dest) == sha256:
            print(f"VERIFIED CACHED {dest.name}: {dest.stat().st_size} bytes")
            return
    if dest.exists():
        dest.unlink()
    errors = []
    for url in urls:
        temp = None
        try:
            # mkstemp is closed before reading the file size or replacing it.
            fd, path = tempfile.mkstemp(prefix=dest.name + ".", suffix=".tmp", dir=dest.parent)
            temp = Path(path)
            digest = hashlib.sha256()
            count = 0
            with os.fdopen(fd, "wb") as output:
                request = Request(url, headers={"User-Agent": "MODOLIVIO-Windows-CI/2.0"})
                with urlopen(request, timeout=180) as response:
                    for chunk in iter(lambda: response.read(1 << 20), b""):
                        count += len(chunk)
                        if count > high:
                            raise ValueError(f"oversized payload ({count} bytes)")
                        output.write(chunk)
                        digest.update(chunk)
            if not low <= count <= high:
                raise ValueError(f"unexpected payload size {count}; possible Git LFS pointer/HTML")
            actual = digest.hexdigest()
            if sha256 is not None and actual != sha256:
                raise ValueError(f"SHA-256 mismatch (actual {actual})")
            os.replace(temp, dest)
            temp = None
            print(f"VERIFIED DOWNLOAD {dest.name}: {count} bytes SHA-256={actual}")
            return
        except Exception as exc:
            errors.append(f"{url}: {type(exc).__name__}: {exc}")
        finally:
            # File descriptor is already closed; Windows can remove it safely.
            if temp is not None:
                try:
                    temp.unlink(missing_ok=True)
                except OSError as cleanup_error:
                    errors.append(f"cleanup {temp.name}: {cleanup_error}")
    raise RuntimeError(f"FAILED to download {dest.name}: " + " | ".join(errors))


def download_models():
    for filename, (folder, low, high, sha256) in MODELS.items():
        urls = [f"{SOURCE}/{folder}/{filename}", f"{FALLBACK}/{folder}/{filename}"]
        download_verified(MODELS_DIR / filename, urls, low=low, high=high, sha256=sha256)


def download_face_test_fixtures():
    # Public example portraits. No customer image or personal session data.
    for filename in ("obama.jpg", "biden.jpg"):
        download_verified(FIXTURES_DIR / filename, [f"{PHOTO_SOURCE}/{filename}"], low=10_000, high=2_000_000)


if __name__ == "__main__":
    download_models()
    download_face_test_fixtures()