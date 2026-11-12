/**
 * E2E luồng giáo viên → ca/phòng → lớp học → xếp lớp → chuyển ca → lịch → buổi học → đóng lớp.
 * Chạy qua scripts/e2e-local.sh (DB sạch).
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

const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const isoWeekday = (d) => {
  const w = new Date(d + 'T00:00:00Z').getUTCDay();
  return w === 0 ? 7 : w;
};

async function login(page) {
  await page.goto(`${BASE}/dang-nhap`);
  await page.fill('#identifier', EMAIL);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  await page.waitForTimeout(800);
  if (page.url().includes('doi-mat-khau')) {
    await page.fill('#cp', PW);
    await page.fill('#np', NEW_PW);
    await page.fill('#cf', NEW_PW);
    await page.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  } else if (page.url().includes('dang-nhap')) {
    await page.fill('#password', NEW_PW);
    await page.click('button[type=submit]');
  }
  await page.waitForURL((u) => !/dang-nhap|doi-mat-khau/.test(u.pathname));
}

/** Gọi API từ trong trang (cookie + CSRF như người dùng thật). */
const apiCall = (page, p, body) =>
  page.evaluate(
    async ({ p, body }) => {
      const csrf = document.cookie.match(/ecm_csrf=([^;]+)/)?.[1] ?? '';
      const r = await fetch(`/api/v1${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    },
    { p, body },
  );

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'vi-VN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });
  const today = vnToday();
  const wd = String(isoWeekday(today));

  try {
    await step('Đăng nhập', () => login(page));

    await step('Thêm giáo viên → hiện mật khẩu tạm một lần', async () => {
      await page.goto(`${BASE}/giao-vien`);
      await page.getByRole('button', { name: 'Thêm giáo viên' }).click();
      await page.fill('#t-name', 'phạm thu hà');
      await page.fill('#t-phone', '0903111222');
      await page.fill('#t-spec', 'Starters – Flyers');
      await page.getByRole('button', { name: 'Lưu', exact: true }).click();
      await page.getByText('Thông tin đăng nhập').waitFor();
      await page.getByText('Đăng nhập: 0903111222').waitFor();
      await shot('c01-teacher-credential');
      await page.getByRole('button', { name: 'Đã ghi lại' }).click();
      await page.getByRole('cell', { name: /Phạm Thu Hà/ }).first().waitFor();
    });

    await step('Thêm phòng học', async () => {
      await page.goto(`${BASE}/ca-hoc`);
      await page.getByRole('tab', { name: 'Phòng học' }).click();
      await page.fill('#room-name', 'P101');
      await page.fill('#room-cap', '15');
      await page.getByRole('button', { name: 'Thêm phòng' }).click();
      await page.getByText('Đã thêm phòng').waitFor();
    });

    await step('Tạo lớp A (kiểm tra không trùng lịch) và mở lớp', async () => {
      await page.goto(`${BASE}/lop-hoc/moi`);
      await page.fill('#code', 'mov-a');
      await page.fill('#name', 'Movers A');
      await page.selectOption('#level', 'Movers');
      await page.selectOption('#teacher', { label: 'Phạm Thu Hà' });
      await page.fill('#max', '2');
      await page.selectOption('select[aria-label="Thứ"]', wd);
      await page.selectOption('select[aria-label="Ca học"]', { label: 'Ca 1 (14:00–15:30)' });
      await page.selectOption('select[aria-label="Phòng"]', { label: 'P101' });
      await page.getByText('Không trùng lịch giáo viên/phòng').waitFor();
      await shot('c02-class-form');
      await page.getByRole('button', { name: 'Tạo lớp' }).click();
      await page.waitForURL(/lop-hoc\/\d+$/);
      await page.getByRole('heading', { name: 'Movers A' }).waitFor();
      await page.getByRole('button', { name: 'Mở lớp' }).click();
      await page.getByText(/Đã mở lớp/).waitFor();
      await page.locator('[data-slot=badge]', { hasText: 'Đang mở' }).waitFor();
    });

    let classAUrl = page.url();

    await step('Tạo lớp B trùng giờ giáo viên → báo trùng; đổi ca → tạo được', async () => {
      await page.goto(`${BASE}/lop-hoc/moi`);
      await page.fill('#code', 'MOV-B');
      await page.fill('#name', 'Movers B');
      await page.selectOption('#teacher', { label: 'Phạm Thu Hà' });
      await page.fill('#max', '10');
      await page.selectOption('select[aria-label="Thứ"]', wd);
      await page.selectOption('select[aria-label="Ca học"]', { label: 'Ca 1 (14:00–15:30)' });
      await page.getByText(/Giáo viên Phạm Thu Hà đã dạy lớp MOV-A/).waitFor();
      await shot('c03-conflict');
      await page.selectOption('select[aria-label="Ca học"]', { label: 'Ca 2 (16:00–17:30)' });
      await page.getByText('Không trùng lịch giáo viên/phòng').waitFor();
      await page.getByRole('button', { name: 'Tạo lớp' }).click();
      await page.waitForURL(/lop-hoc\/\d+$/);
      await page.getByRole('button', { name: 'Mở lớp' }).click();
      await page.getByText(/Đã mở lớp/).waitFor();
    });
    const classBUrl = page.url();

    let s1, s2;
    await step('Tạo 2 học sinh (qua API trong phiên đăng nhập)', async () => {
      const mk = (n, phone) =>
        apiCall(page, '/students', {
          fullName: n,
          startDate: '2026-09-01',
          englishLevel: 'Movers',
          guardians: [{ guardian: { fullName: 'Phụ Huynh ' + n, phone } }],
        });
      const a = await mk('Võ Gia Bảo', '0904000001');
      const b = await mk('Đỗ Khánh Linh', '0904000002');
      if (a.status !== 201 || b.status !== 201) throw new Error(`Tạo HS lỗi ${a.status}/${b.status}`);
      s1 = a.body.id;
      s2 = b.body.id;
    });

    await step('Xếp 2 học sinh vào lớp A (đủ sĩ số 2/2)', async () => {
      await page.goto(classAUrl);
      await page.getByRole('button', { name: 'Thêm học sinh' }).click();
      await page.getByPlaceholder('Tìm học sinh…').fill('gia bao');
      await page.getByText('Võ Gia Bảo').click();
      await page.getByPlaceholder('Tìm học sinh…').fill('khanh linh');
      await page.getByText('Đỗ Khánh Linh').click();
      await page.getByRole('button', { name: 'Xếp 2 học sinh' }).click();
      await page.getByText('Đã xếp 2 học sinh vào lớp').waitFor();
      await page.getByText('Sĩ số: 2/2').waitFor();
      await shot('c04-class-students');
    });

    await step('Chuyển ca: Võ Gia Bảo từ lớp A sang lớp B (từ trang học sinh)', async () => {
      await page.goto(`${BASE}/hoc-sinh/${s1}`);
      await page.getByRole('tab', { name: 'Lớp học' }).click();
      await page.getByRole('button', { name: 'Chuyển lớp/ca' }).click();
      const val = await page.locator('#tr-class option', { hasText: 'MOV-B' }).getAttribute('value');
      await page.selectOption('#tr-class', val);
      const tomorrow = new Date(Date.parse(today) + 86400e3).toISOString().slice(0, 10);
      await page.fill('#tr-date', tomorrow);
      await page.fill('#tr-reason', 'Đổi sang ca 2 cho phù hợp giờ học ở trường');
      await shot('c05-transfer');
      await page.getByRole('button', { name: 'Xác nhận chuyển' }).click();
      await page.getByText('Đã chuyển lớp').waitFor();
      await page.locator('li', { hasText: 'MOV-B' }).getByText('Đang học').waitFor();
      await page.locator('li', { hasText: 'MOV-A' }).getByText('Chuyển lớp').waitFor();
      await shot('c06-student-enrollments');
    });

    await step('Lịch tuần hiển thị buổi của cả hai lớp', async () => {
      await page.goto(`${BASE}/ca-hoc`);
      await page.getByText(/14:00 MOV-A/).first().waitFor();
      await page.getByText(/16:00 MOV-B/).first().waitFor();
      await shot('c07-calendar-week');
      await page.getByRole('button', { name: 'Tháng' }).click();
      await page.getByText(/14:00 MOV-A/).first().waitFor();
      await shot('c08-calendar-month');
    });

    await step('Hủy một buổi học tương lai có lý do', async () => {
      await page.goto(classAUrl);
      await page.getByRole('tab', { name: 'Buổi học' }).click();
      await page.getByRole('button', { name: 'Tháng sau' }).click();
      await page.getByRole('button', { name: 'Hủy buổi' }).first().click();
      await page.fill('#drd-reason', 'Nghỉ lễ');
      await page.getByRole('button', { name: 'Hủy buổi học' }).click();
      await page.getByText('Đã hủy buổi học').waitFor();
      await page.getByText('Đã hủy: Nghỉ lễ').waitFor();
      await shot('c09-lessons');
    });

    await step('Lịch sử sĩ số ghi nhận vào/ra lớp', async () => {
      await page.getByRole('tab', { name: 'Lịch sử sĩ số' }).click();
      await page.getByText('→ MOV-B').waitFor();
      await shot('c10-history');
    });

    await step('Đóng lớp B: học sinh được rút khỏi lớp', async () => {
      await page.goto(classBUrl);
      await page.getByRole('button', { name: 'Đóng lớp' }).click();
      await page.fill('#drd-date', new Date(Date.parse(today) + 86400e3).toISOString().slice(0, 10));
      await page.fill('#drd-reason', 'Gộp lớp');
      await page.getByRole('dialog').getByRole('button', { name: 'Đóng lớp' }).click();
      await page.getByText('Đã đóng lớp').waitFor();
      await page.locator('[data-slot=badge]', { hasText: 'Đã đóng' }).waitFor();
      await page.getByText('Lớp chưa có học sinh').waitFor();
    });
  } finally {
    for (const r of results) console.log(r.join(' '));
    console.log(errors.length ? `Lỗi JS: ${errors.join(' | ')}` : 'Không có lỗi JavaScript');
    await browser.close();
  }
  if (errors.length) process.exit(1);
})().catch(() => process.exit(1));
