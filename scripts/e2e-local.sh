#!/bin/bash
# Chạy E2E web trên môi trường local sạch: xóa D1 local, áp migrations, tạo admin, build web, chạy wrangler dev, chạy Playwright.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SHOTS=${SHOTS_DIR:-$ROOT/e2e-shots}
pkill -f "wrangler dev" 2>/dev/null || true
(cd "$ROOT/apps/web" && npx vite build >/dev/null)
cd "$ROOT/workers"
rm -rf .wrangler/state
npx wrangler d1 migrations apply DB --local >/dev/null
PW=$(cd "$ROOT" && node scripts/admin-account.mjs create --email admin@local.test --name "Nguyễn Quản Trị" 2>/dev/null | grep "Mật khẩu tạm" | awk '{print $NF}')
npx wrangler dev --port 8787 > "$ROOT/.wrangler-dev.log" 2>&1 &
WPID=$!
trap "kill $WPID 2>/dev/null; pkill -f 'wrangler dev' 2>/dev/null || true" EXIT
for i in $(seq 1 60); do curl -s localhost:8787/api/v1/health >/dev/null && break; sleep 1; done
cd "$ROOT"
for f in apps/web/e2e/*.smoke.cjs; do
  echo "▶ $f"
  BASE_URL=http://localhost:8787 ADMIN_EMAIL=admin@local.test ADMIN_PASSWORD="$PW" SHOTS_DIR="$SHOTS" node "$f"
done
