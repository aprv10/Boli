DROP INDEX `idx_quote_events_quote_type`;--> statement-breakpoint
CREATE INDEX `idx_quote_events_quote_type` ON `quote_events` (`quote_id`,`event_type`);