CREATE TABLE `agent_artwork_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`storage_path` text NOT NULL,
	`digest` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`,`student_id`,`class_id`) REFERENCES `design_project_tasks`(`id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_artwork_attachments_mime_check" CHECK("agent_artwork_attachments"."mime_type" in ('image/png','image/jpeg','image/webp')),
	CONSTRAINT "agent_artwork_attachments_path_check" CHECK(length("agent_artwork_attachments"."storage_path") between 1 and 255),
	CONSTRAINT "agent_artwork_attachments_digest_check" CHECK(length("agent_artwork_attachments"."digest") = 64 and "agent_artwork_attachments"."digest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "agent_artwork_attachments_size_check" CHECK("agent_artwork_attachments"."byte_size" between 1 and 5242880),
	CONSTRAINT "agent_artwork_attachments_dimensions_check" CHECK("agent_artwork_attachments"."width" between 1 and 10000 and "agent_artwork_attachments"."height" between 1 and 10000 and "agent_artwork_attachments"."width" * "agent_artwork_attachments"."height" <= 12000000),
	CONSTRAINT "agent_artwork_attachments_data_type_check" CHECK("agent_artwork_attachments"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_artwork_attachments_turn_unique` ON `agent_artwork_attachments` (`turn_id`);--> statement-breakpoint
CREATE INDEX `agent_artwork_attachments_student_created_idx` ON `agent_artwork_attachments` (`student_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `design_project_tasks_owner_unique` ON `design_project_tasks` (`id`,`student_id`,`class_id`);
