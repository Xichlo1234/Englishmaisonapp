ALTER TABLE `invoices` ADD `absence_deduction` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `absence_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `absence_session_total` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `absence_unit_price` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `absence_source_invoice_id` integer;