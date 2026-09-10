CREATE TABLE `tuning_error_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kb_id` text,
	`subject_id` text,
	`topic` text,
	`error_type` text DEFAULT 'factual_error' NOT NULL,
	`mistake_summary` text NOT NULL,
	`root_cause` text DEFAULT '' NOT NULL,
	`correct_approach` text DEFAULT '' NOT NULL,
	`prevention_rule` text NOT NULL,
	`source_evidence` text DEFAULT '{}' NOT NULL,
	`confidence` text DEFAULT 'unverified' NOT NULL,
	`relevance_metadata` text DEFAULT '{}' NOT NULL,
	`embedding` text DEFAULT '[]' NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`last_occurred_at` text,
	`last_used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kb_id`) REFERENCES `knowledge_bases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `errlesson_user_idx` ON `tuning_error_lessons` (`user_id`);--> statement-breakpoint
CREATE INDEX `errlesson_kb_idx` ON `tuning_error_lessons` (`kb_id`);--> statement-breakpoint
CREATE INDEX `errlesson_user_kb_idx` ON `tuning_error_lessons` (`user_id`,`kb_id`);--> statement-breakpoint
CREATE INDEX `errlesson_status_idx` ON `tuning_error_lessons` (`status`);