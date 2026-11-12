# English Maison - Quản lý lớp học tiếng Anh

## Tổng quan
Hệ thống quản lý lớp học (~200 học sinh). Monorepo pnpm, Cloudflare Workers Free plan.

## Kiến trúc
```
packages/shared/    — Zod schemas, constants, utils (grading, attendance, money, datetime)
workers/            — Hono API + Drizzle ORM + D1, phục vụ cả web assets
  src/routes/       — auth, students, classes, attendance, grades, fees, files, me, settings
  src/services/     — business logic
  src/db/schema.ts  — Drizzle schema
  migrations/       — D1 migrations (0000 tables, 0001 seed roles)
  test/             — Vitest integration tests (~80 passing)
apps/web/           — React 19, Vite 7, Tailwind 4, TanStack Query, RHF+zod
  src/pages/        — auth, students, classes, teachers, shifts, attendance, grades, fees
  src/services/     — API client functions
  src/components/ui/ — hand-written shadcn-style components
apps/mobile/        — Flutter scaffold (chưa có màn hình, chỉ placeholder)
```

## Quy ước code
- Ngôn ngữ UI: tiếng Việt. Code/comments: tiếng Anh.
- Ngày hiển thị: dd/mm/yyyy (`formatDateVN` trong shared/datetime, `formatDateTimeVN` trong apps/web/src/lib/format.ts).
- Tiền VNĐ: `formatVnd`, `computeDiscount`, `deriveInvoiceStatus` trong shared/money.
- Auth: PBKDF2 30000 iterations, JWT 15m access + rotating refresh. Web: HttpOnly cookies + CSRF. Mobile: Bearer token.
- D1 batch: dùng `runBatch()` / `rowsOf()` trong workers/src/lib/batch.ts (giao dịch nguyên tử, hỗ trợ raw SQL).
- API response: `{ data }`; lỗi `{ error: { code, message, details } }` (ném `Errors.*` từ workers/src/lib/errors.ts).
- Cron: "0 17 * * *" (00:00 VN), "0 1 * * *" (08:00 VN).

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
- [ ] CI/CD auto-deploy: workflow có, đang lỗi vì token thiếu quyền Workers Scripts Edit

### Đang làm / Chưa xong
- [ ] Users/accounts management web
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
