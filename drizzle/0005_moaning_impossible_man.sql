CREATE TABLE `assessment_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`subject_id` text,
	`mode` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`material_excerpt` text DEFAULT '' NOT NULL,
	`material_hash` text DEFAULT '' NOT NULL,
	`prompt_json` text DEFAULT '{}' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`score` integer,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assess_user_idx` ON `assessment_attempts` (`user_id`);--> statement-breakpoint
CREATE INDEX `assess_mode_idx` ON `assessment_attempts` (`user_id`,`mode`);