/**
 * E2E học phí: tạo gói → gán gói (giảm giá) → tạo nháp kỳ → phát hành → thu tiền (bấm 2 lần không ghi trùng)
 * → phiếu thu (số tiền bằng chữ) → đề nghị hoàn tiền → duyệt → sổ thu.
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
async function login(page) {
  await page.goto(`${BASE}/dang-nhap`);
  await page.fill('#identifier', EMAIL);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  await page.waitForURL(/doi-mat-khau/);
  await page.fill('#cp', PW);
  await page.fill('#np', 'MatKhauMoi2026');
  await page.fill('#cf', 'MatKhauMoi2026');
  await page.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  await page.waitForURL((u) => !u.pathname.includes('doi-mat-khau'));
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
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });
  let studentId;

  try {
    await step('Tạo gói học phí theo tháng 1.800.000 ₫', async () => {
      await login(page);
      await page.goto(`${BASE}/hoc-phi?tab=plans`);
      await page.getByRole('button', { name: 'Thêm gói học phí' }).click();
      await page.fill('#fp-code', 'movers-thang');
      await page.fill('#fp-name', 'Movers theo tháng');
      await page.fill('#fp-amount', '1800000');
      if ((await page.inputValue('#fp-amount')) !== '1.800.000') throw new Error('Ô tiền không định dạng 1.800.000');
      await page.getByRole('button', { name: 'Lưu', exact: true }).click();
      await page.getByText('Đã lưu gói học phí').waitFor();
      await page.getByText('1.800.000 ₫').first().waitFor();
    });

    await step('Gán gói cho học sinh, giảm 10% có lý do → 1.620.000 ₫/kỳ', async () => {
      const s = await call(page, 'POST', '/students', { fullName: 'Lý Thanh Tâm', startDate: '2026-09-01', guardians: [{ guardian: { fullName: 'Lý Văn Phúc', phone: '0909888777' } }] });
      studentId = s.body.id;
      await page.goto(`${BASE}/hoc-sinh/${studentId}`);
      await page.getByRole('tab', { name: 'Học phí' }).click();
      await page.getByRole('button', { name: 'Gán gói' }).click();
      await page.selectOption('#sp-plan', { index: 1 });
      await page.selectOption('#sp-dtype', 'PERCENT');
      await page.fill('#sp-dval', '10');
      await page.fill('#sp-dreason', 'Anh chị em cùng học');
      await page.getByText('1.620.000 ₫').waitFor();
      await page.getByRole('button', { name: 'Lưu', exact: true }).click();
      await page.getByText('Đã gán gói học phí').waitFor();
    });

    await step('Tạo hóa đơn nháp theo kỳ → phát hành', async () => {
      await page.goto(`${BASE}/hoc-phi?tab=generate`);
      await page.getByRole('button', { name: 'Tạo hóa đơn nháp' }).click();
      await page.getByText(/Đã tạo 1 hóa đơn nháp/).waitFor();
      await page.getByRole('cell', { name: 'Lý Thanh Tâm', exact: true }).waitFor();
      await page.getByLabel('Chọn tất cả').click();
      await shot('f01-drafts');
      await page.getByRole('button', { name: /Phát hành 1 hóa đơn/ }).click();
      await page.getByText('Đã phát hành 1 hóa đơn').waitFor();
    });

    await step('Thu 1.000.000 ₫ (bấm xác nhận 2 lần vẫn chỉ 1 giao dịch)', async () => {
      await page.goto(`${BASE}/hoc-phi`);
      await page.getByRole('link', { name: /^HD-/ }).first().click();
      await page.waitForURL(/hoa-don\/\d+/);
      await page.getByRole('button', { name: 'Thu tiền' }).click();
      await page.fill('#pay-amount', '1000000');
      const btn = page.getByRole('button', { name: /Xác nhận thu/ });
      await btn.dblclick();
      await page.getByText(/Đã ghi nhận phiếu thu PT-/).waitFor();
      await shot('f02-paid');
      await page.getByRole('button', { name: 'Xong' }).click();
      await page.getByText('620.000 ₫').first().waitFor();
      const rows = await page.locator('text=/^PT-\\d{8}-\\d{4}$/').count();
      if (rows !== 1) throw new Error(`Có ${rows} giao dịch, mong đợi 1`);
    });

    await step('Phiếu thu in được, có số tiền bằng chữ', async () => {
      await page.getByRole('link', { name: 'Phiếu thu' }).first().click();
      await page.getByRole('heading', { name: 'PHIẾU THU' }).waitFor();
      await page.getByText('Một triệu đồng').waitFor();
      await page.emulateMedia({ media: 'print' });
      await shot('f03-receipt-print');
      if (await page.locator('aside').isVisible()) throw new Error('Thanh menu vẫn hiện khi in');
      await page.emulateMedia({ media: 'screen' });
      await page.goBack();
    });

    await step('Hóa đơn chi tiết: tải ảnh PNG; gửi phụ huynh chưa có tài khoản → báo rõ', async () => {
      await page.getByRole('link', { name: 'Hóa đơn chi tiết' }).click();
      await page.getByText('HÓA ĐƠN HỌC PHÍ').waitFor();
      await page.getByText('Lý Thanh Tâm').waitFor();
      await page.getByText('Bằng chữ: Sáu trăm hai mươi nghìn đồng').waitFor();
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Tải ảnh' }).click()]);
      const file = path.join(SHOTS, 'f06-invoice-image.png');
      await dl.saveAs(file);
      const buf = fs.readFileSync(file);
      if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('File tải về không phải PNG');
      const width = buf.readUInt32BE(16);
      if (width !== 1520) throw new Error(`Ảnh rộng ${width}px, mong đợi 1520px (760 × 2)`);
      if (!/^HD-\d{6}-\d{4}-ly-thanh-tam\.png$/.test(dl.suggestedFilename())) throw new Error(`Tên file: ${dl.suggestedFilename()}`);
      await page.getByRole('button', { name: 'Gửi cho phụ huynh' }).click();
      await page.getByText(/Chưa phụ huynh nào của học sinh có tài khoản/).waitFor();
      await page.goBack();
    });

    await step('Đề nghị hoàn 200.000 ₫ → chờ duyệt (chưa trừ) → duyệt → còn đã nộp 800.000 ₫', async () => {
      await page.getByRole('button', { name: 'Đề nghị điều chỉnh' }).click();
      await page.fill('#adj-amount', '200000');
      await page.fill('#adj-reason', 'Nghỉ 2 buổi do ốm, hoàn lại');
      await page.getByRole('button', { name: 'Gửi đề nghị' }).click();
      await page.getByText(/Đã gửi đề nghị/).waitFor();
      await page.getByText('Chờ duyệt').waitFor();
      await page.goto(`${BASE}/hoc-phi?tab=adjustments`);
      await page.getByText('Nghỉ 2 buổi do ốm, hoàn lại').waitFor();
      await shot('f04-adjustments');
      await page.getByRole('button', { name: 'Duyệt' }).click(); // chỉ có 1 người duyệt trong hệ thống → được tự duyệt (ghi nhận)
      await page.getByText('Nghỉ 2 buổi do ốm, hoàn lại').waitFor({ state: 'detached' });
      await page.locator('select').filter({ has: page.locator('option[value="APPROVED"]') }).selectOption('APPROVED');
      await page.getByRole('row').filter({ hasText: 'Nghỉ 2 buổi do ốm, hoàn lại' }).getByText('Đã duyệt', { exact: true }).waitFor();
      await page.goto(`${BASE}/hoc-sinh/${studentId}`);
      await page.getByRole('tab', { name: 'Học phí' }).click();
      await page.getByText('820.000 ₫').first().waitFor(); // còn nợ = 1.620.000 − 800.000
    });

    await step('Sổ thu: tổng thu 1.000.000 ₫, hoàn/điều chỉnh −200.000 ₫', async () => {
      await page.goto(`${BASE}/hoc-phi?tab=ledger`);
      await page.getByText('Tổng thu (1 phiếu)').waitFor();
      await page.getByText('-200.000 ₫').waitFor();
      await shot('f05-ledger');
    });
  } finally {
    for (const r of results) console.log(r.join(' '));
    console.log(errors.length ? `Lỗi JS: ${errors.join(' | ')}` : 'Không có lỗi JavaScript');
    await browser.close();
  }
  if (errors.length) process.exit(1);
})().catch(() => process.exit(1));
