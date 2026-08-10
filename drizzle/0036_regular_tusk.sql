CREATE TABLE `agent_run_controls` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`generation` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_run_controls_kind_check" CHECK("agent_run_controls"."kind" in ('CANCEL','RETRY')),
	CONSTRAINT "agent_run_controls_generation_check" CHECK("agent_run_controls"."generation" between 0 and 100),
	CONSTRAINT "agent_run_controls_key_check" CHECK(length("agent_run_controls"."idempotency_key") between 1 and 128),
	CONSTRAINT "agent_run_controls_data_type_check" CHECK("agent_run_controls"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_controls_key_unique` ON `agent_run_controls` (`run_id`,`kind`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_controls_generation_unique` ON `agent_run_controls` (`run_id`,`kind`,`generation`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`action_sequence` integer NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`adapter_id` text,
	`target` text NOT NULL,
	`focus` text,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`effect` text DEFAULT 'NAVIGATE' NOT NULL,
	`approval_mode` text DEFAULT 'REQUIRES_CONFIRMATION' NOT NULL,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	`executed_at` integer,
	`rejected_at` integer,
	`data_type` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_actions_type_check" CHECK("__new_agent_actions"."type" in ('OPEN_WORKSPACE','OPEN_RESOURCE','START_DIAGNOSTIC','REQUEST_EVIDENCE','START_TROUBLESHOOTING','START_TRANSFER','ESCALATE_TEACHER')),
	CONSTRAINT "agent_actions_status_check" CHECK("__new_agent_actions"."status" in ('PROPOSED','EXECUTED','REJECTED','EXPIRED')),
	CONSTRAINT "agent_actions_effect_check" CHECK("__new_agent_actions"."effect" in ('READ_CONTEXT','NAVIGATE','WRITE_PROJECT','CHANGE_TOOL_STATE','SUBMIT_EVALUATION','FORMAL_AUTHORITY')),
	CONSTRAINT "agent_actions_approval_mode_check" CHECK("__new_agent_actions"."approval_mode" in ('AUTOMATIC','REQUIRES_CONFIRMATION','FORBIDDEN')),
	CONSTRAINT "agent_actions_policy_effect_check" CHECK(("__new_agent_actions"."effect" = 'READ_CONTEXT' and "__new_agent_actions"."approval_mode" = 'AUTOMATIC') or ("__new_agent_actions"."effect" in ('NAVIGATE','WRITE_PROJECT','CHANGE_TOOL_STATE','SUBMIT_EVALUATION') and "__new_agent_actions"."approval_mode" = 'REQUIRES_CONFIRMATION')),
	CONSTRAINT "agent_actions_resolution_check" CHECK(("__new_agent_actions"."status" = 'EXECUTED' and "__new_agent_actions"."executed_at" is not null and "__new_agent_actions"."rejected_at" is null) or ("__new_agent_actions"."status" = 'REJECTED' and "__new_agent_actions"."rejected_at" is not null and "__new_agent_actions"."executed_at" is null) or ("__new_agent_actions"."status" in ('PROPOSED','EXPIRED') and "__new_agent_actions"."executed_at" is null and "__new_agent_actions"."rejected_at" is null)),
	CONSTRAINT "agent_actions_payload_json_check" CHECK(json_valid("__new_agent_actions"."payload_json") and json_type("__new_agent_actions"."payload_json") = 'object')
);
--> statement-breakpoint
INSERT INTO `__new_agent_actions`("id", "turn_id", "action_sequence", "type", "label", "adapter_id", "target", "focus", "payload_json", "status", "effect", "approval_mode", "idempotency_key", "created_at", "executed_at", "rejected_at", "data_type") SELECT "id", "turn_id", "action_sequence", "type", "label", "adapter_id", "target", "focus", "payload_json", "status", 'NAVIGATE', 'REQUIRES_CONFIRMATION', "idempotency_key", "created_at", "executed_at", NULL, "data_type" FROM `agent_actions`;--> statement-breakpoint
DROP TABLE `agent_actions`;--> statement-breakpoint
ALTER TABLE `__new_agent_actions` RENAME TO `agent_actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_actions_turn_sequence_unique` ON `agent_actions` (`turn_id`,`action_sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_actions_turn_idempotency_unique` ON `agent_actions` (`turn_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_actions_status_created_idx` ON `agent_actions` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `cancel_requested_at` integer;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `retry_requested_at` integer;
