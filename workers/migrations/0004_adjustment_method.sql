ALTER TABLE `payment_adjustments` ADD `method` text;--> statement-breakpoint
UPDATE `payment_adjustments` SET `method` = (SELECT p.`method` FROM `payments` p WHERE p.`id` = `payment_adjustments`.`payment_id`) WHERE `method` IS NULL AND `payment_id` IS NOT NULL;--> statement-breakpoint
UPDATE `payment_adjustments` SET `method` = coalesce((SELECT p.`method` FROM `payments` p WHERE p.`invoice_id` = `payment_adjustments`.`invoice_id` ORDER BY p.`paid_at` DESC, p.`id` DESC LIMIT 1), 'CASH') WHERE `method` IS NULL;
