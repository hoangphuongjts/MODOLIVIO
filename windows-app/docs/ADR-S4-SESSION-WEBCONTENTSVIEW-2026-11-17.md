# ADR — S4 phiên sàn WebContentsView (MODOLIVIO)

Ngày 17/11/2026. Phạm vi: `feature/p3-windows-bridge-agent`, không sửa `main`, production, S1/S2 hoặc tài khoản thật.

## Tử huyệt (trước giải pháp)
1. Tách phiên đọc khỏi phiên đăng nhập khiến mất auth → một WebContentsView tồn tại xuyên suốt phiên.
2. Gộp Shopee/TikTok phiên chéo → partition `persist:shopee` và `persist:tiktok`.
3. Đọc khi chưa đăng nhập, chờ mù 45s → mở và xác nhận thủ công, LOGIN_REQUIRED tức thì nếu chưa có view.
4. CAPTCHA/redirect khác domain → không bypass; báo CAPTCHA_REQUIRED và từ chối domain ngoài allowlist.
5. Trả thumbnail `_tn` thay ảnh thật → chuẩn hóa URL, bỏ `_tn`, yêu cầu >=4 ảnh.
6. DOM trỏ selector lỗi thời → giữ `extension/shopee_grab.js` làm nguồn chính; kiểm chứng thật riêng.
7. Một bước kẹt vô hạn → 45s deadline *tổng* bao gồm navigation và DOM.
8. Mock PASS bị nhầm với phiên thật → CI dùng only mock partition/view; nghiệm thu trên máy người dùng bắt buộc.

## Hai vòng phản biện ba góc (đánh giá mã trong phiên này; chưa có chữ ký review của G1–G4)
- Builder: tiếp tục dùng `p3/product-dom-reader.js`, mở WebContentsView trong cửa sổ MODOLIVIO và IPC tối thiểu.
- Alternative/research: chuyển Chrome/CDP ngoại vi là rẻ hơn nhưng không tái sử dụng cùng WebContents; loại.
- Risk reviewer: yêu cầu thao tác user-confirmed, partition cố định, allowlist, không cookie APIs, chặn popups/CAPTCHA. Hạn chế: OAuth bắt buộc popup có thể không chạy; phải kiểm tra máy thật.
- Vòng hai: Builder đề xuất tự suy luận login từ title; reviewer bác vì dễ false-positive; quyết định yêu cầu nút Xác nhận phiên + DOM gate thực tại mỗi lần đọc.

## Cấu trúc và API
- Menu `Tệp → Phiên sàn`, mở Shopee/TikTok Shop, người dùng tự đăng nhập rồi chọn `Xác nhận phiên`.
- Dán link vào Chat Annie hoặc copy link và `Tệp → Phiên sàn → Đọc link ... từ clipboard`; cả hai gọi cùng controller trên đúng WebContentsView.
- Preload expose `openShopSession`, `confirmShopSession`, `readShopProduct`, `getShopSessionStatus`; IPC chỉ chấp nhận main renderer.
- Electron WebContentsView `nodeIntegration:false`, `sandbox:true`, `contextIsolation:true`.
- Không lấy/chuyển session cookie, key, localStorage, không login/bypass CAPTCHA tự động.
- Lỗi: LOGIN_REQUIRED, CAPTCHA_REQUIRED, TIMEOUT <=45s, INSUFFICIENT_IMAGES (<4), UNSUPPORTED_DOMAIN, SHOP_BUSY.

## Kiểm thử, giới hạn và thương mại về sau
- Unit/integration mock: partition, reuse view, login/captcha early, `_tn`, 4+ ảnh, deadline, Annie /actions, cấm Origin lạ, lưu sản phẩm.
- E2E CI Windows không dùng phiên sàn thật; cổng tổng phải PASS 100% mới coi là QA build.
- Chưa kiểm chứng thật: trang đăng nhập sàn có OAuth popup, CAPTCHA, selector mới, phiên persistent qua restart, tính đầy đủ ảnh 4+ của từng sàn.
- Nếu thương mại sau này: cần rà lại điều khoản nền tảng, giới hạn truy cập và chính sách dữ liệu; không tự mở tài khoản hàng loạt/né rate limit.
- Chỉ dùng phiên đăng nhập mà người dùng tự tạo và tự xác nhận trong ứng dụng; không đồng bộ cookie vào repo/CI.