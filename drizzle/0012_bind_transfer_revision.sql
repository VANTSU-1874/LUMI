PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transfer_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge_id` text NOT NULL,
	`project_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`challenge_revision` integer NOT NULL,
	`attempt_number` integer NOT NULL,
	`response_json` text NOT NULL,
	`rubric_json` text NOT NULL,
	`passed` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`challenge_id`,`project_id`,`student_id`,`class_id`,`challenge_revision`) REFERENCES `transfer_challenges`(`id`,`project_id`,`student_id`,`class_id`,`revision`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transfer_attempts_revision_check" CHECK("__new_transfer_attempts"."challenge_revision" > 0),
	CONSTRAINT "transfer_attempts_number_check" CHECK("__new_transfer_attempts"."attempt_number" between 1 and 2),
	CONSTRAINT "transfer_attempts_passed_check" CHECK("__new_transfer_attempts"."passed" in (0, 1)),
	CONSTRAINT "transfer_attempts_response_json_check" CHECK(coalesce((
      json_valid("__new_transfer_attempts"."response_json") and json_type("__new_transfer_attempts"."response_json") = 'object'
      and json_type("__new_transfer_attempts"."response_json", '$.retainedStructure') = 'text'
      and json_type("__new_transfer_attempts"."response_json", '$.changedParts') = 'text'
      and json_type("__new_transfer_attempts"."response_json", '$.normalization') = 'text'
      and json_type("__new_transfer_attempts"."response_json", '$.culturalImpact') = 'text'
    ), 0)),
	CONSTRAINT "transfer_attempts_rubric_json_check" CHECK(coalesce((
      json_valid("__new_transfer_attempts"."rubric_json") and json_type("__new_transfer_attempts"."rubric_json") = 'object'
      and json_type("__new_transfer_attempts"."rubric_json", '$.criteria') = 'object'
      and json_type("__new_transfer_attempts"."rubric_json", '$.score') = 'integer'
      and json_extract("__new_transfer_attempts"."rubric_json", '$.score') between 0 and 4
      and json_type("__new_transfer_attempts"."rubric_json", '$.passed') in ('true', 'false')
      and json_extract("__new_transfer_attempts"."rubric_json", '$.passed') = "__new_transfer_attempts"."passed"
      and json_type("__new_transfer_attempts"."rubric_json", '$.feedbackCodes') = 'array'
    ), 0))
);
--> statement-breakpoint
INSERT INTO `__new_transfer_attempts`("id", "challenge_id", "project_id", "class_id", "student_id", "challenge_revision", "attempt_number", "response_json", "rubric_json", "passed", "created_at") SELECT "id", "challenge_id", "project_id", "class_id", "student_id", "challenge_revision", "attempt_number", "response_json", "rubric_json", "passed", "created_at" FROM `transfer_attempts`;--> statement-breakpoint
DROP TABLE `transfer_attempts`;--> statement-breakpoint
ALTER TABLE `__new_transfer_attempts` RENAME TO `transfer_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_attempts_challenge_attempt_unique` ON `transfer_attempts` (`challenge_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `transfer_attempts_student_class_project_idx` ON `transfer_attempts` (`student_id`,`class_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `__new_transfer_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_hash` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`,`class_id`) REFERENCES `projects`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transfer_challenges_revision_check" CHECK("__new_transfer_challenges"."revision" > 0),
	CONSTRAINT "transfer_challenges_hash_check" CHECK(length("__new_transfer_challenges"."snapshot_hash") = 64 and "__new_transfer_challenges"."snapshot_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "transfer_challenges_status_check" CHECK("__new_transfer_challenges"."status" in ('OPEN', 'PASSED', 'LOCKED')),
	CONSTRAINT "transfer_challenges_attempt_count_check" CHECK("__new_transfer_challenges"."attempt_count" between 0 and 2),
	CONSTRAINT "transfer_challenges_status_attempt_check" CHECK(("__new_transfer_challenges"."status" = 'OPEN' and "__new_transfer_challenges"."attempt_count" between 0 and 1) or ("__new_transfer_challenges"."status" = 'PASSED' and "__new_transfer_challenges"."attempt_count" between 1 and 2) or ("__new_transfer_challenges"."status" = 'LOCKED' and "__new_transfer_challenges"."attempt_count" = 2)),
	CONSTRAINT "transfer_challenges_snapshot_json_check" CHECK(coalesce((
      json_valid("__new_transfer_challenges"."snapshot_json") and json_type("__new_transfer_challenges"."snapshot_json") = 'object'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.projectId') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.challengeRevision') = 'integer'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.challengeRevision') = "__new_transfer_challenges"."revision"
      and json_type("__new_transfer_challenges"."snapshot_json", '$.changedDimension') = 'text'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.changedDimension') in ('input', 'mapping', 'output')
      and json_type("__new_transfer_challenges"."snapshot_json", '$.prompt') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain') = 'object'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain.culturalIntent') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain.structure') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain.input') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain.mapping') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain.output') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.change') = 'object'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.change.dimension') = json_extract("__new_transfer_challenges"."snapshot_json", '$.changedDimension')
      and json_type("__new_transfer_challenges"."snapshot_json", '$.change.from') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.change.to') = 'text'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.path') in ('DIGISHOW', 'TOUCHDESIGNER', 'COLLABORATIVE')
      and json_type("__new_transfer_challenges"."snapshot_json", '$.evidenceCodes') = 'array'
      and json_array_length("__new_transfer_challenges"."snapshot_json", '$.evidenceCodes') between 1 and 100
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.snapshotHash') = "__new_transfer_challenges"."snapshot_hash"
    ), 0))
);
--> statement-breakpoint
INSERT INTO `__new_transfer_challenges`("id", "project_id", "class_id", "student_id", "revision", "snapshot_hash", "snapshot_json", "status", "attempt_count", "created_at", "updated_at") SELECT "id", "project_id", "class_id", "student_id", "revision", "snapshot_hash", "snapshot_json", "status", "attempt_count", "created_at", "updated_at" FROM `transfer_challenges`;--> statement-breakpoint
DROP TABLE `transfer_challenges`;--> statement-breakpoint
ALTER TABLE `__new_transfer_challenges` RENAME TO `transfer_challenges`;--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_challenges_project_unique` ON `transfer_challenges` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_challenges_id_project_student_class_revision_unique` ON `transfer_challenges` (`id`,`project_id`,`student_id`,`class_id`,`revision`);--> statement-breakpoint
CREATE INDEX `transfer_challenges_student_class_status_idx` ON `transfer_challenges` (`student_id`,`class_id`,`status`);