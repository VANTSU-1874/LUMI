CREATE TABLE `student_identity_codes` (
	`code_digest` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`claimed_user_id` text,
	`created_at` integer NOT NULL,
	`claimed_at` integer,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`claimed_user_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "student_identity_codes_digest_check" CHECK(length("student_identity_codes"."code_digest") = 64),
	CONSTRAINT "student_identity_codes_claim_state_check" CHECK(("student_identity_codes"."claimed_user_id" is null and "student_identity_codes"."claimed_at" is null) or ("student_identity_codes"."claimed_user_id" is not null and "student_identity_codes"."claimed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `student_identity_codes_class_id_idx` ON `student_identity_codes` (`class_id`);