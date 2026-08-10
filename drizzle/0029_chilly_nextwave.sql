CREATE TABLE `agent_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`step_sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`label` text NOT NULL,
	`summary` text NOT NULL,
	`tool_call_id` text,
	`tool_id` text,
	`latency_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_call_id`) REFERENCES `agent_tool_calls`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_steps_kind_check" CHECK("agent_steps"."kind" in ('MODEL_DECISION','TOOL_CALL','TOOL_OBSERVATION','FINAL_RESPONSE','DEGRADED')),
	CONSTRAINT "agent_steps_status_check" CHECK("agent_steps"."status" in ('SUCCEEDED','FAILED','EMPTY','SKIPPED')),
	CONSTRAINT "agent_steps_latency_check" CHECK("agent_steps"."latency_ms" between 0 and 60000),
	CONSTRAINT "agent_steps_label_check" CHECK(length("agent_steps"."label") between 1 and 100),
	CONSTRAINT "agent_steps_summary_check" CHECK(length("agent_steps"."summary") between 1 and 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_steps_turn_sequence_unique` ON `agent_steps` (`turn_id`,`step_sequence`);--> statement-breakpoint
CREATE INDEX `agent_steps_tool_call_idx` ON `agent_steps` (`tool_call_id`);--> statement-breakpoint
CREATE TABLE `agent_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`call_sequence` integer NOT NULL,
	`tool_id` text NOT NULL,
	`tool_version` text NOT NULL,
	`adapter_id` text NOT NULL,
	`input_json` text NOT NULL,
	`output_json` text,
	`status` text NOT NULL,
	`error_code` text,
	`latency_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_tool_calls_status_check" CHECK("agent_tool_calls"."status" in ('SUCCESS','EMPTY','ERROR')),
	CONSTRAINT "agent_tool_calls_latency_check" CHECK("agent_tool_calls"."latency_ms" between 0 and 60000),
	CONSTRAINT "agent_tool_calls_input_json_check" CHECK(json_valid("agent_tool_calls"."input_json") and json_type("agent_tool_calls"."input_json") = 'object'),
	CONSTRAINT "agent_tool_calls_output_json_check" CHECK("agent_tool_calls"."output_json" is null or (json_valid("agent_tool_calls"."output_json") and json_type("agent_tool_calls"."output_json") = 'object')),
	CONSTRAINT "agent_tool_calls_error_check" CHECK(("agent_tool_calls"."status" = 'ERROR' and "agent_tool_calls"."error_code" is not null) or ("agent_tool_calls"."status" <> 'ERROR' and "agent_tool_calls"."error_code" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tool_calls_turn_sequence_unique` ON `agent_tool_calls` (`turn_id`,`call_sequence`);--> statement-breakpoint
CREATE INDEX `agent_tool_calls_tool_created_idx` ON `agent_tool_calls` (`tool_id`,`created_at`);