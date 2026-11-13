/**
 * Lược đồ cơ sở dữ liệu D1 (SQLite) — nguồn để sinh migrations bằng drizzle-kit.
 * Quy ước: thời điểm = TEXT ISO-8601 UTC; ngày nghiệp vụ = TEXT 'YYYY-MM-DD' (giờ VN);
 * tiền = INTEGER VND; boolean = INTEGER 0/1. Xem docs/DATABASE.md.
 */
import { sql, type AnyColumn } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

const nowSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const id = () => integer('id').primaryKey({ autoIncrement: true });
const createdAt = () => text('created_at').notNull().default(nowSql);
const updatedAt = () => text('updated_at').notNull().default(nowSql);
const deletedAt = () => text('deleted_at');
const bool = (name: string) => integer(name, { mode: 'boolean' });
const inList = (col: AnyColumn, values: readonly string[]) =>
  sql`${col} IN (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;

// ───────────────────────── Tài khoản & phân quyền ─────────────────────────

export const roles = sqliteTable('roles', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isSystem: bool('is_system').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const permissions = sqliteTable('permissions', {
  id: id(),
  code: text('code').notNull().unique(),
  description: text('description').notNull(),
  createdAt: createdAt(),
});

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id),
    permissionId: integer('permission_id')
      .notNull()
      .references(() => permissions.id),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const users = sqliteTable(
  'users',
  {
    id: id(),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id),
    fullName: text('full_name').notNull(),
    email: text('email').unique(),
    phone: text('phone').unique(),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: bool('must_change_password').notNull().default(true),
    status: text('status').notNull().default('ACTIVE'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: text('locked_until'),
    lastLoginAt: text('last_login_at'),
    passwordChangedAt: text('password_changed_at'),
    avatarFileId: integer('avatar_file_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('users_role_idx').on(t.roleId),
    index('users_status_idx').on(t.status),
    check('users_status_chk', inList(t.status, ['ACTIVE', 'LOCKED', 'DISABLED'])),
    check('users_identity_chk', sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    client: text('client').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    revokeReason: text('revoke_reason'),
    replacedById: integer('replaced_by_id'),
    familyId: text('family_id').notNull(),
    createdAt: createdAt(),
    lastUsedAt: text('last_used_at'),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_family_idx').on(t.familyId),
    check('sessions_client_chk', inList(t.client, ['WEB', 'MOBILE'])),
  ],
);

export const deviceTokens = sqliteTable(
  'device_tokens',
  {
    id: id(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    fcmToken: text('fcm_token').notNull().unique(),
    platform: text('platform').notNull(),
    createdAt: createdAt(),
    lastSeenAt: text('last_seen_at').notNull().default(nowSql),
  },
  (t) => [
    index('device_tokens_user_idx').on(t.userId),
    check('device_tokens_platform_chk', inList(t.platform, ['ANDROID', 'IOS'])),
  ],
);

// ───────────────────────── Tệp (R2) ─────────────────────────

export const files = sqliteTable(
  'files',
  {
    id: id(),
    r2Key: text('r2_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    category: text('category').notNull(),
    ownerType: text('owner_type').notNull(),
    ownerId: integer('owner_id').notNull(),
    visibility: text('visibility').notNull().default('STAFF'),
    uploadedBy: integer('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('files_owner_idx').on(t.ownerType, t.ownerId),
    check('files_category_chk', inList(t.category, ['STUDENT_PHOTO', 'AVATAR', 'DOCUMENT', 'ATTACHMENT'])),
    check('files_visibility_chk', inList(t.visibility, ['STAFF', 'CLASS', 'OWNER_LINKED'])),
    check('files_size_chk', sql`${t.sizeBytes} > 0`),
  ],
);

// ───────────────────────── Học sinh & phụ huynh ─────────────────────────

export const students = sqliteTable(
  'students',
  {
    id: id(),
    studentCode: text('student_code').unique(),
    fullName: text('full_name').notNull(),
    fullNameSearch: text('full_name_search').notNull(),
    dateOfBirth: text('date_of_birth'),
    gender: text('gender'),
    address: text('address'),
    schoolName: text('school_name'),
    schoolGrade: text('school_grade'),
    startDate: text('start_date').notNull(),
    englishLevel: text('english_level'),
    status: text('status').notNull().default('ACTIVE'),
    statusBeforeArchive: text('status_before_archive'),
    pauseUntil: text('pause_until'),
    needsAttention: bool('needs_attention').notNull().default(false),
    attentionNote: text('attention_note'),
    notes: text('notes'),
    photoFileId: integer('photo_file_id').references(() => files.id),
    // false = family declined photos; teachers are warned before posting class photos.
    photoConsent: bool('photo_consent').notNull().default(true),
    userId: integer('user_id')
      .unique()
      .references(() => users.id),
    version: integer('version').notNull().default(0),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('students_status_idx').on(t.status),
    index('students_name_search_idx').on(t.fullNameSearch),
    index('students_level_idx').on(t.englishLevel),
    check('students_status_chk', inList(t.status, ['ACTIVE', 'PAUSED', 'DROPPED', 'GRADUATED', 'ARCHIVED'])),
    check('students_gender_chk', sql`${t.gender} IS NULL OR ${inList(t.gender, ['MALE', 'FEMALE', 'OTHER'])}`),
  ],
);

export const guardians = sqliteTable(
  'guardians',
  {
    id: id(),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    userId: integer('user_id')
      .unique()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('guardians_phone_idx').on(t.phone)],
);

export const studentGuardians = sqliteTable(
  'student_guardians',
  {
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    guardianId: integer('guardian_id')
      .notNull()
      .references(() => guardians.id),
    relationship: text('relationship').notNull().default('OTHER'),
    isPrimary: bool('is_primary').notNull().default(false),
    receiveNotifications: bool('receive_notifications').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.guardianId] }),
    index('student_guardians_guardian_idx').on(t.guardianId),
    check('student_guardians_rel_chk', inList(t.relationship, ['FATHER', 'MOTHER', 'OTHER'])),
  ],
);

// ───────────────────────── Giáo viên, phòng, ca, lớp, lịch ─────────────────────────

export const teachers = sqliteTable(
  'teachers',
  {
    id: id(),
    userId: integer('user_id')
      .notNull()
      .unique()
      .references(() => users.id),
    teacherCode: text('teacher_code').unique(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    email: text('email'),
    specialty: text('specialty'),
    status: text('status').notNull().default('ACTIVE'),
    hiredDate: text('hired_date'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [check('teachers_status_chk', inList(t.status, ['ACTIVE', 'INACTIVE']))],
);

export const rooms = sqliteTable(
  'rooms',
  {
    id: id(),
    name: text('name').notNull().unique(),
    capacity: integer('capacity'),
    isActive: bool('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('rooms_capacity_chk', sql`${t.capacity} IS NULL OR ${t.capacity} > 0`)],
);

export const shifts = sqliteTable(
  'shifts',
  {
    id: id(),
    name: text('name').notNull().unique(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    isActive: bool('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('shifts_time_chk', sql`${t.startTime} < ${t.endTime}`)],
);

export const feePlans = sqliteTable(
  'fee_plans',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    billingType: text('billing_type').notNull(),
    amount: integer('amount').notNull(),
    sessionCount: integer('session_count'),
    englishLevel: text('english_level'),
    isActive: bool('is_active').notNull().default(true),
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('fee_plans_type_chk', inList(t.billingType, ['MONTHLY', 'COURSE', 'PER_SESSION'])),
    check('fee_plans_amount_chk', sql`${t.amount} >= 0`),
    check(
      'fee_plans_sessions_chk',
      sql`${t.billingType} <> 'PER_SESSION' OR (${t.sessionCount} IS NOT NULL AND ${t.sessionCount} > 0)`,
    ),
  ],
);

export const classes = sqliteTable(
  'classes',
  {
    id: id(),
    classCode: text('class_code').notNull().unique(),
    name: text('name').notNull(),
    englishLevel: text('english_level'),
    mainTeacherId: integer('main_teacher_id').references(() => teachers.id),
    maxStudents: integer('max_students').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    status: text('status').notNull().default('PLANNED'),
    defaultFeePlanId: integer('default_fee_plan_id').references(() => feePlans.id),
    notes: text('notes'),
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: text('closed_at'),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('classes_status_idx').on(t.status),
    index('classes_teacher_idx').on(t.mainTeacherId),
    check('classes_status_chk', inList(t.status, ['PLANNED', 'OPEN', 'CLOSED'])),
    check('classes_max_chk', sql`${t.maxStudents} > 0`),
    check('classes_dates_chk', sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
  ],
);

export const classEnrollments = sqliteTable(
  'class_enrollments',
  {
    id: id(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    classId: integer('class_id')
      .notNull()
      .references(() => classes.id),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    status: text('status').notNull().default('ACTIVE'),
    endReason: text('end_reason'),
    transferredFromId: integer('transferred_from_id').references((): AnySQLiteColumn => classEnrollments.id),
    note: text('note'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('enrollments_class_status_idx').on(t.classId, t.status),
    index('enrollments_student_status_idx').on(t.studentId, t.status),
    uniqueIndex('enrollments_active_uq').on(t.studentId, t.classId).where(sql`status = 'ACTIVE'`),
    check('enrollments_status_chk', inList(t.status, ['ACTIVE', 'ENDED'])),
    check('enrollments_dates_chk', sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
    check(
      'enrollments_reason_chk',
      sql`${t.endReason} IS NULL OR ${inList(t.endReason, ['TRANSFER', 'PAUSE', 'DROP', 'CLASS_CLOSED', 'COMPLETED'])}`,
    ),
  ],
);

export const schedules = sqliteTable(
  'schedules',
  {
    id: id(),
    classId: integer('class_id')
      .notNull()
      .references(() => classes.id),
    shiftId: integer('shift_id')
      .notNull()
      .references(() => shifts.id),
    weekday: integer('weekday').notNull(),
    teacherId: integer('teacher_id')
      .notNull()
      .references(() => teachers.id),
    roomId: integer('room_id').references(() => rooms.id),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('schedules_class_idx').on(t.classId),
    index('schedules_teacher_idx').on(t.teacherId, t.weekday),
    index('schedules_room_idx').on(t.roomId, t.weekday),
    check('schedules_weekday_chk', sql`${t.weekday} BETWEEN 1 AND 7`),
    check('schedules_dates_chk', sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`),
  ],
);

export const lessons = sqliteTable(
  'lessons',
  {
    id: id(),
    classId: integer('class_id')
      .notNull()
      .references(() => classes.id),
    scheduleId: integer('schedule_id').references(() => schedules.id),
    lessonDate: text('lesson_date').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    teacherId: integer('teacher_id')
      .notNull()
      .references(() => teachers.id),
    roomId: integer('room_id').references(() => rooms.id),
    status: text('status').notNull().default('SCHEDULED'),
    cancelReason: text('cancel_reason'),
    topic: text('topic'),
    attendanceStatus: text('attendance_status').notNull().default('NOT_STARTED'),
    attendanceSubmittedBy: integer('attendance_submitted_by').references(() => users.id),
    attendanceSubmittedAt: text('attendance_submitted_at'),
    attendanceLockedAt: text('attendance_locked_at'),
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('lessons_class_slot_uq').on(t.classId, t.lessonDate, t.startTime),
    index('lessons_date_idx').on(t.lessonDate),
    index('lessons_teacher_date_idx').on(t.teacherId, t.lessonDate),
    check('lessons_status_chk', inList(t.status, ['SCHEDULED', 'COMPLETED', 'CANCELLED'])),
    check(
      'lessons_att_status_chk',
      inList(t.attendanceStatus, ['NOT_STARTED', 'DRAFT', 'SUBMITTED', 'LOCKED']),
    ),
    check('lessons_time_chk', sql`${t.startTime} < ${t.endTime}`),
  ],
);

// ───────────────────────── Điểm danh ─────────────────────────

export const attendanceRecords = sqliteTable(
  'attendance_records',
  {
    id: id(),
    lessonId: integer('lesson_id')
      .notNull()
      .references(() => lessons.id),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    enrollmentId: integer('enrollment_id').references(() => classEnrollments.id),
    status: text('status').notNull(),
    lateMinutes: integer('late_minutes'),
    note: text('note'),
    markedBy: integer('marked_by')
      .notNull()
      .references(() => users.id),
    markedAt: text('marked_at').notNull(),
    updatedBy: integer('updated_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('attendance_lesson_student_uq').on(t.lessonId, t.studentId),
    index('attendance_student_idx').on(t.studentId, t.lessonId),
    check('attendance_status_chk', inList(t.status, ['PRESENT', 'EXCUSED', 'UNEXCUSED', 'LATE'])),
    check('attendance_late_chk', sql`${t.lateMinutes} IS NULL OR ${t.lateMinutes} >= 0`),
  ],
);

// ───────────────────────── Đánh giá & điểm ─────────────────────────

export const gradingCriteria = sqliteTable(
  'grading_criteria',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    weight: real('weight').notNull().default(1),
    maxScore: real('max_score').notNull().default(10),
    isActive: bool('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('criteria_weight_chk', sql`${t.weight} > 0`),
    check('criteria_max_chk', sql`${t.maxScore} > 0`),
  ],
);

export const assessmentTypes = sqliteTable('assessment_types', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  criteriaIds: text('criteria_ids').notNull().default('[]'),
  isActive: bool('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const assessments = sqliteTable(
  'assessments',
  {
    id: id(),
    classId: integer('class_id')
      .notNull()
      .references(() => classes.id),
    assessmentTypeId: integer('assessment_type_id')
      .notNull()
      .references(() => assessmentTypes.id),
    lessonId: integer('lesson_id').references(() => lessons.id),
    title: text('title').notNull(),
    assessedOn: text('assessed_on').notNull(),
    configSnapshot: text('config_snapshot').notNull(),
    status: text('status').notNull().default('DRAFT'),
    publishedAt: text('published_at'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('assessments_class_date_idx').on(t.classId, t.assessedOn),
    check('assessments_status_chk', inList(t.status, ['DRAFT', 'PUBLISHED'])),
  ],
);

export const grades = sqliteTable(
  'grades',
  {
    id: id(),
    assessmentId: integer('assessment_id')
      .notNull()
      .references(() => assessments.id),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    criterionId: integer('criterion_id')
      .notNull()
      .references(() => gradingCriteria.id),
    score: real('score').notNull(),
    gradedBy: integer('graded_by')
      .notNull()
      .references(() => users.id),
    gradedAt: text('graded_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('grades_uq').on(t.assessmentId, t.studentId, t.criterionId),
    index('grades_student_idx').on(t.studentId),
    check('grades_score_chk', sql`${t.score} >= 0`),
  ],
);

export const assessmentResults = sqliteTable(
  'assessment_results',
  {
    id: id(),
    assessmentId: integer('assessment_id')
      .notNull()
      .references(() => assessments.id),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    weightedAverage: real('weighted_average'),
    classification: text('classification'),
    teacherComment: text('teacher_comment'),
    computedAt: text('computed_at'),
    updatedBy: integer('updated_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('assessment_results_uq').on(t.assessmentId, t.studentId),
    index('assessment_results_student_idx').on(t.studentId),
  ],
);

// ───────────────────────── Học phí ─────────────────────────

export const studentFeePlans = sqliteTable(
  'student_fee_plans',
  {
    id: id(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    feePlanId: integer('fee_plan_id')
      .notNull()
      .references(() => feePlans.id),
    classId: integer('class_id').references(() => classes.id),
    customAmount: integer('custom_amount'),
    discountType: text('discount_type').notNull().default('NONE'),
    discountValue: integer('discount_value').notNull().default(0),
    discountReason: text('discount_reason'),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('student_fee_plans_student_idx').on(t.studentId),
    check('sfp_discount_type_chk', inList(t.discountType, ['NONE', 'AMOUNT', 'PERCENT'])),
    check('sfp_discount_value_chk', sql`${t.discountValue} >= 0`),
    check('sfp_percent_chk', sql`${t.discountType} <> 'PERCENT' OR ${t.discountValue} <= 100`),
    check('sfp_custom_amount_chk', sql`${t.customAmount} IS NULL OR ${t.customAmount} >= 0`),
  ],
);

export const invoices = sqliteTable(
  'invoices',
  {
    id: id(),
    invoiceCode: text('invoice_code').notNull().unique(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    studentFeePlanId: integer('student_fee_plan_id').references(() => studentFeePlans.id),
    periodLabel: text('period_label').notNull(),
    periodStart: text('period_start'),
    periodEnd: text('period_end'),
    sessionsPurchased: integer('sessions_purchased'),
    grossAmount: integer('gross_amount').notNull(),
    discountAmount: integer('discount_amount').notNull().default(0),
    // Part of discount_amount that is the previous period's absence deduction (shown as its own line).
    absenceDeduction: integer('absence_deduction').notNull().default(0),
    absenceCount: integer('absence_count').notNull().default(0),
    absenceSessionTotal: integer('absence_session_total'),
    absenceUnitPrice: integer('absence_unit_price'),
    absenceSourceInvoiceId: integer('absence_source_invoice_id'),
    amountDue: integer('amount_due').notNull(),
    amountPaid: integer('amount_paid').notNull().default(0),
    dueDate: text('due_date'),
    status: text('status').notNull().default('DRAFT'),
    note: text('note'),
    issuedAt: text('issued_at'),
    cancelledAt: text('cancelled_at'),
    cancelReason: text('cancel_reason'),
    createdBy: integer('created_by').references(() => users.id),
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('invoices_period_uq')
      .on(t.studentId, t.studentFeePlanId, t.periodLabel)
      .where(sql`status <> 'CANCELLED'`),
    index('invoices_status_idx').on(t.status),
    index('invoices_due_idx').on(t.dueDate),
    index('invoices_student_idx').on(t.studentId),
    check(
      'invoices_status_chk',
      inList(t.status, ['DRAFT', 'UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED']),
    ),
    check('invoices_amounts_chk', sql`${t.grossAmount} >= 0 AND ${t.discountAmount} >= 0 AND ${t.amountDue} >= 0`),
    check('invoices_due_calc_chk', sql`${t.amountDue} = ${t.grossAmount} - ${t.discountAmount}`),
    check('invoices_paid_chk', sql`${t.amountPaid} >= 0 AND ${t.amountPaid} <= ${t.amountDue}`),
  ],
);

export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    paymentCode: text('payment_code').notNull().unique(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    amount: integer('amount').notNull(),
    method: text('method').notNull(),
    referenceNo: text('reference_no'),
    paidAt: text('paid_at').notNull(),
    receivedBy: integer('received_by')
      .notNull()
      .references(() => users.id),
    note: text('note'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_paid_at_idx').on(t.paidAt),
    check('payments_amount_chk', sql`${t.amount} > 0`),
    check('payments_method_chk', inList(t.method, ['CASH', 'BANK_TRANSFER', 'OTHER'])),
  ],
);

export const paymentAdjustments = sqliteTable(
  'payment_adjustments',
  {
    id: id(),
    adjustmentCode: text('adjustment_code').notNull().unique(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id),
    paymentId: integer('payment_id').references(() => payments.id),
    type: text('type').notNull(),
    // How the money moved for this entry (CASH/BANK_TRANSFER/OTHER); VOID copies the original payment's method.
    method: text('method'),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('PENDING'),
    requestedBy: integer('requested_by')
      .notNull()
      .references(() => users.id),
    requestedAt: text('requested_at').notNull(),
    approvedBy: integer('approved_by').references(() => users.id),
    approvedAt: text('approved_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('adjustments_invoice_idx').on(t.invoiceId),
    index('adjustments_status_idx').on(t.status),
    check('adjustments_type_chk', inList(t.type, ['REFUND', 'CORRECTION', 'VOID'])),
    check('adjustments_status_chk', inList(t.status, ['PENDING', 'APPROVED', 'REJECTED'])),
    check('adjustments_amount_chk', sql`${t.amount} <> 0`),
    check('adjustments_reason_chk', sql`length(trim(${t.reason})) > 0`),
  ],
);

// ───────────────────────── Thông báo, nhật ký, cài đặt ─────────────────────────

export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: text('data'),
    studentId: integer('student_id').references(() => students.id),
    dedupeKey: text('dedupe_key'),
    pushStatus: text('push_status').notNull().default('PENDING'),
    readAt: text('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_read_idx').on(t.userId, t.readAt),
    uniqueIndex('notifications_dedupe_uq').on(t.userId, t.type, t.dedupeKey).where(sql`dedupe_key IS NOT NULL`),
    check(
      'notifications_type_chk',
      inList(t.type, ['SCHEDULE', 'ABSENCE', 'RESULT', 'FEE_DUE', 'FEE_OVERDUE', 'SYSTEM']),
    ),
    check('notifications_push_chk', inList(t.pushStatus, ['PENDING', 'SENT', 'FAILED', 'SKIPPED'])),
  ],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    actorUserId: integer('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: integer('entity_id'),
    beforeData: text('before_data'),
    afterData: text('after_data'),
    reason: text('reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_actor_idx').on(t.actorUserId, t.createdAt),
    index('audit_created_idx').on(t.createdAt),
  ],
);

// ───────────────────────── Nhật ký lớp & bài tập ─────────────────────────
// Ảnh/tệp đính kèm nằm ở bảng files: owner_type = 'class_post' | 'homework' | 'homework_submission'.

export const classPosts = sqliteTable(
  'class_posts',
  {
    id: id(),
    classId: integer('class_id')
      .notNull()
      .references(() => classes.id),
    postDate: text('post_date').notNull(),
    content: text('content').notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('class_posts_class_idx').on(t.classId, t.postDate)],
);

export const homework = sqliteTable(
  'homework',
  {
    id: id(),
    classId: integer('class_id')
      .notNull()
      .references(() => classes.id),
    title: text('title').notNull(),
    description: text('description'),
    assignedDate: text('assigned_date').notNull(),
    dueDate: text('due_date').notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('homework_class_idx').on(t.classId, t.dueDate),
    check('homework_dates_chk', sql`${t.dueDate} >= ${t.assignedDate}`),
  ],
);

export const homeworkSubmissions = sqliteTable(
  'homework_submissions',
  {
    id: id(),
    homeworkId: integer('homework_id')
      .notNull()
      .references(() => homework.id),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    note: text('note'),
    submittedBy: integer('submitted_by').references(() => users.id),
    submittedAt: text('submitted_at'),
    result: text('result'),
    teacherComment: text('teacher_comment'),
    reviewedBy: integer('reviewed_by').references(() => users.id),
    reviewedAt: text('reviewed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('homework_submissions_uq').on(t.homeworkId, t.studentId),
    check('homework_submissions_result_chk', sql`${t.result} IS NULL OR ${inList(t.result, ['DONE', 'NOT_DONE'])}`),
  ],
);

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedBy: integer('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});
