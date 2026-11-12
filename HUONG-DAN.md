# Hướng dẫn cài đặt & sử dụng MODOLIVIO bản Windows 1.2.0

## Cách 1 — Bản portable (khuyên dùng)

1. Tải file `MODOLIVIO-Windows-1.2.0-portable.exe` (trong thư mục `dist-win/`).
2. Nháy đúp để chạy. Không cần cài đặt, không cần quyền admin.
3. Lần đầu Windows có thể hiện cảnh báo SmartScreen (vì app chưa ký số):
   bấm **More info** → **Run anyway**.
4. App mở cửa sổ MODOLIVIO, tab **Tổng quan** (Dashboard 4 nhóm số liệu) hiện ra là dùng được ngay.

## Cách 2 — Bản zip

1. Tải file `MODOLIVIO-Windows-1.2.0.zip`, bấm phải → **Extract All...**,
   chọn thư mục (ví dụ `C:\MODOLIVIO`).
2. Vào thư mục vừa giải nén → `win-unpacked` → chạy `MODOLIVIO.exe`.
3. Muốn mở nhanh lần sau: bấm phải `MODOLIVIO.exe` → **Send to → Desktop
   (create shortcut)**.

## Đăng nhập tài khoản MODOLIVIO (cùng tài khoản với bản web)

1. Bấm **Đăng nhập** trên thanh trên cùng → **Đăng ký tài khoản mới** (tên,
   email, mật khẩu từ 4 ký tự) hoặc đăng nhập bằng tài khoản đã có.
2. **Tài khoản đăng ký đầu tiên trên máy này tự thành Quản trị viên (Admin)**,
   mở được mục Quản trị viên (quản lý người dùng, gói, key kích hoạt).
3. **Dùng chung tài khoản với bản web:** đăng ký/đăng nhập bằng **cùng email
   + mật khẩu** ở cả hai bản là được (hai bản dùng cùng thuật toán băm mật
   khẩu). Lưu ý: tài khoản phải đăng ký riêng ở mỗi bản lần đầu, hoặc mang
   sang bằng file sao lưu đầy đủ (xem mục Đồng bộ bên dưới) — tài khoản đăng
   ký trên bản web chưa tự xuất hiện trên bản Windows nếu chưa đồng bộ.

## Đồng bộ dữ liệu web ↔ Windows (song song, 2 chiều)

**Nói thẳng:** hiện chưa có đồng bộ tự động qua mạng, vì MODOLIVIO chưa có
máy chủ đám mây chung để hai bản tự gọi nhau. Cách đồng bộ thật trong bản
này là **file sao lưu đầy đủ** — làm ở bản nào cũng mang sang bản kia được:

1. Ở bản đang có dữ liệu mới nhất: menu **Đồng bộ** → **Xuất bản sao lưu đầy
   đủ** → lưu file `modolivio-backup-YYYY-MM-DD.json`.
   File gồm toàn bộ: dự án, nhân vật (kèm 8 ô ảnh khóa mặt), giọng đọc (đủ
   20 giọng), sản phẩm, đơn hàng, kho, tài chính, vận chuyển, khách hàng,
   khuyến mãi, nhân viên, sàn, affiliate, mạng xã hội, bài đăng, tài khoản
   MODOLIVIO và key kích hoạt — từ bản 1.2.0 còn gồm cả tin nhắn/việc trong
   tab Chat với Annie và cài đặt/câu trả lời đã dạy/hộp thư của Chatbot.
2. Sang bản còn lại: menu **Đồng bộ** → **Nhập bản sao lưu đầy đủ** → chọn
   file → bấm **Gộp dữ liệu**. Mục nào cùng mã sẽ ghi đè bằng bản mới hơn,
   mục mới sẽ được thêm vào; dữ liệu hiện có không bị xóa. Nhập lại cùng
   file lần 2 không nhân đôi dữ liệu.
3. Tải lại app (Xem → Tải lại) để thấy dữ liệu mới.

**Đồng bộ từng dự án (nhanh, không cần sao lưu toàn bộ):** trên bản web,
trong chi tiết dự án bấm **Xuất file dự án**; trên bản Windows, tab **Tạo
video** → **Khôi phục dự án từ file** để nhập. File dự án gồm kịch bản, cài
đặt, caption và thông tin sản phẩm (ảnh cảnh là dữ liệu nội bộ của từng máy
nên không nằm trong file).

**Giới hạn đồng bộ cần biết:**
- File sao lưu **không mang theo ảnh/nhạc đã tải lên** (nằm trong thư mục
  `uploads` của từng máy). Muốn mang ảnh mặt/ảnh sản phẩm sang máy khác thì
  chép tay thư mục `uploads` trong `%APPDATA%\MODOLIVIO\` (bản Windows) hoặc
  tải lại ảnh.
- Số liệu (doanh thu, lượt xem/thích/bình luận/người theo dõi) đồng bộ theo
  file sao lưu — nhập file mới nhất thì số liệu mới nhất sẽ hiện ở cả hai bản.
- **Kết nối tài khoản mạng xã hội chưa tự đồng bộ trạng thái đăng nhập:**
  MODOLIVIO chưa được các nền tảng cấp quyền API/OAuth chính thức, nên nút
  **Kết nối tài khoản** mở trang đăng nhập chính thức của nền tảng trong
  khung trình duyệt nhúng ngay trong app (không mở trình duyệt ngoài); đăng
  nhập xong bạn bấm nút "Đăng nhập xong — quay lại app" ngay trong khung là
  app ghi trạng thái "Đã kết nối" kèm ngày kết nối — app chưa tự lấy được
  lượt xem/thích/bình luận/người theo dõi và chưa đăng bài trực tiếp qua API
  (chưa có OAuth chính thức). Số liệu vẫn do bạn ghi trong chi tiết video
  và đăng bài qua gói đăng.

## Dùng thử nhanh (5 phút)

1. Tab **Tạo video** → 2 nút **Làm nhanh** và **Làm thủ công chi tiết** nằm
   cạnh nhau ngay đầu màn hình. **Dự án** → **Khôi phục dự án từ file** — nhập
   file dự án JSON mẫu (định dạng: `{title, caption, hashtags,
   product:{name, description}, scenes:[{idx,title,dialogue,visualPrompt,
   durationSec, motion,smile}]}`).
2. Mở dự án vừa nhập: xem **Kịch bản & cảnh**, **Làm thủ công chi tiết**
   (sửa từng câu thoại, ảnh, giọng, phụ đề, nhạc, caption), **Ghép, duyệt
   & đăng** (duyệt từng cảnh, xuất `.webm`, sao chép caption + hashtag).
3. Tab **Nhân vật & giọng**: tạo nhân vật KOC (tuổi chọn từ 2 tuổi, 8 ô ảnh
   khóa mặt báo "Thiếu ảnh"/"Sai góc"), thêm giọng (đủ 20 giọng: 18 giọng 3
   miền, Adam, nữ Hà Nội trẻ trung), ghi âm giọng của bạn để AI clone.
4. Tab **Bán hàng**: 4 tab chính Hàng hóa / Đơn hàng / Kho / Báo cáo, các mục
   còn lại trong menu **Thêm**; xem báo cáo tài chính so sánh theo
   ngày/tuần/tháng.
5. Tab **Quản lý MXH** (trong menu **Thêm ▸** trên thanh điều hướng, hoặc nút
   **Vào mục Quản lý mạng xã hội** ở Dashboard): hiện 4 nền tảng chính
   TikTok, Facebook, Instagram, YouTube; các nền tảng còn lại trong **Thêm
   nền tảng**; bấm vào từng nền tảng để vào tab quản lý riêng của nền tảng đó.

## Bật giọng đọc VieNeu-TTS (tùy chọn)

Giọng đọc tiếng Việt trong app dùng máy chủ VieNeu-TTS chạy trên máy bạn:

1. Tải/clone VieNeu-TTS (đã có sẵn trong `~/workspace/VieNeu-TTS` trên máy
   build): `git clone https://github.com/pnnbao97/VieNeu-TTS.git`
2. Chạy máy chủ: `uv run python -m apps.openai_speech`
   (nghe tại `http://127.0.0.1:8000`).
3. Mở MODOLIVIO → tab **Nhân vật & giọng** → **Giọng đọc**: trạng thái
   hiện "đang chạy" là nghe thử và clone giọng được ngay.
4. Chưa chạy máy chủ thì app báo rõ "chưa chạy", không giả giọng.

## Xuất video MP4 chuẩn (tùy chọn, cần FFmpeg)

Bản Windows hiện xuất `.webm` từ màn hình chi tiết dự án. Để xuất
`final.mp4` (H.264, AAC, 720×1280, 9:16) như cấu hình Vanzo:

1. Tải FFmpeg cho Windows (https://www.gyan.dev/ffmpeg/builds/),
   giải nén, thêm thư mục `bin` vào PATH.
2. Kiểm tra: mở Command Prompt, gõ `ffmpeg -version` — hiện phiên bản là được.
3. Trong app: menu **Trợ giúp** → **Kiểm tra công cụ** sẽ báo FFmpeg đã
   sẵn sàng hay chưa.

## Làm nhanh bằng AI (tạo clip/giọng tự động)

Bước tạo kịch bản/ảnh/clip/giọng bằng Muse AI vẫn cần tài khoản Muse
(muse.ai) đã đăng nhập — bản Windows chưa tự đăng nhập Muse thay bạn.
Trong app, bấm **Làm nhanh** sẽ báo rõ bước nào cần Muse AI và hướng dẫn
mở bản web để chạy bước đó, rồi nhập kết quả về bằng file dự án JSON.

## Key kích hoạt (dành cho Admin)

Admin tạo key trong mục Quản trị viên: key dạng rút ngắn
`MO-XXXX-XXXX-XXXX` (12 ký tự, 3 nhóm), mỗi key gắn một mã máy, hạn
tháng/năm/vĩnh viễn. Kích hoạt trong mục Quản lý tài khoản. Bản dùng thử
hiện tại chưa bắt buộc kích hoạt.

## Gỡ cài đặt

- Bản portable: xóa file `.exe` là xong.
- Bản zip: xóa thư mục đã giải nén.
- Dữ liệu của bạn nằm ở `%APPDATA%\MODOLIVIO\` — xóa thư mục này nếu muốn
  xóa sạch dữ liệu.
