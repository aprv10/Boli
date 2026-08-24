CREATE TABLE `purchase_requirements` (
	`intent_id` text PRIMARY KEY NOT NULL,
	`quantity` integer NOT NULL,
	`max_unit_paise` integer NOT NULL,
	`delivery_locations_json` text NOT NULL,
	`deadline` text NOT NULL,
	FOREIGN KEY (`intent_id`) REFERENCES `purchase_intents`(`id`) ON UPDATE no action ON DELETE no action
);
