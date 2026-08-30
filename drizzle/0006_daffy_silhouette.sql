CREATE TABLE `checkout_callbacks` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider_payment_id` text NOT NULL,
	`signature_verified` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `razorpay_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_checkout_callbacks_payment` ON `checkout_callbacks` (`provider_payment_id`);--> statement-breakpoint
CREATE INDEX `idx_checkout_callbacks_order` ON `checkout_callbacks` (`order_id`);--> statement-breakpoint
CREATE TABLE `fulfilment_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`failed_product_id` text NOT NULL,
	`blocked_substitute_product_id` text NOT NULL,
	`status` text NOT NULL,
	`failure_code` text NOT NULL,
	`explanation` text NOT NULL,
	`replacement_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`failed_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocked_substitute_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fulfilment_incidents_deal` ON `fulfilment_incidents` (`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_fulfilment_incidents_status` ON `fulfilment_incidents` (`status`);--> statement-breakpoint
CREATE TABLE `inventory_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_reservations_quote_product` ON `inventory_reservations` (`quote_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_reservations_status_expiry` ON `inventory_reservations` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `payment_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`action_type` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`provider_reference` text,
	`failure_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_actions_idempotency` ON `payment_actions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_payment_actions_deal_type` ON `payment_actions` (`deal_id`,`action_type`);--> statement-breakpoint
CREATE TABLE `razorpay_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_action_id` text NOT NULL,
	`deal_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`quote_hash` text NOT NULL,
	`mandate_hash` text NOT NULL,
	`policy_version` integer NOT NULL,
	`provider_order_id` text NOT NULL,
	`provider` text NOT NULL,
	`checkout_key_id` text,
	`amount_paise` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`payment_action_id`) REFERENCES `payment_actions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_razorpay_orders_action` ON `razorpay_orders` (`payment_action_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_razorpay_orders_provider_id` ON `razorpay_orders` (`provider_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_razorpay_orders_quote` ON `razorpay_orders` (`quote_id`);--> statement-breakpoint
CREATE INDEX `idx_razorpay_orders_deal_status` ON `razorpay_orders` (`deal_id`,`status`);--> statement-breakpoint
CREATE TABLE `razorpay_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider_payment_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`captured_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `razorpay_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_razorpay_payments_provider_id` ON `razorpay_payments` (`provider_payment_id`);--> statement-breakpoint
CREATE INDEX `idx_razorpay_payments_order` ON `razorpay_payments` (`order_id`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`payment_action_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reason` text NOT NULL,
	`provider_refund_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `razorpay_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_action_id`) REFERENCES `payment_actions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_refunds_action` ON `refunds` (`payment_action_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_refunds_provider_id` ON `refunds` (`provider_refund_id`);--> statement-breakpoint
CREATE INDEX `idx_refunds_payment_status` ON `refunds` (`payment_id`,`status`);--> statement-breakpoint
CREATE TABLE `webhook_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`signature_verified` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text NOT NULL,
	`failure_code` text,
	`received_at` text NOT NULL,
	`processed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_inbox_status_received` ON `webhook_inbox` (`status`,`received_at`);--> statement-breakpoint
ALTER TABLE `products` ADD `reserved_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `inventory_version` integer DEFAULT 1 NOT NULL;