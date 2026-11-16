"""Fail-closed CI gate for Annie's real YuNet/SFace code and ONNX models.

A successful mocked JS Face Lock result is not proof of a running ONNX verifier.
This gate requires actual Annie source, models, and >=6 Python tests.
"""
from __future__ import annotations
import pathlib
import sys

app_dir = pathlib.Path(__file__).resolve().parents[1]
engine_dir = app_dir / "muse-engine"
source_dir = engine_dir / "python"
verifier = source_dir / "faceLockVerifier.py"
model_dirs = [source_dir / "models", engine_dir / "models"]
models = [f for folder in model_dirs if folder.is_dir() for f in folder.rglob("*.onnx")]
if not verifier.is_file():
    raise SystemExit(f"BLOCKED: missing Annie's actual Face Lock source: {verifier}")
if len(models) < 2:
    raise SystemExit(f"BLOCKED: expected both YuNet + SFace ONNX models, found {len(models)}")

try:
    import pytest
except ImportError as exc:
    raise SystemExit("BLOCKED: pytest dependency is required for Face Lock QA") from exc

class CollectedTestCount:
    count = 0
    skipped = 0
    failed = 0
    passed = 0
    def pytest_collection_finish(self, session):
        self.count = len(session.items)
    def pytest_runtest_logreport(self, report):
        if report.when == "call":
            if report.passed: self.passed += 1
            if report.failed: self.failed += 1
        if report.skipped:
            self.skipped += 1

counter = CollectedTestCount()
paths = [str(source_dir)]
additional_tests = app_dir / "test" / "python"
if additional_tests.is_dir():
    paths.append(str(additional_tests))
exit_code = int(pytest.main(["-q", *paths], plugins=[counter]))
if counter.count < 6:
    raise SystemExit(f"BLOCKED: at least 6 Face Lock test cases required; collected {counter.count}")
if exit_code != 0:
    raise SystemExit(exit_code)
if counter.skipped:
    raise SystemExit(f"BLOCKED: {counter.skipped} Python Face Lock test(s) skipped (need real reference images); {counter.passed} passed")
if counter.passed < 6:
    raise SystemExit(f"BLOCKED: expected >=6 passing real Face Lock tests; only {counter.passed} passed")
print(f"PASS: actual verifier, {len(models)} ONNX model(s), {counter.passed} Python tests passed without skipping")
