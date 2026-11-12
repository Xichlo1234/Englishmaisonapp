// Sinh workers/migrations/0001_seed_defaults.sql từ hằng số dùng chung (vai trò, quyền, tiêu chí, thang xếp loại).
// Chạy: node --experimental-strip-types scripts/gen-seed-sql.mjs
import fs from 'node:fs';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLE_NAMES } from '../packages/shared/src/constants.ts';
import { DEFAULT_CRITERIA, DEFAULT_GRADE_BANDS } from '../packages/shared/src/grading.ts';

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const out = [];
out.push('-- Dữ liệu cấu hình mặc định (KHÔNG chứa dữ liệu học sinh/giả). Sinh bởi scripts/gen-seed-sql.mjs');
out.push('-- Mã học sinh / giáo viên tự động sinh theo id.');
out.push(`CREATE TRIGGER students_code_trg AFTER INSERT ON students WHEN NEW.student_code IS NULL
BEGIN UPDATE students SET student_code = printf('HS%05d', NEW.id) WHERE id = NEW.id; END;`);
out.push(`CREATE TRIGGER teachers_code_trg AFTER INSERT ON teachers WHEN NEW.teacher_code IS NULL
BEGIN UPDATE teachers SET teacher_code = printf('GV%03d', NEW.id) WHERE id = NEW.id; END;`);
out.push('-- Nhật ký chỉ được thêm, không sửa/xóa.');
out.push(`CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;`);
out.push(`CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;`);
out.push('-- Giao dịch thu tiền bất biến.');
out.push(`CREATE TRIGGER payments_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;`);
out.push(`CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;`);

for (const [code, name] of Object.entries(ROLE_NAMES))
  out.push(`INSERT INTO roles (code, name, is_system) VALUES (${q(code)}, ${q(name)}, 1);`);
for (const [code, desc] of Object.entries(PERMISSIONS))
  out.push(`INSERT INTO permissions (code, description) VALUES (${q(code)}, ${q(desc)});`);
for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS))
  out.push(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = ${q(role)} AND p.code IN (${perms.map(q).join(', ')});`,
  );

DEFAULT_CRITERIA.forEach((c, i) =>
  out.push(
    `INSERT INTO grading_criteria (code, name, weight, max_score, sort_order) VALUES (${q(c.code)}, ${q(c.name)}, ${c.weight}, ${c.maxScore}, ${i + 1});`,
  ),
);
const allCrit = `(SELECT json_group_array(id) FROM (SELECT id FROM grading_criteria ORDER BY sort_order))`;
for (const [code, name] of [
  ['LESSON', 'Đánh giá theo buổi'],
  ['PERIODIC', 'Đánh giá định kỳ'],
  ['MONTHLY', 'Kiểm tra tháng'],
  ['FINAL', 'Kiểm tra cuối khóa'],
])
  out.push(`INSERT INTO assessment_types (code, name, criteria_ids) VALUES (${q(code)}, ${q(name)}, ${allCrit});`);

const settings = {
  center_name: 'Lớp học tiếng Anh',
  english_levels: ['Starters', 'Movers', 'Flyers', 'KET', 'PET', 'IELTS'],
  grade_bands: DEFAULT_GRADE_BANDS,
  attendance_lock_policy: { mode: 'END_OF_DAY', openMinutesBefore: 30 },
  attention_thresholds: { absencesIn30Days: 3, minAttendanceRate: 80, minAverage: 5 },
  invoice_due_day: 10,
  fee_reminder_days_before: 3,
  per_session_deduct_statuses: ['PRESENT', 'LATE', 'UNEXCUSED'],
  bank_qr_info: null,
  notifications_enabled: { absence: true, result: true, fee: true, schedule: false },
};
for (const [k, v] of Object.entries(settings))
  out.push(`INSERT INTO system_settings (key, value) VALUES (${q(k)}, ${q(JSON.stringify(v))});`);

// Ca học mẫu theo yêu cầu (cấu hình được, có thể sửa/xóa) — không phải dữ liệu nghiệp vụ giả.
[['Ca 1', '14:00', '15:30'], ['Ca 2', '16:00', '17:30'], ['Ca 3', '18:00', '20:00']].forEach(([n, s, e], i) =>
  out.push(`INSERT INTO shifts (name, start_time, end_time, sort_order) VALUES (${q(n)}, ${q(s)}, ${q(e)}, ${i + 1});`),
);

fs.writeFileSync(
  new URL('../workers/migrations/0001_seed_defaults.sql', import.meta.url),
  out.join('\n--> statement-breakpoint\n') + '\n',
);
console.log('Đã sinh', out.length, 'câu lệnh');
