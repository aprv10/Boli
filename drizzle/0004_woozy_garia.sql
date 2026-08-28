CREATE TABLE `counteroffers` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`source_quote_id` text NOT NULL,
	`proposed_quote_id` text,
	`source_kind` text NOT NULL,
	`buyer_message` text NOT NULL,
	`target_unit_paise` integer NOT NULL,
	`status` text NOT NULL,
	`proposed_option_json` text,
	`checks_json` text NOT NULL,
	`reason_codes_json` text NOT NULL,
	`decision_summary` text NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_counteroffers_deal_created` ON `counteroffers` (`deal_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_counteroffers_deal_status` ON `counteroffers` (`deal_id`,`status`);