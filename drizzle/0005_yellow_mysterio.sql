CREATE TABLE `merchant_policy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`version` integer NOT NULL,
	`minimum_margin_bps` integer NOT NULL,
	`maximum_automatic_concession_bps` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_merchant_policy_version` ON `merchant_policy_versions` (`merchant_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_merchant_policy_active` ON `merchant_policy_versions` (`merchant_id`,`status`);--> statement-breakpoint
ALTER TABLE `quote_events` ADD `previous_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `quote_events` ADD `event_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_quote_events_event_hash` ON `quote_events` (`event_hash`);--> statement-breakpoint
ALTER TABLE `quotes` ADD `policy_version` integer DEFAULT 1 NOT NULL;