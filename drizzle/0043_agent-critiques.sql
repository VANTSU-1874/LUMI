CREATE TABLE `agent_critiques` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`course_id` text NOT NULL,
	`artwork_id` text NOT NULL,
	`framework_id` text NOT NULL,
	`framework_version` text NOT NULL,
	`dimensions_json` text NOT NULL,
	`closure_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`artwork_id`,`turn_id`,`student_id`,`class_id`,`data_type`) REFERENCES `agent_artwork_attachments`(`id`,`turn_id`,`student_id`,`class_id`,`data_type`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_critiques_course_id_check" CHECK(length("agent_critiques"."course_id") between 1 and 64 and "agent_critiques"."course_id" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "agent_critiques_framework_check" CHECK("agent_critiques"."framework_id" = 'critique-framework-five-plus-closure' and "agent_critiques"."framework_version" = '1.0'),
	CONSTRAINT "agent_critiques_dimensions_json_check" CHECK(json_valid("agent_critiques"."dimensions_json") and json_type("agent_critiques"."dimensions_json") = 'array' and json_array_length("agent_critiques"."dimensions_json") = 5),
	CONSTRAINT "agent_critiques_closure_json_check" CHECK(json_valid("agent_critiques"."closure_json") and json_type("agent_critiques"."closure_json") = 'object' and json_type("agent_critiques"."closure_json", '$.established') = 'text' and json_type("agent_critiques"."closure_json", '$.nextStep') = 'text'),
	CONSTRAINT "agent_critiques_data_type_check" CHECK("agent_critiques"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_critiques_turn_unique` ON `agent_critiques` (`turn_id`);--> statement-breakpoint
CREATE INDEX `agent_critiques_owner_course_created_idx` ON `agent_critiques` (`student_id`,`class_id`,`course_id`,`data_type`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_artwork_attachments_critique_owner_unique` ON `agent_artwork_attachments` (`id`,`turn_id`,`student_id`,`class_id`,`data_type`);