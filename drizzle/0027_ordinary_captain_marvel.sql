PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`turn_sequence` integer NOT NULL,
	`student_message` text NOT NULL,
	`episode` text NOT NULL,
	`decision_code` text NOT NULL,
	`response_strategy` text DEFAULT 'CLARIFY' NOT NULL,
	`response_latency_ms` integer DEFAULT 0 NOT NULL,
	`reply_json` text NOT NULL,
	`ai_mode` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_turns_episode_check" CHECK("__new_agent_turns"."episode" in ('EXPLORE','UNDERSTAND','BUILD','DEBUG','TRANSFER','REFLECT')),
	CONSTRAINT "agent_turns_mode_check" CHECK("__new_agent_turns"."ai_mode" in ('MODEL_ASSISTED','DETERMINISTIC_FALLBACK')),
	CONSTRAINT "agent_turns_strategy_check" CHECK("__new_agent_turns"."response_strategy" in ('DIRECT_INSTRUCTION','CONCEPT_EXPLANATION','DIAGNOSTIC_GUIDANCE','TRANSFER_COACHING','REFLECTION_PROMPT','CLARIFY','OUT_OF_SCOPE')),
	CONSTRAINT "agent_turns_latency_check" CHECK("__new_agent_turns"."response_latency_ms" between 0 and 60000),
	CONSTRAINT "agent_turns_reply_json_check" CHECK(json_valid("__new_agent_turns"."reply_json") and json_type("__new_agent_turns"."reply_json") = 'object'),
	CONSTRAINT "agent_turns_source_ids_json_check" CHECK(json_valid("__new_agent_turns"."source_ids_json") and json_type("__new_agent_turns"."source_ids_json") = 'array')
);
--> statement-breakpoint
INSERT INTO `__new_agent_turns`("id", "conversation_id", "turn_sequence", "student_message", "episode", "decision_code", "response_strategy", "response_latency_ms", "reply_json", "ai_mode", "source_ids_json", "created_at", "data_type") SELECT "id", "conversation_id", "turn_sequence", "student_message", "episode", "decision_code", 'CLARIFY', 0, "reply_json", "ai_mode", "source_ids_json", "created_at", "data_type" FROM `agent_turns`;--> statement-breakpoint
DROP TABLE `agent_turns`;--> statement-breakpoint
ALTER TABLE `__new_agent_turns` RENAME TO `agent_turns`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_turns_conversation_sequence_unique` ON `agent_turns` (`conversation_id`,`turn_sequence`);--> statement-breakpoint
CREATE INDEX `agent_turns_created_idx` ON `agent_turns` (`created_at`);
