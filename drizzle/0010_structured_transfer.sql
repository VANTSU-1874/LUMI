PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `transfer_challenges` RENAME TO `legacy_transfer_challenges`;--> statement-breakpoint
CREATE TABLE `transfer_challenges` (
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
	CONSTRAINT "transfer_challenges_revision_check" CHECK("transfer_challenges"."revision" > 0),
	CONSTRAINT "transfer_challenges_hash_check" CHECK(length("transfer_challenges"."snapshot_hash") = 64 and "transfer_challenges"."snapshot_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "transfer_challenges_status_check" CHECK("transfer_challenges"."status" in ('OPEN', 'PASSED', 'LOCKED')),
	CONSTRAINT "transfer_challenges_attempt_count_check" CHECK("transfer_challenges"."attempt_count" between 0 and 2),
	CONSTRAINT "transfer_challenges_status_attempt_check" CHECK(("transfer_challenges"."status" = 'OPEN' and "transfer_challenges"."attempt_count" between 0 and 1) or ("transfer_challenges"."status" = 'PASSED' and "transfer_challenges"."attempt_count" between 1 and 2) or ("transfer_challenges"."status" = 'LOCKED' and "transfer_challenges"."attempt_count" = 2)),
	CONSTRAINT "transfer_challenges_snapshot_json_check" CHECK(
      json_valid("transfer_challenges"."snapshot_json") and json_type("transfer_challenges"."snapshot_json") = 'object'
      and json_type("transfer_challenges"."snapshot_json", '$.projectId') = 'text'
      and json_type("transfer_challenges"."snapshot_json", '$.challengeRevision') = 'integer'
      and json_extract("transfer_challenges"."snapshot_json", '$.challengeRevision') = "transfer_challenges"."revision"
      and json_type("transfer_challenges"."snapshot_json", '$.changedDimension') = 'text'
      and json_extract("transfer_challenges"."snapshot_json", '$.changedDimension') in ('input', 'mapping', 'output')
      and json_type("transfer_challenges"."snapshot_json", '$.prompt') = 'text'
      and json_type("transfer_challenges"."snapshot_json", '$.mustRetain') = 'object'
      and json_type("transfer_challenges"."snapshot_json", '$.change') = 'object'
      and json_type("transfer_challenges"."snapshot_json", '$.evidenceCodes') = 'array'
      and json_extract("transfer_challenges"."snapshot_json", '$.snapshotHash') = "transfer_challenges"."snapshot_hash"
    )
);--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_challenges_project_unique` ON `transfer_challenges` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_challenges_id_project_student_class_unique` ON `transfer_challenges` (`id`,`project_id`,`student_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `transfer_challenges_student_class_status_idx` ON `transfer_challenges` (`student_id`,`class_id`,`status`);--> statement-breakpoint
CREATE TABLE `transfer_attempts` (
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
	FOREIGN KEY (`challenge_id`,`project_id`,`student_id`,`class_id`) REFERENCES `transfer_challenges`(`id`,`project_id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transfer_attempts_revision_check" CHECK("transfer_attempts"."challenge_revision" > 0),
	CONSTRAINT "transfer_attempts_number_check" CHECK("transfer_attempts"."attempt_number" between 1 and 2),
	CONSTRAINT "transfer_attempts_passed_check" CHECK("transfer_attempts"."passed" in (0, 1)),
	CONSTRAINT "transfer_attempts_response_json_check" CHECK(
      json_valid("transfer_attempts"."response_json") and json_type("transfer_attempts"."response_json") = 'object'
      and json_type("transfer_attempts"."response_json", '$.retainedStructure') = 'text'
      and json_type("transfer_attempts"."response_json", '$.changedParts') = 'text'
      and json_type("transfer_attempts"."response_json", '$.normalization') = 'text'
      and json_type("transfer_attempts"."response_json", '$.culturalImpact') = 'text'
    ),
	CONSTRAINT "transfer_attempts_rubric_json_check" CHECK(
      json_valid("transfer_attempts"."rubric_json") and json_type("transfer_attempts"."rubric_json") = 'object'
      and json_type("transfer_attempts"."rubric_json", '$.criteria') = 'object'
      and json_type("transfer_attempts"."rubric_json", '$.score') = 'integer'
      and json_extract("transfer_attempts"."rubric_json", '$.score') between 0 and 4
      and json_type("transfer_attempts"."rubric_json", '$.passed') in ('true', 'false')
      and json_extract("transfer_attempts"."rubric_json", '$.passed') = "transfer_attempts"."passed"
      and json_type("transfer_attempts"."rubric_json", '$.feedbackCodes') = 'array'
    )
);--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_attempts_challenge_attempt_unique` ON `transfer_attempts` (`challenge_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `transfer_attempts_student_class_project_idx` ON `transfer_attempts` (`student_id`,`class_id`,`project_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
