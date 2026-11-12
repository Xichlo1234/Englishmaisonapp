/**
 * E2E chấm điểm (vai trò GIÁO VIÊN): tạo đợt → nhập điểm dạng lưới (TB & xếp loại tính tức thời) → kiểm tra điểm sai
 * → lưu → công bố → khóa sửa với giáo viên → lịch sử → biểu đồ tiến bộ ở trang học sinh.
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const EMAIL = process.env.ADMIN_EMAIL;
const PW = process.env.ADMIN_PASSWORD;
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
  let studentId;

  try {
    await step('Quản trị viên chuẩn bị lớp + một đợt đánh giá cũ đã công bố', async () => {
      await loginAs(page, EMAIL, PW, 'MatKhauMoi2026');
      teacher = (await call(page, 'POST', '/teachers', { fullName: 'Đặng Thu Trang', phone: '0907111222' })).body;
      const c = await call(page, 'POST', '/classes', { classCode: 'KET-1', name: 'KET 1', mainTeacherId: teacher.id, maxStudents: 10, startDate: addDays(today, -60) });
      const ids = [];
      for (const [i, n] of ['Hoàng Yến Nhi', 'Bùi Quốc Huy'].entries())
        ids.push((await call(page, 'POST', '/students', { fullName: n, startDate: '2026-09-01', guardians: [{ guardian: { fullName: 'PH ' + n, phone: `090800000${i}` } }] })).body.id);
      studentId = ids[0];
      await call(page, 'POST', `/classes/${c.body.id}/enrollments`, { studentIds: ids, startDate: addDays(today, -60) });
      const cfg = (await call(page, 'GET', '/grading/config')).body;
      const type = cfg.types.find((t) => t.code === 'PERIODIC').id;
      const old = await call(page, 'POST', '/assessments', { classId: c.body.id, assessmentTypeId: type, title: 'Đánh giá định kỳ 1', assessedOn: addDays(today, -30) });
      await call(page, 'PUT', `/assessments/${old.body.id}/grades`, { grades: cfg.criteria.slice(0, 6).map((cr) => ({ studentId, criterionId: cr.id, score: 6.5 })), comments: [] });
      await call(page, 'POST', `/assessments/${old.body.id}/publish`, {});
      await page.goto(`${BASE}/diem-so`);
      await page.getByRole('tab', { name: 'Cấu hình' }).click();
      await page.getByText('Thang xếp loại (thang 10)').waitFor();
      await shot('g01-config');
      await page.getByRole('button', { name: /Nguyễn Quản Trị/ }).click();
      await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
      await page.waitForURL(/dang-nhap/);
    });

    await step('Giáo viên tạo đợt "Kiểm tra tháng"', async () => {
      await loginAs(page, '0907111222', teacher.tempPassword, 'GiaoVien2026');
      await page.getByRole('link', { name: 'Điểm số' }).first().click();
      await page.getByText('Đánh giá định kỳ 1').waitFor();
      await page.getByRole('button', { name: 'Tạo đợt đánh giá' }).click();
      await page.selectOption('#as-type', { label: 'Kiểm tra tháng' });
      await page.fill('#as-title', 'Kiểm tra tháng 11');
      await page.getByRole('button', { name: 'Tạo và nhập điểm' }).click();
      await page.waitForURL(/diem-so\/\d+/);
      await page.getByRole('heading', { name: 'Kiểm tra tháng 11' }).waitFor();
    });

    await step('Nhập điểm dạng lưới: TB 8,17 và "Giỏi" hiển thị ngay khi gõ', async () => {
      const crit = ['Listening', 'Speaking', 'Reading', 'Writing', 'Homework', 'Attitude'];
      const vals = ['8', '7', '9', '6', '10', '9'];
      for (let i = 0; i < 6; i++) await page.getByLabel(`${crit[i]} – Hoàng Yến Nhi`).fill(vals[i]);
      await page.getByRole('cell', { name: '8,17' }).waitFor();
      await page.getByText('Giỏi', { exact: true }).waitFor();
      // dùng Enter để xuống dòng như bảng tính
      // Bùi Quốc Huy đứng trước (sắp theo tên không dấu): nhập rồi Enter → xuống ô của Hoàng Yến Nhi cùng cột
      await page.getByLabel('Listening – Bùi Quốc Huy').fill('7,5');
      await page.getByLabel('Listening – Bùi Quốc Huy').press('Enter');
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (focused !== 'Listening – Hoàng Yến Nhi') throw new Error('Enter không chuyển xuống ô dưới: ' + focused);
      await page.keyboard.type('8'); // ô được chọn sẵn nên gõ đè
      await page.getByLabel('Nhận xét – Hoàng Yến Nhi').fill('Phát âm tiến bộ rõ, cần luyện viết thêm.');
      await shot('g02-grid');
    });

    await step('Điểm vượt thang bị đánh dấu đỏ, không lưu được', async () => {
      await page.getByLabel('Reading – Bùi Quốc Huy').fill('11');
      const disabled = await page.getByRole('button', { name: 'Lưu điểm' }).isDisabled();
      if (!disabled) throw new Error('Nút lưu không bị khóa khi có điểm sai');
      await page.getByLabel('Reading – Bùi Quốc Huy').fill('8');
    });

    await step('Lưu điểm, tải lại vẫn còn', async () => {
      await page.getByRole('button', { name: 'Lưu điểm' }).click();
      await page.getByText('Đã lưu điểm').waitFor();
      await page.reload();
      await page.getByRole('cell', { name: '8,17' }).waitFor();
      if ((await page.getByLabel('Listening – Bùi Quốc Huy').inputValue()) !== '7,5') throw new Error('Mất điểm sau khi tải lại');
    });

    await step('Công bố → giáo viên không sửa được nữa; lịch sử ghi nhận', async () => {
      await page.getByRole('button', { name: 'Công bố' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Công bố' }).click();
      await page.getByText(/Đã công bố kết quả/).waitFor();
      await page.locator('[data-slot=badge]', { hasText: 'Đã công bố' }).waitFor();
      if (!(await page.getByLabel('Listening – Hoàng Yến Nhi').isDisabled())) throw new Error('Giáo viên vẫn sửa được sau công bố');
      await page.getByRole('button', { name: 'Lịch sử' }).click();
      await page.getByText('Nhập điểm', { exact: true }).waitFor();
      await page.getByText('Công bố', { exact: true }).first().waitFor();
      await shot('g03-published');
    });

    await step('Trang học sinh: biểu đồ tiến bộ (6,5 → 8,17) + bảng kết quả', async () => {
      await page.goto(`${BASE}/hoc-sinh/${studentId}`);
      await page.getByRole('tab', { name: 'Kết quả học tập' }).click();
      await page.getByRole('img', { name: 'Biểu đồ điểm trung bình qua các đợt đánh giá' }).waitFor();
      await page.getByRole('cell', { name: '6,5', exact: true }).waitFor();
      await page.getByText('Phát âm tiến bộ rõ, cần luyện viết thêm.').waitFor();
      await shot('g04-progress');
    });
  } finally {
    for (const r of results) console.log(r.join(' '));
    console.log(errors.length ? `Lỗi JS: ${errors.join(' | ')}` : 'Không có lỗi JavaScript');
    await browser.close();
  }
  if (errors.length) process.exit(1);
})().catch(() => process.exit(1));
