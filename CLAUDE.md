# English Maison - Quản lý lớp học tiếng Anh

## Tổng quan
Hệ thống quản lý lớp học (~200 học sinh). Monorepo pnpm, Cloudflare Workers Free plan.

## Kiến trúc
```
packages/shared/    — Zod schemas, constants, utils (grading, attendance, money, datetime)
workers/            — Hono API + Drizzle ORM + D1, phục vụ cả web assets
  src/routes/       — auth, students, classes, attendance, grades, fees, users, classroom, files, me, settings
  src/services/     — business logic
  src/db/schema.ts  — Drizzle schema
  migrations/       — D1 migrations (0000 tables, 0001 seed, 0002 absence deduction, 0003 class posts/homework)
  test/             — Vitest integration tests (~80 passing)
apps/web/           — React 19, Vite 7, Tailwind 4, TanStack Query, RHF+zod
  src/pages/        — auth, students, classes, teachers, shifts, attendance, grades, fees, users
  src/services/     — API client functions
  src/components/ui/ — hand-written shadcn-style components
apps/mobile/        — Flutter scaffold (chưa có màn hình, chỉ placeholder)
```

## Quy ước code
- Không có cấu hình prettier: KHÔNG chạy prettier trên cả file (sẽ định dạng lại toàn bộ). Giữ kiểu sẵn có: ngoặc đơn, dòng dài ~160.
- Ngôn ngữ UI: tiếng Việt. Code/comments: tiếng Anh.
- Giao diện theo bộ thiết kế English Maison 3D (nhánh `design/english-maison-3d-buttons`): màu chủ đạo #167C75 (index.css), nút 3D qua lớp `.btn-3d` trong index.css gắn vào biến thể `default/destructive/success/outline` của `<Button>` (ghost/link/secondary giữ phẳng); biểu tượng menu 3D ở `src/assets/menu/*.svg` (dùng qua `<img>`, không nhúng inline vì các SVG trùng id gradient). Ảnh nền: `public/images/bg/*.webp` (nén từ PNG gốc, có bản `-sm` cho màn hình < 1024px) qua lớp `.login-hero` (trang đăng nhập) và `.app-canvas` (nền app, trang đổi mật khẩu) trong index.css; thẻ/bảng giữ nền trắng đặc để dễ đọc.
- Ngày hiển thị: dd/mm/yyyy (`formatDateVN` trong shared/datetime, `formatDateTimeVN` trong apps/web/src/lib/format.ts).
- Tiền VNĐ: `formatVnd`, `computeDiscount`, `deriveInvoiceStatus` trong shared/money.
- Auth: PBKDF2 30000 iterations, JWT 15m access + rotating refresh. Web: HttpOnly cookies + CSRF. Mobile: Bearer token.
- D1 batch: dùng `runBatch()` / `rowsOf()` trong workers/src/lib/batch.ts (giao dịch nguyên tử, hỗ trợ raw SQL).
- API response: `{ data }`; lỗi `{ error: { code, message, details } }` (ném `Errors.*` từ workers/src/lib/errors.ts).
- Cron: "0 17 * * *" (00:00 VN), "0 1 * * *" (08:00 VN).
- Quản lý tài khoản (users.service.ts): OWNER chỉ thao tác trên TEACHER/GUARDIAN/STUDENT; không ai tự khóa/tự đổi vai trò; không đặt lại mật khẩu ADMIN khác (dùng scripts/admin-account.mjs); khóa/mở giáo viên đi qua trang Giáo viên (kiểm tra lịch dạy).

## Scripts
```bash
pnpm dev:api          # Workers dev server (port 8787)
pnpm dev:web          # Vite dev server (port 5173)
pnpm test             # Tất cả tests
pnpm typecheck        # Type check toàn bộ
pnpm db:migrate:local # Áp dụng migrations local
```

## CI/CD (GitHub Actions)
- `ci.yml`: push/PR → typecheck + test + build web
- `deploy.yml`: push main → typecheck + test + build → migrations → deploy staging. Production chưa bật (chung database_id với staging).
- `setup-d1.yml`: chạy thủ công để tạo bảng + tài khoản admin.
- Secrets cần: `CLOUDFLARE_API_TOKEN` (D1 Edit + Workers Scripts Edit + Workers R2 Storage Edit), `CLOUDFLARE_ACCOUNT_ID`.

## Staging
- Worker URL: `ecm-api-staging.khovattu.workers.dev`
- D1 database: `ecm-db-staging` (id: b1525a2e-4b87-451d-92a7-ecbd868a01d1)
- Tài khoản admin đầu tiên tạo qua workflow setup-d1

## Trạng thái tiến độ

### Đã xong
- [x] Phase 1: Thiết kế + hạ tầng
- [x] Phase 2: API backend (auth, students, classes, shifts, teachers, attendance, grades, fees)
- [x] Phase 3 web: auth, students, classes, teachers, shifts, attendance, grades, fees (gói học phí, giảm giá, hóa đơn theo kỳ, thu tiền, phiếu thu, điều chỉnh có duyệt, sổ thu)
- [x] Khấu trừ buổi vắng: mọi buổi vắng (có phép + không phép) của kỳ trước trừ vào hóa đơn kỳ sau = học phí ròng kỳ trước × số buổi vắng ÷ số buổi đã diễn ra (bỏ buổi hủy). Lưu trong `invoices.absence_*`; phần trừ nằm TRONG `discount_amount` (ràng buộc CHECK amount_due = gross − discount). `absenceDeductionFor()` trong fees.service.ts; mỗi hóa đơn kỳ trước chỉ làm căn cứ một lần.
- [x] Hóa đơn chi tiết `/hoc-phi/hoa-don/:id/chi-tiet`: tải ảnh PNG (html-to-image, tên file không dấu), in, gửi phụ huynh (tạo notification FEE_DUE, phụ huynh xem qua API `/invoices/:id/statement` — app mobile hiển thị sau).
- [x] Cài đặt `/cai-dat` (ADMIN): tên/địa chỉ/SĐT trung tâm (`PATCH /settings/center`). Người dùng tự đổi họ tên ở `/tai-khoan` (đồng bộ sang hồ sơ giáo viên/phụ huynh).
- [x] Nhật ký lớp & bài tập (tab trong trang lớp; classroom.service.ts): giáo viên của lớp/quản lý đăng ảnh buổi học (ảnh nén 1600px JPEG ở trình duyệt), giao bài kèm ảnh/PDF; phụ huynh nộp ảnh bài làm (API, màn hình ở app mobile), giáo viên chấm Đã làm/Chưa làm + nhận xét. Quyền xem: `classContentVisibleSql` — gia đình chỉ thấy nội dung đăng trong thời gian con học lớp đó. Cờ `students.photo_consent` (Không đăng ảnh) cảnh báo khi đăng. Thông báo loại SYSTEM, `data.kind` = CLASS_POST | HOMEWORK | HOMEWORK_REVIEW.
- [x] Ảnh đại diện: mọi tài khoản tự tải qua `POST /me/avatar` (web: trang `/tai-khoan`, ảnh nén 800px; phụ huynh: app mobile); `/me` trả `avatarFileId`; `<UserAvatar>` (components/common/user-avatar.tsx) ở thanh trên cùng. Ảnh phụ huynh hiện cỡ lớn ở tab Phụ huynh của hồ sơ học sinh; giáo viên của con xem được.
- [x] Quản lý tài khoản (`/quan-ly-tai-khoan`): tạo ADMIN/OWNER, khóa/mở, mở khóa đăng nhập, đổi vai trò, đăng xuất mọi thiết bị, cấp mật khẩu tạm; cấp tài khoản phụ huynh (đăng nhập bằng SĐT) ở trang học sinh
- [x] CI/CD: push main → test → deploy staging tự động

### Đang làm / Chưa xong
- [ ] Reports page (báo cáo)
- [ ] Dashboard tổng quan
- [ ] Phase 4: Mobile Flutter (đăng nhập, lịch, điểm danh, điểm, học phí)
- [ ] Phase 5: FCM push notifications

## Kiểm thử E2E
- `bash scripts/e2e-local.sh` (mọi module) hoặc `E2E_ONLY=fees bash scripts/e2e-local.sh`; ảnh chụp ở `e2e-shots/` (gitignored).

## Git
- Branch: main
- Không force push (có commit unverified 2178c76, để nguyên)
- Commit message: tiếng Anh, conventional commits style
