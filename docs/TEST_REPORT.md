# BÁO CÁO KIỂM THỬ

Cập nhật sau mỗi module. Lệnh chạy toàn bộ: `pnpm typecheck && pnpm test` (thư mục gốc).

## Giai đoạn 2 — Nền tảng (12/11/2026)

**Môi trường:** Node 22, pnpm 10, Wrangler 4.160 (D1/R2 local qua Miniflare), Vitest 4 + `@cloudflare/vitest-plugin` (test chạy trong runtime Workers thật, D1 thật được áp migrations).

| Hạng mục | Kết quả | Ghi chú |
|---|---|---|
| TypeScript strict (`shared`, `workers`) | ✅ 0 lỗi | `noUncheckedIndexedAccess` bật |
| Unit test `packages/shared` | ✅ 36/36 | Điểm TB theo trọng số, xếp loại (biên 9/8/6,5/5), chuyên cần, trạng thái hóa đơn, giảm giá, VND, ngày giờ UTC+7, chuẩn hóa SĐT/tên, schema mật khẩu, quyền mặc định |
| Integration test `workers` | ✅ 21/21 | Xem chi tiết bên dưới |
| Migration D1 local | ✅ | 2 migration, 32 bảng, 6 trigger, seed vai trò/quyền/tiêu chí/cài đặt |
| Kiểm tra ràng buộc DB thủ công | ✅ | CHECK `users_identity_chk` chặn tài khoản thiếu email & SĐT; trigger sinh mã `HS00001` |
| Smoke test `wrangler dev` | ✅ | Đăng nhập tài khoản quản trị tạo bằng script; webapp tĩnh được phục vụ ở `/` |
| Kiểm tra độ nhạy của test (mutation) | ✅ | Tắt kiểm tra CSRF → test CSRF thất bại đúng như mong đợi |

### Chi tiết integration test (xác thực & bảo mật)
- Health, 404 JSON chuẩn, quyền mặc định trong D1 khớp với hằng số dùng chung.
- Đăng nhập mobile: trả token, không đặt cookie; `/me` trả quyền đúng vai trò (giáo viên **không** có `fees.read`).
- Đăng nhập bằng SĐT dạng `+84 912 000 111` (chuẩn hóa).
- Sai mật khẩu và tài khoản không tồn tại trả **cùng** một lỗi (chống dò tài khoản).
- Dữ liệu sai → 422; token bị sửa / thiếu token → 401.
- Tài khoản bị vô hiệu hóa: không đăng nhập được; đang đăng nhập thì mất hiệu lực ngay.
- Refresh token xoay vòng; dùng lại trong 30s (nhiều tab) → 401 nhưng không đăng xuất; dùng lại sau ân hạn → **thu hồi toàn bộ chuỗi phiên** + ghi nhật ký.
- Đăng xuất thu hồi phiên (access và refresh đều mất hiệu lực).
- Web: cookie `HttpOnly; Secure; SameSite=Strict`, không trả token trong body; request thay đổi dữ liệu thiếu/sai CSRF token hoặc Origin lạ → 403; đúng → 200.
- Refresh bằng cookie xoay vòng cookie.
- Khóa tài khoản sau 10 lần sai (423), nhập đúng vẫn bị khóa.
- Bắt buộc đổi mật khẩu lần đầu; mật khẩu yếu/sai mật khẩu hiện tại bị từ chối; đổi xong các phiên khác bị đăng xuất.
- Hash mật khẩu có salt ngẫu nhiên, không chứa mật khẩu; tự đánh dấu băm lại khi tăng số vòng.
- `audit_logs` ghi lần đăng nhập và **không thể sửa/xóa** (trigger).

### Hạn chế đã biết
- Giới hạn tần suất đăng nhập (Rate Limiting binding) hoạt động gần đúng trên Cloudflare (theo từng vị trí); lớp bảo vệ chính là khóa tài khoản lưu trong D1.
- Thời gian CPU thực tế trên gói Free cần đo lại sau khi deploy lên tài khoản thật (Giai đoạn 7).
