CREATE TABLE `mindmaps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`subject_id` text,
	`title` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'syllabus' NOT NULL,
	`map_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mindmaps_user_idx` ON `mindmaps` (`user_id`);