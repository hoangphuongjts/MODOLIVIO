"""Test cho Face Lock verifier (YuNet + SFace). Chạy: <venv>/bin/python -m pytest test_faceLockVerifier.py -v
Yêu cầu model trong models/ (đã tải sẵn). Test e2e dùng hai ảnh chân dung demo công khai, tải vào fixtures/ trên runner
(tệp không được commit hoặc upload). Ảnh thực của người dùng vẫn chờ kiểm chứng riêng.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from faceLockVerifier import FaceLockVerifier, _to_pct

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")


def test_to_pct_mapping():
    assert _to_pct(1.0) == 100.0
    assert _to_pct(0.6) == 95.0  # ngưỡng 95% <-> cosine 0.6
    assert _to_pct(0.0) == 50.0
    assert _to_pct(-1.0) == 0.0


def test_models_exist():
    assert os.path.exists(os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx"))
    assert os.path.exists(os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx"))


def test_verifier_loads():
    v = FaceLockVerifier()
    assert v.detector is not None and v.recognizer is not None


def test_missing_file_returns_error():
    v = FaceLockVerifier()
    r = v.verify("/khong/co/file.jpg", "/khong/co/file2.jpg")
    assert r["passed"] is False
    assert r["error"] is not None


# --- e2e với ảnh nhân vật thật (bỏ qua nếu không có ảnh) ---
IMG2 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "obama.jpg")
IMG3 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "biden.jpg")


@pytest.mark.skipif(not (os.path.exists(IMG2) and os.path.exists(IMG3)),
                    reason="thiếu ảnh nhân vật mẫu")
def test_same_face_passes():
    v = FaceLockVerifier()
    r = v.verify(IMG2, IMG2)
    assert r["passed"] is True
    assert r["similarity_pct"] == 100.0


@pytest.mark.skipif(not (os.path.exists(IMG2) and os.path.exists(IMG3)),
                    reason="thiếu ảnh nhân vật mẫu")
def test_different_face_fails():
    v = FaceLockVerifier()
    r = v.verify(IMG2, IMG3)
    assert r["passed"] is False
    assert r["similarity_pct"] < 95.0