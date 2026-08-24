CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`intent_id` text NOT NULL,
	`public_token` text NOT NULL,
	`state` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`intent_id`) REFERENCES `purchase_intents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_deals_public_token` ON `deals` (`public_token`);--> statement-breakpoint
CREATE INDEX `idx_deals_merchant_state_created` ON `deals` (`merchant_id`,`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_slug_unique` ON `merchants` (`slug`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`tags_json` text NOT NULL,
	`unit_price_paise` integer NOT NULL,
	`unit_cost_paise` integer NOT NULL,
	`available_quantity` integer NOT NULL,
	`lead_time_days` integer NOT NULL,
	`active` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_merchant_sku` ON `products` (`merchant_id`,`sku`);--> statement-breakpoint
CREATE INDEX `idx_products_merchant_active` ON `products` (`merchant_id`,`active`);--> statement-breakpoint
CREATE TABLE `purchase_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`raw_text` text NOT NULL,
	`constraints_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_intents_created_at` ON `purchase_intents` (`created_at`);