CREATE TABLE `inspiration_wiki_private_domain_review_cases` (
	`review_case_id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`draft_revision` integer NOT NULL,
	`draft_content_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`state_hash` text NOT NULL,
	`stage` text NOT NULL,
	`domains_json` text NOT NULL,
	`case_json` text NOT NULL,
	`reviewed_domain_count` integer NOT NULL,
	`title` text NOT NULL,
	`primary_category` text NOT NULL,
	`primary_preview_url` text NOT NULL,
	`rights_scope` text NOT NULL,
	`teacher_private` integer DEFAULT true NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`canonical_compilation` text DEFAULT 'DISABLED' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `inspiration_wiki_private_working_drafts`(`draft_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_wiki_hermes_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_private_domain_review_cases_revision_check" CHECK("inspiration_wiki_private_domain_review_cases"."draft_revision" > 0 and "inspiration_wiki_private_domain_review_cases"."revision" > 0),
	CONSTRAINT "inspiration_wiki_private_domain_review_cases_hash_check" CHECK(length("inspiration_wiki_private_domain_review_cases"."draft_content_hash") = 64 and "inspiration_wiki_private_domain_review_cases"."draft_content_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_private_domain_review_cases"."state_hash") = 64 and "inspiration_wiki_private_domain_review_cases"."state_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_private_domain_review_cases_stage_check" CHECK("inspiration_wiki_private_domain_review_cases"."stage" in ('PENDING_DOMAIN_REVIEW','DOMAIN_REVIEW_HOLD','PRIVATE_DRAFT_REJECTED','DOMAIN_REVIEW_COMPLETE')),
	CONSTRAINT "inspiration_wiki_private_domain_review_cases_json_check" CHECK(json_valid("inspiration_wiki_private_domain_review_cases"."domains_json") and json_type("inspiration_wiki_private_domain_review_cases"."domains_json") = 'object' and json_valid("inspiration_wiki_private_domain_review_cases"."case_json") and json_type("inspiration_wiki_private_domain_review_cases"."case_json") = 'object'),
	CONSTRAINT "inspiration_wiki_private_domain_review_cases_count_check" CHECK("inspiration_wiki_private_domain_review_cases"."reviewed_domain_count" between 0 and 4),
	CONSTRAINT "inspiration_wiki_private_domain_review_cases_preview_check" CHECK("inspiration_wiki_private_domain_review_cases"."primary_preview_url" like '/api/teacher/inspiration-wiki/review-packs/%'),
	CONSTRAINT "inspiration_wiki_private_domain_review_cases_boundary_check" CHECK("inspiration_wiki_private_domain_review_cases"."rights_scope" = 'UNKNOWN_PRIVATE_ONLY' and "inspiration_wiki_private_domain_review_cases"."teacher_private" = 1 and "inspiration_wiki_private_domain_review_cases"."student_visible" = 0 and "inspiration_wiki_private_domain_review_cases"."current_page" = 'DISABLED' and "inspiration_wiki_private_domain_review_cases"."r2" = 'DISABLED' and "inspiration_wiki_private_domain_review_cases"."embedding" = 'DISABLED' and "inspiration_wiki_private_domain_review_cases"."lumi_retrieval" = 'DISABLED' and "inspiration_wiki_private_domain_review_cases"."canonical_compilation" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_domain_review_cases_draft_revision_unique` ON `inspiration_wiki_private_domain_review_cases` (`draft_id`,`draft_revision`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_private_domain_review_cases_stage_updated_idx` ON `inspiration_wiki_private_domain_review_cases` (`stage`,`updated_at`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_private_domain_review_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_case_id` text NOT NULL,
	`previous_case_revision` integer NOT NULL,
	`next_case_revision` integer NOT NULL,
	`review_domain` text NOT NULL,
	`decision` text NOT NULL,
	`assessment_json` text NOT NULL,
	`note` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`previous_stage` text NOT NULL,
	`next_stage` text NOT NULL,
	`previous_state_hash` text NOT NULL,
	`next_state_hash` text NOT NULL,
	`supersedes_decision_id` text,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`previous_case_json` text NOT NULL,
	`next_case_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_case_id`) REFERENCES `inspiration_wiki_private_domain_review_cases`(`review_case_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_private_domain_review_decisions_revision_check" CHECK("inspiration_wiki_private_domain_review_decisions"."previous_case_revision" > 0 and "inspiration_wiki_private_domain_review_decisions"."next_case_revision" = "inspiration_wiki_private_domain_review_decisions"."previous_case_revision" + 1),
	CONSTRAINT "inspiration_wiki_private_domain_review_decisions_domain_check" CHECK("inspiration_wiki_private_domain_review_decisions"."review_domain" in ('CURATION','TEACHING','RIGHTS','SAFETY') and "inspiration_wiki_private_domain_review_decisions"."decision" in ('APPROVE','HOLD','REJECT')),
	CONSTRAINT "inspiration_wiki_private_domain_review_decisions_json_check" CHECK(json_valid("inspiration_wiki_private_domain_review_decisions"."assessment_json") and json_type("inspiration_wiki_private_domain_review_decisions"."assessment_json") = 'object' and json_valid("inspiration_wiki_private_domain_review_decisions"."previous_case_json") and json_type("inspiration_wiki_private_domain_review_decisions"."previous_case_json") = 'object' and json_valid("inspiration_wiki_private_domain_review_decisions"."next_case_json") and json_type("inspiration_wiki_private_domain_review_decisions"."next_case_json") = 'object'),
	CONSTRAINT "inspiration_wiki_private_domain_review_decisions_hash_check" CHECK(length("inspiration_wiki_private_domain_review_decisions"."previous_state_hash") = 64 and "inspiration_wiki_private_domain_review_decisions"."previous_state_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_private_domain_review_decisions"."next_state_hash") = 64 and "inspiration_wiki_private_domain_review_decisions"."next_state_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_private_domain_review_decisions"."request_hash") = 64 and "inspiration_wiki_private_domain_review_decisions"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_private_domain_review_decisions_note_check" CHECK(length("inspiration_wiki_private_domain_review_decisions"."note") <= 300 and (("inspiration_wiki_private_domain_review_decisions"."decision" = 'APPROVE') or length(trim("inspiration_wiki_private_domain_review_decisions"."note")) between 1 and 300)),
	CONSTRAINT "inspiration_wiki_private_domain_review_decisions_key_check" CHECK(length("inspiration_wiki_private_domain_review_decisions"."idempotency_key") between 8 and 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_domain_review_decisions_reviewer_key_unique` ON `inspiration_wiki_private_domain_review_decisions` (`reviewer_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_domain_review_decisions_case_revision_unique` ON `inspiration_wiki_private_domain_review_decisions` (`review_case_id`,`next_case_revision`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_private_domain_review_decisions_case_created_idx` ON `inspiration_wiki_private_domain_review_decisions` (`review_case_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_private_domain_review_decisions_no_update`
BEFORE UPDATE ON `inspiration_wiki_private_domain_review_decisions`
BEGIN
  SELECT RAISE(ABORT, 'PRIVATE_DOMAIN_REVIEW_DECISION_APPEND_ONLY');
END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_private_domain_review_decisions_no_delete`
BEFORE DELETE ON `inspiration_wiki_private_domain_review_decisions`
BEGIN
  SELECT RAISE(ABORT, 'PRIVATE_DOMAIN_REVIEW_DECISION_APPEND_ONLY');
END;
