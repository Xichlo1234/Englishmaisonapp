-- Dữ liệu cấu hình mặc định (KHÔNG chứa dữ liệu học sinh/giả). Sinh bởi scripts/gen-seed-sql.mjs
--> statement-breakpoint
-- Mã học sinh / giáo viên tự động sinh theo id.
--> statement-breakpoint
CREATE TRIGGER students_code_trg AFTER INSERT ON students WHEN NEW.student_code IS NULL
BEGIN UPDATE students SET student_code = printf('HS%05d', NEW.id) WHERE id = NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER teachers_code_trg AFTER INSERT ON teachers WHEN NEW.teacher_code IS NULL
BEGIN UPDATE teachers SET teacher_code = printf('GV%03d', NEW.id) WHERE id = NEW.id; END;
--> statement-breakpoint
-- Nhật ký chỉ được thêm, không sửa/xóa.
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
--> statement-breakpoint
-- Giao dịch thu tiền bất biến.
--> statement-breakpoint
CREATE TRIGGER payments_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;
--> statement-breakpoint
INSERT INTO roles (code, name, is_system) VALUES ('ADMIN', 'Quản trị viên', 1);
--> statement-breakpoint
INSERT INTO roles (code, name, is_system) VALUES ('OWNER', 'Chủ lớp', 1);
--> statement-breakpoint
INSERT INTO roles (code, name, is_system) VALUES ('TEACHER', 'Giáo viên', 1);
--> statement-breakpoint
INSERT INTO roles (code, name, is_system) VALUES ('GUARDIAN', 'Phụ huynh', 1);
--> statement-breakpoint
INSERT INTO roles (code, name, is_system) VALUES ('STUDENT', 'Học sinh', 1);
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('dashboard.read', 'Xem tổng quan');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('dashboard.finance', 'Xem số liệu tài chính trên tổng quan');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('students.read', 'Xem học sinh');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('students.write', 'Thêm/sửa học sinh');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('students.delete', 'Xóa cứng học sinh chưa có dữ liệu');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('classes.read', 'Xem lớp học');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('classes.write', 'Quản lý lớp học, ca học, lịch học');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('enrollments.write', 'Xếp lớp, chuyển lớp, chuyển ca');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('attendance.read', 'Xem điểm danh');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('attendance.write', 'Điểm danh');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('attendance.unlock', 'Mở khóa phiên điểm danh');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('grades.read', 'Xem điểm');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('grades.write', 'Chấm điểm, nhận xét');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('grading.config', 'Cấu hình tiêu chí, trọng số, thang xếp loại');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('fees.read', 'Xem học phí');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('fees.write', 'Lập hóa đơn, thu tiền');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('fees.approve_adjustment', 'Duyệt hoàn tiền/điều chỉnh');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('teachers.read', 'Xem giáo viên');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('teachers.write', 'Quản lý giáo viên');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('users.manage', 'Quản lý tài khoản');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('reports.read', 'Xem báo cáo');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('settings.manage', 'Cấu hình hệ thống');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('audit.read', 'Xem nhật ký hệ thống');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('files.write', 'Tải tệp lên');
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES ('self.read', 'Xem dữ liệu được liên kết (phụ huynh/học sinh)');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'ADMIN' AND p.code IN ('dashboard.read', 'dashboard.finance', 'students.read', 'students.write', 'students.delete', 'classes.read', 'classes.write', 'enrollments.write', 'attendance.read', 'attendance.write', 'attendance.unlock', 'grades.read', 'grades.write', 'grading.config', 'fees.read', 'fees.write', 'fees.approve_adjustment', 'teachers.read', 'teachers.write', 'users.manage', 'reports.read', 'settings.manage', 'audit.read', 'files.write');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'OWNER' AND p.code IN ('dashboard.read', 'dashboard.finance', 'students.read', 'students.write', 'classes.read', 'classes.write', 'enrollments.write', 'attendance.read', 'attendance.write', 'attendance.unlock', 'grades.read', 'grades.write', 'fees.read', 'fees.write', 'fees.approve_adjustment', 'teachers.read', 'teachers.write', 'users.manage', 'reports.read', 'audit.read', 'files.write');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'TEACHER' AND p.code IN ('dashboard.read', 'students.read', 'classes.read', 'attendance.read', 'attendance.write', 'grades.read', 'grades.write', 'teachers.read', 'reports.read', 'files.write');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'GUARDIAN' AND p.code IN ('self.read');
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'STUDENT' AND p.code IN ('self.read');
--> statement-breakpoint
INSERT INTO grading_criteria (code, name, weight, max_score, sort_order) VALUES ('LISTENING', 'Listening', 1, 10, 1);
--> statement-breakpoint
INSERT INTO grading_criteria (code, name, weight, max_score, sort_order) VALUES ('SPEAKING', 'Speaking', 1, 10, 2);
--> statement-breakpoint
INSERT INTO grading_criteria (code, name, weight, max_score, sort_order) VALUES ('READING', 'Reading', 1, 10, 3);
--> statement-breakpoint
INSERT INTO grading_criteria (code, name, weight, max_score, sort_order) VALUES ('WRITING', 'Writing', 1, 10, 4);
--> statement-breakpoint
INSERT INTO grading_criteria (code, name, weight, max_score, sort_order) VALUES ('HOMEWORK', 'Homework', 1, 10, 5);
--> statement-breakpoint
INSERT INTO grading_criteria (code, name, weight, max_score, sort_order) VALUES ('ATTITUDE', 'Attitude', 1, 10, 6);
--> statement-breakpoint
INSERT INTO assessment_types (code, name, criteria_ids) VALUES ('LESSON', 'Đánh giá theo buổi', (SELECT json_group_array(id) FROM (SELECT id FROM grading_criteria ORDER BY sort_order)));
--> statement-breakpoint
INSERT INTO assessment_types (code, name, criteria_ids) VALUES ('PERIODIC', 'Đánh giá định kỳ', (SELECT json_group_array(id) FROM (SELECT id FROM grading_criteria ORDER BY sort_order)));
--> statement-breakpoint
INSERT INTO assessment_types (code, name, criteria_ids) VALUES ('MONTHLY', 'Kiểm tra tháng', (SELECT json_group_array(id) FROM (SELECT id FROM grading_criteria ORDER BY sort_order)));
--> statement-breakpoint
INSERT INTO assessment_types (code, name, criteria_ids) VALUES ('FINAL', 'Kiểm tra cuối khóa', (SELECT json_group_array(id) FROM (SELECT id FROM grading_criteria ORDER BY sort_order)));
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES ('center_name', '"Lớp học tiếng Anh"');
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES ('english_levels', '["Starters","Movers","Flyers","KET","PET","IELTS"]');
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES ('grade_bands', '[{"min":9,"label":"Xuất sắc"},{"min":8,"label":"Giỏi"},{"min":6.5,"label":"Khá"},{"min":5,"label":"Trung bình"},{"min":0,"label":"Cần cải thiện"}]');
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES ('attendance_lock_policy', '{"mode":"END_OF_DAY","openMinutesBefore":30}');
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES ('attention_thresholds', '{"absencesIn30Days":3,"minAttendanceRate":80,"minAverage":5}');
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES ('invoice_due_day', '10');
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES ('fee_reminder_days_before', '3');
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES ('per_session_deduct_statuses', '["PRESENT","LATE","UNEXCUSED"]');
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES ('bank_qr_info', 'null');
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES ('notifications_enabled', '{"absence":true,"result":true,"fee":true,"schedule":false}');
--> statement-breakpoint
INSERT INTO shifts (name, start_time, end_time, sort_order) VALUES ('Ca 1', '14:00', '15:30', 1);
--> statement-breakpoint
INSERT INTO shifts (name, start_time, end_time, sort_order) VALUES ('Ca 2', '16:00', '17:30', 2);
--> statement-breakpoint
INSERT INTO shifts (name, start_time, end_time, sort_order) VALUES ('Ca 3', '18:00', '20:00', 3);
