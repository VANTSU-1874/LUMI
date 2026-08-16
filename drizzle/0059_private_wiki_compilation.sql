CREATE TABLE `inspiration_wiki_private_compiled_truths` (
	`truth_id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`truth_hash` text NOT NULL,
	`content_hash` text NOT NULL,
	`state` text NOT NULL,
	`rights_scope` text NOT NULL,
	`truth_json` text NOT NULL,
	`teacher_private` integer DEFAULT true NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`canonical_compilation` text DEFAULT 'DISABLED' NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`formal_release` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`compiled_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `inspiration_wiki_private_pages`(`page_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`revision_id`) REFERENCES `inspiration_wiki_private_page_revisions`(`revision_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_private_compiled_truths_hash_check" CHECK(length("inspiration_wiki_private_compiled_truths"."truth_hash") = 64 and "inspiration_wiki_private_compiled_truths"."truth_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_private_compiled_truths"."content_hash") = 64 and "inspiration_wiki_private_compiled_truths"."content_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_private_compiled_truths_json_check" CHECK(json_valid("inspiration_wiki_private_compiled_truths"."truth_json") and json_type("inspiration_wiki_private_compiled_truths"."truth_json") = 'object'),
	CONSTRAINT "inspiration_wiki_private_compiled_truths_boundary_check" CHECK("inspiration_wiki_private_compiled_truths"."state" = 'PRIVATE_COMPILED_PREVIEW' and "inspiration_wiki_private_compiled_truths"."rights_scope" = 'UNKNOWN_PRIVATE_ONLY' and "inspiration_wiki_private_compiled_truths"."teacher_private" = 1 and "inspiration_wiki_private_compiled_truths"."student_visible" = 0 and "inspiration_wiki_private_compiled_truths"."canonical_compilation" = 'DISABLED' and "inspiration_wiki_private_compiled_truths"."current_page" = 'DISABLED' and "inspiration_wiki_private_compiled_truths"."formal_release" = 'DISABLED' and "inspiration_wiki_private_compiled_truths"."r2" = 'DISABLED' and "inspiration_wiki_private_compiled_truths"."embedding" = 'DISABLED' and "inspiration_wiki_private_compiled_truths"."lumi_retrieval" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_compiled_truths_revision_unique` ON `inspiration_wiki_private_compiled_truths` (`revision_id`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_private_compiled_truths_page_idx` ON `inspiration_wiki_private_compiled_truths` (`page_id`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_private_page_revisions` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`revision` integer NOT NULL,
	`revision_hash` text NOT NULL,
	`content_hash` text NOT NULL,
	`draft_id` text NOT NULL,
	`draft_revision` integer NOT NULL,
	`draft_content_hash` text NOT NULL,
	`review_case_id` text NOT NULL,
	`review_case_revision` integer NOT NULL,
	`review_state_hash` text NOT NULL,
	`decision_ids_json` text NOT NULL,
	`content_json` text NOT NULL,
	`revision_json` text NOT NULL,
	`compiled_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `inspiration_wiki_private_pages`(`page_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_wiki_hermes_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`draft_id`) REFERENCES `inspiration_wiki_private_working_drafts`(`draft_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`review_case_id`) REFERENCES `inspiration_wiki_private_domain_review_cases`(`review_case_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_private_page_revisions_revision_check" CHECK("inspiration_wiki_private_page_revisions"."revision" > 0 and "inspiration_wiki_private_page_revisions"."draft_revision" > 0 and "inspiration_wiki_private_page_revisions"."review_case_revision" > 0),
	CONSTRAINT "inspiration_wiki_private_page_revisions_hash_check" CHECK(length("inspiration_wiki_private_page_revisions"."revision_hash") = 64 and "inspiration_wiki_private_page_revisions"."revision_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_private_page_revisions"."content_hash") = 64 and "inspiration_wiki_private_page_revisions"."content_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_private_page_revisions"."draft_content_hash") = 64 and "inspiration_wiki_private_page_revisions"."draft_content_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_private_page_revisions"."review_state_hash") = 64 and "inspiration_wiki_private_page_revisions"."review_state_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_private_page_revisions_json_check" CHECK(json_valid("inspiration_wiki_private_page_revisions"."decision_ids_json") and json_type("inspiration_wiki_private_page_revisions"."decision_ids_json") = 'object' and json_valid("inspiration_wiki_private_page_revisions"."content_json") and json_type("inspiration_wiki_private_page_revisions"."content_json") = 'object' and json_valid("inspiration_wiki_private_page_revisions"."revision_json") and json_type("inspiration_wiki_private_page_revisions"."revision_json") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_page_revisions_page_revision_unique` ON `inspiration_wiki_private_page_revisions` (`page_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_page_revisions_source_unique` ON `inspiration_wiki_private_page_revisions` (`review_case_id`,`review_case_revision`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_private_page_revisions_candidate_idx` ON `inspiration_wiki_private_page_revisions` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_private_pages` (
	`page_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`page_type` text NOT NULL,
	`state` text NOT NULL,
	`title` text NOT NULL,
	`latest_revision_id` text NOT NULL,
	`latest_truth_id` text NOT NULL,
	`revision_count` integer NOT NULL,
	`rights_scope` text NOT NULL,
	`page_json` text NOT NULL,
	`teacher_private` integer DEFAULT true NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`private_compilation` text DEFAULT 'ENABLED' NOT NULL,
	`canonical_compilation` text DEFAULT 'DISABLED' NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`formal_release` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_wiki_hermes_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_private_pages_identity_check" CHECK("inspiration_wiki_private_pages"."page_id" glob 'private-wiki-page:*' and "inspiration_wiki_private_pages"."page_type" = 'INSPIRATION_CASE' and "inspiration_wiki_private_pages"."state" = 'PRIVATE_COMPILED' and "inspiration_wiki_private_pages"."revision_count" > 0),
	CONSTRAINT "inspiration_wiki_private_pages_json_check" CHECK(json_valid("inspiration_wiki_private_pages"."page_json") and json_type("inspiration_wiki_private_pages"."page_json") = 'object'),
	CONSTRAINT "inspiration_wiki_private_pages_boundary_check" CHECK("inspiration_wiki_private_pages"."rights_scope" = 'UNKNOWN_PRIVATE_ONLY' and "inspiration_wiki_private_pages"."teacher_private" = 1 and "inspiration_wiki_private_pages"."student_visible" = 0 and "inspiration_wiki_private_pages"."private_compilation" = 'ENABLED' and "inspiration_wiki_private_pages"."canonical_compilation" = 'DISABLED' and "inspiration_wiki_private_pages"."current_page" = 'DISABLED' and "inspiration_wiki_private_pages"."formal_release" = 'DISABLED' and "inspiration_wiki_private_pages"."r2" = 'DISABLED' and "inspiration_wiki_private_pages"."embedding" = 'DISABLED' and "inspiration_wiki_private_pages"."lumi_retrieval" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_pages_candidate_unique` ON `inspiration_wiki_private_pages` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_private_pages_updated_idx` ON `inspiration_wiki_private_pages` (`updated_at`);
--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_private_page_revisions_no_update
BEFORE UPDATE ON inspiration_wiki_private_page_revisions
BEGIN SELECT RAISE(ABORT, 'PRIVATE_PAGE_REVISION_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_private_page_revisions_no_delete
BEFORE DELETE ON inspiration_wiki_private_page_revisions
BEGIN SELECT RAISE(ABORT, 'PRIVATE_PAGE_REVISION_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_private_compiled_truths_no_update
BEFORE UPDATE ON inspiration_wiki_private_compiled_truths
BEGIN SELECT RAISE(ABORT, 'PRIVATE_COMPILED_TRUTH_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_private_compiled_truths_no_delete
BEFORE DELETE ON inspiration_wiki_private_compiled_truths
BEGIN SELECT RAISE(ABORT, 'PRIVATE_COMPILED_TRUTH_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_private_pages_no_delete
BEFORE DELETE ON inspiration_wiki_private_pages
BEGIN SELECT RAISE(ABORT, 'PRIVATE_WIKI_PAGE_DELETE_DISABLED'); END;
