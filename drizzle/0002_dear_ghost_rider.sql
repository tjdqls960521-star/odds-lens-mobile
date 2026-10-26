CREATE TABLE `pick_slips` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pick_slips_created` ON `pick_slips` (`created_at`);