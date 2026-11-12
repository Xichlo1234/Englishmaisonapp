#!/bin/bash
# Chạy E2E web trên môi trường local: mỗi file *.smoke.cjs chạy với D1 local SẠCH (xóa, áp migrations, tạo admin).
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SHOTS=${SHOTS_DIR:-$ROOT/e2e-shots}
(cd "$ROOT/apps/web" && npx vite build >/dev/null)
cleanup() {
  pkill -f "wrangler dev" 2>/dev/null || true
  pkill -f "bin/workerd" 2>/dev/null || true
  # đợi tiến trình thoát hẳn (tránh xóa D1 local khi workerd còn ghi)
  for i in $(seq 1 40); do pgrep -f "bin/workerd|wrangler dev" >/dev/null || break; sleep 0.25; done
}
trap cleanup EXIT
FAILED=0
for f in "$ROOT"/apps/web/e2e/${E2E_ONLY:-*}.smoke.cjs; do
  cleanup; sleep 1
  cd "$ROOT/workers"
  for i in 1 2 3; do rm -rf .wrangler/state 2>/dev/null && break; sleep 1; done
  npx wrangler d1 migrations apply DB --local >/dev/null
  PW=$(cd "$ROOT" && node scripts/admin-account.mjs create --email admin@local.test --name "Nguyễn Quản Trị" 2>/dev/null | grep "Mật khẩu tạm" | awk '{print $NF}')
  npx wrangler dev --port 8787 > "$ROOT/.wrangler-dev.log" 2>&1 &
  for i in $(seq 1 60); do curl -s localhost:8787/api/v1/health >/dev/null && break; sleep 1; done
  cd "$ROOT"
  echo "▶ $(basename "$f")"
  BASE_URL=http://localhost:8787 ADMIN_EMAIL=admin@local.test ADMIN_PASSWORD="$PW" SHOTS_DIR="$SHOTS" node "$f" || FAILED=1
done
exit $FAILED
