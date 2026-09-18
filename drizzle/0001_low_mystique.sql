CREATE TABLE `bot_errors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegram_id` varchar(32),
	`source_url` varchar(2048),
	`stage` varchar(64) NOT NULL,
	`message` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bot_errors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bot_jobs` (
	`id` varchar(24) NOT NULL,
	`telegram_id` varchar(32) NOT NULL,
	`source_url` varchar(2048) NOT NULL,
	`platform` varchar(24) NOT NULL,
	`status` enum('inspecting','ready','downloading','sent','cancelled','failed','expired') NOT NULL DEFAULT 'inspecting',
	`choices_json` text,
	`selected_choice` varchar(16),
	`cancel_requested` boolean NOT NULL DEFAULT false,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bot_owners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegram_id` varchar(32) NOT NULL,
	`role` enum('primary','owner') NOT NULL DEFAULT 'owner',
	`added_at` timestamp NOT NULL DEFAULT (now()),
	`added_by_telegram_id` varchar(32),
	CONSTRAINT `bot_owners_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_owners_telegram_id_unique` UNIQUE(`telegram_id`)
);
--> statement-breakpoint
CREATE TABLE `bot_settings` (
	`id` int NOT NULL,
	`max_users` int NOT NULL DEFAULT 100,
	`cleanup_inactive_days` int NOT NULL DEFAULT 30,
	`cleanup_temp_minutes` int NOT NULL DEFAULT 60,
	`broadcast_rate_per_second` int NOT NULL DEFAULT 20,
	`notify_new_users` boolean NOT NULL DEFAULT true,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `processed_telegram_updates` (
	`update_id` int NOT NULL,
	`processed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `processed_telegram_updates_update_id` PRIMARY KEY(`update_id`)
);
--> statement-breakpoint
CREATE TABLE `telegram_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegram_id` varchar(32) NOT NULL,
	`username` varchar(64),
	`display_name` varchar(160) NOT NULL,
	`language_code` varchar(16),
	`status` enum('active','blocked') NOT NULL DEFAULT 'active',
	`first_seen_at` timestamp NOT NULL DEFAULT (now()),
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	`last_activity_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_users_telegram_id_unique` UNIQUE(`telegram_id`)
);
--> statement-breakpoint
CREATE INDEX `bot_errors_created_idx` ON `bot_errors` (`created_at`);--> statement-breakpoint
CREATE INDEX `bot_jobs_expiry_idx` ON `bot_jobs` (`expires_at`);--> statement-breakpoint
CREATE INDEX `bot_jobs_user_status_idx` ON `bot_jobs` (`telegram_id`,`status`);--> statement-breakpoint
CREATE INDEX `telegram_users_activity_idx` ON `telegram_users` (`last_activity_at`);--> statement-breakpoint
CREATE INDEX `telegram_users_status_idx` ON `telegram_users` (`status`);