CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`project` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memories_created_idx` ON `memories` (`created_at`);--> statement-breakpoint
CREATE INDEX `memories_project_idx` ON `memories` (`project`);--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  memory_id UNINDEXED,
  content,
  tokenize = 'unicode61'
);
