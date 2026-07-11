CREATE TABLE `gto_hands` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`schema_version` integer NOT NULL,
	`advisor_version` text NOT NULL,
	`street` text NOT NULL,
	`position` text NOT NULL,
	`spot_json` text NOT NULL,
	`theoretical_json` text NOT NULL,
	`adapted_json` text NOT NULL,
	`table_context_json` text NOT NULL,
	`profiles_json` text NOT NULL,
	`actual_action` text,
	`actual_amount` integer,
	`hero_net` integer,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gto_hands_created_at_idx` ON `gto_hands` (`created_at`);--> statement-breakpoint
CREATE INDEX `gto_hands_street_idx` ON `gto_hands` (`street`);