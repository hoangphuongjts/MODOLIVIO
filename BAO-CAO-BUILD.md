# Báo cáo build MODOLIVIO bản Windows 1.2.0

Ngày build: 2026-11-12. Electron 33.4.11, electron-builder 25.1.8,
Windows x64. Build trên Linux (không có Wine nên không làm được NSIS
installer — xem giới hạn ở dưới).

Bản 1.1.0 cũ còn nguyên: thư mục `dist-win-v1.1.0-old/` và file
`MODOLIVIO-Windows-1.1.0.zip`. Bản 1.0.0 cũ còn nguyên trong
`dist-win-v1.0.0-old/` và file `MODOLIVIO-Windows-1.0.0.zip`.

## File build 1.2.0

- `dist-win/MODOLIVIO-Windows-1.2.0-portable.exe` — 86.612.851 byte (~83 MB)
  (MD5 `fa93a35d7d555d15d9c82a229a0859b5`), chạy thẳng không cần cài đặt.
- `dist-win/win-unpacked/MODOLIVIO.exe` — 188.784.128 byte, bản thư mục
  281 MB, 73 file (MD5 `1c93e10ddd4256001d9a81a527b5759e`).
- `MODOLIVIO-Windows-1.2.0.zip` — 213.564.104 byte (~204 MB), 77 file
  (MD5 `ae019cc0f3f57238033327cc17983c47`), đã kiểm tra `unzip -l`: đủ
  `MODOLIVIO.exe` + `resources/app.asar`.
- Đã kiểm tra nội dung `app.asar`: renderer v16
  (`index-9s0t5ehk.js`, `index-dm82p18k.css`, đủ 50 ảnh bối cảnh
  `bg-bc-01..50`), `handlers.js` (đủ action mới: Chat với Annie, Chatbot,
  connectShop/disconnectShop, setAccountConnection), `main.js`
  (APP_VERSION `1.2.0-win1`, menu Đồng bộ), `bridge.js` (thêm 5 collection
  mới: annieMessages, annieTasks, chatbotSettings, chatbotKnowledge,
  chatbotConversations), `package.json` version `1.2.0`.

## Có gì mới so với 1.1.0

1. **Renderer = bản web mới nhất v16 (1.4.0):** kho nhạc 6 nguồn (TikTok
   Commercial Music Library, Meta Sound Collection, YouTube Audio Library,
   Pixabay Music, Mixkit, nhạc tải lên — mỗi nguồn ghi rõ giấy phép và đăng
   được lên nền tảng nào, lọc theo nền tảng đăng bài), đăng nhập bằng trình
   duyệt nhúng trong app cho mọi nền tảng và sàn, tab **Chat với Annie**,
   giao diện quản lý đầy đủ 4 sàn (mỗi sàn 1 tab riêng, đủ các mục kết nối,
   sản phẩm, đơn hàng, doanh thu, tồn kho, đánh giá, gắn link vào video).
   CSS đóng gói đã bỏ dòng `@import` Google Fonts (font Be Vietnam Pro) để
   chạy offline bằng font hệ thống (font stack có sẵn system-ui/Segoe UI);
   file gốc trên bản web không bị sửa.
2. **Đủ 228/228 action của bản web** (+ 2 action sao lưu riêng của bản
   Windows = 230 action): đã bổ sung toàn bộ nhóm còn thiếu so với 1.1.0 —
   Chat với Annie (`getAnnieChat`, `annieSendMessage`, `annieMarkTasksSeen`,
   `annieDeleteTask`), Chatbot (`getChatbotSettings`, `saveChatbotSettings`,
   `listChatbotKnowledge`, `createChatbotKnowledge`,
   `updateChatbotKnowledge`, `deleteChatbotKnowledge`,
   `listChatbotConversations`, `chatbotAsk`, `chatbotCreateOrder`,
   `chatbotHumanReply`, `chatbotSetConversationStatus`,
   `deleteChatbotConversation`), kết nối sàn (`connectShop`,
   `disconnectShop`), đăng nhập Muse AI (`setAccountConnection`, tự chuyển
   tài khoản đang dùng khi ngắt kết nối).
3. **Chatbot chạy cục bộ (không bịa):** trả lời theo câu đã dạy (khớp từ
   khóa), tra đơn theo SĐT, ngoài giờ thì hẹn lại theo cài đặt, khách giận
   thì trấn an + chuyển người thật, tạo đơn thật (mã CB-…) vào mục Bán hàng.
   Câu hỏi ngoài dữ liệu shop thì chuyển người thật kèm câu trấn an — không
   bịa câu trả lời bằng AI (bản Windows không có Muse AI).
4. **Chat với Annie chạy cục bộ (không bịa):** trả lời bằng dữ liệu thật
   trong app (sản phẩm, video, việc, tài khoản MXH/sàn đã kết nối), hỏi
   tiến độ thì báo đúng bước pipeline. Dán link sản phẩm thì Annie lưu link
   và tạo việc ở trạng thái "Cần anh xử lý" kèm hướng dẫn chạy tiếp trên
   bản web (bước đọc link cần Muse AI) — không để việc kẹt ở "đang chạy"
   mãi, không bịa là đã đọc xong.
5. **Nhạc tải lên giữ nhãn giấy phép:** `uploadMusic` nay lưu `licenseNote`
   (all / tiktok / meta / youtube / own) và `listMusic` trả lại nhãn này
   (bản 1.1.0 làm mất nhãn) nên lọc nhạc theo nền tảng đăng bài trong Thư
   viện nhạc chạy đúng.
6. **Chuẩn hóa trạng thái khớp bản web:** tài khoản MXH mặc định
   `chua-ket-noi` (bản 1.1.0 dùng `connected`), sức khỏe `tot` (bản 1.1.0
   dùng `tốt`), tài khoản Muse mặc định `ready`, gian hàng có đủ
   `status`/`connectedAt` — client v16 kiểm tra đúng các giá trị này.
7. **Báo cáo bán hàng gồm đơn hôm nay (khớp bản web):** bản web v16 đã sửa
   `getSalesReport` (kỳ hiện tại tính đến ngày mai); bản Windows giữ cách
   sửa từ 1.1.0 nên hai bản nay khớp nhau — Dashboard không còn lệch số liệu
   ở đơn trong ngày. Đã kiểm chứng: đơn hôm nay 698.000đ được tính đúng.
8. **VieNeu-TTS:** `getVieneuStatus`/`previewVieneuVoice` chạy thật qua
   proxy tới `http://127.0.0.1:8000` khi máy chủ đang chạy; chưa chạy thì
   báo rõ cách chạy, không giả giọng (đã sửa lỗi "not declared" ở bản web
   v16; bản Windows vốn đã khai báo đúng các action này).

## Đồng bộ — giới hạn trung thực (quan trọng)

**Chưa có đồng bộ tự động qua mạng / theo thời gian thực.** Bản web
MODOLIVIO không có API hay máy chủ đám mây công khai để bản Windows gọi
trực tiếp (dữ liệu web nằm trong `app.db` của máy chủ Hatch, phiên đăng
nhập lưu ở localStorage của trình duyệt), và MODOLIVIO chưa có máy chủ
đám mây riêng. Vì vậy "đồng bộ song song" trong bản này là **đồng bộ bằng
file sao lưu đầy đủ** (xuất ở bản này → nhập ở bản kia), cộng với việc
dùng chung tài khoản (cùng email + mật khẩu). Muốn đồng bộ tự động thật
thì cần xây máy chủ đám mây MODOLIVIO (API + đăng nhập + đồng bộ) — việc
này chưa làm trong bản này.
**File sao lưu không mang theo ảnh/nhạc đã tải lên** (nằm trong thư mục
`uploads` của từng máy) — muốn mang ảnh mặt/ảnh sản phẩm sang máy khác
thì chép tay thư mục `uploads`. Đây cũng là giới hạn của nút "Xuất file
dự án" trên bản web.
**Mới trong 1.2.0:** file sao lưu đầy đủ nay mang cả 5 collection mới
(Chat với Annie: annieMessages/annieTasks; Chatbot: chatbotSettings/
chatbotKnowledge/chatbotConversations) — đã kiểm chứng nhập sang store
mới: thêm 27 mục, nhập lại không nhân đôi, đăng nhập ở "máy mới" bằng
tài khoản trong file sao lưu được, tin nhắn Annie vẫn còn đủ.

## Kiểm tra đã làm (đều là kết quả thật, đã chạy)

1. **Syntax:** `node --check` OK cho cả 5 file JS (main, preload, server,
   bridge, handlers) — script `npm run check`.
2. **So khớp action:** trích 228 action từ `server/src/actions.ts` của bản
   web và đối chiếu với handler hiệu dụng của bản Windows (handler tường
   minh + bảng ENTITIES generic): **thiếu 0 action** — 228/228 + 2 action
   sao lưu riêng (`exportAllData`, `importAllData`) = 230.
3. **Máy chủ độc lập + probe action (`/tmp/probe-v12.js`): 62/62 PASS** —
   health 200 (version `1.2.0-win1`), renderer mới 200 (bundle
   `index-9s0t5ehk.js` chứa "Chat với Annie" + "TikTok Commercial Music
   Library"), CSS không còn Google Fonts, ảnh bối cảnh 200, hash mật khẩu
   khớp bản web, đăng ký/đăng nhập/đổi mật khẩu (dùng đúng trường
   `currentPassword` của bản web), admin (key MO-XXXX-XXXX-XXXX tạo/kích
   hoạt hạn +1 tháng đến 2026-12-12/kiểm tra trạng thái `active`),
   connectShop/disconnectShop (da-ket-noi kèm ngày 2026-11-12 → chua-ket-noi,
   xóa ngày), setAccountConnection (ready + email + ngày → login_needed),
   tài khoản MXH TikTok da-ket-noi kèm ngày, getSalesReport hôm nay
   698.000đ đúng (đơn hôm nay + kỳ tháng), uploadMusic giữ licenseNote
   `youtube`, VieNeu-TTS báo chưa chạy trung thực (không giả giọng),
   Chat với Annie (gửi link → việc needs_attention, hỏi tiến độ → trả lời
   bằng dữ liệu thật, đánh dấu đã xem, xóa việc), Chatbot (cài đặt mặc định
   08:00–22:00 + Muse AI, dạy/sửa/xóa câu trả lời, chatbotAsk khớp câu đã
   dạy, khách giận → needs_human + xin lỗi, tra đơn theo SĐT ra đúng đơn
   698.000đ, tạo đơn thật CB-… 349.000đ vào Bán hàng, trả lời người thật,
   đổi trạng thái, xóa hội thoại), quickCreate báo lỗi Muse AI rõ ràng,
   export/import sao lưu đầy đủ sang store mới (thêm 27 mục, nhập lại không
   nhân đôi, đăng nhập ở "máy mới" được, tin nhắn Annie còn đủ 6 tin).
   - Trong lúc probe phát hiện và đã sửa 1 lỗi thật: CSS bản web v16 có
     dòng `@import` Google Fonts (bản 1.1.0 đã bỏ) — đã bỏ dòng này khỏi CSS
     đóng gói (font stack có sẵn system-ui/Segoe UI nên hiển thị không đổi).
   - 5 lỗi "FAIL" ban đầu trong probe là lỗi của chính script probe (sai
     tên trường `oldPassword` thay vì `currentPassword` của bản web; kỳ
     vọng sai shape trả về của `activateLicense`/`checkLicense`; xóa việc
     Annie duy nhất trước khi kiểm tra sao lưu) — đã sửa probe và chạy lại
     đạt 62/62, không phải lỗi app.
4. **Smoke test Electron thật (xvfb-run, `electron . --smoke-test`):**
   React mount (`rootChildren: 1`), title MODOLIVIO, **0 console error**.
   Dashboard hiện đúng: ☰ Menu, Đăng nhập, ← Quay lại / Tiếp theo →,
   Bước 1/8 · Tổng quan, ⚡ Làm nhanh / ✎ Làm thủ công, ♪ Beat Studio,
   và đủ 10 tab: Tổng quan, Tạo video, Nhân vật & giọng đọc, Bối cảnh,
   Bán hàng, Quản lý mạng xã hội, Chatbot, Chat với Annie, Beat Studio,
   Tài khoản. (Lỗi dbus/GPU trong log là nhiễu của môi trường Linux, không
   phải lỗi console của app.)
5. **Probe bấm tab thật (Electron headless, 0 lỗi console):** cả 8 tab chính
   bấm được và hiện đúng nội dung (Tổng quan, Tạo video, Nhân vật & giọng
   đọc, Bối cảnh, Bán hàng, Quản lý MXH, Chatbot, Chat với Annie, Beat
   Studio, Tài khoản); Bán hàng → menu Thêm → **Sàn** mở trang "Quản lý &
   đăng nhập từng sàn (Shopee, TikTok Shop, Lazada, Tiki)", mỗi sàn 1 tab
   riêng; Beat Studio → **Thư viện nhạc** hiện bộ lọc nền tảng (Mọi nền
   tảng / TikTok / Facebook / Instagram / YouTube); tab **Chat với Annie**
   gửi link Shopee thật từ giao diện: tin nhắn + câu trả lời của Annie +
   thẻ việc "Đọc link sản phẩm (shopee) — Cần anh xử lý" hiện ngay, lưu
   đúng vào dữ liệu (2 tin nhắn, 1 việc needs_attention).
6. **Gói Windows:** `electron-builder --win --x64` exit 0, tạo đủ 2 target
   (dir + portable). Đã kiểm tra nội dung `app.asar` (xem trên) và file zip.

## Kiến trúc (giữ nguyên từ 1.1.0, cập nhật v1.2)

- `renderer/` — bản sao client dist mới nhất của App V1 web (**v16 /
  1.4.0**).
- `server.js` — máy chủ cục bộ Node thuần, phục vụ renderer,
  `POST /actions`, `GET /uploads/*`, `GET /health` (version `1.2.0-win1`).
- `bridge.js` — store JSON cục bộ (`%APPDATA%/MODOLIVIO/modolivio-data.json`),
  thêm các collection `annieMessages`, `annieTasks`, `chatbotSettings`,
  `chatbotKnowledge`, `chatbotConversations`; `hashPassword`,
  `makeLicenseKey`, `exportBackup`/`importBackup` (tự bao cả collection
  mới); proxy thật tới VieNeu-TTS ở `http://127.0.0.1:8000` khi máy chủ
  đang chạy.
- `handlers.js` — bộ điều phối 230 actions (228 của bản web + 2 action
  sao lưu `exportAllData`/`importAllData`), khớp đúng response shape của
  bản web. Các action cần Muse AI trả lỗi tiếng Việt rõ ràng, không bịa
  kết quả. Chatbot/Chat với Annie chạy cục bộ bằng dữ liệu thật trong app.
- `main.js` — Electron main: single-instance, cửa sổ 1360×860, menu tiếng
  Việt, menu **Đồng bộ** (Xuất/Nhập bản sao lưu đầy đủ + giải thích cách
  đồng bộ), IPC `modolivio:get-info` / `open-data-folder` /
  `check-tools`, chế độ `--smoke-test`.

## Giới hạn còn lại (chưa kiểm tra hoặc chưa làm được)

1. **Chưa chạy thử file `.exe` trên Windows thật.** Máy build là Linux,
   không chạy được binary win32. Đã kiểm tra tới mức tối đa trên Linux:
   Electron smoke test + probe tab + probe action 62/62 + nội dung asar.
   Trên Windows cần kiểm tra lại một lần: mở app, đăng nhập, bấm các tab,
   nhập file sao lưu, gửi tin nhắn trong tab Chat với Annie.
2. **Không có NSIS installer** (cần Wine trên máy build). Chỉ có bản
   portable `.exe` và bản thư mục/zip — đều chạy được, không cần cài đặt.
3. **App không ký số (unsigned):** Windows SmartScreen sẽ hỏi lần đầu.
   Icon file `.exe` trong Explorer là icon mặc định của Electron (do
   không có Wine để nhúng icon.ico); icon trong cửa sổ/taskbar vẫn là
   logo MO (đặt lúc chạy bằng `main.js`).
4. **Làm nhanh AI cần Muse AI:** các action `quickCreate`,
   `runPipelineStep`, `regenerateSceneImage`, `inferCharacterProfile`,
   `generateCharacter`, `generateOutline`, `buildEpisode`,
   `buildAllEpisodes`, `createCafeVideo`, `buildReverseVideo`,
   `analyzeReverseFrames`, `rewriteReverse`, `assistSubtitles`,
   `createSeriesFromReverse` trả lỗi tiếng Việt rõ ràng, không bịa kết
   quả. Cần dùng bản web với tài khoản Muse đã đăng nhập cho các bước này.
   Trong tab Chat với Annie trên bản Windows, Annie lưu link và hướng dẫn
   chạy tiếp trên bản web thay vì giả vờ đã đọc xong.
5. **Xuất file cuối là `.webm`** (ghép từ ảnh từng cảnh) — chưa có FFmpeg
   phía server để xuất `final.mp4` H.264/AAC. Xem `HUONG-DAN.md` để cài
   FFmpeg.
6. **Đồng bộ chưa tự động qua mạng** (xem mục Đồng bộ ở trên). File sao
   lưu không mang ảnh/nhạc tải lên.
7. **Kết nối tài khoản MXH/sàn chưa có OAuth chính thức:** nút Kết nối mở
   trang đăng nhập chính thức của nền tảng trong khung trình duyệt nhúng
   trong app; đăng nhập xong bấm nút "Đăng nhập xong — quay lại app" trong
   khung là app ghi trạng thái "Đã kết nối" kèm ngày — vì trang đăng nhập
   khác nguồn nên app không tự nhận biết khoảnh khắc đăng nhập xong mà
   không cần 1 nút bấm nào. App chưa tự lấy số liệu (lượt xem/thích/bình
   luận/người theo dõi) và chưa đăng bài trực tiếp qua API.
