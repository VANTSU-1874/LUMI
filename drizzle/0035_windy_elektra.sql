CREATE TABLE `agent_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`event_sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`summary` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_run_events_kind_check" CHECK("agent_run_events"."kind" in ('RUN_CREATED','STATUS_CHANGED','RUN_CLAIMED','STEP','TOOL','APPROVAL','COMPLETION','ERROR','CANCELLED','TOKEN')),
	CONSTRAINT "agent_run_events_label_check" CHECK(length("agent_run_events"."label") between 1 and 100),
	CONSTRAINT "agent_run_events_summary_check" CHECK(length("agent_run_events"."summary") between 1 and 300),
	CONSTRAINT "agent_run_events_payload_check" CHECK(json_valid("agent_run_events"."payload_json") and json_type("agent_run_events"."payload_json") = 'object'),
	CONSTRAINT "agent_run_events_data_type_check" CHECK("agent_run_events"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_events_run_sequence_unique` ON `agent_run_events` (`run_id`,`event_sequence`);--> statement-breakpoint
CREATE INDEX `agent_run_events_kind_created_idx` ON `agent_run_events` (`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`runtime_id` text NOT NULL,
	`runtime_version` text NOT NULL,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`request_json` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text,
	`checkpoint_json` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`last_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`data_type` text NOT NULL,
	FOREIGN KEY (`task_id`,`student_id`,`class_id`) REFERENCES `design_project_tasks`(`id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_runs_status_check" CHECK("agent_runs"."status" in ('QUEUED','RUNNING','WAITING_APPROVAL','COMPLETED','FAILED','CANCELLED')),
	CONSTRAINT "agent_runs_runtime_id_check" CHECK(length("agent_runs"."runtime_id") between 2 and 64),
	CONSTRAINT "agent_runs_runtime_version_check" CHECK(length("agent_runs"."runtime_version") between 1 and 16),
	CONSTRAINT "agent_runs_request_json_check" CHECK(json_valid("agent_runs"."request_json") and json_type("agent_runs"."request_json") = 'object'),
	CONSTRAINT "agent_runs_request_hash_check" CHECK(length("agent_runs"."request_hash") = 64 and "agent_runs"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "agent_runs_response_json_check" CHECK("agent_runs"."response_json" is null or (json_valid("agent_runs"."response_json") and json_type("agent_runs"."response_json") = 'object')),
	CONSTRAINT "agent_runs_checkpoint_json_check" CHECK(json_valid("agent_runs"."checkpoint_json") and json_type("agent_runs"."checkpoint_json") = 'object'),
	CONSTRAINT "agent_runs_idempotency_key_check" CHECK(length("agent_runs"."idempotency_key") between 1 and 128),
	CONSTRAINT "agent_runs_attempt_check" CHECK("agent_runs"."attempt" between 0 and 100),
	CONSTRAINT "agent_runs_error_code_check" CHECK("agent_runs"."last_error_code" is null or ("agent_runs"."last_error_code" not glob '*[^A-Z0-9_]*' and "agent_runs"."last_error_code" glob '[A-Z]*' and length("agent_runs"."last_error_code") between 3 and 64)),
	CONSTRAINT "agent_runs_data_type_check" CHECK("agent_runs"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_student_idempotency_unique` ON `agent_runs` (`student_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_owner_unique` ON `agent_runs` (`id`,`student_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_task_updated_idx` ON `agent_runs` (`task_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_recovery_idx` ON `agent_runs` (`status`,`lease_expires_at`);--> statement-breakpoint
ALTER TABLE `agent_turns` ADD `run_id` text REFERENCES agent_runs(id);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_turns_run_unique` ON `agent_turns` (`run_id`);
