CREATE TABLE `assessment_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assessment_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`weighted_average` real,
	`classification` text,
	`teacher_comment` text,
	`computed_at` text,
	`updated_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_results_uq` ON `assessment_results` (`assessment_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `assessment_results_student_idx` ON `assessment_results` (`student_id`);--> statement-breakpoint
CREATE TABLE `assessment_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`criteria_ids` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_types_code_unique` ON `assessment_types` (`code`);--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`assessment_type_id` integer NOT NULL,
	`lesson_id` integer,
	`title` text NOT NULL,
	`assessed_on` text NOT NULL,
	`config_snapshot` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`published_at` text,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assessment_type_id`) REFERENCES `assessment_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assessments_status_chk" CHECK("assessments"."status" IN ('DRAFT', 'PUBLISHED'))
);
--> statement-breakpoint
CREATE INDEX `assessments_class_date_idx` ON `assessments` (`class_id`,`assessed_on`);--> statement-breakpoint
CREATE TABLE `attendance_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`enrollment_id` integer,
	`status` text NOT NULL,
	`late_minutes` integer,
	`note` text,
	`marked_by` integer NOT NULL,
	`marked_at` text NOT NULL,
	`updated_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_id`) REFERENCES `class_enrollments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attendance_status_chk" CHECK("attendance_records"."status" IN ('PRESENT', 'EXCUSED', 'UNEXCUSED', 'LATE')),
	CONSTRAINT "attendance_late_chk" CHECK("attendance_records"."late_minutes" IS NULL OR "attendance_records"."late_minutes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_lesson_student_uq` ON `attendance_records` (`lesson_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `attendance_student_idx` ON `attendance_records` (`student_id`,`lesson_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`before_data` text,
	`after_data` text,
	`reason` text,
	`ip` text,
	`user_agent` text,
	`request_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `class_enrollments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`class_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`end_reason` text,
	`transferred_from_id` integer,
	`note` text,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transferred_from_id`) REFERENCES `class_enrollments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "enrollments_status_chk" CHECK("class_enrollments"."status" IN ('ACTIVE', 'ENDED')),
	CONSTRAINT "enrollments_dates_chk" CHECK("class_enrollments"."end_date" IS NULL OR "class_enrollments"."end_date" >= "class_enrollments"."start_date"),
	CONSTRAINT "enrollments_reason_chk" CHECK("class_enrollments"."end_reason" IS NULL OR "class_enrollments"."end_reason" IN ('TRANSFER', 'PAUSE', 'DROP', 'CLASS_CLOSED', 'COMPLETED'))
);
--> statement-breakpoint
CREATE INDEX `enrollments_class_status_idx` ON `class_enrollments` (`class_id`,`status`);--> statement-breakpoint
CREATE INDEX `enrollments_student_status_idx` ON `class_enrollments` (`student_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_active_uq` ON `class_enrollments` (`student_id`,`class_id`) WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE TABLE `classes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_code` text NOT NULL,
	`name` text NOT NULL,
	`english_level` text,
	`main_teacher_id` integer,
	`max_students` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`default_fee_plan_id` integer,
	`notes` text,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`closed_at` text,
	`deleted_at` text,
	FOREIGN KEY (`main_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_fee_plan_id`) REFERENCES `fee_plans`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "classes_status_chk" CHECK("classes"."status" IN ('PLANNED', 'OPEN', 'CLOSED')),
	CONSTRAINT "classes_max_chk" CHECK("classes"."max_students" > 0),
	CONSTRAINT "classes_dates_chk" CHECK("classes"."end_date" IS NULL OR "classes"."end_date" >= "classes"."start_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classes_class_code_unique` ON `classes` (`class_code`);--> statement-breakpoint
CREATE INDEX `classes_status_idx` ON `classes` (`status`);--> statement-breakpoint
CREATE INDEX `classes_teacher_idx` ON `classes` (`main_teacher_id`);--> statement-breakpoint
CREATE TABLE `device_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`fcm_token` text NOT NULL,
	`platform` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_tokens_platform_chk" CHECK("device_tokens"."platform" IN ('ANDROID', 'IOS'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_tokens_fcm_token_unique` ON `device_tokens` (`fcm_token`);--> statement-breakpoint
CREATE INDEX `device_tokens_user_idx` ON `device_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `fee_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`billing_type` text NOT NULL,
	`amount` integer NOT NULL,
	`session_count` integer,
	`english_level` text,
	`is_active` integer DEFAULT true NOT NULL,
	`description` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "fee_plans_type_chk" CHECK("fee_plans"."billing_type" IN ('MONTHLY', 'COURSE', 'PER_SESSION')),
	CONSTRAINT "fee_plans_amount_chk" CHECK("fee_plans"."amount" >= 0),
	CONSTRAINT "fee_plans_sessions_chk" CHECK("fee_plans"."billing_type" <> 'PER_SESSION' OR ("fee_plans"."session_count" IS NOT NULL AND "fee_plans"."session_count" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fee_plans_code_unique` ON `fee_plans` (`code`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`r2_key` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`category` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` integer NOT NULL,
	`visibility` text DEFAULT 'STAFF' NOT NULL,
	`uploaded_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "files_category_chk" CHECK("files"."category" IN ('STUDENT_PHOTO', 'AVATAR', 'DOCUMENT', 'ATTACHMENT')),
	CONSTRAINT "files_visibility_chk" CHECK("files"."visibility" IN ('STAFF', 'CLASS', 'OWNER_LINKED')),
	CONSTRAINT "files_size_chk" CHECK("files"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_r2_key_unique` ON `files` (`r2_key`);--> statement-breakpoint
CREATE INDEX `files_owner_idx` ON `files` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `grades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assessment_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`criterion_id` integer NOT NULL,
	`score` real NOT NULL,
	`graded_by` integer NOT NULL,
	`graded_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criterion_id`) REFERENCES `grading_criteria`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`graded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "grades_score_chk" CHECK("grades"."score" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grades_uq` ON `grades` (`assessment_id`,`student_id`,`criterion_id`);--> statement-breakpoint
CREATE INDEX `grades_student_idx` ON `grades` (`student_id`);--> statement-breakpoint
CREATE TABLE `grading_criteria` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`max_score` real DEFAULT 10 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "criteria_weight_chk" CHECK("grading_criteria"."weight" > 0),
	CONSTRAINT "criteria_max_chk" CHECK("grading_criteria"."max_score" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grading_criteria_code_unique` ON `grading_criteria` (`code`);--> statement-breakpoint
CREATE TABLE `guardians` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guardians_user_id_unique` ON `guardians` (`user_id`);--> statement-breakpoint
CREATE INDEX `guardians_phone_idx` ON `guardians` (`phone`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_code` text NOT NULL,
	`student_id` integer NOT NULL,
	`student_fee_plan_id` integer,
	`period_label` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`sessions_purchased` integer,
	`gross_amount` integer NOT NULL,
	`discount_amount` integer DEFAULT 0 NOT NULL,
	`amount_due` integer NOT NULL,
	`amount_paid` integer DEFAULT 0 NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`note` text,
	`issued_at` text,
	`cancelled_at` text,
	`cancel_reason` text,
	`created_by` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_fee_plan_id`) REFERENCES `student_fee_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoices_status_chk" CHECK("invoices"."status" IN ('DRAFT', 'UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED')),
	CONSTRAINT "invoices_amounts_chk" CHECK("invoices"."gross_amount" >= 0 AND "invoices"."discount_amount" >= 0 AND "invoices"."amount_due" >= 0),
	CONSTRAINT "invoices_due_calc_chk" CHECK("invoices"."amount_due" = "invoices"."gross_amount" - "invoices"."discount_amount"),
	CONSTRAINT "invoices_paid_chk" CHECK("invoices"."amount_paid" >= 0 AND "invoices"."amount_paid" <= "invoices"."amount_due")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_code_unique` ON `invoices` (`invoice_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_period_uq` ON `invoices` (`student_id`,`student_fee_plan_id`,`period_label`) WHERE status <> 'CANCELLED';--> statement-breakpoint
CREATE INDEX `invoices_status_idx` ON `invoices` (`status`);--> statement-breakpoint
CREATE INDEX `invoices_due_idx` ON `invoices` (`due_date`);--> statement-breakpoint
CREATE INDEX `invoices_student_idx` ON `invoices` (`student_id`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`schedule_id` integer,
	`lesson_date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`teacher_id` integer NOT NULL,
	`room_id` integer,
	`status` text DEFAULT 'SCHEDULED' NOT NULL,
	`cancel_reason` text,
	`topic` text,
	`attendance_status` text DEFAULT 'NOT_STARTED' NOT NULL,
	`attendance_submitted_by` integer,
	`attendance_submitted_at` text,
	`attendance_locked_at` text,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attendance_submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lessons_status_chk" CHECK("lessons"."status" IN ('SCHEDULED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "lessons_att_status_chk" CHECK("lessons"."attendance_status" IN ('NOT_STARTED', 'DRAFT', 'SUBMITTED', 'LOCKED')),
	CONSTRAINT "lessons_time_chk" CHECK("lessons"."start_time" < "lessons"."end_time")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lessons_class_slot_uq` ON `lessons` (`class_id`,`lesson_date`,`start_time`);--> statement-breakpoint
CREATE INDEX `lessons_date_idx` ON `lessons` (`lesson_date`);--> statement-breakpoint
CREATE INDEX `lessons_teacher_date_idx` ON `lessons` (`teacher_id`,`lesson_date`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`data` text,
	`student_id` integer,
	`dedupe_key` text,
	`push_status` text DEFAULT 'PENDING' NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notifications_type_chk" CHECK("notifications"."type" IN ('SCHEDULE', 'ABSENCE', 'RESULT', 'FEE_DUE', 'FEE_OVERDUE', 'SYSTEM')),
	CONSTRAINT "notifications_push_chk" CHECK("notifications"."push_status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED'))
);
--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_uq` ON `notifications` (`user_id`,`type`,`dedupe_key`) WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE TABLE `payment_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`adjustment_code` text NOT NULL,
	`invoice_id` integer NOT NULL,
	`payment_id` integer,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`requested_by` integer NOT NULL,
	`requested_at` text NOT NULL,
	`approved_by` integer,
	`approved_at` text,
	`decision_note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "adjustments_type_chk" CHECK("payment_adjustments"."type" IN ('REFUND', 'CORRECTION', 'VOID')),
	CONSTRAINT "adjustments_status_chk" CHECK("payment_adjustments"."status" IN ('PENDING', 'APPROVED', 'REJECTED')),
	CONSTRAINT "adjustments_amount_chk" CHECK("payment_adjustments"."amount" <> 0),
	CONSTRAINT "adjustments_reason_chk" CHECK(length(trim("payment_adjustments"."reason")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_adjustments_adjustment_code_unique` ON `payment_adjustments` (`adjustment_code`);--> statement-breakpoint
CREATE INDEX `adjustments_invoice_idx` ON `payment_adjustments` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `adjustments_status_idx` ON `payment_adjustments` (`status`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_code` text NOT NULL,
	`invoice_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`method` text NOT NULL,
	`reference_no` text,
	`paid_at` text NOT NULL,
	`received_by` integer NOT NULL,
	`note` text,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_amount_chk" CHECK("payments"."amount" > 0),
	CONSTRAINT "payments_method_chk" CHECK("payments"."method" IN ('CASH', 'BANK_TRANSFER', 'OTHER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_payment_code_unique` ON `payments` (`payment_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idempotency_key_unique` ON `payments` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `payments_invoice_idx` ON `payments` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `payments_paid_at_idx` ON `payments` (`paid_at`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_code_unique` ON `permissions` (`code`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` integer NOT NULL,
	`permission_id` integer NOT NULL,
	PRIMARY KEY(`role_id`, `permission_id`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`is_system` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_code_unique` ON `roles` (`code`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`capacity` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "rooms_capacity_chk" CHECK("rooms"."capacity" IS NULL OR "rooms"."capacity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_name_unique` ON `rooms` (`name`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`shift_id` integer NOT NULL,
	`weekday` integer NOT NULL,
	`teacher_id` integer NOT NULL,
	`room_id` integer,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedules_weekday_chk" CHECK("schedules"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "schedules_dates_chk" CHECK("schedules"."effective_to" IS NULL OR "schedules"."effective_to" >= "schedules"."effective_from")
);
--> statement-breakpoint
CREATE INDEX `schedules_class_idx` ON `schedules` (`class_id`);--> statement-breakpoint
CREATE INDEX `schedules_teacher_idx` ON `schedules` (`teacher_id`,`weekday`);--> statement-breakpoint
CREATE INDEX `schedules_room_idx` ON `schedules` (`room_id`,`weekday`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`client` text NOT NULL,
	`user_agent` text,
	`ip` text,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`revoke_reason` text,
	`replaced_by_id` integer,
	`family_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sessions_client_chk" CHECK("sessions"."client" IN ('WEB', 'MOBILE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_refresh_token_hash_unique` ON `sessions` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_family_idx` ON `sessions` (`family_id`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "shifts_time_chk" CHECK("shifts"."start_time" < "shifts"."end_time")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_name_unique` ON `shifts` (`name`);--> statement-breakpoint
CREATE TABLE `student_fee_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`fee_plan_id` integer NOT NULL,
	`class_id` integer,
	`custom_amount` integer,
	`discount_type` text DEFAULT 'NONE' NOT NULL,
	`discount_value` integer DEFAULT 0 NOT NULL,
	`discount_reason` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fee_plan_id`) REFERENCES `fee_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sfp_discount_type_chk" CHECK("student_fee_plans"."discount_type" IN ('NONE', 'AMOUNT', 'PERCENT')),
	CONSTRAINT "sfp_discount_value_chk" CHECK("student_fee_plans"."discount_value" >= 0),
	CONSTRAINT "sfp_percent_chk" CHECK("student_fee_plans"."discount_type" <> 'PERCENT' OR "student_fee_plans"."discount_value" <= 100),
	CONSTRAINT "sfp_custom_amount_chk" CHECK("student_fee_plans"."custom_amount" IS NULL OR "student_fee_plans"."custom_amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `student_fee_plans_student_idx` ON `student_fee_plans` (`student_id`);--> statement-breakpoint
CREATE TABLE `student_guardians` (
	`student_id` integer NOT NULL,
	`guardian_id` integer NOT NULL,
	`relationship` text DEFAULT 'OTHER' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`receive_notifications` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`student_id`, `guardian_id`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guardian_id`) REFERENCES `guardians`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "student_guardians_rel_chk" CHECK("student_guardians"."relationship" IN ('FATHER', 'MOTHER', 'OTHER'))
);
--> statement-breakpoint
CREATE INDEX `student_guardians_guardian_idx` ON `student_guardians` (`guardian_id`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_code` text,
	`full_name` text NOT NULL,
	`full_name_search` text NOT NULL,
	`date_of_birth` text,
	`gender` text,
	`address` text,
	`school_name` text,
	`school_grade` text,
	`start_date` text NOT NULL,
	`english_level` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`status_before_archive` text,
	`pause_until` text,
	`needs_attention` integer DEFAULT false NOT NULL,
	`attention_note` text,
	`notes` text,
	`photo_file_id` integer,
	`user_id` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`photo_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "students_status_chk" CHECK("students"."status" IN ('ACTIVE', 'PAUSED', 'DROPPED', 'GRADUATED', 'ARCHIVED')),
	CONSTRAINT "students_gender_chk" CHECK("students"."gender" IS NULL OR "students"."gender" IN ('MALE', 'FEMALE', 'OTHER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_student_code_unique` ON `students` (`student_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `students_user_id_unique` ON `students` (`user_id`);--> statement-breakpoint
CREATE INDEX `students_status_idx` ON `students` (`status`);--> statement-breakpoint
CREATE INDEX `students_name_search_idx` ON `students` (`full_name_search`);--> statement-breakpoint
CREATE INDEX `students_level_idx` ON `students` (`english_level`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` integer,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `teachers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`teacher_code` text,
	`full_name` text NOT NULL,
	`phone` text,
	`email` text,
	`specialty` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`hired_date` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "teachers_status_chk" CHECK("teachers"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teachers_user_id_unique` ON `teachers` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `teachers_teacher_code_unique` ON `teachers` (`teacher_code`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`email` text,
	`phone` text,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`password_changed_at` text,
	`avatar_file_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "users_status_chk" CHECK("users"."status" IN ('ACTIVE', 'LOCKED', 'DISABLED')),
	CONSTRAINT "users_identity_chk" CHECK("users"."email" IS NOT NULL OR "users"."phone" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_unique` ON `users` (`phone`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role_id`);--> statement-breakpoint
CREATE INDEX `users_status_idx` ON `users` (`status`);