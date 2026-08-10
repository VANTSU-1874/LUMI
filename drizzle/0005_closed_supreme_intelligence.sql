CREATE TABLE `action_rate_limits` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`requests` integer NOT NULL,
	`window_started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "action_rate_limits_key_hash_check" CHECK(length("action_rate_limits"."key_hash") = 64 and "action_rate_limits"."key_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "action_rate_limits_requests_check" CHECK("action_rate_limits"."requests" >= 1)
);
--> statement-breakpoint
CREATE INDEX `action_rate_limits_updated_idx` ON `action_rate_limits` (`updated_at`);--> statement-breakpoint
CREATE TABLE `hint_evidence_consumptions` (
	`evidence_id` text PRIMARY KEY NOT NULL,
	`hint_record_id` text NOT NULL,
	`project_id` text NOT NULL,
	`student_id` text NOT NULL,
	`content_digest` text NOT NULL,
	`consumed_at` integer NOT NULL,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`hint_record_id`) REFERENCES `hint_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "hint_evidence_consumptions_digest_check" CHECK(length("hint_evidence_consumptions"."content_digest") = 64 and "hint_evidence_consumptions"."content_digest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hint_evidence_consumptions_hint_record_id_unique` ON `hint_evidence_consumptions` (`hint_record_id`);--> statement-breakpoint
CREATE INDEX `hint_evidence_consumptions_project_student_idx` ON `hint_evidence_consumptions` (`project_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `hint_records` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`hint_level` integer NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "hint_records_level_check" CHECK("hint_records"."hint_level" in (1, 2, 3)),
	CONSTRAINT "hint_records_response_json_check" CHECK(json_valid("hint_records"."response_json") and json_type("hint_records"."response_json") = 'object')
);
--> statement-breakpoint
CREATE INDEX `hint_records_student_project_created_idx` ON `hint_records` (`student_id`,`project_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`kind` text NOT NULL,
	`signal_layer` text NOT NULL,
	`confirmed_code` text NOT NULL,
	`label` text NOT NULL,
	`content` text NOT NULL,
	`content_digest` text NOT NULL,
	`original_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evidence_kind_check" CHECK("__new_evidence"."kind" in ('TEXT', 'IMAGE', 'VALUE', 'VIDEO_LINK')),
	CONSTRAINT "evidence_signal_layer_check" CHECK("__new_evidence"."signal_layer" in ('INPUT', 'MAPPING', 'TRANSPORT', 'BINDING', 'OUTPUT')),
	CONSTRAINT "evidence_confirmed_code_check" CHECK("__new_evidence"."confirmed_code" in ('INPUT_OK', 'MAPPING_OK', 'TRANSPORT_OK', 'BINDING_OK', 'OUTPUT_OK')),
	CONSTRAINT "evidence_digest_check" CHECK(length("__new_evidence"."content_digest") = 64 and "__new_evidence"."content_digest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "evidence_label_length_check" CHECK(length("__new_evidence"."label") between 1 and 80),
	CONSTRAINT "evidence_original_name_length_check" CHECK("__new_evidence"."original_name" is null or length("__new_evidence"."original_name") between 1 and 120)
);
--> statement-breakpoint
INSERT INTO `__new_evidence`("id", "project_id", "class_id", "student_id", "kind", "signal_layer", "confirmed_code", "label", "content", "content_digest", "original_name", "created_at")
SELECT e."id", e."project_id", p."class_id", p."student_id", e."kind", 'INPUT', 'INPUT_OK',
	CASE WHEN trim(e."label") = '' THEN '历史证据' ELSE substr(e."label", 1, 80) END,
	e."content", lower(hex(randomblob(32))), NULL, e."created_at"
FROM `evidence` e JOIN `projects` p ON p."id" = e."project_id";--> statement-breakpoint
DROP TABLE `evidence`;--> statement-breakpoint
ALTER TABLE `__new_evidence` RENAME TO `evidence`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `evidence_project_kind_idx` ON `evidence` (`project_id`,`kind`);--> statement-breakpoint
CREATE INDEX `evidence_student_project_created_idx` ON `evidence` (`student_id`,`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `troubleshooting_runs` ADD `created_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `troubleshooting_runs` ADD `updated_at` integer NOT NULL DEFAULT 0;
