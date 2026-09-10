CREATE TABLE `knowledge_bases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`subject_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'empty' NOT NULL,
	`doc_count` integer DEFAULT 0 NOT NULL,
	`ready_doc_count` integer DEFAULT 0 NOT NULL,
	`concept_count` integer DEFAULT 0 NOT NULL,
	`profile_json` text DEFAULT '{}' NOT NULL,
	`embedding_source` text DEFAULT 'local' NOT NULL,
	`last_processed_at` text,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `kb_user_idx` ON `knowledge_bases` (`user_id`);--> statement-breakpoint
CREATE INDEX `kb_subject_idx` ON `knowledge_bases` (`subject_id`);--> statement-breakpoint
CREATE TABLE `knowledge_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`kb_id` text NOT NULL,
	`user_id` text NOT NULL,
	`subject_id` text,
	`ord` integer DEFAULT 0 NOT NULL,
	`section` text,
	`content` text NOT NULL,
	`embedding` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kb_id`) REFERENCES `knowledge_bases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `kchunk_kb_idx` ON `knowledge_chunks` (`kb_id`);--> statement-breakpoint
CREATE INDEX `kchunk_doc_idx` ON `knowledge_chunks` (`doc_id`);--> statement-breakpoint
CREATE INDEX `kchunk_user_idx` ON `knowledge_chunks` (`user_id`);--> statement-breakpoint
CREATE TABLE `knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kb_id` text NOT NULL,
	`user_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text DEFAULT 'application/pdf' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`char_count` integer DEFAULT 0 NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`error` text,
	`full_text` text,
	`dedupe_key` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`kb_id`) REFERENCES `knowledge_bases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kdoc_kb_idx` ON `knowledge_documents` (`kb_id`);--> statement-breakpoint
CREATE INDEX `kdoc_user_idx` ON `knowledge_documents` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kdoc_dedupe_unique` ON `knowledge_documents` (`user_id`,`kb_id`,`dedupe_key`);--> statement-breakpoint
CREATE TABLE `tuning_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text DEFAULT 'process_document' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`idem_key` text DEFAULT '' NOT NULL,
	`error` text,
	`next_run_at` text,
	`created_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tjob_user_idx` ON `tuning_jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `tjob_status_idx` ON `tuning_jobs` (`status`,`next_run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tjob_idem_unique` ON `tuning_jobs` (`user_id`,`idem_key`);--> statement-breakpoint
CREATE TABLE `tuning_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`detail_level` text DEFAULT 'medium' NOT NULL,
	`updated_at` text DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
