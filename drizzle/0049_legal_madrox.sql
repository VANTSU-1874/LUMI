CREATE TABLE `preview_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`status` text NOT NULL,
	`response_json` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`data_type` text DEFAULT 'DEMONSTRATION_DATA' NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `preview_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "preview_runs_status_check" CHECK("preview_runs"."status" in ('RUNNING','COMPLETED','FAILED')),
	CONSTRAINT "preview_runs_response_check" CHECK("preview_runs"."response_json" is null or (json_valid("preview_runs"."response_json") and json_type("preview_runs"."response_json") = 'object')),
	CONSTRAINT "preview_runs_error_code_check" CHECK("preview_runs"."error_code" is null or ("preview_runs"."error_code" not glob '*[^A-Z0-9_]*' and length("preview_runs"."error_code") between 3 and 64)),
	CONSTRAINT "preview_runs_expiry_check" CHECK("preview_runs"."expires_at" > "preview_runs"."created_at"),
	CONSTRAINT "preview_runs_data_type_check" CHECK("preview_runs"."data_type" = 'DEMONSTRATION_DATA')
);
--> statement-breakpoint
CREATE INDEX `preview_runs_session_created_idx` ON `preview_runs` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `preview_runs_expiry_idx` ON `preview_runs` (`expires_at`);--> statement-breakpoint
CREATE TABLE `preview_scenario_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`run_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text DEFAULT 'DEMONSTRATION_DATA' NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `preview_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "preview_scenario_usage_count_check" CHECK("preview_scenario_usage"."run_count" between 0 and 3),
	CONSTRAINT "preview_scenario_usage_data_type_check" CHECK("preview_scenario_usage"."data_type" = 'DEMONSTRATION_DATA')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preview_scenario_usage_session_scenario_unique` ON `preview_scenario_usage` (`session_id`,`scenario_id`);--> statement-breakpoint
CREATE TABLE `preview_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`data_type` text DEFAULT 'DEMONSTRATION_DATA' NOT NULL,
	CONSTRAINT "preview_sessions_expiry_check" CHECK("preview_sessions"."expires_at" > "preview_sessions"."created_at"),
	CONSTRAINT "preview_sessions_data_type_check" CHECK("preview_sessions"."data_type" = 'DEMONSTRATION_DATA')
);
--> statement-breakpoint
CREATE INDEX `preview_sessions_expiry_idx` ON `preview_sessions` (`expires_at`);