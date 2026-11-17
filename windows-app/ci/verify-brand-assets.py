#!/usr/bin/env python3
"""Ensure the user-supplied official logo is bundled: NEVER synthesize or use a stand-in."""
from pathlib import Path
import struct
import sys
import zlib

root = Path(__file__).resolve().parents[1]
logo = root / "renderer" / "assets" / "logo-mo-6562vk78.png"
html_file = root / "renderer" / "index.html"
js_file = root / "renderer" / "assets" / "index-9s0t5ehk.js"

def fail(reason: str) -> None:
    print("BLOCKED OFFICIAL MODOLIVIO LOGO: " + reason, file=sys.stderr)
    raise SystemExit(1)

if not logo.is_file():
    fail("Missing renderer/assets/logo-mo-6562vk78.png; provide the original source asset. Do not substitute a generated logo.")
data = logo.read_bytes()
if len(data) < 45 or data[:8] != b"\x89PNG\r\n\x1a\n":
    fail("Logo is not a genuine PNG file.")
if struct.unpack(">I", data[8:12])[0] != 13 or data[12:16] != b"IHDR":
    fail("PNG IHDR is missing or corrupt.")
if zlib.crc32(data[12:29]) & 0xFFFFFFFF != struct.unpack(">I", data[29:33])[0]:
    fail("PNG header CRC mismatch.")
width, height = struct.unpack(">II", data[16:24])
if min(width, height) < 16 or max(width, height) > 8192:
    fail(f"Unexpected logo dimensions {width}x{height}.")
if not html_file.is_file() or 'href="./assets/logo-mo-6562vk78.png"' not in html_file.read_text(encoding="utf-8"):
    fail("index.html favicon does not point to the original logo asset.")
if not js_file.is_file() or '"./assets/logo-mo-6562vk78.png"' not in js_file.read_text(encoding="utf-8"):
    fail("The packaged renderer does not reference the original logo asset.")
print(f"BRAND-ASSET-PASS: original logo asset present, PNG {width}x{height}, {len(data)} bytes; favicon and renderer match.")
