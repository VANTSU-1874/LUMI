CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`module_id` text NOT NULL,
	`title` text NOT NULL,
	`brief` text NOT NULL,
	`allowed_tools` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_id`,`class_id`) REFERENCES `course_modules`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assignments_allowed_tools_json_check" CHECK(json_valid("assignments"."allowed_tools"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignments_id_class_id_unique` ON `assignments` (`id`,`class_id`);--> statement-breakpoint
CREATE INDEX `assignments_class_id_idx` ON `assignments` (`class_id`);--> statement-breakpoint
CREATE INDEX `assignments_module_id_class_id_idx` ON `assignments` (`module_id`,`class_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "audit_events_payload_json_check" CHECK(json_valid("audit_events"."payload_json"))
);
--> statement-breakpoint
CREATE INDEX `audit_events_user_id_idx` ON `audit_events` (`user_id`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`access_code` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classes_access_code_unique` ON `classes` (`access_code`);--> statement-breakpoint
CREATE TABLE `course_modules` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`title` text NOT NULL,
	`hours` integer NOT NULL,
	`focus` text NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_modules_id_class_id_unique` ON `course_modules` (`id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `course_modules_class_id_sequence_unique` ON `course_modules` (`class_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "evidence_kind_check" CHECK("evidence"."kind" in ('TEXT', 'IMAGE', 'VALUE', 'VIDEO_LINK'))
);
--> statement-breakpoint
CREATE INDEX `evidence_project_kind_idx` ON `evidence` (`project_id`,`kind`);--> statement-breakpoint
CREATE TABLE `knowledge_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`tags` text NOT NULL,
	`content` text NOT NULL,
	CONSTRAINT "knowledge_chunks_tags_json_check" CHECK(json_valid("knowledge_chunks"."tags"))
);
--> statement-breakpoint
CREATE TABLE `learner_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`level` text NOT NULL,
	`decomposition` integer NOT NULL,
	`signal_understanding` integer NOT NULL,
	`mapping_design` integer NOT NULL,
	`troubleshooting` integer NOT NULL,
	`transfer` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "learner_profiles_level_check" CHECK("learner_profiles"."level" in ('L1', 'L2', 'L3', 'L4')),
	CONSTRAINT "learner_profiles_decomposition_range_check" CHECK("learner_profiles"."decomposition" between 1 and 4),
	CONSTRAINT "learner_profiles_signal_understanding_range_check" CHECK("learner_profiles"."signal_understanding" between 1 and 4),
	CONSTRAINT "learner_profiles_mapping_design_range_check" CHECK("learner_profiles"."mapping_design" between 1 and 4),
	CONSTRAINT "learner_profiles_troubleshooting_range_check" CHECK("learner_profiles"."troubleshooting" between 1 and 4),
	CONSTRAINT "learner_profiles_transfer_range_check" CHECK("learner_profiles"."transfer" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE `logic_cards` (
	`project_id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`rule_ready` integer NOT NULL,
	`semantic_ready` integer NOT NULL,
	`semantic_review_json` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "logic_cards_payload_json_check" CHECK(json_valid("logic_cards"."payload_json")),
	CONSTRAINT "logic_cards_semantic_review_json_check" CHECK(json_valid("logic_cards"."semantic_review_json")),
	CONSTRAINT "logic_cards_rule_ready_check" CHECK("logic_cards"."rule_ready" in (0, 1)),
	CONSTRAINT "logic_cards_semantic_ready_check" CHECK("logic_cards"."semantic_ready" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`stage` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assignment_id`,`class_id`) REFERENCES `assignments`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "projects_stage_check" CHECK("projects"."stage" in ('DIAGNOSTIC', 'LOGIC_CARD', 'TOOL_PATH', 'BUILD', 'TROUBLESHOOT', 'TRANSFER', 'COMPLETE'))
);
--> statement-breakpoint
CREATE INDEX `projects_assignment_id_class_id_idx` ON `projects` (`assignment_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `projects_student_id_class_id_idx` ON `projects` (`student_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `projects_stage_idx` ON `projects` (`stage`);--> statement-breakpoint
CREATE TABLE `transfer_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`changed_dimension` text NOT NULL,
	`prompt` text NOT NULL,
	`response_json` text NOT NULL,
	`rubric_json` text NOT NULL,
	`passed` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transfer_challenges_response_json_check" CHECK(json_valid("transfer_challenges"."response_json")),
	CONSTRAINT "transfer_challenges_rubric_json_check" CHECK(json_valid("transfer_challenges"."rubric_json")),
	CONSTRAINT "transfer_challenges_passed_check" CHECK("transfer_challenges"."passed" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `transfer_challenges_project_id_idx` ON `transfer_challenges` (`project_id`);--> statement-breakpoint
CREATE TABLE `troubleshooting_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`symptom` text NOT NULL,
	`current_layer` text NOT NULL,
	`state_json` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "troubleshooting_runs_state_json_check" CHECK(json_valid("troubleshooting_runs"."state_json")),
	CONSTRAINT "troubleshooting_runs_status_check" CHECK("troubleshooting_runs"."status" in ('ACTIVE', 'RESOLVED', 'ESCALATED'))
);
--> statement-breakpoint
CREATE INDEX `troubleshooting_runs_project_status_idx` ON `troubleshooting_runs` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text,
	`role` text NOT NULL,
	`alias` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('STUDENT', 'TEACHER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_id_class_id_unique` ON `users` (`id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_class_id_alias_unique` ON `users` (`class_id`,`alias`);