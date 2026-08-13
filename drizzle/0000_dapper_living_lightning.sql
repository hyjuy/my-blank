CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`source_text` text DEFAULT '' NOT NULL,
	`schedule_date` text NOT NULL,
	`start_at` text,
	`end_at` text,
	`due_at` text,
	`duration_minutes` integer DEFAULT 30 NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`schedule_type` text DEFAULT 'flexible' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `schedules_user_day_status_idx` ON `schedules` (`user_id`,`schedule_date`,`status`);--> statement-breakpoint
CREATE INDEX `schedules_user_start_idx` ON `schedules` (`user_id`,`start_at`);