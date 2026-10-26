CREATE TABLE `collection_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`observed_at` text NOT NULL,
	`raw_hash` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`model_version` text,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`sport` text NOT NULL,
	`league` text NOT NULL,
	`start_at` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_start` ON `events` (`start_at`);--> statement-breakpoint
CREATE TABLE `markets` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `markets_event` ON `markets` (`event_id`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `predictions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`market_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`as_of` text NOT NULL,
	`model_version` text,
	`eligibility` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `quote_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `predictions_market_time` ON `predictions` (`market_id`,`as_of`);--> statement-breakpoint
CREATE INDEX `predictions_time` ON `predictions` (`as_of`);--> statement-breakpoint
CREATE TABLE `result_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`offer_id` text,
	`event_id` text,
	`market_id` text,
	`known_at` text NOT NULL,
	`status` text NOT NULL,
	`raw_hash` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `results_source_time` ON `result_revisions` (`source_key`,`known_at`);--> statement-breakpoint
CREATE INDEX `results_market_time` ON `result_revisions` (`market_id`,`known_at`);--> statement-breakpoint
CREATE TABLE `quote_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`market_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`raw_hash` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `snapshots_offer_time` ON `quote_snapshots` (`offer_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `snapshots_market_time` ON `quote_snapshots` (`market_id`,`observed_at`);