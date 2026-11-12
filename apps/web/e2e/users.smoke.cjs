/**
 * E2E quản lý tài khoản: tạo chủ lớp → cấp tài khoản phụ huynh → khóa/mở → phụ huynh đăng nhập bằng SĐT
 * → chủ lớp không thao tác được trên tài khoản quản trị.
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
async function loginFirstTime(page, identifier, password, newPassword) {
  await page.goto(`${BASE}/dang-nhap`);
  await page.fill('#identifier', identifier);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForURL(/doi-mat-khau/);
  await page.fill('#cp', password);
  await page.fill('#np', newPassword);
  await page.fill('#cf', newPassword);
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
async function readCredential(page) {
  const box = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Thông tin đăng nhập' }) });
  await box.waitFor();
  const text = await box.innerText();
  const password = text.match(/Mật khẩu tạm: (\S+)/)[1];
  const login = text.match(/Đăng nhập: (\S+)/)[1];
  await box.getByRole('button', { name: 'Đã ghi lại' }).click();
  return { login, password };
}

(async () => {
  const browser = await chromium.launch();
  const newPage = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'vi-VN', ...opts });
    const p = await ctx.newPage();
    p.on('dialog', (d) => d.accept());
    p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const errors = [];
  const page = await newPage();
  const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });
  let owner;
  let guardian;

  try {
    await step('Menu "Tài khoản" → danh sách; dòng của chính mình không có nút thao tác', async () => {
      await loginFirstTime(page, EMAIL, PW, 'MatKhauMoi2026');
      await page.getByRole('link', { name: 'Tài khoản' }).click();
      await page.waitForURL(/quan-ly-tai-khoan/);
      await page.getByRole('heading', { name: 'Quản lý tài khoản' }).waitFor();
      const myRow = page.getByRole('row').filter({ hasText: '(bạn)' });
      await myRow.waitFor();
      if (await myRow.getByRole('button').count()) throw new Error('Có nút thao tác trên tài khoản của chính mình');
    });

    await step('Tạo chủ lớp → hiện mật khẩu tạm một lần', async () => {
      await page.getByRole('button', { name: 'Thêm quản trị / chủ lớp' }).click();
      await page.fill('#s-name', 'trần thị chủ');
      await page.fill('#s-email', 'chulop@local.test');
      await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
      owner = await readCredential(page);
      if (owner.login !== 'chulop@local.test') throw new Error(`Sai tên đăng nhập: ${owner.login}`);
      await page.getByRole('row').filter({ hasText: 'Trần Thị Chủ' }).getByText('Chưa đổi mật khẩu tạm').waitFor();
    });

    await step('Cấp tài khoản phụ huynh ở hồ sơ học sinh → đăng nhập bằng SĐT', async () => {
      const s = await call(page, 'POST', '/students', { fullName: 'Đỗ Minh Khôi', startDate: '2026-09-01', guardians: [{ guardian: { fullName: 'Đỗ Văn Hùng', phone: '0912345678' } }] });
      if (s.status !== 201) throw new Error(`Tạo học sinh lỗi ${s.status}`);
      await page.goto(`${BASE}/hoc-sinh/${s.body.id}`);
      await page.getByRole('tab', { name: /Phụ huynh/ }).click();
      await page.getByRole('button', { name: 'Cấp tài khoản' }).click();
      guardian = await readCredential(page);
      if (guardian.login !== '0912345678') throw new Error(`Sai tên đăng nhập: ${guardian.login}`);
      await page.getByText('Đã có tài khoản').waitFor();
      if (await page.getByRole('button', { name: 'Cấp tài khoản' }).count()) throw new Error('Vẫn còn nút Cấp tài khoản');
    });

    await step('Lọc vai trò Phụ huynh, tìm không dấu → khóa tài khoản → không đăng nhập được', async () => {
      await page.goto(`${BASE}/quan-ly-tai-khoan`);
      await page.getByLabel('Lọc vai trò').selectOption('GUARDIAN');
      await page.getByLabel('Tìm tài khoản').fill('do van hung');
      const row = page.getByRole('row').filter({ hasText: 'Đỗ Văn Hùng' });
      await row.waitFor();
      if ((await page.getByRole('row').count()) !== 2) throw new Error('Bộ lọc trả về thừa dòng');
      await shot(page, 'u01-users');
      await row.getByRole('button', { name: /Thao tác/ }).click();
      await page.getByRole('menuitem', { name: 'Khóa tài khoản' }).click();
      await page.getByText('Đã khóa tài khoản').waitFor();
      await row.getByText('Đã khóa', { exact: true }).waitFor();
      const g = await newPage();
      await g.goto(`${BASE}/dang-nhap`);
      await g.fill('#identifier', guardian.login);
      await g.fill('#password', guardian.password);
      await g.click('button[type=submit]');
      await g.getByText('Tài khoản đã bị vô hiệu hóa').waitFor();
      await g.context().close();
    });

    await step('Mở lại tài khoản → phụ huynh đăng nhập lần đầu, buộc đổi mật khẩu, web hướng dẫn dùng app', async () => {
      const row = page.getByRole('row').filter({ hasText: 'Đỗ Văn Hùng' });
      await row.getByRole('button', { name: /Thao tác/ }).click();
      await page.getByRole('menuitem', { name: 'Mở tài khoản' }).click();
      await page.getByText('Đã mở tài khoản').waitFor();
      const g = await newPage();
      await loginFirstTime(g, guardian.login, guardian.password, 'PhuHuynh2026');
      await g.getByText('Vui lòng dùng ứng dụng điện thoại').waitFor();
      await shot(g, 'u03-guardian-web');
      await g.context().close();
    });

    await step('Chủ lớp: không tạo được quản trị/chủ lớp, không có thao tác trên tài khoản quản trị', async () => {
      const o = await newPage();
      await loginFirstTime(o, owner.login, owner.password, 'ChuLop2026x');
      await o.goto(`${BASE}/quan-ly-tai-khoan`);
      await o.getByRole('heading', { name: 'Quản lý tài khoản' }).waitFor();
      if (await o.getByRole('button', { name: 'Thêm quản trị / chủ lớp' }).count()) throw new Error('Chủ lớp thấy nút tạo quản trị');
      const adminRow = o.getByRole('row').filter({ hasText: 'Nguyễn Quản Trị' });
      await adminRow.waitFor();
      if (await adminRow.getByRole('button').count()) throw new Error('Chủ lớp có thao tác trên tài khoản quản trị');
      await o.getByRole('row').filter({ hasText: 'Đỗ Văn Hùng' }).getByRole('button', { name: /Thao tác/ }).waitFor();
      await o.context().close();
    });

    await step('Quản trị viên đổi vai trò chủ lớp → quản trị viên', async () => {
      await page.getByLabel('Lọc vai trò').selectOption('');
      await page.getByLabel('Tìm tài khoản').fill('');
      const row = page.getByRole('row').filter({ hasText: 'Trần Thị Chủ' });
      await row.getByRole('button', { name: /Thao tác/ }).click();
      await page.getByRole('menuitem', { name: 'Đổi thành Quản trị viên' }).click();
      await page.getByText('Đã đổi thành Quản trị viên').waitFor();
      await row.getByText('Quản trị viên', { exact: true }).waitFor();
    });

    await step('Cài đặt: đổi tên trung tâm → góc trái đổi theo; trang Tài khoản: tự đổi họ tên', async () => {
      await page.getByRole('link', { name: 'Cài đặt' }).click();
      await page.fill('#c-name', 'English Maison');
      await page.fill('#c-address', '12 Lê Lợi, TP Huế');
      await page.fill('#c-phone', '0234 3888 999');
      await page.getByRole('button', { name: 'Lưu' }).click();
      await page.getByText('Đã lưu thông tin trung tâm').waitFor();
      await page.locator('aside').getByText('English Maison').waitFor();
      await shot(page, 'u04-settings');
      await page.goto(`${BASE}/tai-khoan`);
      await page.getByRole('button', { name: 'Đổi tên hiển thị' }).click();
      await page.getByLabel('Họ tên mới').fill('nguyễn văn quản trị');
      await page.getByRole('button', { name: 'Lưu tên' }).click();
      await page.getByText('Đã đổi tên hiển thị').waitFor();
      await page.locator('header').getByText('Nguyễn Văn Quản Trị').waitFor();
    });

    await step('Giao diện điện thoại (390px) không tràn ngang', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}/quan-ly-tai-khoan`);
      await page.getByRole('heading', { name: 'Quản lý tài khoản' }).waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await shot(page, 'u02-users-mobile');
      if (overflow > 1) throw new Error(`Tràn ngang ${overflow}px`);
    });
  } finally {
    for (const r of results) console.log(r.join(' '));
    console.log(errors.length ? `Lỗi JS: ${errors.join(' | ')}` : 'Không có lỗi JavaScript');
    await browser.close();
  }
  if (errors.length) process.exit(1);
})().catch(() => process.exit(1));
