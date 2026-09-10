ALTER TABLE `materials` ADD `mime_type` text;--> statement-breakpoint
ALTER TABLE `materials` ADD `size_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `materials` ADD `raw_blob` blob;