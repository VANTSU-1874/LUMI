CREATE TABLE `evidence_recovery_locks` (
	`name` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`acquired_at` integer NOT NULL,
	CONSTRAINT "evidence_recovery_locks_name_check" CHECK(length("evidence_recovery_locks"."name") between 1 and 80),
	CONSTRAINT "evidence_recovery_locks_owner_check" CHECK(length("evidence_recovery_locks"."owner") = 36),
	CONSTRAINT "evidence_recovery_locks_acquired_at_check" CHECK("evidence_recovery_locks"."acquired_at" >= 0)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TEMP TABLE `__hint_evidence_consumptions_0008` AS
SELECT * FROM `hint_evidence_consumptions`;--> statement-breakpoint
DROP TABLE `hint_evidence_consumptions`;--> statement-breakpoint
CREATE TABLE `__new_hint_evidence_consumptions` (
	`evidence_id` text PRIMARY KEY NOT NULL,
	`hint_record_id` text NOT NULL,
	`project_id` text NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`evidence_sequence` integer NOT NULL,
	`content_digest` text NOT NULL,
	`consumed_at` integer NOT NULL,
	FOREIGN KEY (`evidence_id`,`project_id`,`student_id`,`class_id`,`evidence_sequence`,`content_digest`) REFERENCES `evidence`(`id`,`project_id`,`student_id`,`class_id`,`evidence_sequence`,`content_digest`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`hint_record_id`,`project_id`,`student_id`,`class_id`) REFERENCES `hint_records`(`id`,`project_id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "hint_evidence_consumptions_sequence_check" CHECK("__new_hint_evidence_consumptions"."evidence_sequence" > 0),
	CONSTRAINT "hint_evidence_consumptions_digest_check" CHECK(length("__new_hint_evidence_consumptions"."content_digest") = 64 and "__new_hint_evidence_consumptions"."content_digest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
ALTER TABLE `__new_hint_evidence_consumptions` RENAME TO `hint_evidence_consumptions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `hint_evidence_consumptions_hint_record_id_unique` ON `hint_evidence_consumptions` (`hint_record_id`);--> statement-breakpoint
CREATE INDEX `hint_evidence_consumptions_project_student_class_idx` ON `hint_evidence_consumptions` (`project_id`,`student_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `hint_evidence_consumptions_evidence_owner_idx` ON `hint_evidence_consumptions` (`evidence_id`,`project_id`,`student_id`,`class_id`,`evidence_sequence`,`content_digest`);--> statement-breakpoint
CREATE INDEX `hint_evidence_consumptions_hint_owner_idx` ON `hint_evidence_consumptions` (`hint_record_id`,`project_id`,`student_id`,`class_id`);--> statement-breakpoint
CREATE TABLE `__new_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`evidence_sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`signal_layer` text NOT NULL,
	`confirmed_code` text,
	`verification_status` text NOT NULL,
	`storage_status` text NOT NULL,
	`label` text NOT NULL,
	`content` text NOT NULL,
	`content_digest` text NOT NULL,
	`probe_json` text,
	`original_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`,`class_id`) REFERENCES `projects`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evidence_kind_check" CHECK("__new_evidence"."kind" in ('TEXT', 'IMAGE', 'VALUE', 'VIDEO_LINK', 'PROBE')),
	CONSTRAINT "evidence_signal_layer_check" CHECK("__new_evidence"."signal_layer" in ('INPUT', 'MAPPING', 'TRANSPORT', 'BINDING', 'OUTPUT')),
	CONSTRAINT "evidence_sequence_positive_check" CHECK("__new_evidence"."evidence_sequence" > 0),
	CONSTRAINT "evidence_verification_status_check" CHECK("__new_evidence"."verification_status" in ('SUBMITTED', 'RULE_VERIFIED', 'TEACHER_VERIFIED', 'REJECTED')),
	CONSTRAINT "evidence_storage_status_check" CHECK("__new_evidence"."storage_status" in ('PENDING', 'READY') and ("__new_evidence"."kind" = 'IMAGE' or "__new_evidence"."storage_status" = 'READY')),
	CONSTRAINT "evidence_probe_json_check" CHECK((
        "__new_evidence"."kind" = 'PROBE' and "__new_evidence"."probe_json" is not null and json_valid("__new_evidence"."probe_json") and json_type("__new_evidence"."probe_json") = 'object'
      ) or (
        "__new_evidence"."kind" <> 'PROBE' and "__new_evidence"."probe_json" is null
      )),
	CONSTRAINT "evidence_verification_code_layer_check" CHECK((
        "__new_evidence"."verification_status" in ('SUBMITTED', 'REJECTED') and "__new_evidence"."confirmed_code" is null
      ) or (
        "__new_evidence"."verification_status" in ('RULE_VERIFIED', 'TEACHER_VERIFIED') and "__new_evidence"."confirmed_code" is not null and (
          ("__new_evidence"."signal_layer" = 'INPUT' and "__new_evidence"."confirmed_code" = 'INPUT_OK') or
          ("__new_evidence"."signal_layer" = 'MAPPING' and "__new_evidence"."confirmed_code" = 'MAPPING_OK') or
          ("__new_evidence"."signal_layer" = 'TRANSPORT' and "__new_evidence"."confirmed_code" = 'TRANSPORT_OK') or
          ("__new_evidence"."signal_layer" = 'BINDING' and "__new_evidence"."confirmed_code" = 'BINDING_OK') or
          ("__new_evidence"."signal_layer" = 'OUTPUT' and "__new_evidence"."confirmed_code" = 'OUTPUT_OK')
        )
      )),
	CONSTRAINT "evidence_digest_check" CHECK(length("__new_evidence"."content_digest") = 64 and "__new_evidence"."content_digest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "evidence_label_length_check" CHECK(length("__new_evidence"."label") between 1 and 80),
	CONSTRAINT "evidence_original_name_length_check" CHECK("__new_evidence"."original_name" is null or length("__new_evidence"."original_name") between 1 and 120)
);
--> statement-breakpoint
INSERT INTO `__new_evidence`("id", "project_id", "class_id", "student_id", "evidence_sequence", "kind", "signal_layer", "confirmed_code", "verification_status", "storage_status", "label", "content", "content_digest", "probe_json", "original_name", "created_at") SELECT "id", "project_id", "class_id", "student_id", "evidence_sequence", "kind", "signal_layer", "confirmed_code", "verification_status", "storage_status", "label", "content", "content_digest", "probe_json", "original_name", "created_at" FROM `evidence`;--> statement-breakpoint
DROP TABLE `evidence`;--> statement-breakpoint
ALTER TABLE `__new_evidence` RENAME TO `evidence`;--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_id_project_student_class_unique` ON `evidence` (`id`,`project_id`,`student_id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_exact_consumption_unique` ON `evidence` (`id`,`project_id`,`student_id`,`class_id`,`evidence_sequence`,`content_digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_project_student_sequence_unique` ON `evidence` (`project_id`,`student_id`,`evidence_sequence`);--> statement-breakpoint
CREATE INDEX `evidence_project_class_kind_idx` ON `evidence` (`project_id`,`class_id`,`kind`);--> statement-breakpoint
CREATE INDEX `evidence_student_class_project_sequence_idx` ON `evidence` (`student_id`,`class_id`,`project_id`,`evidence_sequence`);--> statement-breakpoint
INSERT INTO `hint_evidence_consumptions`(
	"evidence_id", "hint_record_id", "project_id", "student_id", "class_id", "evidence_sequence", "content_digest", "consumed_at"
)
SELECT "evidence_id", "hint_record_id", "project_id", "student_id", "class_id", "evidence_sequence", "content_digest", "consumed_at"
FROM `__hint_evidence_consumptions_0008`;--> statement-breakpoint
DROP TABLE `__hint_evidence_consumptions_0008`;--> statement-breakpoint
CREATE TABLE `__new_troubleshooting_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`symptom` text NOT NULL,
	`current_layer` text NOT NULL,
	`state_json` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "troubleshooting_runs_state_json_check" CHECK(json_valid("__new_troubleshooting_runs"."state_json")
        and json_type("__new_troubleshooting_runs"."state_json") = 'object'
        and coalesce(
          json_extract("__new_troubleshooting_runs"."state_json", '$.currentLayer'),
          json_extract("__new_troubleshooting_runs"."state_json", '$.current_layer')
        ) is not null
        and coalesce(
          json_extract("__new_troubleshooting_runs"."state_json", '$.currentLayer'),
          json_extract("__new_troubleshooting_runs"."state_json", '$.current_layer')
        ) = "__new_troubleshooting_runs"."current_layer"
        and json_extract("__new_troubleshooting_runs"."state_json", '$.status') is not null
        and json_extract("__new_troubleshooting_runs"."state_json", '$.status') = "__new_troubleshooting_runs"."status"),
	CONSTRAINT "troubleshooting_runs_layer_check" CHECK("__new_troubleshooting_runs"."current_layer" in ('INPUT', 'MAPPING', 'TRANSPORT', 'BINDING', 'OUTPUT')),
	CONSTRAINT "troubleshooting_runs_revision_positive_check" CHECK("__new_troubleshooting_runs"."revision" > 0),
	CONSTRAINT "troubleshooting_runs_status_check" CHECK("__new_troubleshooting_runs"."status" in ('ACTIVE', 'RESOLVED', 'ESCALATED'))
);
--> statement-breakpoint
INSERT INTO `__new_troubleshooting_runs`(
	"id", "project_id", "symptom", "current_layer", "state_json", "status", "revision", "created_at", "updated_at"
)
SELECT "id", "project_id", "symptom", "current_layer",
	json_set(
		CASE WHEN json_valid("state_json") AND json_type("state_json") = 'object' THEN "state_json" ELSE '{}' END,
		'$.currentLayer', "current_layer",
		'$.status', "status"
	),
	"status", "revision", "created_at", "updated_at"
FROM `troubleshooting_runs`;--> statement-breakpoint
DROP TABLE `troubleshooting_runs`;--> statement-breakpoint
ALTER TABLE `__new_troubleshooting_runs` RENAME TO `troubleshooting_runs`;--> statement-breakpoint
CREATE INDEX `troubleshooting_runs_project_status_layer_idx` ON `troubleshooting_runs` (`project_id`,`status`,`current_layer`);
