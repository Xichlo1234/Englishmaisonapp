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

## Giai đoạn 3.1 — Khung webapp & 3.2 — Module Học sinh (12/11/2026)

| Hạng mục | Kết quả | Ghi chú |
|---|---|---|
| TypeScript (shared, workers, web) | ✅ 0 lỗi | |
| Build web (Vite) | ✅ | Excel tách thành chunk riêng, chỉ tải khi bấm "Xuất Excel" |
| Unit test shared | ✅ 36/36 | |
| Integration test workers | ✅ 41/41 | +20 test module học sinh |
| E2E trình duyệt (Chromium) | ✅ 14/14 bước | `scripts/e2e-local.sh` — DB sạch, tài khoản thật, không dữ liệu giả |
| Giao diện điện thoại 390px | ✅ | Không tràn ngang; menu trượt; bảng cuộn trong khung |

### Integration test module Học sinh
- Tạo học sinh + phụ huynh mới: mã `HS00001` tự sinh, chuẩn hóa họ tên ("nguyễn   văn an" → "Nguyễn Văn An") và SĐT, ghi nhật ký.
- Từ chối: không có phụ huynh, ngày sinh sau ngày nhập học, SĐT sai, ngày không tồn tại (30/02), tên quá ngắn.
- Anh/chị/em dùng chung phụ huynh (tìm theo SĐT); cảnh báo trùng theo họ tên + ngày sinh.
- Tìm kiếm không dấu, theo SĐT phụ huynh; phân trang; hồ sơ lưu trữ bị ẩn mặc định.
- Sửa một trường không làm mất trường khác; version cũ → 409 `VERSION_CONFLICT`; xóa trắng trường bằng `null`.
- Tạm nghỉ đóng ghi danh lớp (ngày kết thúc = ngày hiệu lực − 1); chặn chuyển trạng thái không hợp lệ; quay lại học.
- **Không cho đặt ngày nghỉ trước buổi đã điểm danh** (bảo toàn dữ liệu điểm danh).
- Lưu trữ → khôi phục về "Nghỉ học"; xóa cứng bị chặn khi có lịch sử; xóa được hồ sơ tạo nhầm (có nhật ký).
- Không được bỏ phụ huynh cuối cùng; luôn đúng một liên hệ chính.
- **Phân quyền:** giáo viên chỉ thấy học sinh lớp mình (học sinh khác → 404), không thêm/sửa được; phụ huynh chỉ xem con mình, không thấy ghi chú nội bộ, không xem danh sách.
- **Ảnh R2:** khóa ngẫu nhiên không chứa tên; chỉ đọc qua API có kiểm tra quyền (`Cache-Control: private`); chưa đăng nhập → 401; phụ huynh khác → 404; tệp giả mạo đuôi PNG bị từ chối (kiểm tra magic bytes).

### E2E (trình duyệt thật)
Chưa đăng nhập → chuyển trang đăng nhập · sai mật khẩu báo lỗi · đăng nhập lần đầu bắt buộc đổi mật khẩu · danh sách trống có hướng dẫn · thêm học sinh + phụ huynh · thêm em dùng lại phụ huynh (gợi ý theo SĐT) + cảnh báo trùng · tìm không dấu và theo SĐT · sửa hồ sơ · tải ảnh lên R2 và hiển thị · thêm phụ huynh thứ hai, đổi liên hệ chính · tạm nghỉ có lý do, hiện trong nhật ký · xuất Excel · đăng xuất · giao diện 390px.

### Lỗi phát hiện và đã sửa trong module
1. Sửa hồ sơ: trường không gửi lên bị ghi `null` (do transform của Zod) → sửa schema, thêm test "sửa một trường không làm mất trường khác".
2. Drizzle `db.batch` không hỗ trợ SQL thô → viết `runBatch` gọi trực tiếp `D1Database.batch` (vẫn nguyên tử, tham số luôn được bind).
3. Web: sau đăng nhập bị đẩy về trang đăng nhập (xóa nhầm cache phiên) → chỉ xóa dữ liệu khác, giữ trạng thái người dùng.
4. API làm mới phiên trả 422 khi không có token → trả 401 đúng chuẩn.

### Ghi chú
- Thư viện shadcn/ui: registry `ui.shadcn.com` bị chặn trong môi trường build, các component được viết theo đúng cấu trúc shadcn (Radix UI + Tailwind + `cva`) trong `apps/web/src/components/ui`, có `components.json` để dùng CLI sau này.
- Menu chỉ hiển thị module đã hoàn thành (hiện tại: Học sinh). Các mục khác được bật khi module tương ứng qua kiểm thử.

## Giai đoạn 3.3 — Ca học & 3.4 — Lớp học (+ quản lý giáo viên cơ bản) (12/11/2026)

> Quản lý giáo viên (thêm, sửa, ngừng làm việc, cấp lại mật khẩu) được làm sớm hơn kế hoạch (vốn ở 3.8) vì là điều kiện để tạo lớp và lịch dạy.

| Hạng mục | Kết quả | Ghi chú |
|---|---|---|
| TypeScript (shared, workers, web) | ✅ 0 lỗi | |
| Unit test shared | ✅ 36/36 | |
| Integration test workers | ✅ 57/57 | +16 test lớp học/ca/giáo viên |
| E2E trình duyệt | ✅ 26/26 bước | 2 kịch bản, mỗi kịch bản chạy trên D1 local sạch |

### Integration test
- **Giáo viên:** tạo kèm tài khoản, mật khẩu tạm đăng nhập được và bắt buộc đổi; trùng email → 409; thiếu cả email và SĐT → 422; không cho ngừng làm việc khi còn lịch dạy; ngừng làm việc → không đăng nhập được.
- **Ca học:** giờ kết thúc phải sau giờ bắt đầu; tên không trùng; 3 ca mẫu (14:00–15:30, 16:00–17:30, 18:00–20:00) có sẵn.
- **Trùng lịch:** chặn trùng giáo viên (cùng thứ, giờ giao nhau); khác thứ được; lớp cũ kết thúc trước ngày lớp mới bắt đầu thì không tính trùng; chặn trùng phòng; API kiểm tra trước khi lưu.
- **Mở lớp:** không mở được lớp chưa có lịch; sinh **đúng số buổi** theo thứ trong tuần từ ngày bắt đầu đến 8 tuần tới; cron sinh lại **không tạo trùng**.
- **Đổi giờ ca:** chỉ áp dụng buổi chưa diễn ra; buổi đã qua giữ giờ cũ. **Kết thúc lịch:** xóa buổi tương lai chưa điểm danh.
- **Sĩ số:** chặn vượt sĩ số; quản trị viên vượt được khi nhập lý do (ghi vào ghi danh + nhật ký).
- **Xếp lớp:** chặn học sinh trùng giờ giữa hai lớp; học sinh tạm nghỉ không xếp được.
- **Chuyển ca:** chặn ngày chuyển trước buổi đã điểm danh; ghi danh cũ kết thúc (hiệu lực − 1, `TRANSFER`), ghi danh mới liên kết `transferred_from_id`; **điểm danh cũ giữ nguyên**; danh sách theo ngày trả đúng lớp trước/sau ngày chuyển; xuất hiện trong nhật ký học sinh và lịch sử sĩ số.
- **Đóng lớp:** chặn khi còn buổi đã qua chưa điểm danh; hủy các buổi đó thì đóng được; ghi danh kết thúc `CLASS_CLOSED`; buổi tương lai bị xóa.
- **Buổi bù / dạy thay:** kiểm tra trùng giáo viên ở cấp buổi học.
- **Phân quyền:** giáo viên chỉ thấy lớp và lịch của mình (lớp khác → 404), không tạo lớp/xếp lớp được; danh sách giáo viên trả cho giáo viên không có email/SĐT.

### E2E lớp học (trình duyệt thật)
Thêm giáo viên (hiện mật khẩu tạm một lần) · thêm phòng · tạo lớp A + kiểm tra không trùng lịch ngay trên form · mở lớp · tạo lớp B trùng giờ giáo viên → form báo trùng, đổi ca → tạo được · xếp 2 học sinh (đủ sĩ số 2/2) · chuyển ca từ trang học sinh · lịch tuần/tháng hiển thị cả hai lớp · hủy buổi có lý do · lịch sử sĩ số ghi nhận chuyển lớp · đóng lớp rút học sinh.

### Lỗi phát hiện và đã sửa
1. Ca mới tạo có thứ tự 0 nên chen lên trước Ca 1/2/3 → ca mới mặc định xếp cuối.
2. Script E2E: tiến trình `workerd` cũ còn giữ cổng sau khi xóa D1 local → script dừng hẳn tiến trình và dùng DB sạch cho từng kịch bản.

## Cập nhật giao diện theo góp ý chủ dự án (12/11/2026)

| Yêu cầu | Thực hiện | Kiểm thử |
|---|---|---|
| Ngày tháng dạng **dd/mm/yyyy** | Ô nhập ngày riêng (`DateInput`) luôn hiển thị dd/mm/yyyy, không phụ thuộc ngôn ngữ trình duyệt; gõ liền số tự chèn "/"; nút lịch để chọn nhanh; ngày không tồn tại (VD 30/02) bị xóa khi rời ô. Ô giờ dạng 24h HH:MM. Ngày giờ trong nhật ký hiển thị "dd/mm/yyyy HH:mm" theo giờ Việt Nam. Giá trị gửi API vẫn là ISO. | E2E: bước "Ô ngày hiển thị dd/mm/yyyy, tự chèn "/" và từ chối ngày không tồn tại"; toàn bộ form nhập ngày đi qua E2E |
| Màu sắc thanh menu | Mỗi mục có màu nhận diện riêng (ô biểu tượng + nền khi đang chọn): Tổng quan xanh dương, Học sinh chàm, Lớp học tím, Ca học vàng, Điểm danh xanh lá, Điểm số hồng, Học phí xanh ngọc, Giáo viên cam, Báo cáo xanh lơ, Cài đặt xám. Đỏ chỉ dùng cho lỗi/vắng. | Ảnh chụp E2E |
| Hình ảnh nền | 4 hình SVG tự thiết kế (không dùng hình có bản quyền): minh họa trang đăng nhập, họa tiết chữ cái ABC rất mờ ở nền (vẫn giữ nền trắng), minh họa cuối thanh menu, minh họa màn hình trống. Tổng < 7KB. | Ảnh chụp E2E |

E2E sau cập nhật: ✅ 27/27 bước.

## Giai đoạn 3.5 — Điểm danh (12/11/2026)

| Hạng mục | Kết quả | Ghi chú |
|---|---|---|
| TypeScript (shared, workers, web) | ✅ 0 lỗi | |
| Unit test shared | ✅ 36/36 | |
| Integration test workers | ✅ 64/64 | +7 test điểm danh |
| Kiểm tra độ nhạy (mutation) | ✅ | Tắt quy tắc khóa phiên → test khóa phiên thất bại đúng như mong đợi |
| E2E trình duyệt | ✅ 36/36 bước | 3 kịch bản; kịch bản điểm danh chạy dưới vai trò **giáo viên** |

### Quy tắc nghiệp vụ đã kiểm thử
- Mỗi buổi học là một phiên: Chưa điểm danh → Nháp → Đã xác nhận → Đã khóa.
- **Không trùng bản ghi** cho cùng học sinh và buổi học (UNIQUE + UPSERT); gửi lại cùng dữ liệu khi mạng chập chờn → thành công, không nhân bản; hai người sửa cùng lúc → người sau nhận thông báo xung đột (409), giao diện tự tải lại và gửi lại lựa chọn của mình.
- Học sinh không thuộc lớp vào ngày học → bị từ chối. Phút đi muộn chỉ lưu khi trạng thái "Đi muộn".
- Xác nhận khi còn học sinh chưa chọn → bị chặn và liệt kê tên. Xác nhận xong: lưu người & thời gian xác nhận, buổi học chuyển "đã học".
- Phụ huynh (có tài khoản, bật nhận thông báo) của học sinh vắng nhận thông báo trong ứng dụng; xác nhận lại **không tạo thông báo trùng**. (Gửi push qua Firebase thực hiện ở Giai đoạn 5.)
- Sửa sau khi xác nhận vẫn được trong ngày và được đánh dấu "Sửa sau khi xác nhận"; lịch sử ghi rõ **cũ → mới**, người sửa, thời điểm.
- Giáo viên không điểm danh được buổi tương lai (mở từ 30 phút trước giờ học); quản trị viên được.
- **00:00 giờ VN (cron)** khóa mọi phiên của ngày đã qua; giáo viên không sửa/không mở khóa được; quản trị viên/chủ lớp mở khóa phải nhập lý do (ghi vào lịch sử), phiên tự khóa lại vào 00:00 tiếp theo.
- Giáo viên lớp khác không xem được (404); phụ huynh xem được chuyên cần của con, không xem phiên điểm danh của lớp.
- Thống kê: số buổi, có mặt, đi muộn, vắng, tỷ lệ chuyên cần = (có mặt + đi muộn) / số buổi đã điểm danh; ma trận tháng theo lớp.
- Đóng lớp được kiểm tra theo "đã xác nhận" (buổi bị khóa mà chưa xác nhận vẫn chặn đóng lớp).

### E2E điểm danh (vai trò giáo viên, trình duyệt thật)
Giáo viên đăng nhập lần đầu → trang Điểm danh hôm nay · chọn trạng thái, "Tất cả có mặt", đi muộn 10 phút → tự lưu nháp · tải lại trang vẫn còn · **mất mạng**: lựa chọn được giữ, hiện nút Thử lại; có mạng lại → lưu được · xác nhận (hộp tổng kết) · sửa sau xác nhận → lịch sử "Có mặt → Đi muộn" · tổng hợp tháng · màn hình điện thoại 390px: 4 nút trên một hàng, cao ≥ 44px, không tràn ngang.

### Lỗi phát hiện và đã sửa
1. Nút trạng thái trên điện thoại ~40px, nhãn dài làm vỡ hàng → lưới 4 cột, cao 48px, nhãn ngắn trên điện thoại (Có mặt / Muộn / Vắng P / Vắng KP).
2. Cột "Có mặt" ở ma trận tháng cộng cả đi muộn → chỉ đếm có mặt (đi muộn có cột riêng).

## Giai đoạn 3.6 — Chấm điểm & đánh giá (12/11/2026)

| Hạng mục | Kết quả | Ghi chú |
|---|---|---|
| TypeScript (shared, workers, web) | ✅ 0 lỗi | |
| Unit test shared | ✅ 36/36 | gồm các mức biên xếp loại 9 / 8 / 6,5 / 5 |
| Integration test workers | ✅ 71/71 | +7 test chấm điểm |
| E2E trình duyệt | ✅ 43/43 bước | 4 kịch bản; kịch bản chấm điểm chạy dưới vai trò **giáo viên** |

### Quy tắc nghiệp vụ đã kiểm thử
- Cấu hình mặc định: 6 tiêu chí (Listening, Speaking, Reading, Writing, Homework, Attitude), 4 loại đánh giá (theo buổi, định kỳ, kiểm tra tháng, cuối khóa), 5 mức xếp loại.
- Điểm TB theo trọng số, quy về thang 10: ví dụ trong tài liệu thiết kế 8,7,9,6,10,9 → **8,17 – Giỏi**; thiếu tiêu chí chỉ tính tiêu chí có điểm (Q8); xóa một điểm → tính lại.
- **Không tự ý thay đổi điểm cũ:** mỗi đợt chụp lại cấu hình (tiêu chí, trọng số, thang điểm, thang xếp loại). Test đổi trọng số Listening = 3 và thang xếp loại mới → đợt cũ vẫn 7,5 – Khá; đợt mới tính 8,25 – Đạt theo cấu hình mới.
- Từ chối: điểm vượt thang, học sinh ngoài lớp, ngày đánh giá trong tương lai, thang xếp loại thiếu mức 0; giáo viên không sửa được cấu hình.
- Lịch sử sửa điểm ghi cũ → mới; sau công bố giáo viên không sửa được, quản trị viên sửa được (ghi nhận "Sửa điểm sau khi công bố").
- Công bố: phụ huynh (có tài khoản) xem được kết quả và nhận thông báo (không trùng); đợt nháp ẩn với phụ huynh.
- Giáo viên lớp khác không xem/tạo được đợt đánh giá của lớp; không xóa được đợt đã có điểm.

### E2E chấm điểm (vai trò giáo viên)
Quản trị viên xem trang Cấu hình · giáo viên tạo đợt "Kiểm tra tháng" · nhập điểm dạng lưới, TB **8,17** và **Giỏi** hiện ngay khi gõ, Enter chuyển xuống ô dưới như bảng tính, nhận xét · điểm 11 bị tô đỏ và khóa nút Lưu · lưu, tải lại vẫn còn · công bố → ô nhập bị khóa với giáo viên, lịch sử ghi nhận · trang học sinh: biểu đồ tiến bộ 6,5 → 8,17 kèm bảng kết quả.

### Biểu đồ tiến bộ
Một chuỗi (điểm TB) nên không cần chú giải; một trục 0–10; đường 2px, điểm có viền nền; lưới mờ; nhãn trực tiếp cho điểm cuối; chú thích khi rê/chạm với vùng bắt rộng hơn điểm; bảng số liệu đầy đủ ngay bên dưới.

### Lỗi phát hiện và đã sửa
1. **Thông báo nổi (toast) che nút "Lưu điểm"/"Xác nhận điểm danh"** ở thanh cố định cuối màn hình → chuyển thông báo lên góc trên phải, dưới thanh tiêu đề.
