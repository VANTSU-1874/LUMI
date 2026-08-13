CREATE TABLE `inspiration_wiki_private_working_draft_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`previous_revision` integer NOT NULL,
	`next_revision` integer NOT NULL,
	`operation` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`previous_content_hash` text,
	`next_content_hash` text NOT NULL,
	`previous_draft_json` text,
	`next_draft_json` text NOT NULL,
	`note` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `inspiration_wiki_private_working_drafts`(`draft_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_private_working_draft_revisions_revision_check" CHECK("inspiration_wiki_private_working_draft_revisions"."previous_revision" >= 0 and "inspiration_wiki_private_working_draft_revisions"."next_revision" = "inspiration_wiki_private_working_draft_revisions"."previous_revision" + 1),
	CONSTRAINT "inspiration_wiki_private_working_draft_revisions_hash_check" CHECK(("inspiration_wiki_private_working_draft_revisions"."previous_revision" = 0 and "inspiration_wiki_private_working_draft_revisions"."previous_content_hash" is null) or ("inspiration_wiki_private_working_draft_revisions"."previous_revision" > 0 and length("inspiration_wiki_private_working_draft_revisions"."previous_content_hash") = 64 and "inspiration_wiki_private_working_draft_revisions"."previous_content_hash" not glob '*[^0-9a-f]*')),
	CONSTRAINT "inspiration_wiki_private_working_draft_revisions_next_hash_check" CHECK(length("inspiration_wiki_private_working_draft_revisions"."next_content_hash") = 64 and "inspiration_wiki_private_working_draft_revisions"."next_content_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_private_working_draft_revisions"."request_hash") = 64 and "inspiration_wiki_private_working_draft_revisions"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_private_working_draft_revisions_json_check" CHECK((("inspiration_wiki_private_working_draft_revisions"."previous_revision" = 0 and "inspiration_wiki_private_working_draft_revisions"."previous_draft_json" is null) or ("inspiration_wiki_private_working_draft_revisions"."previous_revision" > 0 and json_valid("inspiration_wiki_private_working_draft_revisions"."previous_draft_json") and json_type("inspiration_wiki_private_working_draft_revisions"."previous_draft_json") = 'object')) and json_valid("inspiration_wiki_private_working_draft_revisions"."next_draft_json") and json_type("inspiration_wiki_private_working_draft_revisions"."next_draft_json") = 'object'),
	CONSTRAINT "inspiration_wiki_private_working_draft_revisions_key_check" CHECK(length("inspiration_wiki_private_working_draft_revisions"."idempotency_key") between 8 and 128 and length(trim("inspiration_wiki_private_working_draft_revisions"."note")) between 1 and 300),
	CONSTRAINT "inspiration_wiki_private_working_draft_revisions_actor_check" CHECK(("inspiration_wiki_private_working_draft_revisions"."operation" = 'INITIAL_COMPILE' and "inspiration_wiki_private_working_draft_revisions"."actor_type" = 'CODEX') or ("inspiration_wiki_private_working_draft_revisions"."operation" <> 'INITIAL_COMPILE' and "inspiration_wiki_private_working_draft_revisions"."actor_type" = 'TEACHER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_working_draft_revisions_pack_revision_unique` ON `inspiration_wiki_private_working_draft_revisions` (`draft_id`,`next_revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_working_draft_revisions_actor_key_unique` ON `inspiration_wiki_private_working_draft_revisions` (`actor_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_private_working_draft_revisions_created_idx` ON `inspiration_wiki_private_working_draft_revisions` (`draft_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_private_working_drafts` (
	`draft_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`source_review_pack_id` text NOT NULL,
	`source_contract_kind` text NOT NULL,
	`source_review_revision` integer NOT NULL,
	`source_decision_id` text NOT NULL,
	`revision` integer NOT NULL,
	`stage` text NOT NULL,
	`content_hash` text NOT NULL,
	`draft_json` text NOT NULL,
	`title` text NOT NULL,
	`primary_category` text NOT NULL,
	`completion_count` integer NOT NULL,
	`primary_preview_url` text NOT NULL,
	`rights_status` text NOT NULL,
	`teacher_private` integer DEFAULT true NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_wiki_hermes_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_private_working_drafts_revision_check" CHECK("inspiration_wiki_private_working_drafts"."revision" > 0 and "inspiration_wiki_private_working_drafts"."source_review_revision" > 0),
	CONSTRAINT "inspiration_wiki_private_working_drafts_hash_check" CHECK(length("inspiration_wiki_private_working_drafts"."content_hash") = 64 and "inspiration_wiki_private_working_drafts"."content_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_private_working_drafts_json_check" CHECK(json_valid("inspiration_wiki_private_working_drafts"."draft_json") and json_type("inspiration_wiki_private_working_drafts"."draft_json") = 'object'),
	CONSTRAINT "inspiration_wiki_private_working_drafts_completion_check" CHECK("inspiration_wiki_private_working_drafts"."completion_count" between 0 and 7),
	CONSTRAINT "inspiration_wiki_private_working_drafts_preview_check" CHECK("inspiration_wiki_private_working_drafts"."primary_preview_url" like '/api/teacher/inspiration-wiki/review-packs/%'),
	CONSTRAINT "inspiration_wiki_private_working_drafts_private_check" CHECK("inspiration_wiki_private_working_drafts"."rights_status" = 'UNKNOWN' and "inspiration_wiki_private_working_drafts"."teacher_private" = 1 and "inspiration_wiki_private_working_drafts"."student_visible" = 0 and "inspiration_wiki_private_working_drafts"."current_page" = 'DISABLED' and "inspiration_wiki_private_working_drafts"."r2" = 'DISABLED' and "inspiration_wiki_private_working_drafts"."embedding" = 'DISABLED' and "inspiration_wiki_private_working_drafts"."lumi_retrieval" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_working_drafts_candidate_unique` ON `inspiration_wiki_private_working_drafts` (`candidate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_working_drafts_review_pack_unique` ON `inspiration_wiki_private_working_drafts` (`source_review_pack_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_working_drafts_decision_unique` ON `inspiration_wiki_private_working_drafts` (`source_decision_id`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_private_working_drafts_stage_category_idx` ON `inspiration_wiki_private_working_drafts` (`stage`,`primary_category`);
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_private_working_draft_revisions_no_update`
BEFORE UPDATE ON `inspiration_wiki_private_working_draft_revisions`
BEGIN
  SELECT RAISE(ABORT, 'PRIVATE_WORKING_DRAFT_REVISION_APPEND_ONLY');
END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_private_working_draft_revisions_no_delete`
BEFORE DELETE ON `inspiration_wiki_private_working_draft_revisions`
BEGIN
  SELECT RAISE(ABORT, 'PRIVATE_WORKING_DRAFT_REVISION_APPEND_ONLY');
END;
