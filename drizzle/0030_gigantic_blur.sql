PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_teacher_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`project_id` text,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`original_revision` integer NOT NULL,
	`decision` text NOT NULL,
	`reason_code` text NOT NULL,
	`notes` text NOT NULL,
	`sequence` integer NOT NULL,
	`timeline_sequence` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	`original_snapshot_json` text DEFAULT '{"targetType":"LOGIC_REVIEW","revision":1,"status":"PENDING","ruleReady":false,"semanticReady":false,"source":"LEGACY","issues":[]}' NOT NULL,
	`original_snapshot_hash` text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	`created_at` integer NOT NULL,
	`data_type` text GENERATED ALWAYS AS (case when student_id glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end) VIRTUAL,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`class_id`,`student_id`) REFERENCES `projects`(`id`,`class_id`,`student_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "teacher_decisions_target_check" CHECK("__new_teacher_decisions"."target_type" in ('LOGIC_REVIEW', 'EVIDENCE', 'TRANSFER', 'BOOK_LAYOUT_EVIDENCE')),
	CONSTRAINT "teacher_decisions_project_scope_check" CHECK((("__new_teacher_decisions"."target_type"='BOOK_LAYOUT_EVIDENCE' and "__new_teacher_decisions"."project_id" is null) or ("__new_teacher_decisions"."target_type"<>'BOOK_LAYOUT_EVIDENCE' and "__new_teacher_decisions"."project_id" is not null))),
	CONSTRAINT "teacher_decisions_decision_check" CHECK("__new_teacher_decisions"."decision" in ('CONFIRMED', 'CORRECTED', 'NEEDS_REVIEW')),
	CONSTRAINT "teacher_decisions_revision_check" CHECK("__new_teacher_decisions"."original_revision" > 0),
	CONSTRAINT "teacher_decisions_sequence_check" CHECK("__new_teacher_decisions"."sequence" > 0),
	CONSTRAINT "teacher_decisions_timeline_sequence_check" CHECK("__new_teacher_decisions"."timeline_sequence" > 0),
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
        and (json_type("__new_teacher_decisions"."original_snapshot_json", '$.latestRubric')='null' or json_type("__new_teacher_decisions"."original_snapshot_json", '$.latestRubric')='object'))
      or ("__new_teacher_decisions"."target_type"='BOOK_LAYOUT_EVIDENCE' and json_type("__new_teacher_decisions"."original_snapshot_json", '$.id')='text' and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.id')="__new_teacher_decisions"."target_id"
        and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.audience') in ('NEW_STUDENTS','COMMUNITY_RESIDENTS')
        and json_type("__new_teacher_decisions"."original_snapshot_json", '$.pageOrder')='array' and json_array_length("__new_teacher_decisions"."original_snapshot_json", '$.pageOrder')=8
        and json_type("__new_teacher_decisions"."original_snapshot_json", '$.diagnosticAnswers')='array' and json_array_length("__new_teacher_decisions"."original_snapshot_json", '$.diagnosticAnswers')=3
        and json_type("__new_teacher_decisions"."original_snapshot_json", '$.transferChoices')='array' and json_array_length("__new_teacher_decisions"."original_snapshot_json", '$.transferChoices') between 0 and 3
        and json_type("__new_teacher_decisions"."original_snapshot_json", '$.criteria')='array' and json_array_length("__new_teacher_decisions"."original_snapshot_json", '$.criteria')=4
        and json_type("__new_teacher_decisions"."original_snapshot_json", '$.score')='integer' and json_extract("__new_teacher_decisions"."original_snapshot_json", '$.score') between 0 and 4
        and json_type("__new_teacher_decisions"."original_snapshot_json", '$.passed') in ('true','false')))),0))
);
--> statement-breakpoint
INSERT INTO `__new_teacher_decisions`("id", "teacher_id", "class_id", "student_id", "project_id", "target_type", "target_id", "original_revision", "decision", "reason_code", "notes", "sequence", "timeline_sequence", "idempotency_key", "request_hash", "original_snapshot_json", "original_snapshot_hash", "created_at") SELECT "id", "teacher_id", "class_id", "student_id", "project_id", "target_type", "target_id", "original_revision", "decision", "reason_code", "notes", "sequence", "timeline_sequence", "idempotency_key", "request_hash", "original_snapshot_json", "original_snapshot_hash", "created_at" FROM `teacher_decisions`;--> statement-breakpoint
DROP TABLE `teacher_decisions`;--> statement-breakpoint
ALTER TABLE `__new_teacher_decisions` RENAME TO `teacher_decisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_decisions_teacher_class_idempotency_unique` ON `teacher_decisions` (`teacher_id`,`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_decisions_target_sequence_unique` ON `teacher_decisions` (`class_id`,`target_type`,`target_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_decisions_student_timeline_unique` ON `teacher_decisions` (`class_id`,`student_id`,`timeline_sequence`);--> statement-breakpoint
CREATE INDEX `teacher_decisions_class_created_idx` ON `teacher_decisions` (`class_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `teacher_decisions_student_project_created_idx` ON `teacher_decisions` (`student_id`,`project_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `teacher_decisions_snapshot_insert_guard` BEFORE INSERT ON `teacher_decisions` BEGIN
  SELECT CASE WHEN NEW.target_type='LOGIC_REVIEW' AND EXISTS (
    SELECT 1 FROM json_each(NEW.original_snapshot_json, '$.issues')
    WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 200
  ) THEN RAISE(ABORT, 'invalid logic issues') END;
  SELECT CASE WHEN NEW.target_type='EVIDENCE' AND NOT (
    json_type(NEW.original_snapshot_json,'$.id')='text' AND json_type(NEW.original_snapshot_json,'$.kind')='text'
    AND json_type(NEW.original_snapshot_json,'$.layer')='text' AND json_type(NEW.original_snapshot_json,'$.verification')='text'
    AND json_type(NEW.original_snapshot_json,'$.revision')='integer' AND json_type(NEW.original_snapshot_json,'$.sequence')='integer'
  ) THEN RAISE(ABORT, 'invalid evidence snapshot') END;
  SELECT CASE WHEN NEW.target_type='TRANSFER' AND json_type(NEW.original_snapshot_json,'$.latestRubric')='object' AND coalesce((
    json_type(NEW.original_snapshot_json,'$.latestRubric.score')='integer'
    AND json_extract(NEW.original_snapshot_json,'$.latestRubric.score') BETWEEN 0 AND 4
    AND json_type(NEW.original_snapshot_json,'$.latestRubric.passed') IN ('true','false')
    AND json_extract(NEW.original_snapshot_json,'$.latestRubric.outcome') IN ('RETRY','PASSED','LOCKED')
  ),0)=0 THEN RAISE(ABORT, 'invalid transfer rubric') END;
  SELECT CASE WHEN NEW.target_type='BOOK_LAYOUT_EVIDENCE' AND (
    (SELECT count(DISTINCT value) FROM json_each(NEW.original_snapshot_json, '$.pageOrder')) <> 8
    OR EXISTS (SELECT 1 FROM json_each(NEW.original_snapshot_json, '$.pageOrder') WHERE type <> 'text' OR value NOT IN ('cover','quick-start','activity-map','featured-activity','calendar','community-voices','join-us','contact'))
    OR EXISTS (SELECT 1 FROM json_each(NEW.original_snapshot_json, '$.diagnosticAnswers') WHERE type <> 'text' OR value NOT IN ('AUDIENCE_FIRST','TASK_FIRST','DECORATION_FIRST'))
    OR EXISTS (SELECT 1 FROM json_each(NEW.original_snapshot_json, '$.transferChoices') WHERE type <> 'text' OR value NOT IN ('COMMUNITY_ENTRY_FIRST','VOLUNTEER_CALL_TO_ACTION','RETAIN_ACTIVITY_CORE'))
    OR (SELECT count(DISTINCT json_extract(value,'$.id')) FROM json_each(NEW.original_snapshot_json, '$.criteria')) <> 4
    OR EXISTS (SELECT 1 FROM json_each(NEW.original_snapshot_json, '$.criteria') WHERE type <> 'object'
      OR json_extract(value,'$.id') NOT IN ('DIAGNOSTIC','PAGE_BOUNDARY','READING_PATH','AUDIENCE_TRANSFER')
      OR json_type(value,'$.passed') NOT IN ('true','false') OR json_type(value,'$.label') <> 'text' OR json_type(value,'$.note') <> 'text')
    OR (SELECT sum(json_extract(value,'$.passed')) FROM json_each(NEW.original_snapshot_json, '$.criteria')) <> json_extract(NEW.original_snapshot_json,'$.score')
    OR (json_extract(NEW.original_snapshot_json,'$.passed') <> (json_extract(NEW.original_snapshot_json,'$.score')=4))
  ) THEN RAISE(ABORT, 'invalid book layout snapshot') END;
END;
--> statement-breakpoint
CREATE TRIGGER `teacher_decisions_snapshot_update_guard` BEFORE UPDATE OF original_snapshot_json,target_type,target_id,original_revision ON `teacher_decisions` BEGIN
  SELECT CASE WHEN NEW.target_type='LOGIC_REVIEW' AND EXISTS (
    SELECT 1 FROM json_each(NEW.original_snapshot_json, '$.issues')
    WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 200
  ) THEN RAISE(ABORT, 'invalid logic issues') END;
  SELECT CASE WHEN NEW.target_type='EVIDENCE' AND NOT (
    json_type(NEW.original_snapshot_json,'$.id')='text' AND json_type(NEW.original_snapshot_json,'$.kind')='text'
    AND json_type(NEW.original_snapshot_json,'$.layer')='text' AND json_type(NEW.original_snapshot_json,'$.verification')='text'
    AND json_type(NEW.original_snapshot_json,'$.revision')='integer' AND json_type(NEW.original_snapshot_json,'$.sequence')='integer'
  ) THEN RAISE(ABORT, 'invalid evidence snapshot') END;
  SELECT CASE WHEN NEW.target_type='TRANSFER' AND json_type(NEW.original_snapshot_json,'$.latestRubric')='object' AND coalesce((
    json_type(NEW.original_snapshot_json,'$.latestRubric.score')='integer'
    AND json_extract(NEW.original_snapshot_json,'$.latestRubric.score') BETWEEN 0 AND 4
    AND json_type(NEW.original_snapshot_json,'$.latestRubric.passed') IN ('true','false')
    AND json_extract(NEW.original_snapshot_json,'$.latestRubric.outcome') IN ('RETRY','PASSED','LOCKED')
  ),0)=0 THEN RAISE(ABORT, 'invalid transfer rubric') END;
  SELECT CASE WHEN NEW.target_type='BOOK_LAYOUT_EVIDENCE' AND (
    (SELECT count(DISTINCT value) FROM json_each(NEW.original_snapshot_json, '$.pageOrder')) <> 8
    OR EXISTS (SELECT 1 FROM json_each(NEW.original_snapshot_json, '$.pageOrder') WHERE type <> 'text' OR value NOT IN ('cover','quick-start','activity-map','featured-activity','calendar','community-voices','join-us','contact'))
    OR EXISTS (SELECT 1 FROM json_each(NEW.original_snapshot_json, '$.diagnosticAnswers') WHERE type <> 'text' OR value NOT IN ('AUDIENCE_FIRST','TASK_FIRST','DECORATION_FIRST'))
    OR EXISTS (SELECT 1 FROM json_each(NEW.original_snapshot_json, '$.transferChoices') WHERE type <> 'text' OR value NOT IN ('COMMUNITY_ENTRY_FIRST','VOLUNTEER_CALL_TO_ACTION','RETAIN_ACTIVITY_CORE'))
    OR (SELECT count(DISTINCT json_extract(value,'$.id')) FROM json_each(NEW.original_snapshot_json, '$.criteria')) <> 4
    OR EXISTS (SELECT 1 FROM json_each(NEW.original_snapshot_json, '$.criteria') WHERE type <> 'object'
      OR json_extract(value,'$.id') NOT IN ('DIAGNOSTIC','PAGE_BOUNDARY','READING_PATH','AUDIENCE_TRANSFER')
      OR json_type(value,'$.passed') NOT IN ('true','false') OR json_type(value,'$.label') <> 'text' OR json_type(value,'$.note') <> 'text')
    OR (SELECT sum(json_extract(value,'$.passed')) FROM json_each(NEW.original_snapshot_json, '$.criteria')) <> json_extract(NEW.original_snapshot_json,'$.score')
    OR (json_extract(NEW.original_snapshot_json,'$.passed') <> (json_extract(NEW.original_snapshot_json,'$.score')=4))
  ) THEN RAISE(ABORT, 'invalid book layout snapshot') END;
END;
--> statement-breakpoint
CREATE TRIGGER `teacher_decisions_transfer_validator_insert` BEFORE INSERT ON `teacher_decisions`
WHEN NEW.target_type='TRANSFER' BEGIN
  SELECT CASE WHEN NOT (
    (json_type(NEW.original_snapshot_json,'$.latestRubric')='null'
      AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=0
      AND json_type(NEW.original_snapshot_json,'$.latestOutcome')='null'
      AND json_extract(NEW.original_snapshot_json,'$.status')='OPEN')
    OR
    (json_type(NEW.original_snapshot_json,'$.latestRubric')='object'
      AND tonggan_validate_transfer_rubric(json_extract(NEW.original_snapshot_json,'$.latestRubric'))=1
      AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')=json_extract(NEW.original_snapshot_json,'$.latestRubric.outcome')
      AND ((json_extract(NEW.original_snapshot_json,'$.status')='OPEN' AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=1 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='RETRY')
        OR (json_extract(NEW.original_snapshot_json,'$.status')='PASSED' AND json_extract(NEW.original_snapshot_json,'$.attemptCount') BETWEEN 1 AND 2 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='PASSED')
        OR (json_extract(NEW.original_snapshot_json,'$.status')='LOCKED' AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=2 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='LOCKED')))
  ) THEN RAISE(ABORT, 'invalid transfer snapshot state') END;
END;
--> statement-breakpoint
CREATE TRIGGER `teacher_decisions_transfer_validator_update` BEFORE UPDATE OF original_snapshot_json,target_type,original_revision ON `teacher_decisions`
WHEN NEW.target_type='TRANSFER' BEGIN
  SELECT CASE WHEN NOT (
    (json_type(NEW.original_snapshot_json,'$.latestRubric')='null'
      AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=0
      AND json_type(NEW.original_snapshot_json,'$.latestOutcome')='null'
      AND json_extract(NEW.original_snapshot_json,'$.status')='OPEN')
    OR
    (json_type(NEW.original_snapshot_json,'$.latestRubric')='object'
      AND tonggan_validate_transfer_rubric(json_extract(NEW.original_snapshot_json,'$.latestRubric'))=1
      AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')=json_extract(NEW.original_snapshot_json,'$.latestRubric.outcome')
      AND ((json_extract(NEW.original_snapshot_json,'$.status')='OPEN' AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=1 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='RETRY')
        OR (json_extract(NEW.original_snapshot_json,'$.status')='PASSED' AND json_extract(NEW.original_snapshot_json,'$.attemptCount') BETWEEN 1 AND 2 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='PASSED')
        OR (json_extract(NEW.original_snapshot_json,'$.status')='LOCKED' AND json_extract(NEW.original_snapshot_json,'$.attemptCount')=2 AND json_extract(NEW.original_snapshot_json,'$.latestOutcome')='LOCKED')))
  ) THEN RAISE(ABORT, 'invalid transfer snapshot state') END;
END;
