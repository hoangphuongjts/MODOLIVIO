# MODOLIVIO — Bản Windows 1.2.0

App Video Bán Hàng V1 chạy riêng trên Windows, không cần trình duyệt.
Mở app là dùng ngay: Dashboard tổng quan 4 nhóm số liệu, Tạo video
(Làm nhanh + Làm thủ công cùng giao diện), kịch bản, nhân vật & giọng đọc
(đủ 20 giọng), bối cảnh (50 bối cảnh, mỗi bối cảnh 1 ảnh riêng),
ghép duyệt & đăng, quản lý bán hàng, quản lý mạng xã hội (4 nền tảng chính
+ tab quản lý riêng từng nền tảng), Beat Studio, Chatbot, **Chat với Annie**.

Giao diện trong bản này là **bản web mới nhất** của App MODOLIVIO
(artifact `app-video-ban-hang-v1`, **v16 / 1.4.0** — kho nhạc 6 nguồn,
đăng nhập bằng trình duyệt nhúng trong app, tab Chat với Annie, giao diện
quản lý đầy đủ 4 sàn, báo cáo bán hàng gồm đơn hôm nay, sửa VieNeu-TTS).

## File tải về

| File | Dung lượng | MD5 | Cách dùng |
|---|---|---|---|
| `dist-win/MODOLIVIO-Windows-1.2.0-portable.exe` | ~83 MB | `fa93a35d7d555d15d9c82a229a0859b5` | **Khuyên dùng.** Chạy thẳng, không cần cài đặt. |
| `MODOLIVIO-Windows-1.2.0.zip` | ~204 MB | `ae019cc0f3f57238033327cc17983c47` | Giải nén rồi chạy `win-unpacked/MODOLIVIO.exe`. |
| `dist-win/win-unpacked/MODOLIVIO.exe` | ~281 MB (thư mục, 73 file) | `1c93e10ddd4256001d9a81a527b5759e` | Bản thư mục đã giải nén sẵn. |

Chi tiết từng bước xem `HUONG-DAN.md`. Báo cáo kỹ thuật xem `BAO-CAO-BUILD.md`.

## Có gì mới so với 1.1.0

1. **Renderer = bản web v16 (1.4.0):** kho nhạc 6 nguồn (TikTok Commercial
   Music Library, Meta Sound Collection, YouTube Audio Library, Pixabay
   Music, Mixkit, nhạc tải lên — mỗi nguồn ghi rõ giấy phép và đăng được
   lên nền tảng nào), đăng nhập bằng trình duyệt nhúng trong app cho mọi
   nền tảng và sàn, tab **Chat với Annie**, giao diện quản lý đầy đủ 4 sàn
   (Shopee / TikTok Shop / Lazada / Tiki, mỗi sàn 1 tab riêng).
2. **Đủ 228/228 action của bản web** (+ 2 action sao lưu riêng của bản
   Windows): đã bổ sung Chat với Annie (`getAnnieChat`, `annieSendMessage`,
   `annieMarkTasksSeen`, `annieDeleteTask`), Chatbot đầy đủ (cài đặt, câu
   trả lời đã dạy, hộp thư, trả lời khách, tạo đơn thật), kết nối/ngắt kết
   nối sàn (`connectShop`, `disconnectShop`) và ghi nhận đăng nhập Muse AI
   (`setAccountConnection`).
3. **Nhạc tải lên giữ nhãn giấy phép** (`licenseNote`: all / tiktok / meta /
   youtube / own) nên lọc nhạc theo nền tảng đăng bài chạy đúng.
4. **Báo cáo bán hàng gồm đơn hôm nay:** `getSalesReport` ở cả hai bản nay
   đều tính kỳ hiện tại đến ngày mai nên đơn và dòng tiền của chính hôm nay
   được tính (bản web đã sửa, bản Windows đã sửa từ 1.1.0) — Dashboard hai
   bản không còn lệch số liệu ở đơn trong ngày.
5. **VieNeu-TTS:** trạng thái và nghe thử chạy thật khi máy chủ VieNeu-TTS
   đang chạy ở `http://127.0.0.1:8000`; chưa chạy thì app báo rõ cách chạy,
   không giả giọng.

## Yêu cầu

- Windows 10/11 64-bit.
- Không cần cài thêm gì. App tự chạy máy chủ cục bộ của riêng nó.
- Có mạng khi cần: đọc link sản phẩm. Chạy offline được bằng font hệ thống
  (bản đóng gói đã bỏ dòng tải Google Fonts trong CSS).

## Đăng nhập & đồng bộ với bản web (quan trọng)

- **Tài khoản MODOLIVIO:** đăng ký/đăng nhập bằng cùng email + mật khẩu ở
  cả hai bản (cùng thuật toán băm mật khẩu SHA-256 như bản web). Tài khoản
  đăng ký đầu tiên trên máy này tự thành Quản trị viên (Admin).
- **Đồng bộ dữ liệu:** hiện đồng bộ bằng **file sao lưu đầy đủ** qua menu
  **Đồng bộ** → **Xuất/Nhập bản sao lưu đầy đủ** (gộp 2 chiều, không nhân
  đôi; từ 1.2.0 file sao lưu còn mang cả Chat với Annie và Chatbot). Chưa có
  đồng bộ tự động qua mạng — MODOLIVIO chưa có máy chủ đám mây chung.
  Đồng bộ từng dự án: xuất file dự án trên bản web → nhập bằng
  **Khôi phục dự án từ file** trên bản Windows.
- **Giới hạn:** file sao lưu không mang theo ảnh/nhạc đã tải lên (nằm trong
  thư mục `uploads` của từng máy); kết nối tài khoản mạng xã hội chưa có
  OAuth chính thức nên chưa tự lấy số liệu/tự đăng bài qua API.
- Chi tiết đầy đủ xem `HUONG-DAN.md` (mục Đăng nhập & Đồng bộ).

## Dữ liệu lưu ở đâu

Dữ liệu (tài khoản, dự án, nhân vật, giọng, sản phẩm, đơn hàng...) lưu trên
máy của bạn tại `%APPDATA%\MODOLIVIO\modolivio-data.json`. Gỡ app không xóa
dữ liệu này trừ khi bạn xóa tay thư mục đó.

## Giới hạn đã biết (đọc kỹ trước khi dùng)

1. **Làm nhanh bằng AI cần tài khoản Muse (muse.ai).** Bản Windows này chưa
   tự tạo clip/giọng bằng AI: bấm "Làm nhanh" sẽ báo cần dùng bản web với
   tài khoản Muse đã đăng nhập. Các bước không cần AI (nhập dự án từ file,
   sửa kịch bản/cảnh, giọng VieNeu-TTS, ghép/xuất, quản lý bán hàng,
   Chatbot trả lời theo câu đã dạy, Chat với Annie) chạy ngay trên Windows.
   Trong tab Chat với Annie, Annie lưu link sản phẩm và hướng dẫn chạy tiếp
   trên bản web, không bịa kết quả đọc link hay video đã xong.
2. **Chưa có FFmpeg phía server** nên xuất file cuối là `.webm` ghép từ ảnh
   từng cảnh (trong màn hình chi tiết dự án → "Xuất file video"), kèm
   caption + hashtag để đăng. Muốn `final.mp4` H.264/AAC chuẩn Vanzo thì
   cần cài FFmpeg (xem `HUONG-DAN.md`).
3. **VieNeu-TTS (giọng đọc tiếng Việt)** chỉ chạy khi máy chủ VieNeu-TTS
   đang chạy trên máy (`http://127.0.0.1:8000`). Chưa chạy thì app báo
   "chưa chạy" thay vì giả giọng.
4. **Đăng bài lên TikTok/Shopee/Facebook** cần kết nối OAuth từng tài khoản;
   chưa kết nối thì app xuất video + caption để đăng tay và nhắc lịch.
   Nút **Kết nối tài khoản** mở trang đăng nhập chính thức của nền tảng
   trong khung trình duyệt nhúng trong app; đăng nhập xong bấm
   "Đăng nhập xong — quay lại app" trong khung là app ghi "Đã kết nối" kèm
   ngày kết nối — app chưa tự lấy số liệu/tự đăng bài qua API (chưa có OAuth
   chính thức, và trang đăng nhập khác nguồn nên app không tự nhận biết
   khoảnh khắc đăng nhập xong mà không cần 1 nút bấm).
5. App **không ký số (unsigned)**: Windows SmartScreen có thể hỏi khi chạy
   lần đầu — bấm "More info" → "Run anyway". **Không có NSIS installer**
   (cần Wine trên máy build).

## Nguồn build

- Mã nguồn đóng gói: `app/` (Electron 33.4.11, main.js + server.js +
  bridge.js + handlers.js + renderer là bản web App V1 mới nhất v16).
- Bản web App V1 gốc: `~/workspace/ts-spaces/app-video-ban-hang-v1/`
  (không sửa file gốc khi đóng gói; chỉ sao chép bản `client/dist` đã build,
  và bỏ dòng tải Google Fonts trong CSS đóng gói để chạy offline).
- Bản 1.1.0 cũ còn giữ nguyên trong `dist-win-v1.1.0-old/` và file
  `MODOLIVIO-Windows-1.1.0.zip`; bản 1.0.0 cũ trong `dist-win-v1.0.0-old/`
  và file `MODOLIVIO-Windows-1.0.0.zip`.
