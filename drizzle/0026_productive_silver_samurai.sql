CREATE TABLE `agent_actions` (
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
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	`executed_at` integer,
	`data_type` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_actions_type_check" CHECK("agent_actions"."type" in ('OPEN_WORKSPACE','OPEN_RESOURCE','START_DIAGNOSTIC','REQUEST_EVIDENCE','START_TROUBLESHOOTING','START_TRANSFER','ESCALATE_TEACHER')),
	CONSTRAINT "agent_actions_status_check" CHECK("agent_actions"."status" in ('PROPOSED','EXECUTED','EXPIRED')),
	CONSTRAINT "agent_actions_payload_json_check" CHECK(json_valid("agent_actions"."payload_json") and json_type("agent_actions"."payload_json") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_actions_turn_sequence_unique` ON `agent_actions` (`turn_id`,`action_sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_actions_turn_idempotency_unique` ON `agent_actions` (`turn_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_actions_status_created_idx` ON `agent_actions` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`project_id` text,
	`course_pack_id` text NOT NULL,
	`course_pack_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text GENERATED ALWAYS AS (case when student_id glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end) VIRTUAL,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`class_id`,`student_id`) REFERENCES `projects`(`id`,`class_id`,`student_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_conversations_student_updated_idx` ON `agent_conversations` (`student_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agent_conversations_pack_idx` ON `agent_conversations` (`course_pack_id`,`course_pack_version`);--> statement-breakpoint
CREATE TABLE `agent_decision_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`decision` text NOT NULL,
	`notes` text NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_decision_reviews_decision_check" CHECK("agent_decision_reviews"."decision" in ('CONFIRMED','CORRECTED','NEEDS_REVIEW')),
	CONSTRAINT "agent_decision_reviews_notes_check" CHECK(length("agent_decision_reviews"."notes") <= 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_decision_reviews_turn_teacher_unique` ON `agent_decision_reviews` (`turn_id`,`teacher_id`);--> statement-breakpoint
CREATE TABLE `agent_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`turn_sequence` integer NOT NULL,
	`student_message` text NOT NULL,
	`episode` text NOT NULL,
	`decision_code` text NOT NULL,
	`reply_json` text NOT NULL,
	`ai_mode` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_turns_episode_check" CHECK("agent_turns"."episode" in ('EXPLORE','UNDERSTAND','BUILD','DEBUG','TRANSFER','REFLECT')),
	CONSTRAINT "agent_turns_mode_check" CHECK("agent_turns"."ai_mode" in ('MODEL_ASSISTED','DETERMINISTIC_FALLBACK')),
	CONSTRAINT "agent_turns_reply_json_check" CHECK(json_valid("agent_turns"."reply_json") and json_type("agent_turns"."reply_json") = 'object'),
	CONSTRAINT "agent_turns_source_ids_json_check" CHECK(json_valid("agent_turns"."source_ids_json") and json_type("agent_turns"."source_ids_json") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_turns_conversation_sequence_unique` ON `agent_turns` (`conversation_id`,`turn_sequence`);--> statement-breakpoint
CREATE INDEX `agent_turns_created_idx` ON `agent_turns` (`created_at`);--> statement-breakpoint
CREATE TABLE `course_pack_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`class_id` text NOT NULL,
	`course_pack_id` text NOT NULL,
	`course_pack_version` text NOT NULL,
	`level` text NOT NULL,
	`dimensions_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	`data_type` text GENERATED ALWAYS AS (case when user_id glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end) VIRTUAL,
	FOREIGN KEY (`user_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "course_pack_profiles_level_check" CHECK("course_pack_profiles"."level" in ('L1', 'L2', 'L3', 'L4')),
	CONSTRAINT "course_pack_profiles_dimensions_json_check" CHECK(json_valid("course_pack_profiles"."dimensions_json") and json_type("course_pack_profiles"."dimensions_json") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_pack_profiles_user_pack_unique` ON `course_pack_profiles` (`user_id`,`course_pack_id`,`course_pack_version`);--> statement-breakpoint
CREATE INDEX `course_pack_profiles_class_pack_idx` ON `course_pack_profiles` (`class_id`,`course_pack_id`,`course_pack_version`);--> statement-breakpoint
ALTER TABLE `assignments` ADD `course_pack_id` text GENERATED ALWAYS AS ('digital-interaction') VIRTUAL;--> statement-breakpoint
ALTER TABLE `assignments` ADD `course_pack_version` text GENERATED ALWAYS AS ('1') VIRTUAL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_knowledge_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`tags` text NOT NULL,
	`content` text NOT NULL,
	`course_pack_id` text DEFAULT 'digital-interaction' NOT NULL,
	`course_pack_version` text DEFAULT '1' NOT NULL,
	`namespace` text DEFAULT 'interaction-principles' NOT NULL,
	`authority` text DEFAULT 'COURSE_DESIGN' NOT NULL,
	`content_hash` text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	`verified_date` text DEFAULT '2026-07-14' NOT NULL,
	CONSTRAINT "knowledge_chunks_tags_json_check" CHECK(json_valid("__new_knowledge_chunks"."tags")),
	CONSTRAINT "knowledge_chunks_hash_check" CHECK(length("__new_knowledge_chunks"."content_hash") = 64 and "__new_knowledge_chunks"."content_hash" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_chunks`("id", "source", "title", "tags", "content", "course_pack_id", "course_pack_version", "namespace", "authority", "content_hash", "verified_date")
SELECT "id", "source", "title", "tags", "content", 'digital-interaction', '1', 'interaction-principles', 'COURSE_DESIGN', '0000000000000000000000000000000000000000000000000000000000000000', '2026-07-14' FROM `knowledge_chunks`;--> statement-breakpoint
DROP TABLE `knowledge_chunks`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_chunks` RENAME TO `knowledge_chunks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_chunks_pack_source_unique` ON `knowledge_chunks` (`course_pack_id`,`course_pack_version`,`id`);--> statement-breakpoint
CREATE INDEX `knowledge_chunks_pack_namespace_idx` ON `knowledge_chunks` (`course_pack_id`,`course_pack_version`,`namespace`);--> statement-breakpoint
ALTER TABLE `projects` ADD `course_pack_id` text GENERATED ALWAYS AS ('digital-interaction') VIRTUAL;--> statement-breakpoint
ALTER TABLE `projects` ADD `course_pack_version` text GENERATED ALWAYS AS ('1') VIRTUAL;--> statement-breakpoint
INSERT INTO `course_pack_profiles`("id", "user_id", "class_id", "course_pack_id", "course_pack_version", "level", "dimensions_json", "updated_at")
SELECT 'digital-interaction:1:' || lp."user_id", lp."user_id", u."class_id", 'digital-interaction', '1', lp."level",
  json_object(
    'decomposition', lp."decomposition",
    'signal-understanding', lp."signal_understanding",
    'mapping-design', lp."mapping_design",
    'troubleshooting', lp."troubleshooting",
    'transfer', lp."transfer"
  ),
  lp."updated_at"
FROM `learner_profiles` lp
JOIN `users` u ON u."id" = lp."user_id"
WHERE u."class_id" IS NOT NULL;
