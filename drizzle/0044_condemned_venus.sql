CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`structure_json` text NOT NULL,
	`attachment_id` text,
	`tool_call_refs_json` text NOT NULL,
	`turn_id` text,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `agent_artwork_attachments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`,`student_id`,`class_id`) REFERENCES `design_project_tasks`(`id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_messages_id_check" CHECK(length("agent_messages"."id") between 1 and 128),
	CONSTRAINT "agent_messages_role_check" CHECK("agent_messages"."role" in ('user','assistant')),
	CONSTRAINT "agent_messages_content_check" CHECK(length(trim("agent_messages"."content")) between 1 and 32000),
	CONSTRAINT "agent_messages_structure_json_check" CHECK(
      json_valid("agent_messages"."structure_json")
      and json_type("agent_messages"."structure_json") = 'object'
      and json_extract("agent_messages"."structure_json", '$.version') = 1
      and json_extract("agent_messages"."structure_json", '$.kind') = "agent_messages"."role"
    ),
	CONSTRAINT "agent_messages_tool_refs_json_check" CHECK(
      json_valid("agent_messages"."tool_call_refs_json")
      and json_type("agent_messages"."tool_call_refs_json") = 'array'
    ),
	CONSTRAINT "agent_messages_role_shape_check" CHECK(
      ("agent_messages"."role" = 'user' and json_array_length("agent_messages"."tool_call_refs_json") = 0)
      or ("agent_messages"."role" = 'assistant' and "agent_messages"."turn_id" is not null and "agent_messages"."attachment_id" is null)
    ),
	CONSTRAINT "agent_messages_data_type_check" CHECK("agent_messages"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_messages_turn_role_unique` ON `agent_messages` (`turn_id`,`role`);--> statement-breakpoint
CREATE INDEX `agent_messages_task_created_idx` ON `agent_messages` (`task_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_design_project_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`mode` text DEFAULT 'conversation' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "design_project_tasks_title_check" CHECK(length(trim("__new_design_project_tasks"."title")) between 1 and 80),
	CONSTRAINT "design_project_tasks_status_check" CHECK("__new_design_project_tasks"."status" in ('ACTIVE','ARCHIVED')),
	CONSTRAINT "design_project_tasks_mode_check" CHECK("__new_design_project_tasks"."mode" in ('conversation','engineering')),
	CONSTRAINT "design_project_tasks_data_type_check" CHECK("__new_design_project_tasks"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
INSERT INTO `__new_design_project_tasks`("id", "student_id", "class_id", "title", "status", "mode", "pinned", "created_at", "updated_at", "data_type") SELECT "id", "student_id", "class_id", "title", "status", 'conversation', 0, "created_at", "updated_at", "data_type" FROM `design_project_tasks`;--> statement-breakpoint
DROP TABLE `design_project_tasks`;--> statement-breakpoint
ALTER TABLE `__new_design_project_tasks` RENAME TO `design_project_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `design_project_tasks_owner_unique` ON `design_project_tasks` (`id`,`student_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `design_project_tasks_student_updated_idx` ON `design_project_tasks` (`student_id`,`status`,`updated_at`);
