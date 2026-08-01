CREATE TABLE `agent_project_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`brief_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_project_briefs_revision_check" CHECK("agent_project_briefs"."revision" > 0),
	CONSTRAINT "agent_project_briefs_json_check" CHECK(json_valid("agent_project_briefs"."brief_json") and json_type("agent_project_briefs"."brief_json") = 'object'),
	CONSTRAINT "agent_project_briefs_data_type_check" CHECK("agent_project_briefs"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_project_briefs_student_class_unique` ON `agent_project_briefs` (`student_id`,`class_id`);
--> statement-breakpoint
CREATE INDEX `agent_project_briefs_updated_idx` ON `agent_project_briefs` (`updated_at`);
