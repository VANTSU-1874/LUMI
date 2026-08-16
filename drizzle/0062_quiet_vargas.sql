CREATE TABLE `inspiration_wiki_release_qualification_cases` (
	`case_id` text PRIMARY KEY NOT NULL,
	`case_hash` text NOT NULL,
	`entry_id` text NOT NULL,
	`page_id` text NOT NULL,
	`page_revision_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`primary_category` text NOT NULL,
	`case_json` text NOT NULL,
	`teacher_private` integer DEFAULT true NOT NULL,
	`formal_qualification_only` integer DEFAULT true NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`formal_release` text DEFAULT 'DISABLED' NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`browse_release` text DEFAULT 'SHADOW' NOT NULL,
	`student_search` text DEFAULT 'SHADOW' NOT NULL,
	`wiki_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`production_deployment` text DEFAULT 'DISABLED' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `inspiration_wiki_private_internal_catalog_entries`(`entry_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_id`) REFERENCES `inspiration_wiki_private_pages`(`page_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_revision_id`) REFERENCES `inspiration_wiki_private_page_revisions`(`revision_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_release_qualification_case_id_check" CHECK("inspiration_wiki_release_qualification_cases"."case_id" glob 'release-qualification:*'),
	CONSTRAINT "inspiration_wiki_release_qualification_case_hash_check" CHECK(length("inspiration_wiki_release_qualification_cases"."case_hash") = 71 and "inspiration_wiki_release_qualification_cases"."case_hash" like 'sha256:%' and length("inspiration_wiki_release_qualification_cases"."content_hash") = 64 and "inspiration_wiki_release_qualification_cases"."content_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_release_qualification_case_json_check" CHECK(json_valid("inspiration_wiki_release_qualification_cases"."case_json") and json_type("inspiration_wiki_release_qualification_cases"."case_json") = 'object'),
	CONSTRAINT "inspiration_wiki_release_qualification_case_boundary_check" CHECK("inspiration_wiki_release_qualification_cases"."teacher_private" = 1 and "inspiration_wiki_release_qualification_cases"."formal_qualification_only" = 1 and "inspiration_wiki_release_qualification_cases"."student_visible" = 0 and "inspiration_wiki_release_qualification_cases"."formal_release" = 'DISABLED' and "inspiration_wiki_release_qualification_cases"."current_page" = 'DISABLED' and "inspiration_wiki_release_qualification_cases"."browse_release" = 'SHADOW' and "inspiration_wiki_release_qualification_cases"."student_search" = 'SHADOW' and "inspiration_wiki_release_qualification_cases"."wiki_retrieval" = 'DISABLED' and "inspiration_wiki_release_qualification_cases"."r2" = 'DISABLED' and "inspiration_wiki_release_qualification_cases"."embedding" = 'DISABLED' and "inspiration_wiki_release_qualification_cases"."lumi_retrieval" = 'DISABLED' and "inspiration_wiki_release_qualification_cases"."production_deployment" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_release_qualification_entry_unique` ON `inspiration_wiki_release_qualification_cases` (`entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_release_qualification_revision_unique` ON `inspiration_wiki_release_qualification_cases` (`page_revision_id`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_release_qualification_category_idx` ON `inspiration_wiki_release_qualification_cases` (`primary_category`,`created_at`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_release_qualification_decisions` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`decision_hash` text NOT NULL,
	`request_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`case_id` text NOT NULL,
	`gate` text NOT NULL,
	`status` text NOT NULL,
	`evidence_ref` text,
	`note` text NOT NULL,
	`actor_id` text NOT NULL,
	`revision` integer NOT NULL,
	`decision_json` text NOT NULL,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `inspiration_wiki_release_qualification_cases`(`case_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_release_qualification_decision_id_check" CHECK("inspiration_wiki_release_qualification_decisions"."decision_id" glob 'release-qualification-decision:*'),
	CONSTRAINT "inspiration_wiki_release_qualification_decision_hash_check" CHECK(length("inspiration_wiki_release_qualification_decisions"."decision_hash") = 71 and "inspiration_wiki_release_qualification_decisions"."decision_hash" like 'sha256:%' and length("inspiration_wiki_release_qualification_decisions"."request_hash") = 71 and "inspiration_wiki_release_qualification_decisions"."request_hash" like 'sha256:%'),
	CONSTRAINT "inspiration_wiki_release_qualification_decision_json_check" CHECK(json_valid("inspiration_wiki_release_qualification_decisions"."decision_json") and json_type("inspiration_wiki_release_qualification_decisions"."decision_json") = 'object'),
	CONSTRAINT "inspiration_wiki_release_qualification_decision_revision_check" CHECK("inspiration_wiki_release_qualification_decisions"."revision" >= 1),
	CONSTRAINT "inspiration_wiki_release_qualification_rights_evidence_check" CHECK("inspiration_wiki_release_qualification_decisions"."gate" <> 'STUDENT_DISPLAY_RIGHTS' or "inspiration_wiki_release_qualification_decisions"."status" <> 'SATISFIED' or ("inspiration_wiki_release_qualification_decisions"."evidence_ref" is not null and length(trim("inspiration_wiki_release_qualification_decisions"."evidence_ref")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_release_qualification_idempotency_unique` ON `inspiration_wiki_release_qualification_decisions` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_release_qualification_gate_revision_unique` ON `inspiration_wiki_release_qualification_decisions` (`case_id`,`gate`,`revision`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_release_qualification_decision_case_idx` ON `inspiration_wiki_release_qualification_decisions` (`case_id`,`decided_at`);
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_release_qualification_cases_no_update`
BEFORE UPDATE ON `inspiration_wiki_release_qualification_cases`
BEGIN
  SELECT RAISE(ABORT, 'D25_RELEASE_QUALIFICATION_CASE_APPEND_ONLY');
END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_release_qualification_cases_no_delete`
BEFORE DELETE ON `inspiration_wiki_release_qualification_cases`
BEGIN
  SELECT RAISE(ABORT, 'D25_RELEASE_QUALIFICATION_CASE_APPEND_ONLY');
END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_release_qualification_decisions_no_update`
BEFORE UPDATE ON `inspiration_wiki_release_qualification_decisions`
BEGIN
  SELECT RAISE(ABORT, 'D25_RELEASE_QUALIFICATION_DECISION_APPEND_ONLY');
END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_release_qualification_decisions_no_delete`
BEFORE DELETE ON `inspiration_wiki_release_qualification_decisions`
BEGIN
  SELECT RAISE(ABORT, 'D25_RELEASE_QUALIFICATION_DECISION_APPEND_ONLY');
END;
