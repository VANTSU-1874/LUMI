CREATE TABLE `inspiration_wiki_hermes_batches` (
	`batch_id` text PRIMARY KEY NOT NULL,
	`contract_version` text NOT NULL,
	`package_digest` text NOT NULL,
	`manifest_json` text NOT NULL,
	`done_json` text NOT NULL,
	`candidate_count` integer NOT NULL,
	`failure_count` integer NOT NULL,
	`intake_state` text NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`imported_at` integer NOT NULL,
	CONSTRAINT "inspiration_wiki_hermes_batches_digest_check" CHECK(length("inspiration_wiki_hermes_batches"."package_digest") = 64 and "inspiration_wiki_hermes_batches"."package_digest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_hermes_batches_counts_check" CHECK("inspiration_wiki_hermes_batches"."candidate_count" between 0 and 10000 and "inspiration_wiki_hermes_batches"."failure_count" between 0 and 10000),
	CONSTRAINT "inspiration_wiki_hermes_batches_json_check" CHECK(json_valid("inspiration_wiki_hermes_batches"."manifest_json") and json_type("inspiration_wiki_hermes_batches"."manifest_json") = 'object' and json_valid("inspiration_wiki_hermes_batches"."done_json") and json_type("inspiration_wiki_hermes_batches"."done_json") = 'object'),
	CONSTRAINT "inspiration_wiki_hermes_batches_private_check" CHECK("inspiration_wiki_hermes_batches"."contract_version" = 'LEGACY_V1' and "inspiration_wiki_hermes_batches"."intake_state" = 'VALIDATED_PRIVATE' and "inspiration_wiki_hermes_batches"."student_visible" = 0 and "inspiration_wiki_hermes_batches"."current_page" = 'DISABLED' and "inspiration_wiki_hermes_batches"."r2" = 'DISABLED' and "inspiration_wiki_hermes_batches"."embedding" = 'DISABLED' and "inspiration_wiki_hermes_batches"."lumi_retrieval" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_hermes_batches_digest_unique` ON `inspiration_wiki_hermes_batches` (`package_digest`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_hermes_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`source_candidate_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`contract_state` text NOT NULL,
	`review_state` text DEFAULT 'PENDING_REVIEW' NOT NULL,
	`source_id` text NOT NULL,
	`source_platform` text NOT NULL,
	`page_url` text NOT NULL,
	`canonical_url` text,
	`title` text,
	`description` text,
	`author_json` text,
	`license_json` text,
	`media_json` text NOT NULL,
	`design_categories_json` text NOT NULL,
	`screening_json` text NOT NULL,
	`raw_candidate_json` text NOT NULL,
	`raw_digest` text NOT NULL,
	`dedupe_fingerprint` text NOT NULL,
	`scope` text DEFAULT 'PRIVATE_CANDIDATE' NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`wiki_draft` text DEFAULT 'NOT_CREATED' NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `inspiration_wiki_hermes_batches`(`batch_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_hermes_candidates_revision_check" CHECK("inspiration_wiki_hermes_candidates"."revision" > 0),
	CONSTRAINT "inspiration_wiki_hermes_candidates_url_check" CHECK("inspiration_wiki_hermes_candidates"."page_url" like 'https://%' and ("inspiration_wiki_hermes_candidates"."canonical_url" is null or "inspiration_wiki_hermes_candidates"."canonical_url" like 'https://%')),
	CONSTRAINT "inspiration_wiki_hermes_candidates_digest_check" CHECK(length("inspiration_wiki_hermes_candidates"."raw_digest") = 64 and "inspiration_wiki_hermes_candidates"."raw_digest" not glob '*[^0-9a-f]*' and length("inspiration_wiki_hermes_candidates"."dedupe_fingerprint") = 64 and "inspiration_wiki_hermes_candidates"."dedupe_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_hermes_candidates_json_check" CHECK(("inspiration_wiki_hermes_candidates"."author_json" is null or (json_valid("inspiration_wiki_hermes_candidates"."author_json") and json_type("inspiration_wiki_hermes_candidates"."author_json") = 'object')) and ("inspiration_wiki_hermes_candidates"."license_json" is null or (json_valid("inspiration_wiki_hermes_candidates"."license_json") and json_type("inspiration_wiki_hermes_candidates"."license_json") = 'object')) and json_valid("inspiration_wiki_hermes_candidates"."media_json") and json_type("inspiration_wiki_hermes_candidates"."media_json") = 'array' and json_array_length("inspiration_wiki_hermes_candidates"."media_json") > 0 and json_valid("inspiration_wiki_hermes_candidates"."design_categories_json") and json_type("inspiration_wiki_hermes_candidates"."design_categories_json") = 'array' and json_array_length("inspiration_wiki_hermes_candidates"."design_categories_json") > 0 and json_valid("inspiration_wiki_hermes_candidates"."screening_json") and json_type("inspiration_wiki_hermes_candidates"."screening_json") = 'object' and json_valid("inspiration_wiki_hermes_candidates"."raw_candidate_json") and json_type("inspiration_wiki_hermes_candidates"."raw_candidate_json") = 'object'),
	CONSTRAINT "inspiration_wiki_hermes_candidates_state_check" CHECK("inspiration_wiki_hermes_candidates"."contract_state" = 'V1_UPGRADE_REQUIRED' and "inspiration_wiki_hermes_candidates"."review_state" in ('PENDING_REVIEW','NORMALIZATION_REQUIRED','DUPLICATE_HOLD','RIGHTS_HOLD','REJECTED')),
	CONSTRAINT "inspiration_wiki_hermes_candidates_private_check" CHECK("inspiration_wiki_hermes_candidates"."scope" = 'PRIVATE_CANDIDATE' and "inspiration_wiki_hermes_candidates"."student_visible" = 0 and "inspiration_wiki_hermes_candidates"."wiki_draft" = 'NOT_CREATED' and "inspiration_wiki_hermes_candidates"."current_page" = 'DISABLED' and "inspiration_wiki_hermes_candidates"."r2" = 'DISABLED' and "inspiration_wiki_hermes_candidates"."embedding" = 'DISABLED' and "inspiration_wiki_hermes_candidates"."lumi_retrieval" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_hermes_candidates_batch_source_unique` ON `inspiration_wiki_hermes_candidates` (`batch_id`,`source_candidate_id`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_hermes_candidates_queue_idx` ON `inspiration_wiki_hermes_candidates` (`review_state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_hermes_candidates_fingerprint_idx` ON `inspiration_wiki_hermes_candidates` (`dedupe_fingerprint`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_hermes_candidates_page_idx` ON `inspiration_wiki_hermes_candidates` (`page_url`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_hermes_triage_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`candidate_revision` integer NOT NULL,
	`teacher_id` text NOT NULL,
	`decision` text NOT NULL,
	`previous_state` text NOT NULL,
	`next_state` text NOT NULL,
	`note` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_wiki_hermes_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_hermes_triage_revision_check" CHECK("inspiration_wiki_hermes_triage_decisions"."candidate_revision" > 0),
	CONSTRAINT "inspiration_wiki_hermes_triage_note_check" CHECK(length("inspiration_wiki_hermes_triage_decisions"."note") <= 1000),
	CONSTRAINT "inspiration_wiki_hermes_triage_key_check" CHECK(length("inspiration_wiki_hermes_triage_decisions"."idempotency_key") between 8 and 128),
	CONSTRAINT "inspiration_wiki_hermes_triage_hash_check" CHECK(length("inspiration_wiki_hermes_triage_decisions"."request_hash") = 64 and "inspiration_wiki_hermes_triage_decisions"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_hermes_triage_state_check" CHECK("inspiration_wiki_hermes_triage_decisions"."previous_state" in ('PENDING_REVIEW','NORMALIZATION_REQUIRED','DUPLICATE_HOLD','RIGHTS_HOLD','REJECTED') and "inspiration_wiki_hermes_triage_decisions"."next_state" in ('PENDING_REVIEW','NORMALIZATION_REQUIRED','DUPLICATE_HOLD','RIGHTS_HOLD','REJECTED')),
	CONSTRAINT "inspiration_wiki_hermes_triage_transition_check" CHECK(("inspiration_wiki_hermes_triage_decisions"."decision" = 'RESTORE_PENDING' and "inspiration_wiki_hermes_triage_decisions"."next_state" = 'PENDING_REVIEW') or ("inspiration_wiki_hermes_triage_decisions"."decision" = 'REQUEST_NORMALIZATION' and "inspiration_wiki_hermes_triage_decisions"."next_state" = 'NORMALIZATION_REQUIRED') or ("inspiration_wiki_hermes_triage_decisions"."decision" = 'HOLD_DUPLICATE' and "inspiration_wiki_hermes_triage_decisions"."next_state" = 'DUPLICATE_HOLD') or ("inspiration_wiki_hermes_triage_decisions"."decision" = 'HOLD_RIGHTS' and "inspiration_wiki_hermes_triage_decisions"."next_state" = 'RIGHTS_HOLD') or ("inspiration_wiki_hermes_triage_decisions"."decision" = 'REJECT' and "inspiration_wiki_hermes_triage_decisions"."next_state" = 'REJECTED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_hermes_triage_teacher_key_unique` ON `inspiration_wiki_hermes_triage_decisions` (`teacher_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_hermes_triage_candidate_created_idx` ON `inspiration_wiki_hermes_triage_decisions` (`candidate_id`,`created_at`);