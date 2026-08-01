CREATE TABLE `tool_path_plans` (
	`project_id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`requirements_json` text NOT NULL,
	`reasons_json` text NOT NULL,
	`milestones_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tool_path_plans_path_check" CHECK("tool_path_plans"."path" in ('DIGISHOW', 'TOUCHDESIGNER', 'COLLABORATIVE')),
	CONSTRAINT "tool_path_plans_requirements_json_check" CHECK(json_valid("tool_path_plans"."requirements_json")),
	CONSTRAINT "tool_path_plans_reasons_json_check" CHECK(json_valid("tool_path_plans"."reasons_json")),
	CONSTRAINT "tool_path_plans_milestones_json_check" CHECK(json_valid("tool_path_plans"."milestones_json"))
);
