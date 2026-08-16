CREATE TABLE `inspiration_wiki_evidence_gap_analysis_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_pack_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`analysis_kind` text NOT NULL,
	`previous_revision` integer NOT NULL,
	`next_revision` integer NOT NULL,
	`previous_material_hash` text NOT NULL,
	`next_material_hash` text NOT NULL,
	`source_artifact_digest` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`previous_pack_json` text NOT NULL,
	`revised_pack_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_pack_id`) REFERENCES `inspiration_wiki_evidence_gap_review_packs`(`review_pack_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_wiki_hermes_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_evidence_gap_analysis_revisions_kind_check" CHECK("inspiration_wiki_evidence_gap_analysis_revisions"."analysis_kind" = 'SIX_ANALYZED_THREE_UNKNOWN'),
	CONSTRAINT "inspiration_wiki_evidence_gap_analysis_revisions_revision_check" CHECK("inspiration_wiki_evidence_gap_analysis_revisions"."previous_revision" > 0 and "inspiration_wiki_evidence_gap_analysis_revisions"."next_revision" = "inspiration_wiki_evidence_gap_analysis_revisions"."previous_revision" + 1),
	CONSTRAINT "inspiration_wiki_evidence_gap_analysis_revisions_hash_check" CHECK(length("inspiration_wiki_evidence_gap_analysis_revisions"."previous_material_hash") = 64 and "inspiration_wiki_evidence_gap_analysis_revisions"."previous_material_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_evidence_gap_analysis_revisions"."next_material_hash") = 64 and "inspiration_wiki_evidence_gap_analysis_revisions"."next_material_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_evidence_gap_analysis_revisions"."source_artifact_digest") = 64 and "inspiration_wiki_evidence_gap_analysis_revisions"."source_artifact_digest" not glob '*[^0-9a-f]*' and length("inspiration_wiki_evidence_gap_analysis_revisions"."request_hash") = 64 and "inspiration_wiki_evidence_gap_analysis_revisions"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_evidence_gap_analysis_revisions_key_check" CHECK(length("inspiration_wiki_evidence_gap_analysis_revisions"."idempotency_key") between 8 and 128),
	CONSTRAINT "inspiration_wiki_evidence_gap_analysis_revisions_json_check" CHECK(json_valid("inspiration_wiki_evidence_gap_analysis_revisions"."previous_pack_json") and json_type("inspiration_wiki_evidence_gap_analysis_revisions"."previous_pack_json") = 'object' and json_valid("inspiration_wiki_evidence_gap_analysis_revisions"."revised_pack_json") and json_type("inspiration_wiki_evidence_gap_analysis_revisions"."revised_pack_json") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_evidence_gap_analysis_revisions_key_unique` ON `inspiration_wiki_evidence_gap_analysis_revisions` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_evidence_gap_analysis_revisions_pack_revision_unique` ON `inspiration_wiki_evidence_gap_analysis_revisions` (`review_pack_id`,`next_revision`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_evidence_gap_analysis_revisions_pack_created_idx` ON `inspiration_wiki_evidence_gap_analysis_revisions` (`review_pack_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_evidence_gap_analysis_revisions_no_update`
BEFORE UPDATE ON `inspiration_wiki_evidence_gap_analysis_revisions`
BEGIN
  SELECT RAISE(ABORT, 'evidence gap analysis revisions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_evidence_gap_analysis_revisions_no_delete`
BEFORE DELETE ON `inspiration_wiki_evidence_gap_analysis_revisions`
BEGIN
  SELECT RAISE(ABORT, 'evidence gap analysis revisions are append-only');
END;
