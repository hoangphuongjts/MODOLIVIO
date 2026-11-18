'use strict';
/**
 * S1 — Kiểm tra DOM thật của muse.ai trên GitHub Actions Windows runner.
 *
 * Mục tiêu: trả lời 2 câu hỏi bằng bằng chứng thật (không đoán):
 *   1. Có đăng nhập được muse.ai bằng nick hy sinh từ IP trung tâm dữ liệu
 *      của GitHub Actions không (hay bị chặn / bị hỏi xác minh)?
 *   2. Các selector trong MUSE_CHAT_SELECTORS (museCdpEngine.js) có khớp
 *      với DOM thật của muse.ai không?
 *
 * Cách chạy (workflow .github/workflows/muse-s1.yml):
 *   node p3/muse/s1-dom-check.js
 *   Env bắt buộc (GitHub Secrets): MUSE_EMAIL, MUSE_PASSWORD,
 *   GMAIL_APP_PASSWORD (mật khẩu ứng dụng Gmail của hộp thư hy sinh —
 *   để script tự đọc mã đăng nhập Meta gửi về email; xem fetchMetaCode).
 *   (tài khoản Muse hy sinh — KHÔNG dùng nick chính).
 *
 * Kết quả: thư mục windows-app/s1-output/
 *   - s1-report.json  (kết luận + từng selector + URL từng trạng thái)
 *   - s1-state-*.png  (ảnh chụp từng trạng thái)
 *   - s1-state-*.html (DOM từng trạng thái)
 *
 * Mã thoát: 0 = S1 PASS (đã đăng nhập + thấy ô nhập chat);
 *            1 = S1 FAIL (không đăng nhập được / bị chặn / thiếu selector);
 *            2 = thiếu secret MUSE_EMAIL/MUSE_PASSWORD/GMAIL_APP_PASSWORD.
 * Không bao giờ in email/mật khẩu/mã xác minh ra log. Chỉ thử đăng nhập
 * 1 lần. Khi Meta đòi mã dùng một lần, script tự đọc mã từ hộp thư hy
 * sinh qua IMAP (chỉ thư mới nhất, không xóa/không sửa thư) rồi điền mã
 * 1 lần duy nhất; nếu không lấy được mã thì DỪNG và báo CHALLENGED.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT_DIR = path.join(__dirname, '..', '..', 's1-output');

// Selector cần kiểm chứng — copy nguyên văn từ MUSE_CHAT_SELECTORS
// trong museCdpEngine.js (dòng 85). S1 sẽ báo cái nào khớp, cái nào lệch.
const SELECTORS = {
  composer: 'textarea',
  notLoggedInPane: '[data-testid="native-auth-access-pane"]',
  statusPanel: '[data-testid="hatch-status-panel-sliding-surface"]',
  stopButton: '[data-testid="hatch-composer-stop-button"]',
  attachmentPresentation: '[data-testid^="hatch-chat-attachment-presentation-"]',
  agentBubble: '.hatch-agent-bubble-bg',
  fileInput: 'input[type="file"]',
  videoInBubble: '.hatch-agent-bubble-bg video',
};

const CHALLENGE_PATTERNS = [
  /checkpoint/i,
  /verify (your|that it's you)/i,
  /two[- ]factor/i,
  /2[- ]step verification/i,
  /xác minh/i,
  /mã xác minh/i,
  /mã dùng một lần/i,
  /code_submit/i,
  /Kiểm tra email của bạn/i,
  /Hãy nhập mã/i,
  /Enter your code/i,
  /suspicious/i,
  /unusual (activity|login)/i,
  /confirm (your )?identity/i,
  /we need to verify/i,
];

const LOGIN_TEXT = /log ?in|sign ?in|đăng nhập/i;

function log(msg) {
  console.log(`[S1 ${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function saveState(page, name, report) {
  const png = path.join(OUT_DIR, `s1-${name}.png`);
  const html = path.join(OUT_DIR, `s1-${name}.html`);
  try {
    await page.screenshot({ path: png, fullPage: false });
  } catch (e) {
    log(`Không chụp được ảnh ${name}: ${e.message}`);
  }
  try {
    const content = await page.content();
    fs.writeFileSync(html, content, 'utf8');
  } catch (e) {
    log(`Không lưu được DOM ${name}: ${e.message}`);
  }
  const state = { name, url: page.url(), title: '' };
  try {
    state.title = await page.title();
  } catch (e) {
    state.title = '';
  }
  report.states.push(state);
  log(`Đã lưu trạng thái ${name}: ${state.url} | ${state.title}`);
  return state;
}

async function checkSelectors(page) {
  const results = {};
  for (const [name, selector] of Object.entries(SELECTORS)) {
    try {
      const count = await page.locator(selector).count();
      results[name] = { selector, found: count > 0, count };
    } catch (e) {
      results[name] = { selector, found: false, count: 0, error: e.message };
    }
  }
  return results;
}

async function detectChallenge(page) {
  try {
    const url = page.url();
    // Trang code_submit của Meta: chỉ ghi lại phần path, KHÔNG ghi query
    // (trong query có token dùng một lần, không được đưa vào báo cáo).
    if (/code_submit/i.test(url)) return { challenged: true, pattern: 'code_submit url', excerpt: url.split('?')[0].slice(0, 200) };
    const bodyText = (await page.evaluate(() => document.body ? document.body.innerText : '')).slice(0, 4000);
    const hit = CHALLENGE_PATTERNS.find((re) => re.test(bodyText));
    if (hit) return { challenged: true, pattern: String(hit), excerpt: bodyText.slice(0, 300) };
    const codeInput = await page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]').count();
    if (codeInput > 0) return { challenged: true, pattern: 'one-time-code input', excerpt: '' };
  } catch (e) {
    log(`Lỗi khi kiểm tra trang xác minh: ${e.message}`);
  }
  return { challenged: false };
}

// Đọc mã đăng nhập 6 số Meta gửi về hộp thư hy sinh qua IMAP, dùng mật khẩu
// ứng dụng Gmail (secret GMAIL_APP_PASSWORD). Chỉ đọc thư trong ~15 phút
// qua, không xóa/không đánh dấu đã đọc, không in mã hay nội dung thư ra log.
// Trả về mã (chuỗi 6 số) hoặc null nếu không lấy được trong 5 phút.
async function fetchMetaCode({ user, appPassword }) {
  let ImapFlow;
  try {
    ({ ImapFlow } = require('imapflow'));
  } catch (e) {
    log('Thiếu thư viện imapflow — không đọc được hộp thư.');
    return null;
  }
  const deadline = Date.now() + 5 * 60 * 1000;
  let client = null;
  try {
    client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user, pass: appPassword },
      logger: false,
    });
    await client.connect();
    await client.mailboxOpen('INBOX');
    while (Date.now() < deadline) {
      let uids = [];
      try {
        uids = await client.search({ since: new Date(Date.now() - 15 * 60 * 1000) });
      } catch (e) {
        log(`Tìm thư mã thất bại: ${e.message}`);
      }
      uids.sort((a, b) => b - a);
      for (const uid of uids.slice(0, 5)) {
        try {
          const msg = await client.fetchOne(uid, { envelope: true, source: true });
          const subject = (msg && msg.envelope && msg.envelope.subject) || '';
          const raw = msg && msg.source ? msg.source.toString('utf8') : '';
          const idx = raw.search(/\r\n\r\n|\n\n/);
          const body = idx >= 0 ? raw.slice(idx) : raw;
          const text = `${subject}\n${body}`;
          if (!/meta|facebook/i.test(`${subject}\n${raw.slice(0, 2000)}`)) continue;
          const m = text.match(/\b(\d{6})\b/);
          if (m) {
            log('Đã lấy được mã từ email (không in mã ra log).');
            return m[1];
          }
        } catch (e) {
          /* thử thư tiếp theo */
        }
      }
      await sleep(30000);
    }
    log('Hết 5 phút chờ mà không thấy email mã của Meta.');
  } catch (e) {
    log(`Không đọc được hộp thư: ${e.message}`);
  } finally {
    if (client) {
      try { await client.logout(); } catch (_) { /* bỏ qua */ }
    }
  }
  return null;
}

// Điền mã 6 số vào trang xác minh của Meta rồi gửi. Trả về true nếu đã
// điền + gửi được, false nếu không thấy ô mã.
async function fillCodeAndSubmit(page, code) {
  try {
    const codeInput = page.locator('input[placeholder="Mã"], input[inputmode="numeric"], input[autocomplete="one-time-code"], input[type="text"]').first();
    if ((await codeInput.count()) === 0) return false;
    await codeInput.fill(code, { timeout: 15000 });
    await sleep(800);
    const next = page.locator('button:has-text("Tiếp tục"), [role="button"]:has-text("Tiếp tục")').first();
    if ((await next.count()) > 0) {
      await next.click({ timeout: 10000 });
    } else {
      await codeInput.press('Enter');
    }
    await sleep(5000);
    return true;
  } catch (e) {
    log(`Điền mã thất bại: ${e.message}`);
    return false;
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    runAt: new Date().toISOString(),
    target: 'https://muse.ai',
    loginOutcome: 'UNKNOWN',
    challenge: null,
    selectors: {},
    states: [],
    notes: [],
  };

  const email = process.env.MUSE_EMAIL || '';
  const password = process.env.MUSE_PASSWORD || '';
  // Mật khẩu ứng dụng Gmail thường hiển thị dạng "xxxx xxxx xxxx xxxx" —
  // bỏ khoảng trắng để dùng cho IMAP.
  const gmailAppPassword = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!email || !password || !gmailAppPassword) {
    report.loginOutcome = 'MISSING_SECRETS';
    report.notes.push('Thiếu secret MUSE_EMAIL, MUSE_PASSWORD hoặc GMAIL_APP_PASSWORD. Thêm trong repo Settings → Secrets and variables → Actions, rồi chạy lại workflow.');
    fs.writeFileSync(path.join(OUT_DIR, 's1-report.json'), JSON.stringify(report, null, 2), 'utf8');
    log('S1 FAIL: thiếu secret MUSE_EMAIL/MUSE_PASSWORD/GMAIL_APP_PASSWORD.');
    process.exit(2);
  }
  // Chỉ thử lấy + điền mã 1 lần duy nhất trong cả lượt chạy.
  let codeTried = false;

  const chromeBin = process.env.CHROME_BIN || '';
  let browser;
  try {
    const launchOpts = {
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    };
    if (chromeBin && fs.existsSync(chromeBin)) {
      launchOpts.executablePath = chromeBin;
      log(`Dùng Chrome thật tại ${chromeBin}`);
    } else {
      log('Không có CHROME_BIN — dùng Chromium của Playwright.');
    }
    browser = await chromium.launch(launchOpts);
  } catch (e) {
    report.loginOutcome = 'BROWSER_LAUNCH_FAILED';
    report.notes.push(`Không mở được trình duyệt: ${e.message}`);
    fs.writeFileSync(path.join(OUT_DIR, 's1-report.json'), JSON.stringify(report, null, 2), 'utf8');
    log(`S1 FAIL: không mở được trình duyệt: ${e.message}`);
    process.exit(1);
  }

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  try {
    log('Mở https://muse.ai ...');
    await page.goto('https://muse.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);
    await saveState(page, 'state-1-landing', report);

    // Đã đăng nhập sẵn chưa?
    let selectors = await checkSelectors(page);
    const alreadyIn = selectors.composer.found && !selectors.notLoggedInPane.found;
    if (alreadyIn) {
      log('Đã ở trong trang chat (có ô nhập, không có panel chưa đăng nhập).');
      report.loginOutcome = 'LOGGED_IN';
    } else {
      // Tìm nút đăng nhập và bấm.
      log('Chưa đăng nhập — tìm nút đăng nhập...');
      const loginBtn = page.locator('a, button', { hasText: LOGIN_TEXT }).first();
      if ((await loginBtn.count()) > 0) {
        await loginBtn.click({ timeout: 10000 });
        await sleep(4000);
        await saveState(page, 'state-2-login-page', report);
      } else {
        report.notes.push('Không thấy nút đăng nhập trên trang đích — xem ảnh/DOM state-1.');
        await saveState(page, 'state-2-login-page', report);
      }

      // Đăng nhập Meta kiểu 2 bước (chỉ thử 1 lần): bước 1 nhập email + Continue,
      // bước 2 mới hiện ô mật khẩu. (Bằng chứng run #3: trang đăng nhập chỉ có
      // 1 ô "Mobile number or email", không có ô mật khẩu cùng trang.)
      const emailInput = page.locator('input[placeholder="Mobile number or email"], input[aria-label="Mobile number or email"], input[type="email"], input[name="email"], input#email, input[autocomplete="username"]').first();
      let passInput = page.locator('input[type="password"]').first();
      const formFound = (await emailInput.count()) > 0;
      if (formFound && (await passInput.count()) === 0) {
        log('Trang đăng nhập 2 bước: điền email rồi bấm Continue...');
        await emailInput.fill(email, { timeout: 15000 });
        await sleep(800);
        const contBtn = page.locator('button[data-pel-click="login_contact_continue_click"], button[type="submit"]').first();
        if ((await contBtn.count()) > 0) {
          await contBtn.click({ timeout: 10000 });
        } else {
          await emailInput.press('Enter');
        }
        await sleep(5000);
        // Meta có thể đưa tới trang nhập mã 6 số thay vì ô mật khẩu — trang đó
        // có link "Use password instead": bấm vào đó để về luồng mật khẩu.
        // (Bằng chứng run #4: sau Continue, Meta gửi mã về email thay vì
        // hiện ô mật khẩu.)
        const usePassLink = page.locator('a, button', { hasText: 'Use password instead' }).first();
        if ((await usePassLink.count()) > 0) {
          log('Trang yêu cầu mã — bấm "Use password instead" để dùng mật khẩu...');
          await usePassLink.click({ timeout: 10000 });
          await sleep(5000);
        }
        passInput = page.locator('input[type="password"]').first();
        await saveState(page, 'state-2b-password-page', report);
        if ((await passInput.count()) === 0) {
          const challenge = await detectChallenge(page);
          if (challenge.challenged && /code/i.test(challenge.pattern) && !codeTried) {
            // Trang đòi mã ngay sau Continue (chưa tới bước mật khẩu) — thử
            // lấy mã từ Gmail 1 lần duy nhất rồi điền mã (hướng C).
            codeTried = true;
            report.challenge = challenge;
            log('Trang đòi mã — thử lấy mã từ Gmail (1 lần duy nhất)...');
            const code = await fetchMetaCode({ user: email, appPassword: gmailAppPassword });
            if (code && (await fillCodeAndSubmit(page, code))) {
              log('Đã điền mã và gửi — chờ xem trang tiếp theo...');
              await sleep(5000);
              passInput = page.locator('input[type="password"]').first();
              report.challenge = null;
              const s2 = await checkSelectors(page);
              if (s2.composer.found && !s2.notLoggedInPane.found) {
                report.loginOutcome = 'LOGGED_IN';
                selectors = s2;
              }
            }
          }
          if (report.loginOutcome !== 'LOGGED_IN' && (await passInput.count()) === 0) {
            const ch2 = await detectChallenge(page);
            if (ch2.challenged) {
              report.challenge = ch2;
              report.loginOutcome = 'CHALLENGED';
              report.notes.push(codeTried
                ? 'Đã thử điền mã từ Gmail nhưng vẫn chưa qua được trang xác minh — xem ảnh/DOM state-2b.'
                : 'Sau khi nhập email + Continue thì gặp trang xác minh/thử thách — đã DỪNG, không nhập mã. Xem ảnh/DOM state-2b.');
            } else {
              report.loginOutcome = 'LOGIN_FAILED';
              report.notes.push('Đã nhập email + Continue nhưng không thấy ô mật khẩu xuất hiện — xem ảnh/DOM state-2b để biết trang đang ở đâu.');
            }
          }
        }
      }
      if (formFound && (await passInput.count()) > 0) {
        log('Điền mật khẩu và gửi (1 lần duy nhất)...');
        await passInput.fill(password, { timeout: 15000 });
        await sleep(800);
        const submit = page.locator('button[type="submit"], button:has-text("Log In"), button:has-text("Log in")').first();
        if ((await submit.count()) > 0) {
          await submit.click({ timeout: 10000 });
        } else {
          await passInput.press('Enter');
        }
        // Chờ tối đa 120s: hoặc vào được chat, hoặc bị chặn/xác minh.
        // Nếu Meta đòi mã dùng một lần thì thử lấy mã từ Gmail 1 lần duy
        // nhất rồi điền mã (hướng C, anh đã chọn), sau đó chờ thêm 180s.
        let deadline = Date.now() + 120000;
        let settled = false;
        while (Date.now() < deadline) {
          await sleep(5000);
          selectors = await checkSelectors(page);
          if (selectors.composer.found && !selectors.notLoggedInPane.found) {
            settled = true;
            break;
          }
          const challenge = await detectChallenge(page);
          if (challenge.challenged) {
            report.challenge = challenge;
            if (!codeTried && /code/i.test(challenge.pattern)) {
              codeTried = true;
              log('Trang đòi mã — thử lấy mã từ Gmail (1 lần duy nhất)...');
              const code = await fetchMetaCode({ user: email, appPassword: gmailAppPassword });
              if (code) {
                const filled = await fillCodeAndSubmit(page, code);
                if (filled) {
                  log('Đã điền mã và gửi — chờ vào chat...');
                  report.challenge = null;
                  deadline = Date.now() + 180000;
                  continue;
                }
              }
              report.notes.push('Đã thử lấy mã từ Gmail nhưng không lấy/điền được — xem ảnh/DOM state-3.');
            }
            settled = true;
            break;
          }
        }
        await saveState(page, 'state-3-after-login', report);
        if (report.challenge) {
          report.loginOutcome = 'CHALLENGED';
          report.notes.push(codeTried
            ? 'Đã thử điền mã từ Gmail nhưng vẫn chưa vào được chat — xem ảnh/DOM state-3.'
            : 'Gặp trang xác minh/thử thách sau khi gửi đăng nhập — đã DỪNG, không nhập mã. Xem ảnh/DOM state-3.');
        } else if (selectors.composer.found && !selectors.notLoggedInPane.found) {
          report.loginOutcome = 'LOGGED_IN';
        } else {
          report.loginOutcome = 'LOGIN_FAILED';
          report.notes.push('Sau 120s vẫn không thấy ô nhập chat và không thấy trang xác minh rõ ràng — xem ảnh/DOM state-3 để biết trang đang ở đâu.');
        }
      } else if (!formFound) {
        report.loginOutcome = 'LOGIN_FORM_NOT_FOUND';
        report.notes.push('Không tìm thấy ô email/mật khẩu trên trang đăng nhập — xem ảnh/DOM state-2. Có thể giao diện đăng nhập của Meta khác với dự đoán.');
      }
    }

    // Kiểm chứng toàn bộ selector trên DOM hiện tại.
    report.selectors = await checkSelectors(page);
    for (const [name, r] of Object.entries(report.selectors)) {
      log(`Selector ${name} (${r.selector}): ${r.found ? `THẤY (${r.count})` : 'KHÔNG THẤY'}`);
    }
    await saveState(page, 'state-4-final', report);

    const composerOk = report.selectors.composer && report.selectors.composer.found;
    const pass = report.loginOutcome === 'LOGGED_IN' && composerOk;
    report.verdict = pass ? 'S1 PASS' : 'S1 FAIL';
    fs.writeFileSync(path.join(OUT_DIR, 's1-report.json'), JSON.stringify(report, null, 2), 'utf8');
    log(`${report.verdict} — loginOutcome=${report.loginOutcome}, composer=${composerOk ? 'thấy' : 'không thấy'}. Báo cáo: s1-report.json`);
    process.exit(pass ? 0 : 1);
  } catch (e) {
    report.loginOutcome = report.loginOutcome === 'UNKNOWN' ? 'SCRIPT_ERROR' : report.loginOutcome;
    report.notes.push(`Lỗi script: ${e.message}`);
    try {
      await saveState(page, 'state-error', report);
    } catch (_) {
      /* bỏ qua */
    }
    fs.writeFileSync(path.join(OUT_DIR, 's1-report.json'), JSON.stringify(report, null, 2), 'utf8');
    log(`S1 FAIL: lỗi script: ${e.message}`);
    process.exit(1);
  } finally {
    await browser.close().catch(() => {});
  }
}

main();
