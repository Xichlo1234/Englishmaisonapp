/**
 * E2E nhật ký lớp & bài tập: giáo viên đăng ảnh buổi học (trên điện thoại) → giao bài kèm đề → phụ huynh nộp ảnh bài làm
 * (qua API, như app mobile) → giáo viên chấm → quản lý thấy ảnh phụ huynh cỡ lớn + cờ "Không đăng ảnh".
 */
const { chromium, devices } = require('playwright');
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
    if (global.__fail) await global.__fail();
    throw e;
  }
}
async function loginAs(page, id, pw, newPw) {
  await page.goto(`${BASE}/dang-nhap`);
  await page.fill('#identifier', id);
  await page.fill('#password', pw);
  await page.click('button[type=submit]');
  await page.waitForURL(/doi-mat-khau/);
  await page.fill('#cp', pw);
  await page.fill('#np', newPw);
  await page.fill('#cf', newPw);
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
/** Multipart upload from inside the page (what the mobile app will do). */
const upload = (page, p, fields, pngBase64) =>
  page.evaluate(
    async ({ p, fields, pngBase64 }) => {
      const csrf = document.cookie.match(/ecm_csrf=([^;]+)/)?.[1] ?? '';
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
      f.append('files', new Blob([bytes], { type: 'image/png' }), 'anh.png');
      const r = await fetch(`/api/v1${p}`, { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: f });
      return { status: r.status, body: await r.json() };
    },
    { p, fields, pngBase64 },
  );

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (opts) => {
    const p = await (await browser.newContext({ locale: 'vi-VN', ...opts })).newPage();
    p.on('dialog', (d) => d.accept());
    p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const admin = await newPage({ viewport: { width: 1366, height: 900 } });
  const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });

  // "Ảnh chụp lớp": render a colourful scene and save it as PNG files on disk for the file picker.
  const art = await newPage({ viewport: { width: 1200, height: 900 } });
  const photoFiles = [];
  for (const [i, color] of ['#fde68a', '#bfdbfe'].entries()) {
    await art.setContent(`<body style="margin:0;background:${color};display:flex;align-items:center;justify-content:center;height:100vh;font:bold 120px sans-serif">Lớp học ${i + 1}</body>`);
    const file = path.join(SHOTS, `_class-photo-${i + 1}.png`);
    await art.screenshot({ path: file });
    photoFiles.push(file);
  }
  const avatarPng = fs.readFileSync(photoFiles[0]).toString('base64');
  await art.context().close();

  let teacher, classId, studentA, studentB, guardianA, homeworkId;
  try {
    await step('Quản trị viên chuẩn bị lớp (2 học sinh, 1 em gia đình không đồng ý chụp ảnh) + tài khoản phụ huynh', async () => {
      await loginAs(admin, EMAIL, PW, 'MatKhauMoi2026');
      teacher = (await call(admin, 'POST', '/teachers', { fullName: 'Lê Minh Tâm', phone: '0905123456' })).body;
      const sh = await call(admin, 'POST', '/shifts', { name: 'Ca tối', startTime: '18:00', endTime: '19:30' });
      const c = await call(admin, 'POST', '/classes', { classCode: 'MOV-A', name: 'Movers A', mainTeacherId: teacher.id, maxStudents: 10, startDate: '2026-09-01', schedules: [{ shiftId: sh.body.id, weekday: 2 }] });
      classId = c.body.id;
      const v = (await call(admin, 'GET', `/classes/${classId}`)).body.version;
      await call(admin, 'POST', `/classes/${classId}/open`, { version: v });
      studentA = (await call(admin, 'POST', '/students', { fullName: 'Ngô Bảo Anh', startDate: '2026-09-01', guardians: [{ guardian: { fullName: 'Ngô Văn Long', phone: '0906000001' } }] })).body.id;
      studentB = (await call(admin, 'POST', '/students', { fullName: 'Phan Minh Đức', startDate: '2026-09-01', photoConsent: false, guardians: [{ guardian: { fullName: 'Phan Thị Hoa', phone: '0906000002' } }] })).body.id;
      const e = await call(admin, 'POST', `/classes/${classId}/enrollments`, { studentIds: [studentA, studentB], startDate: '2026-09-01' });
      if (e.status !== 201) throw new Error('Xếp lớp lỗi ' + JSON.stringify(e.body));
      const gid = (await call(admin, 'GET', `/students/${studentA}`)).body.guardians[0].id;
      guardianA = (await call(admin, 'POST', `/guardians/${gid}/account`, {})).body;
    });

    const teacherPage = await newPage({ ...devices['iPhone 13'] });
    global.__fail = () => teacherPage.screenshot({ path: path.join(SHOTS, '_fail.png') });
    await step('Giáo viên (điện thoại) đăng nhật ký: thấy cảnh báo em không đăng ảnh, chọn 2 ảnh → ảnh được thu nhỏ rồi đăng', async () => {
      await loginAs(teacherPage, '0905123456', teacher.tempPassword, 'GiaoVien2026');
      await teacherPage.goto(`${BASE}/lop-hoc/${classId}`);
      const overflow0 = await teacherPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow0 > 1) throw new Error(`Trang lớp tràn ngang ${overflow0}px trên điện thoại`);
      await teacherPage.getByRole('tab', { name: 'Nhật ký lớp' }).click();
      await teacherPage.getByText('Không đăng ảnh có mặt các bạn').waitFor();
      await teacherPage.getByText('Phan Minh Đức').first().waitFor();
      await teacherPage.getByLabel('Nội dung buổi học').fill('Hôm nay lớp học chủ đề Animals, các con hát bài Old MacDonald.');
      await teacherPage.getByTestId('photo-input').setInputFiles(photoFiles);
      await teacherPage.getByRole('button', { name: 'Đăng', exact: true }).click();
      await teacherPage.getByText('Đã đăng nhật ký lớp').waitFor();
      const stored = (await call(teacherPage, 'GET', `/classes/${classId}/posts`)).body.data[0].photos;
      // Ảnh gốc là PNG 1200×900 → phải được nén sang JPEG ở trình duyệt trước khi tải lên
      if (stored.some((p) => p.mimeType !== 'image/jpeg')) throw new Error('Ảnh không được nén sang JPEG: ' + JSON.stringify(stored));
      const post = teacherPage.getByTestId('class-post').first();
      await post.getByText('Old MacDonald').waitFor();
      if ((await post.locator('img').count()) !== 2) throw new Error('Bài đăng không có đủ 2 ảnh');
      await post.locator('img').first().evaluate((img) => img.decode());
      if ((await post.locator('img').first().evaluate((img) => img.naturalWidth)) < 100) throw new Error('Ảnh không hiển thị');
      await shot(teacherPage, 'c01-feed-mobile');
      const overflow = await teacherPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`Tràn ngang ${overflow}px`);
    });

    await step('Giáo viên giao bài tập kèm ảnh đề', async () => {
      await teacherPage.getByRole('tab', { name: 'Bài tập' }).click();
      await teacherPage.getByRole('button', { name: 'Giao bài tập' }).click();
      await teacherPage.fill('#hw-title', 'Workbook trang 12');
      await teacherPage.fill('#hw-desc', 'Làm bài 1 và 2, tô màu con vật');
      await teacherPage.getByRole('dialog').getByTestId('photo-input').setInputFiles([photoFiles[1]]);
      await teacherPage.getByRole('button', { name: 'Giao bài' }).click();
      await teacherPage.getByText('Đã giao bài tập').waitFor();
      await teacherPage.getByText(/đã nộp 0\/2/).waitFor();
    });

    const guardian = await newPage({ viewport: { width: 390, height: 844 } });
    await step('Phụ huynh (như app): xem nhật ký của con, nộp ảnh bài làm, tải ảnh đại diện', async () => {
      await loginAs(guardian, guardianA.login, guardianA.tempPassword, 'PhuHuynh2026');
      const feed = await call(guardian, 'GET', `/students/${studentA}/class-posts`);
      if (feed.body.data?.[0]?.photos?.length !== 2) throw new Error('Phụ huynh không thấy nhật ký: ' + JSON.stringify(feed.body).slice(0, 200));
      const hw = await call(guardian, 'GET', `/students/${studentA}/homework`);
      homeworkId = hw.body.data[0].id;
      const sub = await upload(guardian, `/homework/${homeworkId}/submissions`, { studentId: String(studentA), note: 'Con làm xong rồi ạ' }, avatarPng);
      if (sub.status !== 201) throw new Error('Nộp bài lỗi ' + JSON.stringify(sub.body));
      const av = await upload(guardian, '/me/avatar', {}, avatarPng);
      if (av.status !== 201) throw new Error('Tải ảnh đại diện lỗi ' + JSON.stringify(av.body));
    });

    await step('Giáo viên mở bài tập: thấy ảnh bài làm + lời nhắn, chấm Đã làm / Chưa làm có nhận xét', async () => {
      await teacherPage.reload();
      await teacherPage.getByRole('tab', { name: 'Bài tập' }).click();
      await teacherPage.getByText(/đã nộp 1\/2/).click();
      const rowA = teacherPage.getByTestId('submission-row').filter({ hasText: 'Ngô Bảo Anh' });
      await rowA.getByText('Con làm xong rồi ạ', { exact: false }).waitFor();
      if ((await rowA.locator('img').count()) !== 1) throw new Error('Không thấy ảnh bài làm');
      await rowA.getByLabel('Nhận xét cho Ngô Bảo Anh').fill('Tô màu rất đẹp');
      await rowA.getByRole('button', { name: 'Đã làm' }).click();
      await teacherPage.getByText('Đã chấm Ngô Bảo Anh').waitFor();
      await rowA.getByText('Đã làm', { exact: true }).first().waitFor();
      const rowB = teacherPage.getByTestId('submission-row').filter({ hasText: 'Phan Minh Đức' });
      await rowB.getByRole('button', { name: 'Chưa làm' }).click();
      await teacherPage.getByText('Đã chấm Phan Minh Đức').waitFor();
      await shot(teacherPage, 'c02-homework-review');
      const mine = await call(guardian, 'GET', `/students/${studentA}/homework`);
      if (mine.body.data[0].result !== 'DONE' || mine.body.data[0].teacherComment !== 'Tô màu rất đẹp') throw new Error('Phụ huynh chưa thấy kết quả chấm');
    });

    await step('Hồ sơ học sinh: ảnh phụ huynh cỡ lớn để giáo viên nhận ra; phụ huynh chưa có ảnh hiện chữ viết tắt', async () => {
      await admin.goto(`${BASE}/hoc-sinh/${studentA}`);
      await admin.getByRole('tab', { name: /Phụ huynh/ }).click();
      const img = admin.getByRole('img', { name: 'Ảnh phụ huynh Ngô Văn Long' });
      await img.waitFor();
      const box = await img.boundingBox();
      if (box.width < 100) throw new Error(`Ảnh phụ huynh nhỏ (${box.width}px)`);
      await img.evaluate((i) => i.decode());
      await shot(admin, 'c03-guardian-avatar');
      await admin.goto(`${BASE}/hoc-sinh/${studentB}`);
      await admin.getByRole('tab', { name: /Phụ huynh/ }).click();
      await admin.getByText('Chưa có ảnh').waitFor();
    });
  } finally {
    for (const r of results) console.log(r.join(' '));
    console.log(errors.length ? `Lỗi JS: ${errors.join(' | ')}` : 'Không có lỗi JavaScript');
    for (const f of photoFiles) fs.rmSync(f, { force: true });
    await browser.close();
  }
  if (errors.length) process.exit(1);
})().catch(() => process.exit(1));
