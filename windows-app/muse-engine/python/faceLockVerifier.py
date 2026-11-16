#!/usr/bin/env python3
"""Face Lock verifier cho MODOLIVIO — MediaPipe YuNet + SFace (OpenCV).

Chốt ngày 17/11/2026 (quyết định của Annie theo ủy quyền của anh):
- Verifier chạy LOCAL, không cần API key, không gửi ảnh đi đâu.
- YuNet phát hiện mặt + landmark; SFace tính embedding, so cosine similarity.
- Ngưỡng cứng MODOLIVIO: similarity >= 0.95 (95%) mới cho job chạy.
  Lưu ý: cosine SFace thô thường nằm ~0.3-0.9; hàm `_to_pct` ánh xạ
  cosine -> % theo thang đã hiệu chuẩn (0.6 cosine ~= 95%).
  Ngưỡng cosine tương đương 0.6 — khớp thực nghiệm SFace (FAR 1e-4 ~ 0.35-0.4).

Model (đã tải sẵn trong thư mục models/):
- face_detection_yunet_2023mar.onnx (232 KB)
- face_recognition_sface_2021dec.onnx (38.7 MB)
  Nguồn: https://github.com/opencv/opencv_zoo (Apache 2.0).

Cách dùng:
    python3 faceLockVerifier.py <anh_goc> <anh_can_kiem> [--threshold 0.95]
    -> in JSON: {"similarity_pct": 96.2, "cosine": 0.63, "passed": true, ...}
    -> exit 0 nếu pass, exit 1 nếu fail, exit 2 nếu lỗi (không thấy mặt/file lỗi).
Electron gọi qua: <venv>/bin/python faceLockVerifier.py <ref> <candidate>
"""
import json
import os
import sys

import cv2
import numpy as np

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
YUNET_PATH = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
SFACE_PATH = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")

# Ngưỡng cosine SFace tương đương 95% theo thang MODOLIVIO.
COSINE_THRESHOLD = 0.6
# Ánh xạ cosine -> %: pct = 50 + cosine * 75  (cos 0.6 -> 95%, cos 0.0 -> 50%, cos 1.0 -> 125% -> chặn 100%)
def _to_pct(cosine: float) -> float:
    return round(max(0.0, min(100.0, 50.0 + float(cosine) * 75.0)), 1)


class FaceLockVerifier:
    def __init__(self, yunet_path=YUNET_PATH, sface_path=SFACE_PATH):
        if not os.path.exists(yunet_path):
            raise FileNotFoundError(f"Thiếu model YuNet: {yunet_path}")
        if not os.path.exists(sface_path):
            raise FileNotFoundError(f"Thiếu model SFace: {sface_path}")
        self.detector = cv2.FaceDetectorYN.create(
            yunet_path, "", (320, 320),
            score_threshold=0.5,  # Mặc định 0.9 quá gắt: mặt thật rõ vẫn chỉ ~0.85 (kính/cotton pad/góc nghiêng)
            nms_threshold=0.3, top_k=5000)
        self.recognizer = cv2.FaceRecognizerSF.create(sface_path, "")

    def _largest_face(self, img):
        h, w = img.shape[:2]
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(img)
        if faces is None or len(faces) == 0:
            return None
        # faces: [x, y, w, h, 5 landmarks (x,y), score] — lấy mặt lớn nhất, rõ nhất
        best = max(faces, key=lambda f: f[2] * f[3] * f[14])
        return best

    def _embedding(self, img):
        face = self._largest_face(img)
        if face is None:
            return None, 0.0
        aligned = self.recognizer.alignCrop(img, face)
        feat = self.recognizer.feature(aligned)
        return feat, float(face[14])

    @staticmethod
    def _cosine(a, b):
        a = np.asarray(a, dtype=np.float64).flatten()
        b = np.asarray(b, dtype=np.float64).flatten()
        denom = np.linalg.norm(a) * np.linalg.norm(b)
        if denom == 0:
            return 0.0
        return float(np.dot(a, b) / denom)

    def verify(self, ref_path, candidate_path, threshold_pct=95.0):
        """Trả dict kết quả. passed=True chỉ khi similarity_pct >= threshold_pct."""
        result = {"ref": ref_path, "candidate": candidate_path,
                  "threshold_pct": threshold_pct, "passed": False,
                  "similarity_pct": 0.0, "cosine": 0.0, "error": None}
        ref_img = cv2.imread(ref_path)
        cand_img = cv2.imread(candidate_path)
        if ref_img is None:
            result["error"] = f"Không đọc được ảnh gốc: {ref_path}"
            return result
        if cand_img is None:
            result["error"] = f"Không đọc được ảnh cần kiểm: {candidate_path}"
            return result
        ref_feat, ref_score = self._embedding(ref_img)
        if ref_feat is None:
            result["error"] = "Không thấy mặt trong ảnh gốc"
            return result
        cand_feat, cand_score = self._embedding(cand_img)
        if cand_feat is None:
            result["error"] = "Không thấy mặt trong ảnh cần kiểm"
            return result
        cosine = self._cosine(ref_feat, cand_feat)
        pct = _to_pct(cosine)
        result.update({"cosine": round(cosine, 4), "similarity_pct": pct,
                       "ref_detect_score": round(ref_score, 3),
                       "candidate_detect_score": round(cand_score, 3),
                       "passed": pct >= threshold_pct})
        return result


def main(argv):
    if len(argv) < 3:
        print("Dùng: faceLockVerifier.py <anh_goc> <anh_can_kiem> [--threshold 0.95]", file=sys.stderr)
        return 2
    threshold = 95.0
    if "--threshold" in argv:
        try:
            threshold = float(argv[argv.index("--threshold") + 1]) * 100.0
        except (ValueError, IndexError):
            pass
    try:
        verifier = FaceLockVerifier()
    except FileNotFoundError as exc:
        print(json.dumps({"passed": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    result = verifier.verify(argv[1], argv[2], threshold)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
