# Hệ thống quản lý lớp học tiếng Anh

Webapp quản lý + ứng dụng Android/iOS + API dùng chung trên Cloudflare (Workers, D1, R2). Quy mô ~200 học sinh.

- Thiết kế đã phê duyệt: [`docs/PHASE1_DESIGN.md`](docs/PHASE1_DESIGN.md)
- Báo cáo kiểm thử: [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md)
- Biến môi trường: [`.env.example`](.env.example)

## Cấu trúc

```
apps/web         React + Vite + TypeScript (webapp)
apps/mobile      Flutter (Android / iOS)
workers          Cloudflare Worker: API Hono + phục vụ webapp; migrations D1
packages/shared  Hằng số, schema Zod, quy tắc nghiệp vụ dùng chung (tính điểm, học phí, chuyên cần)
scripts          Tạo/khôi phục tài khoản quản trị, sinh seed SQL
```

## Chạy local

Yêu cầu: Node.js ≥ 20, pnpm 10.

```bash
pnpm install
```

```bash
cp workers/.dev.vars.example workers/.dev.vars   # sau đó đặt JWT_SECRET ngẫu nhiên
```

```bash
pnpm db:migrate:local
```

```bash
node scripts/admin-account.mjs create --email admin@local.test --name "Quản trị viên"
```

```bash
pnpm dev:api        # API tại http://localhost:8787/api/v1
```

## Kiểm thử

```bash
pnpm typecheck && pnpm test
```

## Tài khoản quản trị bị mất

```bash
node scripts/admin-account.mjs reset --email <email-quan-tri> --remote --env production
```

Lệnh sinh mật khẩu tạm, thu hồi mọi phiên cũ và ghi nhật ký `auth.break_glass`. Chỉ người có quyền trên tài khoản Cloudflare chạy được.
