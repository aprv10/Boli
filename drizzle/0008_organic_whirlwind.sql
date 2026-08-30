PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_checkout_callbacks` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider_payment_id` text NOT NULL,
	`signature_verified` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `razorpay_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "checkout_callbacks_signature_boolean" CHECK("__new_checkout_callbacks"."signature_verified" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_checkout_callbacks`("id", "order_id", "provider_payment_id", "signature_verified", "payload_hash", "created_at") SELECT "id", "order_id", "provider_payment_id", "signature_verified", "payload_hash", "created_at" FROM `checkout_callbacks`;--> statement-breakpoint
DROP TABLE `checkout_callbacks`;--> statement-breakpoint
ALTER TABLE `__new_checkout_callbacks` RENAME TO `checkout_callbacks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_checkout_callbacks_payment` ON `checkout_callbacks` (`provider_payment_id`);--> statement-breakpoint
CREATE INDEX `idx_checkout_callbacks_order` ON `checkout_callbacks` (`order_id`);--> statement-breakpoint
CREATE TABLE `__new_fulfilment_incidents` (
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
	FOREIGN KEY (`blocked_substitute_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfilment_incidents_status_valid" CHECK("__new_fulfilment_incidents"."status" IN ('replacement_offered', 'buyer_declined', 'refund_pending', 'refunded'))
);
--> statement-breakpoint
INSERT INTO `__new_fulfilment_incidents`("id", "deal_id", "quote_id", "failed_product_id", "blocked_substitute_product_id", "status", "failure_code", "explanation", "replacement_json", "created_at", "updated_at") SELECT "id", "deal_id", "quote_id", "failed_product_id", "blocked_substitute_product_id", "status", "failure_code", "explanation", "replacement_json", "created_at", "updated_at" FROM `fulfilment_incidents`;--> statement-breakpoint
DROP TABLE `fulfilment_incidents`;--> statement-breakpoint
ALTER TABLE `__new_fulfilment_incidents` RENAME TO `fulfilment_incidents`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fulfilment_incidents_deal` ON `fulfilment_incidents` (`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_fulfilment_incidents_status` ON `fulfilment_incidents` (`status`);--> statement-breakpoint
CREATE TABLE `__new_inventory_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_reservations_quantity_positive" CHECK("__new_inventory_reservations"."quantity" > 0),
	CONSTRAINT "inventory_reservations_status_valid" CHECK("__new_inventory_reservations"."status" IN ('reserved', 'consumed', 'released', 'lost'))
);
--> statement-breakpoint
INSERT INTO `__new_inventory_reservations`("id", "quote_id", "product_id", "quantity", "status", "expires_at", "created_at", "updated_at") SELECT "id", "quote_id", "product_id", "quantity", "status", "expires_at", "created_at", "updated_at" FROM `inventory_reservations`;--> statement-breakpoint
DROP TABLE `inventory_reservations`;--> statement-breakpoint
ALTER TABLE `__new_inventory_reservations` RENAME TO `inventory_reservations`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_reservations_quote_product` ON `inventory_reservations` (`quote_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_reservations_status_expiry` ON `inventory_reservations` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_payment_actions` (
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
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_actions_amount_positive" CHECK("__new_payment_actions"."amount_paise" > 0),
	CONSTRAINT "payment_actions_type_valid" CHECK("__new_payment_actions"."action_type" IN ('create_order', 'refund')),
	CONSTRAINT "payment_actions_status_valid" CHECK("__new_payment_actions"."status" IN ('pending', 'succeeded', 'failed', 'reconciliation_required')),
	CONSTRAINT "payment_actions_provider_valid" CHECK("__new_payment_actions"."provider" IN ('razorpay', 'demo'))
);
--> statement-breakpoint
INSERT INTO `__new_payment_actions`("id", "deal_id", "quote_id", "idempotency_key", "action_type", "amount_paise", "status", "provider", "provider_reference", "failure_code", "created_at", "updated_at") SELECT "id", "deal_id", "quote_id", "idempotency_key", "action_type", "amount_paise", "status", "provider", "provider_reference", "failure_code", "created_at", "updated_at" FROM `payment_actions`;--> statement-breakpoint
DROP TABLE `payment_actions`;--> statement-breakpoint
ALTER TABLE `__new_payment_actions` RENAME TO `payment_actions`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_actions_idempotency` ON `payment_actions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_payment_actions_deal_type` ON `payment_actions` (`deal_id`,`action_type`);--> statement-breakpoint
CREATE TABLE `__new_razorpay_orders` (
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
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "razorpay_orders_policy_version_positive" CHECK("__new_razorpay_orders"."policy_version" > 0),
	CONSTRAINT "razorpay_orders_amount_positive" CHECK("__new_razorpay_orders"."amount_paise" > 0),
	CONSTRAINT "razorpay_orders_currency_inr" CHECK("__new_razorpay_orders"."currency" = 'INR'),
	CONSTRAINT "razorpay_orders_provider_valid" CHECK("__new_razorpay_orders"."provider" IN ('razorpay', 'demo')),
	CONSTRAINT "razorpay_orders_status_valid" CHECK("__new_razorpay_orders"."status" IN ('created', 'paid', 'refund_pending', 'refunded'))
);
--> statement-breakpoint
INSERT INTO `__new_razorpay_orders`("id", "payment_action_id", "deal_id", "quote_id", "quote_hash", "mandate_hash", "policy_version", "provider_order_id", "provider", "checkout_key_id", "amount_paise", "currency", "status", "created_at", "updated_at") SELECT "id", "payment_action_id", "deal_id", "quote_id", "quote_hash", "mandate_hash", "policy_version", "provider_order_id", "provider", "checkout_key_id", "amount_paise", "currency", "status", "created_at", "updated_at" FROM `razorpay_orders`;--> statement-breakpoint
DROP TABLE `razorpay_orders`;--> statement-breakpoint
ALTER TABLE `__new_razorpay_orders` RENAME TO `razorpay_orders`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_razorpay_orders_action` ON `razorpay_orders` (`payment_action_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_razorpay_orders_provider_id` ON `razorpay_orders` (`provider_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_razorpay_orders_quote` ON `razorpay_orders` (`quote_id`);--> statement-breakpoint
CREATE INDEX `idx_razorpay_orders_deal_status` ON `razorpay_orders` (`deal_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_razorpay_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider_payment_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`captured_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `razorpay_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "razorpay_payments_amount_positive" CHECK("__new_razorpay_payments"."amount_paise" > 0),
	CONSTRAINT "razorpay_payments_currency_inr" CHECK("__new_razorpay_payments"."currency" = 'INR'),
	CONSTRAINT "razorpay_payments_status_valid" CHECK("__new_razorpay_payments"."status" IN ('captured', 'partially_refunded', 'refunded'))
);
--> statement-breakpoint
INSERT INTO `__new_razorpay_payments`("id", "order_id", "provider_payment_id", "amount_paise", "currency", "status", "captured_at", "created_at") SELECT "id", "order_id", "provider_payment_id", "amount_paise", "currency", "status", "captured_at", "created_at" FROM `razorpay_payments`;--> statement-breakpoint
DROP TABLE `razorpay_payments`;--> statement-breakpoint
ALTER TABLE `__new_razorpay_payments` RENAME TO `razorpay_payments`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_razorpay_payments_provider_id` ON `razorpay_payments` (`provider_payment_id`);--> statement-breakpoint
CREATE INDEX `idx_razorpay_payments_order` ON `razorpay_payments` (`order_id`);--> statement-breakpoint
CREATE TABLE `__new_refunds` (
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
	FOREIGN KEY (`payment_action_id`) REFERENCES `payment_actions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refunds_amount_positive" CHECK("__new_refunds"."amount_paise" > 0),
	CONSTRAINT "refunds_status_valid" CHECK("__new_refunds"."status" IN ('pending', 'processed', 'failed', 'reconciliation_required'))
);
--> statement-breakpoint
INSERT INTO `__new_refunds`("id", "payment_id", "payment_action_id", "amount_paise", "reason", "provider_refund_id", "status", "created_at", "updated_at") SELECT "id", "payment_id", "payment_action_id", "amount_paise", "reason", "provider_refund_id", "status", "created_at", "updated_at" FROM `refunds`;--> statement-breakpoint
DROP TABLE `refunds`;--> statement-breakpoint
ALTER TABLE `__new_refunds` RENAME TO `refunds`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_refunds_action` ON `refunds` (`payment_action_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_refunds_provider_id` ON `refunds` (`provider_refund_id`);--> statement-breakpoint
CREATE INDEX `idx_refunds_payment_status` ON `refunds` (`payment_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_webhook_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`signature_verified` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text NOT NULL,
	`failure_code` text,
	`received_at` text NOT NULL,
	`processed_at` text,
	CONSTRAINT "webhook_inbox_signature_boolean" CHECK("__new_webhook_inbox"."signature_verified" IN (0, 1)),
	CONSTRAINT "webhook_inbox_status_valid" CHECK("__new_webhook_inbox"."status" IN ('received', 'processed', 'rejected'))
);
--> statement-breakpoint
INSERT INTO `__new_webhook_inbox`("id", "event_type", "signature_verified", "payload_hash", "status", "failure_code", "received_at", "processed_at") SELECT "id", "event_type", "signature_verified", "payload_hash", "status", "failure_code", "received_at", "processed_at" FROM `webhook_inbox`;--> statement-breakpoint
DROP TABLE `webhook_inbox`;--> statement-breakpoint
ALTER TABLE `__new_webhook_inbox` RENAME TO `webhook_inbox`;--> statement-breakpoint
CREATE INDEX `idx_webhook_inbox_status_received` ON `webhook_inbox` (`status`,`received_at`);