#!/usr/bin/env python3
"""Fetch real OpenCV Zoo YuNet/SFace ONNX for offline Face Lock CI.

Downloaded binaries remain under ignored models/ and are never committed.
Raises on Git LFS pointer files, HTML pages, network failures or unexpected sizes.
"""
from pathlib import Path
from urllib.request import urlopen, Request
import tempfile

OUT = Path(__file__).resolve().parents[1] / 'muse-engine' / 'python' / 'models'
SOURCE = 'https://raw.githubusercontent.com/opencv/opencv_zoo/main/models'
MODELS = {
    'face_detection_yunet_2023mar.onnx': ('face_detection_yunet', 200_000, 800_000),
    'face_recognition_sface_2021dec.onnx': ('face_recognition_sface', 30_000_000, 50_000_000),
}


def download_models():
    OUT.mkdir(parents=True, exist_ok=True)
    for filename, (folder, low, high) in MODELS.items():
        dest = OUT / filename
        if dest.exists() and low <= dest.stat().st_size <= high:
            print(f'EXISTS {filename}: {dest.stat().st_size} bytes')
            continue
        url = f'{SOURCE}/{folder}/{filename}'
        req = Request(url, headers={'User-Agent': 'MODOLIVIO-CI/1.0'})
        with tempfile.NamedTemporaryFile(dir=OUT, prefix=filename+'.', delete=False) as tmp:
            temp = Path(tmp.name)
            try:
                with urlopen(req, timeout=120) as resp:
                    while data := resp.read(1 << 20):
                        tmp.write(data)
                size = temp.stat().st_size
                if not low <= size <= high:
                    raise RuntimeError(f'{filename}: unexpected size {size}; may be Git LFS pointer')
                temp.replace(dest)
                print(f'DOWNLOADED {filename}: {size} bytes (source: {url})')
            finally:
                if temp.exists():
                    temp.unlink()


if __name__ == '__main__':
    download_models()
