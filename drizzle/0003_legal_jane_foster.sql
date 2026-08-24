CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`operation` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text NOT NULL,
	`output_json` text,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer NOT NULL,
	`failure_code` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runs_status_created` ON `agent_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `intent_agent_runs` (
	`intent_id` text PRIMARY KEY NOT NULL,
	`agent_run_id` text NOT NULL,
	`review_status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`intent_id`) REFERENCES `purchase_intents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_intent_agent_runs_agent` ON `intent_agent_runs` (`agent_run_id`);