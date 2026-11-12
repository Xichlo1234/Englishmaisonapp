/**
 * E2E điểm danh dưới vai trò GIÁO VIÊN: mở buổi hôm nay → chọn trạng thái → tự lưu nháp → mất mạng/khôi phục
 * → xác nhận → lịch sử → tổng hợp tháng → giao diện điện thoại.
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const EMAIL = process.env.ADMIN_EMAIL;
const PW = process.env.ADMIN_PASSWORD;
const NEW_PW = 'MatKhauMoi2026';
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
const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const isoWeekday = (d) => {
  const w = new Date(d + 'T00:00:00Z').getUTCDay();
  return w === 0 ? 7 : w;
};

async function loginAs(page, id, pw, newPw) {
  await page.goto(`${BASE}/dang-nhap`);
  await page.fill('#identifier', id);
  await page.fill('#password', pw);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.includes('dang-nhap'));
  if (page.url().includes('doi-mat-khau')) {
    await page.fill('#cp', pw);
    await page.fill('#np', newPw);
    await page.fill('#cf', newPw);
    await page.getByRole('button', { name: 'Đổi mật khẩu' }).click();
    await page.waitForURL((u) => !u.pathname.includes('doi-mat-khau'));
  }
}
const call = (page, method, p, body) =>
  page.evaluate(
    async ({ method, p, body }) => {
      const csrf = document.cookie.match(/ecm_csrf=([^;]+)/)?.[1] ?? '';
      const r = await fetch(`/api/v1${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json() };
    },
    { method, p, body },
  );

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'vi-VN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });
  const today = vnToday();
  let teacher;

  try {
    await step('Quản trị viên chuẩn bị lớp có buổi học hôm nay (3 học sinh)', async () => {
      await loginAs(page, EMAIL, PW, NEW_PW);
      const t = await call(page, 'POST', '/teachers', { fullName: 'Lê Minh Tâm', phone: '0905123456' });
      teacher = t.body;
      const sh = await call(page, 'POST', '/shifts', { name: 'Ca sớm', startTime: '00:05', endTime: '00:35' });
      const start = addDays(today, -14);
      const c = await call(page, 'POST', '/classes', { classCode: 'FLY-1', name: 'Flyers 1', mainTeacherId: teacher.id, maxStudents: 10, startDate: start, schedules: [{ shiftId: sh.body.id, weekday: isoWeekday(today) }] });
      const v = (await call(page, 'GET', `/classes/${c.body.id}`)).body.version;
      await call(page, 'POST', `/classes/${c.body.id}/open`, { version: v });
      const ids = [];
      for (const [i, name] of ['Ngô Bảo Anh', 'Phan Minh Đức', 'Trịnh Gia Hân'].entries()) {
        const s = await call(page, 'POST', '/students', { fullName: name, startDate: '2026-09-01', guardians: [{ guardian: { fullName: `PH ${name}`, phone: `090600000${i}` } }] });
        ids.push(s.body.id);
      }
      const e = await call(page, 'POST', `/classes/${c.body.id}/enrollments`, { studentIds: ids, startDate: start });
      if (e.status !== 201) throw new Error('Xếp lớp lỗi ' + JSON.stringify(e.body));
      await page.getByRole('button', { name: /Nguyễn Quản Trị/ }).click();
      await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
      await page.waitForURL(/dang-nhap/);
    });

    await step('Giáo viên đăng nhập lần đầu → trang Điểm danh hôm nay', async () => {
      await loginAs(page, '0905123456', teacher.tempPassword, 'GiaoVien2026');
      await page.getByRole('link', { name: 'Điểm danh' }).first().click();
      await page.getByText('FLY-1 · Flyers 1').waitFor();
      await shot('a01-day');
    });

    await step('Chọn trạng thái, tất cả có mặt, đi muộn có số phút, ghi chú → tự lưu nháp', async () => {
      await page.getByText('FLY-1 · Flyers 1').click();
      await page.waitForURL(/diem-danh\/\d+/);
      await page.getByText('Chưa chọn: 3').waitFor();
      await page.getByRole('radiogroup', { name: 'Trạng thái Phan Minh Đức' }).getByRole('radio', { name: 'Đi muộn' }).click();
      await page.getByLabel('Số phút đi muộn').fill('10');
      await page.getByRole('radiogroup', { name: 'Trạng thái Trịnh Gia Hân' }).getByRole('radio', { name: 'Vắng không phép' }).click();
      await page.getByRole('button', { name: 'Tất cả có mặt' }).click();
      await page.getByText('Có mặt: 1').waitFor();
      await page.getByText(/Đã lưu nháp lúc/).waitFor({ timeout: 10000 });
      await shot('a02-sheet');
    });

    await step('Tải lại trang: lựa chọn đã được lưu', async () => {
      await page.reload();
      await page.getByText('Đi muộn: 1').waitFor();
      await page.getByText('Vắng không phép: 1').waitFor();
      const v = await page.getByLabel('Số phút đi muộn').inputValue();
      if (v !== '10') throw new Error('Mất số phút đi muộn');
    });

    await step('Mất mạng: lựa chọn được giữ, có nút Thử lại; có mạng lại thì lưu được', async () => {
      await ctx.setOffline(true);
      await page.getByRole('radiogroup', { name: 'Trạng thái Trịnh Gia Hân' }).getByRole('radio', { name: 'Vắng có phép' }).click();
      await page.getByText(/Mất kết nối/).waitFor({ timeout: 10000 });
      await shot('a03-offline');
      await ctx.setOffline(false);
      await page.getByRole('button', { name: 'Thử lại' }).first().click();
      await page.getByText(/Đã lưu nháp lúc/).waitFor({ timeout: 10000 });
      await page.reload();
      await page.getByText('Vắng có phép: 1').waitFor();
    });

    await step('Xác nhận điểm danh', async () => {
      await page.getByRole('button', { name: 'Xác nhận điểm danh' }).click();
      await page.getByRole('dialog').getByText('Có mặt: 1').waitFor();
      await shot('a04-confirm');
      await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
      await page.getByText(/Đã xác nhận điểm danh/).waitFor();
      await page.locator('[data-slot=badge]', { hasText: 'Đã xác nhận' }).waitFor();
    });

    await step('Sửa sau khi xác nhận → lịch sử ghi cũ → mới', async () => {
      await page.getByRole('radiogroup', { name: 'Trạng thái Ngô Bảo Anh' }).getByRole('radio', { name: 'Đi muộn' }).click();
      await page.getByText(/Đã lưu nháp lúc/).waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: /Xem lịch sử/ }).click();
      await page.getByText('Sửa sau khi xác nhận').waitFor();
      await page.getByText('Ngô Bảo Anh: Có mặt → Đi muộn').waitFor();
      await shot('a05-history');
    });

    await step('Tổng hợp tháng hiển thị ma trận + tỷ lệ chuyên cần', async () => {
      await page.goto(`${BASE}/diem-danh`);
      await page.getByRole('tab', { name: 'Tổng hợp tháng' }).click();
      await page.getByRole('cell', { name: 'Trịnh Gia Hân' }).waitFor();
      await page.locator('span[title="Vắng có phép"]').first().waitFor();
      await shot('a06-matrix');
    });

    await step('Màn hình điểm danh trên điện thoại (390px): nút lớn, không tràn ngang', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}/diem-danh`);
      await page.getByText('FLY-1 · Flyers 1').click();
      await page.getByText('Đi muộn: 2').waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const h = await page.getByRole('radio', { name: 'Có mặt' }).first().boundingBox();
      await shot('a07-mobile-sheet');
      if (overflow > 1) throw new Error(`Tràn ngang ${overflow}px`);
      if (!h || h.height < 44) throw new Error('Nút trạng thái quá nhỏ cho thao tác một tay');
    });
  } finally {
    for (const r of results) console.log(r.join(' '));
    console.log(errors.length ? `Lỗi JS: ${errors.join(' | ')}` : 'Không có lỗi JavaScript');
    await browser.close();
  }
  if (errors.length) process.exit(1);
})().catch(() => process.exit(1));
