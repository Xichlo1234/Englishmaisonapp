CREATE TABLE `class_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`post_date` text NOT NULL,
	`content` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `class_posts_class_idx` ON `class_posts` (`class_id`,`post_date`);--> statement-breakpoint
CREATE TABLE `homework` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`assigned_date` text NOT NULL,
	`due_date` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "homework_dates_chk" CHECK("homework"."due_date" >= "homework"."assigned_date")
);
--> statement-breakpoint
CREATE INDEX `homework_class_idx` ON `homework` (`class_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `homework_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`homework_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`note` text,
	`submitted_by` integer,
	`submitted_at` text,
	`result` text,
	`teacher_comment` text,
	`reviewed_by` integer,
	`reviewed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`homework_id`) REFERENCES `homework`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "homework_submissions_result_chk" CHECK("homework_submissions"."result" IS NULL OR "homework_submissions"."result" IN ('DONE', 'NOT_DONE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `homework_submissions_uq` ON `homework_submissions` (`homework_id`,`student_id`);--> statement-breakpoint
ALTER TABLE `students` ADD `photo_consent` integer DEFAULT true NOT NULL;