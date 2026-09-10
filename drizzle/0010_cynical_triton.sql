CREATE TABLE `communities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`subject` text,
	`created_by` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `community_creator_idx` ON `communities` (`created_by`);--> statement-breakpoint
CREATE TABLE `community_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`helpful` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `community_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canswer_question_idx` ON `community_answers` (`question_id`);--> statement-breakpoint
CREATE TABLE `community_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` text,
	`max_uses` integer DEFAULT 0 NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invite_community_idx` ON `community_invites` (`community_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_unique` ON `community_invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `community_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`raw_blob` blob,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cmat_community_idx` ON `community_materials` (`community_id`);--> statement-breakpoint
CREATE TABLE `community_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_unique` ON `community_memberships` (`community_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `membership_community_idx` ON `community_memberships` (`community_id`);--> statement-breakpoint
CREATE INDEX `membership_user_idx` ON `community_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `community_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`subject` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cquestion_community_idx` ON `community_questions` (`community_id`);