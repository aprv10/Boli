CREATE TABLE `quote_events` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`quote_id` text,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`summary` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quote_events_deal_sequence` ON `quote_events` (`deal_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quote_events_quote_type` ON `quote_events` (`quote_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `idx_quote_events_deal_created` ON `quote_events` (`deal_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`version` integer NOT NULL,
	`option_key` text NOT NULL,
	`label` text NOT NULL,
	`rationale` text NOT NULL,
	`lines_json` text NOT NULL,
	`checks_json` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_total_paise` integer NOT NULL,
	`order_total_paise` integer NOT NULL,
	`unit_cost_paise` integer NOT NULL,
	`contribution_margin_bps` integer NOT NULL,
	`intent_hash` text NOT NULL,
	`quote_hash` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`approved_at` text NOT NULL,
	`accepted_at` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quotes_deal_version` ON `quotes` (`deal_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quotes_hash` ON `quotes` (`quote_hash`);--> statement-breakpoint
CREATE INDEX `idx_quotes_deal_status` ON `quotes` (`deal_id`,`status`);