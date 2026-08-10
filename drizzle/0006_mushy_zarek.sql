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
INSERT INTO `__new_evidence`("id", "project_id", "class_id", "student_id", "kind", "signal_layer", "confirmed_code", "label", "content", "content_digest", "original_name", "created_at") SELECT "id", "project_id", "class_id", "student_id", "kind", "signal_layer", "confirmed_code", "label", "content", "content_digest", "original_name", "created_at" FROM `evidence`;--> statement-breakpoint
DROP TABLE `evidence`;--> statement-breakpoint
ALTER TABLE `__new_evidence` RENAME TO `evidence`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `evidence_project_kind_idx` ON `evidence` (`project_id`,`kind`);--> statement-breakpoint
CREATE INDEX `evidence_student_project_created_idx` ON `evidence` (`student_id`,`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_hint_records` (
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
	CONSTRAINT "hint_records_level_check" CHECK("__new_hint_records"."hint_level" in (1, 2, 3)),
	CONSTRAINT "hint_records_response_json_check" CHECK(json_valid("__new_hint_records"."response_json") and json_type("__new_hint_records"."response_json") = 'object')
);
--> statement-breakpoint
INSERT INTO `__new_hint_records`("id", "project_id", "class_id", "student_id", "hint_level", "response_json", "created_at") SELECT "id", "project_id", "class_id", "student_id", "hint_level", "response_json", "created_at" FROM `hint_records`;--> statement-breakpoint
DROP TABLE `hint_records`;--> statement-breakpoint
ALTER TABLE `__new_hint_records` RENAME TO `hint_records`;--> statement-breakpoint
CREATE INDEX `hint_records_student_project_created_idx` ON `hint_records` (`student_id`,`project_id`,`created_at`);