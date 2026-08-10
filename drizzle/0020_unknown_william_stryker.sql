PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_teacher_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`project_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`original_revision` integer NOT NULL,
	`decision` text NOT NULL,
	`reason_code` text NOT NULL,
	`notes` text NOT NULL,
	`sequence` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	`original_snapshot_json` text DEFAULT '{"targetType":"LOGIC_REVIEW","revision":1,"status":"PENDING","ruleReady":false,"semanticReady":false,"source":"LEGACY","issues":[]}' NOT NULL,
	`original_snapshot_hash` text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`class_id`,`student_id`) REFERENCES `projects`(`id`,`class_id`,`student_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "teacher_decisions_target_check" CHECK("__new_teacher_decisions"."target_type" in ('LOGIC_REVIEW', 'EVIDENCE', 'TRANSFER')),
	CONSTRAINT "teacher_decisions_decision_check" CHECK("__new_teacher_decisions"."decision" in ('CONFIRMED', 'CORRECTED', 'NEEDS_REVIEW')),
	CONSTRAINT "teacher_decisions_revision_check" CHECK("__new_teacher_decisions"."original_revision" > 0),
	CONSTRAINT "teacher_decisions_sequence_check" CHECK("__new_teacher_decisions"."sequence" > 0),
	CONSTRAINT "teacher_decisions_teacher_length_check" CHECK(length(trim("__new_teacher_decisions"."teacher_id")) between 1 and 128),
	CONSTRAINT "teacher_decisions_target_id_length_check" CHECK(length(trim("__new_teacher_decisions"."target_id")) between 1 and 128),
	CONSTRAINT "teacher_decisions_reason_length_check" CHECK(length(trim("__new_teacher_decisions"."reason_code")) between 1 and 64),
	CONSTRAINT "teacher_decisions_notes_length_check" CHECK(length("__new_teacher_decisions"."notes") <= 1000),
	CONSTRAINT "teacher_decisions_idempotency_length_check" CHECK(length("__new_teacher_decisions"."idempotency_key") between 8 and 128),
	CONSTRAINT "teacher_decisions_request_hash_check" CHECK(length("__new_teacher_decisions"."request_hash") = 64 and "__new_teacher_decisions"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "teacher_decisions_snapshot_hash_check" CHECK(length("__new_teacher_decisions"."original_snapshot_hash") = 64 and "__new_teacher_decisions"."original_snapshot_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "teacher_decisions_snapshot_json_check" CHECK(coalesce((json_valid("__new_teacher_decisions"."original_snapshot_json") and json_type("__new_teacher_decisions"."original_snapshot_json")='object'
      and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.targetType')="__new_teacher_decisions"."target_type"
      and json_type("__new_teacher_decisions"."original_snapshot_json", '$.revision')='integer' and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.revision')="__new_teacher_decisions"."original_revision"
      and (("__new_teacher_decisions"."target_type"='LOGIC_REVIEW' and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.status') in ('APPROVED','NEEDS_REVISION','PENDING')
        and json_type("__new_teacher_decisions"."original_snapshot_json", '$.ruleReady') in ('true','false') and json_type("__new_teacher_decisions"."original_snapshot_json", '$.semanticReady') in ('true','false')
        and json_type("__new_teacher_decisions"."original_snapshot_json", '$.source')='text' and length(json_extract("__new_teacher_decisions"."original_snapshot_json", '$.source')) between 1 and 64
        and json_type("__new_teacher_decisions"."original_snapshot_json", '$.issues')='array' and json_array_length("__new_teacher_decisions"."original_snapshot_json", '$.issues') between 0 and 10)
      or ("__new_teacher_decisions"."target_type"='EVIDENCE' and json_type("__new_teacher_decisions"."original_snapshot_json", '$.id')='text' and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.id')="__new_teacher_decisions"."target_id"
        and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.kind') in ('TEXT','IMAGE','VALUE','VIDEO_LINK','PROBE')
        and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.layer') in ('INPUT','MAPPING','TRANSPORT','BINDING','OUTPUT')
        and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.verification') in ('SUBMITTED','RULE_VERIFIED','TEACHER_VERIFIED','REJECTED')
        and (json_type("__new_teacher_decisions"."original_snapshot_json", '$.code')='null' or json_extract("__new_teacher_decisions"."original_snapshot_json", '$.code') in ('INPUT_OK','MAPPING_OK','TRANSPORT_OK','BINDING_OK','OUTPUT_OK'))
        and json_type("__new_teacher_decisions"."original_snapshot_json", '$.sequence')='integer' and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.sequence')>0)
      or ("__new_teacher_decisions"."target_type"='TRANSFER' and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.status') in ('OPEN','PASSED','LOCKED')
        and json_type("__new_teacher_decisions"."original_snapshot_json", '$.attemptCount')='integer' and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.attemptCount')>=0
        and (json_type("__new_teacher_decisions"."original_snapshot_json", '$.latestOutcome')='null' or json_extract("__new_teacher_decisions"."original_snapshot_json", '$.latestOutcome') in ('RETRY','PASSED','LOCKED'))
        and (json_type("__new_teacher_decisions"."original_snapshot_json", '$.latestRubric')='null' or json_type("__new_teacher_decisions"."original_snapshot_json", '$.latestRubric')='object')))),0))
);
--> statement-breakpoint
INSERT INTO `__new_teacher_decisions`("id", "teacher_id", "class_id", "student_id", "project_id", "target_type", "target_id", "original_revision", "decision", "reason_code", "notes", "sequence", "idempotency_key", "request_hash", "original_snapshot_json", "original_snapshot_hash", "created_at")
SELECT "id", "teacher_id", "class_id", "student_id", "project_id", "target_type", "target_id", "original_revision", "decision", "reason_code", "notes", "sequence", "idempotency_key",
  '0000000000000000000000000000000000000000000000000000000000000000',
  CASE "target_type"
    WHEN 'LOGIC_REVIEW' THEN json_object('targetType','LOGIC_REVIEW','revision',"original_revision",'status','PENDING','ruleReady',json('false'),'semanticReady',json('false'),'source','LEGACY','issues',json('[]'))
    WHEN 'EVIDENCE' THEN json_object('targetType','EVIDENCE','id',"target_id",'kind','TEXT','layer','INPUT','verification','SUBMITTED','code',NULL,'revision',"original_revision",'sequence',"original_revision")
    ELSE json_object('targetType','TRANSFER','revision',"original_revision",'status','OPEN','attemptCount',0,'latestRubric',NULL,'latestOutcome',NULL)
  END,
  '0000000000000000000000000000000000000000000000000000000000000000', "created_at"
FROM `teacher_decisions`;--> statement-breakpoint
DROP TABLE `teacher_decisions`;--> statement-breakpoint
ALTER TABLE `__new_teacher_decisions` RENAME TO `teacher_decisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_decisions_teacher_class_idempotency_unique` ON `teacher_decisions` (`teacher_id`,`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_decisions_target_sequence_unique` ON `teacher_decisions` (`class_id`,`target_type`,`target_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `teacher_decisions_class_created_idx` ON `teacher_decisions` (`class_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `teacher_decisions_student_project_created_idx` ON `teacher_decisions` (`student_id`,`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_id_class_student_unique` ON `projects` (`id`,`class_id`,`student_id`);
