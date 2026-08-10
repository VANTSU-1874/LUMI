CREATE TABLE `teacher_decisions` (
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
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`class_id`) REFERENCES `projects`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "teacher_decisions_target_check" CHECK("teacher_decisions"."target_type" in ('LOGIC_REVIEW', 'EVIDENCE', 'TRANSFER')),
	CONSTRAINT "teacher_decisions_decision_check" CHECK("teacher_decisions"."decision" in ('CONFIRMED', 'CORRECTED', 'NEEDS_REVIEW')),
	CONSTRAINT "teacher_decisions_revision_check" CHECK("teacher_decisions"."original_revision" > 0),
	CONSTRAINT "teacher_decisions_sequence_check" CHECK("teacher_decisions"."sequence" > 0),
	CONSTRAINT "teacher_decisions_teacher_length_check" CHECK(length(trim("teacher_decisions"."teacher_id")) between 1 and 128),
	CONSTRAINT "teacher_decisions_target_id_length_check" CHECK(length(trim("teacher_decisions"."target_id")) between 1 and 128),
	CONSTRAINT "teacher_decisions_reason_length_check" CHECK(length(trim("teacher_decisions"."reason_code")) between 1 and 64),
	CONSTRAINT "teacher_decisions_notes_length_check" CHECK(length("teacher_decisions"."notes") <= 1000),
	CONSTRAINT "teacher_decisions_idempotency_length_check" CHECK(length("teacher_decisions"."idempotency_key") between 8 and 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_decisions_teacher_class_idempotency_unique` ON `teacher_decisions` (`teacher_id`,`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_decisions_target_sequence_unique` ON `teacher_decisions` (`class_id`,`target_type`,`target_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `teacher_decisions_class_created_idx` ON `teacher_decisions` (`class_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `teacher_decisions_student_project_created_idx` ON `teacher_decisions` (`student_id`,`project_id`,`created_at`);