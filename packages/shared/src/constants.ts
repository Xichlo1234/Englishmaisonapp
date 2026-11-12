/** Mã vai trò hệ thống. */
export const ROLE_CODES = ['ADMIN', 'OWNER', 'TEACHER', 'GUARDIAN', 'STUDENT'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLE_NAMES: Record<RoleCode, string> = {
  ADMIN: 'Quản trị viên',
  OWNER: 'Chủ lớp',
  TEACHER: 'Giáo viên',
  GUARDIAN: 'Phụ huynh',
  STUDENT: 'Học sinh',
};

/** Danh sách quyền. Thêm quyền mới phải thêm migration seed tương ứng. */
export const PERMISSIONS = {
  'dashboard.read': 'Xem tổng quan',
  'dashboard.finance': 'Xem số liệu tài chính trên tổng quan',
  'students.read': 'Xem học sinh',
  'students.write': 'Thêm/sửa học sinh',
  'students.delete': 'Xóa cứng học sinh chưa có dữ liệu',
  'classes.read': 'Xem lớp học',
  'classes.write': 'Quản lý lớp học, ca học, lịch học',
  'enrollments.write': 'Xếp lớp, chuyển lớp, chuyển ca',
  'attendance.read': 'Xem điểm danh',
  'attendance.write': 'Điểm danh',
  'attendance.unlock': 'Mở khóa phiên điểm danh',
  'grades.read': 'Xem điểm',
  'grades.write': 'Chấm điểm, nhận xét',
  'grading.config': 'Cấu hình tiêu chí, trọng số, thang xếp loại',
  'fees.read': 'Xem học phí',
  'fees.write': 'Lập hóa đơn, thu tiền',
  'fees.approve_adjustment': 'Duyệt hoàn tiền/điều chỉnh',
  'teachers.read': 'Xem giáo viên',
  'teachers.write': 'Quản lý giáo viên',
  'users.manage': 'Quản lý tài khoản',
  'reports.read': 'Xem báo cáo',
  'settings.manage': 'Cấu hình hệ thống',
  'audit.read': 'Xem nhật ký hệ thống',
  'files.write': 'Tải tệp lên',
  'self.read': 'Xem dữ liệu được liên kết (phụ huynh/học sinh)',
} as const;
export type PermissionCode = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as PermissionCode[];

/** Quyền mặc định theo vai trò (được seed vào D1, nguồn sự thật ở runtime là D1). */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  ADMIN: ALL.filter((p) => p !== 'self.read'),
  OWNER: ALL.filter((p) => !['settings.manage', 'grading.config', 'self.read', 'students.delete'].includes(p)),
  TEACHER: [
    'dashboard.read',
    'students.read',
    'classes.read',
    'attendance.read',
    'attendance.write',
    'grades.read',
    'grades.write',
    'teachers.read',
    'reports.read',
    'files.write',
  ],
  GUARDIAN: ['self.read'],
  STUDENT: ['self.read'],
};

/** Vai trò nhân sự có phạm vi toàn hệ thống. */
export const FULL_SCOPE_ROLES: readonly RoleCode[] = ['ADMIN', 'OWNER'];

export const STUDENT_STATUSES = ['ACTIVE', 'PAUSED', 'DROPPED', 'GRADUATED', 'ARCHIVED'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  ACTIVE: 'Đang học',
  PAUSED: 'Tạm nghỉ',
  DROPPED: 'Nghỉ học',
  GRADUATED: 'Hoàn thành',
  ARCHIVED: 'Đã lưu trữ',
};

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export type Gender = (typeof GENDERS)[number];

export const CLASS_STATUSES = ['PLANNED', 'OPEN', 'CLOSED'] as const;
export type ClassStatus = (typeof CLASS_STATUSES)[number];

export const ENROLLMENT_END_REASONS = ['TRANSFER', 'PAUSE', 'DROP', 'CLASS_CLOSED', 'COMPLETED'] as const;
export type EnrollmentEndReason = (typeof ENROLLMENT_END_REASONS)[number];

export const LESSON_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export const ATTENDANCE_SESSION_STATUSES = ['NOT_STARTED', 'DRAFT', 'SUBMITTED', 'LOCKED'] as const;
export type AttendanceSessionStatus = (typeof ATTENDANCE_SESSION_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['PRESENT', 'EXCUSED', 'UNEXCUSED', 'LATE'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Có mặt',
  EXCUSED: 'Vắng có phép',
  UNEXCUSED: 'Vắng không phép',
  LATE: 'Đi muộn',
};

export const BILLING_TYPES = ['MONTHLY', 'COURSE', 'PER_SESSION'] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export const INVOICE_STATUSES = ['DRAFT', 'UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Nháp',
  UNPAID: 'Chưa thanh toán',
  PARTIAL: 'Đã thanh toán một phần',
  PAID: 'Đã thanh toán',
  OVERDUE: 'Quá hạn',
  CANCELLED: 'Đã hủy',
};

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ADJUSTMENT_TYPES = ['REFUND', 'CORRECTION', 'VOID'] as const;
export const ADJUSTMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const USER_STATUSES = ['ACTIVE', 'LOCKED', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const FILE_CATEGORIES = ['STUDENT_PHOTO', 'AVATAR', 'DOCUMENT', 'ATTACHMENT'] as const;

export const NOTIFICATION_TYPES = ['SCHEDULE', 'ABSENCE', 'RESULT', 'FEE_DUE', 'FEE_OVERDUE', 'SYSTEM'] as const;

/** Múi giờ Việt Nam: UTC+7, không có giờ mùa hè. */
export const VN_TZ_OFFSET_MINUTES = 7 * 60;
export const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';
