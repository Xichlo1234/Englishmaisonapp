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
  src/pages/        — auth, students, classes, teachers, shifts, attendance, grades
  src/services/     — API client functions
  src/components/ui/ — hand-written shadcn-style components
apps/mobile/        — Flutter scaffold (chưa có màn hình, chỉ placeholder)
```

## Quy ước code
- Ngôn ngữ UI: tiếng Việt. Code/comments: tiếng Anh.
- Ngày hiển thị: dd/mm/yyyy (dùng `formatDateVN` từ shared).
- Tiền VNĐ: `formatVND`, `vndInWords` từ shared/money.
- Auth: PBKDF2 30000 iterations, JWT 15m access + rotating refresh. Web: HttpOnly cookies + CSRF. Mobile: Bearer token.
- D1 batch: dùng `runBatch()` helper (workers/src/lib/run-batch.ts) vì Drizzle batch chỉ hỗ trợ prepared, không raw SQL.
- API response: `{ data }` hoặc `{ error, code }`.
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
- `deploy.yml`: push main → deploy staging. Tag v* → deploy production.
- `setup-d1.yml`: chạy thủ công để tạo bảng + tài khoản admin.
- Secrets cần: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Staging
- Worker URL: `ecm-api-staging.khovattu.workers.dev`
- D1 database: `ecm-db-staging` (id: b1525a2e-4b87-451d-92a7-ecbd868a01d1)
- Tài khoản admin: admin@gmail.com (đã tạo qua setup-d1 workflow)

## Trạng thái tiến độ

### Đã xong
- [x] Phase 1: Thiết kế + hạ tầng
- [x] Phase 2: API backend (auth, students, classes, shifts, teachers, attendance, grades, fees)
- [x] Phase 3 web: auth, students, classes, teachers, shifts, attendance, grades
- [x] CI/CD: auto-deploy staging on push

### Đang làm / Chưa xong
- [ ] **Fees web** — code đang ở `git stash@{0}` ("fees-web-wip"). Pop stash, fix E2E approve test, fix NativeSelect className, merge.
- [ ] Users/accounts management web
- [ ] Reports page (báo cáo)
- [ ] Dashboard tổng quan
- [ ] Phase 4: Mobile Flutter (đăng nhập, lịch, điểm danh, điểm, học phí)
- [ ] Phase 5: FCM push notifications
- [ ] APP_ORIGIN trong wrangler.jsonc cần sửa thành `ecm-api-staging.khovattu.workers.dev`

### Bugs đã biết
- Fees E2E: sau approve, list filter "Chờ duyệt" nên không thấy "Đã duyệt" (API trả 200 OK)
- NativeSelect: className apply vào wrapper thay vì select element (chevron bị lệch)

## Git
- Branch: main
- Không force push (có commit unverified 2178c76, để nguyên)
- Commit message: tiếng Anh, conventional commits style
