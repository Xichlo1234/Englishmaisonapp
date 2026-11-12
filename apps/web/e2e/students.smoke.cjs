/**
 * Kiểm thử E2E luồng học sinh trên trình duyệt thật (Chromium/Playwright).
 * Yêu cầu: `wrangler dev` đang chạy (phục vụ web build + API) và tài khoản quản trị có mật khẩu tạm.
 *   BASE_URL=http://localhost:8787 ADMIN_EMAIL=... ADMIN_PASSWORD=... node apps/web/e2e/students.smoke.cjs
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const EMAIL = process.env.ADMIN_EMAIL;
const PW = process.env.ADMIN_PASSWORD;
const NEW_PW = process.env.NEW_PASSWORD || 'MatKhauMoi2026';
const SHOTS = process.env.SHOTS_DIR || path.join(process.cwd(), 'e2e-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['✅', name]);
  } catch (e) {
    results.push(['❌', name, e.message.split('\n')[0]]);
    throw e;
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'vi-VN', acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });

  try {
    await step('Chưa đăng nhập → chuyển về trang đăng nhập', async () => {
      await page.goto(`${BASE}/hoc-sinh`);
      await page.waitForURL(/dang-nhap/);
      await shot('01-login');
    });

    await step('Sai mật khẩu hiển thị lỗi', async () => {
      await page.fill('#identifier', EMAIL);
      await page.fill('#password', 'SaiMatKhau1');
      await page.click('button[type=submit]');
      await page.getByText('Thông tin đăng nhập không đúng').waitFor();
    });

    await step('Đăng nhập lần đầu → bắt buộc đổi mật khẩu', async () => {
      await page.fill('#password', PW);
      await page.click('button[type=submit]');
      await page.waitForURL(/doi-mat-khau/);
      await page.fill('#cp', PW);
      await page.fill('#np', NEW_PW);
      await page.fill('#cf', NEW_PW);
      await shot('02-force-change-password');
      await page.getByRole('button', { name: 'Đổi mật khẩu' }).click();
      await page.waitForURL(/hoc-sinh/);
    });

    await step('Danh sách trống có hướng dẫn', async () => {
      await page.getByText('Chưa có học sinh').waitFor();
      await shot('03-students-empty');
    });

    await step('Thêm học sinh + phụ huynh', async () => {
      await page.getByRole('link', { name: 'Thêm học sinh' }).first().click();
      await page.waitForURL(/hoc-sinh\/moi/);
      await page.fill('#fullName', 'trần thị bảo ngọc');
      await page.fill('#dob', '12/04/2016');
      await page.selectOption('#gender', 'FEMALE');
      await page.fill('#school', 'TH Nguyễn Du');
      await page.fill('#grade', '4A');
      await page.selectOption('#level', 'Movers');
      await page.fill('[id="guardians.0.phone"]', '0912 345 678');
      await page.fill('[id="guardians.0.fullName"]', 'Trần Văn Hùng');
      await page.selectOption('[id="guardians.0.rel"]', 'FATHER');
      await shot('04-student-form');
      await page.getByRole('button', { name: 'Lưu học sinh' }).click();
      await page.waitForURL(/hoc-sinh\/\d+$/);
      await page.getByRole('heading', { name: 'Trần Thị Bảo Ngọc' }).waitFor();
      await page.getByText('HS00001').waitFor();
      await shot('05-student-detail');
    });

    await step('Thêm em (dùng lại phụ huynh theo SĐT) + cảnh báo', async () => {
      await page.goto(`${BASE}/hoc-sinh/moi`);
      await page.fill('#fullName', 'Trần Minh Khang');
      await page.fill('#dob', '01092018'); // gõ liền số → tự chèn dấu /
      await page.fill('[id="guardians.0.phone"]', '0912345678');
      await page.getByRole('button', { name: 'Dùng phụ huynh này' }).click();
      await page.getByText('Trần Văn Hùng – 0912345678').waitFor();
      await page.getByText('Có thể trùng với học sinh đã có').waitFor();
      await shot('06-sibling-existing-guardian');
      await page.getByRole('button', { name: 'Lưu học sinh' }).click();
      await page.waitForURL(/hoc-sinh\/\d+$/);
      await page.getByText('HS00002').waitFor();
    });

    await step('Ô ngày hiển thị dd/mm/yyyy, tự chèn "/" và từ chối ngày không tồn tại', async () => {
      await page.goto(`${BASE}/hoc-sinh/moi`);
      await page.fill('#dob', '15032017');
      if ((await page.inputValue('#dob')) !== '15/03/2017') throw new Error('Không tự định dạng dd/mm/yyyy');
      await page.fill('#dob', '30/02/2017');
      await page.locator('#fullName').click();
      if ((await page.inputValue('#dob')) !== '') throw new Error('Không xóa ngày không tồn tại');
      const start = await page.inputValue('#start');
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(start)) throw new Error('Ngày bắt đầu mặc định không ở dạng dd/mm/yyyy: ' + start);
    });

    await step('Tìm kiếm không dấu và theo SĐT phụ huynh', async () => {
      await page.goto(`${BASE}/hoc-sinh`);
      await page.getByPlaceholder('Tìm theo tên').fill('bao ngoc');
      await page.getByRole('cell', { name: 'HS00001' }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
      await page.getByPlaceholder('Tìm theo tên').fill('0912345678');
      await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
      await page.getByPlaceholder('Tìm theo tên').fill('');
      await shot('07-students-list');
    });

    await step('Sửa hồ sơ', async () => {
      await page.getByRole('link', { name: 'Trần Thị Bảo Ngọc' }).click();
      await page.getByRole('link', { name: 'Sửa hồ sơ' }).click();
      await page.fill('#address', '25 Hai Bà Trưng, Q.1');
      await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
      await page.getByText('Đã lưu thay đổi').waitFor();
      await page.getByText('25 Hai Bà Trưng, Q.1').waitFor();
    });

    await step('Tải ảnh học sinh (R2) và hiển thị qua API có kiểm tra quyền', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwFfGZMa3hCH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBmGYxWlLxJbIAAAAASUVORK5CYII=',
        'base64',
      );
      await page.setInputFiles('input[type=file]', { name: 'anh.png', mimeType: 'image/png', buffer: png });
      await page.getByText('Đã cập nhật ảnh').waitFor();
      const img = page.locator('img[alt^="Ảnh"]');
      await img.waitFor();
      await page.waitForFunction(() => {
        const i = document.querySelector('img[alt^="Ảnh"]');
        return i && i.complete && i.naturalWidth > 0;
      });
    });

    await step('Thêm phụ huynh thứ 2 và đặt liên hệ chính', async () => {
      await page.getByRole('tab', { name: /Phụ huynh/ }).click();
      await page.getByRole('button', { name: 'Thêm phụ huynh' }).click();
      await page.fill('[id="guardians.0.phone"]', '0987654321');
      await page.fill('[id="guardians.0.fullName"]', 'Lê Thị Mai');
      await page.selectOption('[id="guardians.0.rel"]', 'MOTHER');
      await page.getByRole('button', { name: 'Lưu', exact: true }).click();
      await page.getByText('Đã thêm phụ huynh').waitFor();
      await page.getByRole('button', { name: 'Đặt liên hệ chính' }).click();
      await page.getByText('Đã đổi liên hệ chính').waitFor();
      await shot('08-guardians');
    });

    await step('Tạm nghỉ có lý do → trạng thái + nhật ký', async () => {
      await page.getByRole('button', { name: 'Thao tác khác' }).click();
      await page.getByRole('menuitem', { name: 'Tạm nghỉ' }).click();
      await page.fill('#reason', 'Đi du lịch cùng gia đình');
      await shot('09-pause-dialog');
      await page.getByRole('button', { name: 'Xác nhận tạm nghỉ' }).click();
      await page.getByText('Đã cập nhật trạng thái').waitFor();
      await page.locator('[data-slot=badge]', { hasText: 'Tạm nghỉ' }).first().waitFor();
      await page.getByRole('tab', { name: 'Nhật ký' }).click();
      await page.getByText('Đi du lịch cùng gia đình').waitFor();
      await shot('10-timeline');
    });

    await step('Xuất Excel', async () => {
      await page.goto(`${BASE}/hoc-sinh`);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Xuất Excel' }).click()]);
      const file = path.join(SHOTS, dl.suggestedFilename());
      await dl.saveAs(file);
      if (fs.statSync(file).size < 3000) throw new Error('File Excel quá nhỏ');
    });

    await step('Đăng xuất', async () => {
      await page.getByRole('button', { name: /Nguyễn Quản Trị/ }).click();
      await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
      await page.waitForURL(/dang-nhap/);
      await page.goto(`${BASE}/hoc-sinh`);
      await page.waitForURL(/dang-nhap/);
    });

    await step('Giao diện điện thoại (390px) không vỡ bố cục', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.fill('#identifier', EMAIL);
      await page.fill('#password', NEW_PW);
      await page.click('button[type=submit]');
      await page.waitForURL(/hoc-sinh/);
      await page.getByText('HS00001').first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await shot('11-mobile-list');
      if (overflow > 1) throw new Error(`Tràn ngang ${overflow}px`);
    });
  } finally {
    for (const r of results) console.log(r.join(' '));
    const relevantErrors = consoleErrors.filter((e) => !/status of 4\d\d/.test(e));
    console.log(relevantErrors.length ? `Lỗi console: ${relevantErrors.join(' | ')}` : 'Không có lỗi console (ngoài các phản hồi 4xx được kiểm thử)');
    await browser.close();
  }
})().catch(() => process.exit(1));
