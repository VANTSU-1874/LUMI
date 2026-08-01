PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_runtime_events` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`event_sequence` integer NOT NULL,
	`runtime_id` text NOT NULL,
	`runtime_version` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`label` text NOT NULL,
	`summary` text NOT NULL,
	`tool_call_id` text,
	`tool_id` text,
	`source_ids_json` text NOT NULL,
	`policy_rule` text,
	`error_code` text,
	`model_provider` text,
	`model_id` text,
	`usage_status` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`latency_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_call_id`) REFERENCES `agent_tool_calls`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_runtime_events_kind_check" CHECK("__new_agent_runtime_events"."kind" in ('CONTEXT_PREPARATION','RETRIEVAL','POLICY_CHECK','MODEL_DECISION','TOOL_CALL','TOOL_OBSERVATION','SOURCE_SELECTION','PERSISTENCE','FINAL_RESPONSE','DEGRADED')),
	CONSTRAINT "agent_runtime_events_status_check" CHECK("__new_agent_runtime_events"."status" in ('SUCCEEDED','FAILED','EMPTY','SKIPPED')),
	CONSTRAINT "agent_runtime_events_runtime_id_check" CHECK(length("__new_agent_runtime_events"."runtime_id") between 2 and 64),
	CONSTRAINT "agent_runtime_events_runtime_version_check" CHECK(length("__new_agent_runtime_events"."runtime_version") between 1 and 16),
	CONSTRAINT "agent_runtime_events_label_check" CHECK(length("__new_agent_runtime_events"."label") between 1 and 100),
	CONSTRAINT "agent_runtime_events_summary_check" CHECK(length("__new_agent_runtime_events"."summary") between 1 and 300),
	CONSTRAINT "agent_runtime_events_source_ids_check" CHECK(json_valid("__new_agent_runtime_events"."source_ids_json") and json_type("__new_agent_runtime_events"."source_ids_json") = 'array'),
	CONSTRAINT "agent_runtime_events_usage_status_check" CHECK("__new_agent_runtime_events"."usage_status" in ('RECORDED','UNAVAILABLE')),
	CONSTRAINT "agent_runtime_events_usage_check" CHECK(("__new_agent_runtime_events"."usage_status" = 'RECORDED' and "__new_agent_runtime_events"."input_tokens" is not null and "__new_agent_runtime_events"."output_tokens" is not null and "__new_agent_runtime_events"."total_tokens" = "__new_agent_runtime_events"."input_tokens" + "__new_agent_runtime_events"."output_tokens") or ("__new_agent_runtime_events"."usage_status" = 'UNAVAILABLE' and "__new_agent_runtime_events"."input_tokens" is null and "__new_agent_runtime_events"."output_tokens" is null and "__new_agent_runtime_events"."total_tokens" is null)),
	CONSTRAINT "agent_runtime_events_latency_check" CHECK("__new_agent_runtime_events"."latency_ms" between 0 and 900000),
	CONSTRAINT "agent_runtime_events_data_type_check" CHECK("__new_agent_runtime_events"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_runtime_events`("id", "turn_id", "event_sequence", "runtime_id", "runtime_version", "kind", "status", "label", "summary", "tool_call_id", "tool_id", "source_ids_json", "policy_rule", "error_code", "model_provider", "model_id", "usage_status", "input_tokens", "output_tokens", "total_tokens", "latency_ms", "created_at", "data_type") SELECT "id", "turn_id", "event_sequence", "runtime_id", "runtime_version", "kind", "status", "label", "summary", "tool_call_id", "tool_id", "source_ids_json", "policy_rule", "error_code", "model_provider", "model_id", "usage_status", "input_tokens", "output_tokens", "total_tokens", "latency_ms", "created_at", "data_type" FROM `agent_runtime_events`;--> statement-breakpoint
DROP TABLE `agent_runtime_events`;--> statement-breakpoint
ALTER TABLE `__new_agent_runtime_events` RENAME TO `agent_runtime_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runtime_events_turn_sequence_unique` ON `agent_runtime_events` (`turn_id`,`event_sequence`);--> statement-breakpoint
CREATE INDEX `agent_runtime_events_kind_idx` ON `agent_runtime_events` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_runtime_events_tool_call_idx` ON `agent_runtime_events` (`tool_call_id`);--> statement-breakpoint
CREATE TABLE `__new_agent_steps` (
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
	CONSTRAINT "agent_steps_kind_check" CHECK("__new_agent_steps"."kind" in ('MODEL_DECISION','TOOL_CALL','TOOL_OBSERVATION','FINAL_RESPONSE','DEGRADED')),
	CONSTRAINT "agent_steps_status_check" CHECK("__new_agent_steps"."status" in ('SUCCEEDED','FAILED','EMPTY','SKIPPED')),
	CONSTRAINT "agent_steps_latency_check" CHECK("__new_agent_steps"."latency_ms" between 0 and 900000),
	CONSTRAINT "agent_steps_label_check" CHECK(length("__new_agent_steps"."label") between 1 and 100),
	CONSTRAINT "agent_steps_summary_check" CHECK(length("__new_agent_steps"."summary") between 1 and 300)
);
--> statement-breakpoint
INSERT INTO `__new_agent_steps`("id", "turn_id", "step_sequence", "kind", "status", "label", "summary", "tool_call_id", "tool_id", "latency_ms", "created_at", "data_type") SELECT "id", "turn_id", "step_sequence", "kind", "status", "label", "summary", "tool_call_id", "tool_id", "latency_ms", "created_at", "data_type" FROM `agent_steps`;--> statement-breakpoint
DROP TABLE `agent_steps`;--> statement-breakpoint
ALTER TABLE `__new_agent_steps` RENAME TO `agent_steps`;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_steps_turn_sequence_unique` ON `agent_steps` (`turn_id`,`step_sequence`);--> statement-breakpoint
CREATE INDEX `agent_steps_tool_call_idx` ON `agent_steps` (`tool_call_id`);--> statement-breakpoint
CREATE TABLE `__new_agent_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`conversation_id` text NOT NULL,
	`turn_sequence` integer NOT NULL,
	`student_message` text NOT NULL,
	`episode` text NOT NULL,
	`decision_code` text NOT NULL,
	`policy_id` text DEFAULT 'competition-core' NOT NULL,
	`policy_version` text DEFAULT '1' NOT NULL,
	`policy_trace_json` text NOT NULL,
	`response_strategy` text DEFAULT 'CLARIFY' NOT NULL,
	`response_latency_ms` integer DEFAULT 0 NOT NULL,
	`reply_json` text NOT NULL,
	`ai_mode` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_turns_episode_check" CHECK("__new_agent_turns"."episode" in ('EXPLORE','UNDERSTAND','BUILD','DEBUG','TRANSFER','REFLECT')),
	CONSTRAINT "agent_turns_mode_check" CHECK("__new_agent_turns"."ai_mode" in ('MODEL_ASSISTED','DETERMINISTIC_FALLBACK')),
	CONSTRAINT "agent_turns_strategy_check" CHECK("__new_agent_turns"."response_strategy" in ('DIRECT_INSTRUCTION','CONCEPT_EXPLANATION','DIAGNOSTIC_GUIDANCE','TRANSFER_COACHING','REFLECTION_PROMPT','CLARIFY','OUT_OF_SCOPE')),
	CONSTRAINT "agent_turns_latency_check" CHECK("__new_agent_turns"."response_latency_ms" between 0 and 900000),
	CONSTRAINT "agent_turns_policy_id_check" CHECK(length("__new_agent_turns"."policy_id") between 1 and 64),
	CONSTRAINT "agent_turns_policy_version_check" CHECK(length("__new_agent_turns"."policy_version") between 1 and 8 and "__new_agent_turns"."policy_version" not glob '*[^0-9]*'),
	CONSTRAINT "agent_turns_policy_trace_json_check" CHECK(json_valid("__new_agent_turns"."policy_trace_json") and json_type("__new_agent_turns"."policy_trace_json") = 'object'),
	CONSTRAINT "agent_turns_reply_json_check" CHECK(json_valid("__new_agent_turns"."reply_json") and json_type("__new_agent_turns"."reply_json") = 'object'),
	CONSTRAINT "agent_turns_source_ids_json_check" CHECK(json_valid("__new_agent_turns"."source_ids_json") and json_type("__new_agent_turns"."source_ids_json") = 'array')
);
--> statement-breakpoint
INSERT INTO `__new_agent_turns`("id", "run_id", "conversation_id", "turn_sequence", "student_message", "episode", "decision_code", "policy_id", "policy_version", "policy_trace_json", "response_strategy", "response_latency_ms", "reply_json", "ai_mode", "source_ids_json", "created_at", "data_type") SELECT "id", "run_id", "conversation_id", "turn_sequence", "student_message", "episode", "decision_code", "policy_id", "policy_version", "policy_trace_json", "response_strategy", "response_latency_ms", "reply_json", "ai_mode", "source_ids_json", "created_at", "data_type" FROM `agent_turns`;--> statement-breakpoint
DROP TRIGGER `agent_student_memory_owner_source_insert_guard`;--> statement-breakpoint
DROP TRIGGER `agent_student_memory_owner_source_update_guard`;--> statement-breakpoint
DROP TRIGGER `agent_session_summaries_turn_owner_insert_guard`;--> statement-breakpoint
DROP TRIGGER `agent_session_summaries_turn_owner_update_guard`;--> statement-breakpoint
DROP TABLE `agent_turns`;--> statement-breakpoint
ALTER TABLE `__new_agent_turns` RENAME TO `agent_turns`;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_turns_run_unique` ON `agent_turns` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_turns_conversation_sequence_unique` ON `agent_turns` (`conversation_id`,`turn_sequence`);--> statement-breakpoint
CREATE INDEX `agent_turns_created_idx` ON `agent_turns` (`created_at`);--> statement-breakpoint
CREATE TRIGGER `agent_student_memory_owner_source_insert_guard` BEFORE INSERT ON `agent_student_memory`
WHEN NOT EXISTS (
	SELECT 1 FROM `users`
	WHERE `id` = NEW.`student_id` AND `class_id` = NEW.`class_id` AND `role` = 'STUDENT'
) OR (
	NEW.`source_turn_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `agent_turns` AS `turn`
		JOIN `agent_conversations` AS `conversation` ON `conversation`.`id` = `turn`.`conversation_id`
		WHERE `turn`.`id` = NEW.`source_turn_id`
			AND `conversation`.`student_id` = NEW.`student_id`
			AND `conversation`.`class_id` = NEW.`class_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'invalid agent student memory owner or source turn');
END;--> statement-breakpoint
CREATE TRIGGER `agent_student_memory_owner_source_update_guard` BEFORE UPDATE OF `student_id`, `class_id`, `source_turn_id` ON `agent_student_memory`
WHEN NOT EXISTS (
	SELECT 1 FROM `users`
	WHERE `id` = NEW.`student_id` AND `class_id` = NEW.`class_id` AND `role` = 'STUDENT'
) OR (
	NEW.`source_turn_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `agent_turns` AS `turn`
		JOIN `agent_conversations` AS `conversation` ON `conversation`.`id` = `turn`.`conversation_id`
		WHERE `turn`.`id` = NEW.`source_turn_id`
			AND `conversation`.`student_id` = NEW.`student_id`
			AND `conversation`.`class_id` = NEW.`class_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'invalid agent student memory owner or source turn');
END;--> statement-breakpoint
CREATE TRIGGER `agent_session_summaries_turn_owner_insert_guard` BEFORE INSERT ON `agent_session_summaries`
WHEN NOT EXISTS (
	SELECT 1 FROM `agent_turns` AS `turn`
	JOIN `agent_conversations` AS `conversation` ON `conversation`.`id` = `turn`.`conversation_id`
	WHERE `turn`.`id` = NEW.`through_turn_id`
		AND `conversation`.`task_id` = NEW.`task_id`
		AND `conversation`.`student_id` = NEW.`student_id`
		AND `conversation`.`class_id` = NEW.`class_id`
)
BEGIN
	SELECT RAISE(ABORT, 'invalid agent session summary owner or through turn');
END;--> statement-breakpoint
CREATE TRIGGER `agent_session_summaries_turn_owner_update_guard` BEFORE UPDATE OF `task_id`, `student_id`, `class_id`, `through_turn_id` ON `agent_session_summaries`
WHEN NOT EXISTS (
	SELECT 1 FROM `agent_turns` AS `turn`
	JOIN `agent_conversations` AS `conversation` ON `conversation`.`id` = `turn`.`conversation_id`
	WHERE `turn`.`id` = NEW.`through_turn_id`
		AND `conversation`.`task_id` = NEW.`task_id`
		AND `conversation`.`student_id` = NEW.`student_id`
		AND `conversation`.`class_id` = NEW.`class_id`
)
BEGIN
	SELECT RAISE(ABORT, 'invalid agent session summary owner or through turn');
END;
