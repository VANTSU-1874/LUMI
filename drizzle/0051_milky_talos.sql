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
--> statement-breakpoint
-- Rehomes the former local 0049 governance migration after production 0049
-- was retained. Existing local databases already contain these objects;
-- production and fresh databases create them here.
-- Migration 0048 was hand-authored without a Drizzle snapshot. These guarded
-- statements bridge that metadata gap without rebuilding or changing old tables.
CREATE TABLE IF NOT EXISTS `inspiration_admissions` (
	`candidate_id` text PRIMARY KEY NOT NULL,
	`candidate_revision` integer NOT NULL,
	`status` text NOT NULL,
	`read_model_json` text NOT NULL,
	`publication_scope` text DEFAULT 'INTERNAL_CATALOG_ONLY' NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`student_display_decision` text DEFAULT 'PENDING' NOT NULL,
	`source_disclosure_decision` text DEFAULT 'PENDING' NOT NULL,
	`teaching_decision` text DEFAULT 'PENDING' NOT NULL,
	`safety_decision` text DEFAULT 'PENDING' NOT NULL,
	`quality_decision` text DEFAULT 'PENDING' NOT NULL,
	`withdrawal_readiness` text DEFAULT 'PENDING' NOT NULL,
	`browser_channel` text DEFAULT 'DISABLED' NOT NULL,
	`bridge_channel` text DEFAULT 'DISABLED' NOT NULL,
	`publication_revision` integer DEFAULT 0 NOT NULL,
	`published_by` text,
	`published_at` integer,
	`citation_eligibility_recorded` integer NOT NULL,
	`indexed_at` integer NOT NULL,
	`activated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_admissions_status_check" CHECK("inspiration_admissions"."status" in ('AUTO_ADMITTED/INDEXED','ACTIVE')),
	CONSTRAINT "inspiration_admissions_read_model_json_check" CHECK(json_valid("inspiration_admissions"."read_model_json")),
	CONSTRAINT "inspiration_admissions_publication_revision_check" CHECK("inspiration_admissions"."publication_revision" >= 0),
	CONSTRAINT "inspiration_admissions_publication_contract_check" CHECK(
    (
      "inspiration_admissions"."publication_scope" = 'INTERNAL_CATALOG_ONLY'
      and "inspiration_admissions"."student_visible" = 0
      and "inspiration_admissions"."student_display_decision" = 'PENDING'
      and "inspiration_admissions"."source_disclosure_decision" = 'PENDING'
      and "inspiration_admissions"."teaching_decision" = 'PENDING'
      and "inspiration_admissions"."safety_decision" = 'PENDING'
      and "inspiration_admissions"."quality_decision" = 'PENDING'
      and "inspiration_admissions"."withdrawal_readiness" = 'PENDING'
      and "inspiration_admissions"."browser_channel" = 'DISABLED'
      and "inspiration_admissions"."bridge_channel" = 'DISABLED'
      and "inspiration_admissions"."publication_revision" = 0
      and "inspiration_admissions"."published_by" is null
      and "inspiration_admissions"."published_at" is null
      and "inspiration_admissions"."citation_eligibility_recorded" = 0
    ) or (
      "inspiration_admissions"."publication_scope" = 'AUTHENTICATED_STUDENT_ONLY'
      and "inspiration_admissions"."student_visible" = 1
      and "inspiration_admissions"."student_display_decision" = 'ALLOW'
      and "inspiration_admissions"."source_disclosure_decision" = 'ALLOW'
      and "inspiration_admissions"."teaching_decision" = 'ALLOW'
      and "inspiration_admissions"."safety_decision" = 'ALLOW'
      and "inspiration_admissions"."quality_decision" = 'ALLOW'
      and "inspiration_admissions"."withdrawal_readiness" = 'READY'
      and "inspiration_admissions"."browser_channel" = 'ACTIVE'
      and "inspiration_admissions"."bridge_channel" = 'ACTIVE'
      and "inspiration_admissions"."publication_revision" > 0
      and "inspiration_admissions"."published_by" is not null
      and "inspiration_admissions"."published_at" is not null
      and "inspiration_admissions"."citation_eligibility_recorded" = 1
    )
  )
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `inspiration_candidate_analyses` (
	`candidate_id` text PRIMARY KEY NOT NULL,
	`candidate_revision` integer NOT NULL,
	`analysis_json` text NOT NULL,
	`actual_channel` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_candidate_analyses_json_check" CHECK(json_valid("inspiration_candidate_analyses"."analysis_json")),
	CONSTRAINT "inspiration_candidate_analyses_revision_check" CHECK("inspiration_candidate_analyses"."candidate_revision" > 0),
	CONSTRAINT "inspiration_candidate_analyses_channel_check" CHECK("inspiration_candidate_analyses"."actual_channel" in ('NONE','LOCAL','REMOTE'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `inspiration_candidate_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_id` text,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_candidate_audit_events_payload_json_check" CHECK(json_valid("inspiration_candidate_audit_events"."payload_json"))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inspiration_candidate_audit_events_candidate_created_idx` ON `inspiration_candidate_audit_events` (`candidate_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `inspiration_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`curation_json` text NOT NULL,
	`asset_json` text NOT NULL,
	`rights_json` text NOT NULL,
	`analysis_json` text NOT NULL,
	`review_package_json` text NOT NULL,
	`withdrawal_status` text NOT NULL,
	`content_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `inspiration_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_candidates_state_check" CHECK("inspiration_candidates"."state" in ('DISCOVERED','DOWNLOADED/IMPORTED','NORMALIZED/DEDUPED','VISUALLY_ANALYZED','READY_FOR_TEACHER_REVIEW','APPROVED','AUTO_ADMITTED/INDEXED','ACTIVE','REJECTED','WITHDRAWN')),
	CONSTRAINT "inspiration_candidates_revision_check" CHECK("inspiration_candidates"."revision" > 0),
	CONSTRAINT "inspiration_candidates_json_check" CHECK(json_valid("inspiration_candidates"."curation_json") and json_valid("inspiration_candidates"."asset_json") and json_valid("inspiration_candidates"."rights_json") and json_valid("inspiration_candidates"."analysis_json") and json_valid("inspiration_candidates"."review_package_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `inspiration_candidates_source_content_hash_unique` ON `inspiration_candidates` (`source_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inspiration_candidates_review_queue_idx` ON `inspiration_candidates` (`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `inspiration_review_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`candidate_revision` integer NOT NULL,
	`teacher_id` text NOT NULL,
	`decision` text NOT NULL,
	`course_tags_json` text NOT NULL,
	`notes` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_review_decisions_check" CHECK("inspiration_review_decisions"."decision" in ('APPROVE','REJECT','DEFER')),
	CONSTRAINT "inspiration_review_decisions_revision_check" CHECK("inspiration_review_decisions"."candidate_revision" > 0),
	CONSTRAINT "inspiration_review_decisions_tags_json_check" CHECK(json_valid("inspiration_review_decisions"."course_tags_json") and json_type("inspiration_review_decisions"."course_tags_json") = 'array'),
	CONSTRAINT "inspiration_review_decisions_notes_check" CHECK(length("inspiration_review_decisions"."notes") <= 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `inspiration_review_decisions_teacher_idempotency_unique` ON `inspiration_review_decisions` (`teacher_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inspiration_review_decisions_candidate_created_idx` ON `inspiration_review_decisions` (`candidate_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `inspiration_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`adapter_id` text NOT NULL,
	`configuration_json` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "inspiration_sources_configuration_json_check" CHECK(json_valid("inspiration_sources"."configuration_json")),
	CONSTRAINT "inspiration_sources_private_only_check" CHECK(json_extract("inspiration_sources"."configuration_json", '$.scope') = 'PRIVATE_CANDIDATE_ONLY')
);
--> statement-breakpoint
CREATE TABLE `inspiration_wiki_domain_review_decisions` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`decision_revision_id` text NOT NULL,
	`decision_revision_hash` text NOT NULL,
	`draft_material_receipt_id` text NOT NULL,
	`review_domain` text NOT NULL,
	`decision` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_role_assignment_id` text NOT NULL,
	`policy_revision_id` text NOT NULL,
	`policy_revision_hash` text NOT NULL,
	`target_hash` text NOT NULL,
	`required_reviewer_count` integer NOT NULL,
	`co_reviewer_decision_ids_json` text NOT NULL,
	`review_json` text NOT NULL,
	`status` text NOT NULL,
	`valid_until` integer,
	`decided_at` integer NOT NULL,
	`supersedes_decision_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`draft_material_receipt_id`) REFERENCES `inspiration_wiki_draft_revisions`(`draft_material_receipt_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_role_assignment_id`) REFERENCES `inspiration_wiki_reviewer_assignments`(`assignment_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`policy_revision_id`) REFERENCES `inspiration_wiki_role_policies`(`revision_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_decision_id`) REFERENCES `inspiration_wiki_domain_review_decisions`(`decision_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_domain_review_decisions_count_check" CHECK("inspiration_wiki_domain_review_decisions"."required_reviewer_count" between 1 and 2),
	CONSTRAINT "inspiration_wiki_domain_review_decisions_json_check" CHECK(json_valid("inspiration_wiki_domain_review_decisions"."co_reviewer_decision_ids_json") and json_type("inspiration_wiki_domain_review_decisions"."co_reviewer_decision_ids_json") = 'array' and json_valid("inspiration_wiki_domain_review_decisions"."review_json") and json_type("inspiration_wiki_domain_review_decisions"."review_json") = 'object'),
	CONSTRAINT "inspiration_wiki_domain_review_decisions_hash_check" CHECK(length("inspiration_wiki_domain_review_decisions"."decision_revision_hash") = 71 and "inspiration_wiki_domain_review_decisions"."decision_revision_hash" like 'sha256:%' and length("inspiration_wiki_domain_review_decisions"."policy_revision_hash") = 71 and "inspiration_wiki_domain_review_decisions"."policy_revision_hash" like 'sha256:%' and length("inspiration_wiki_domain_review_decisions"."target_hash") = 71 and "inspiration_wiki_domain_review_decisions"."target_hash" like 'sha256:%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_domain_review_decisions_revision_unique` ON `inspiration_wiki_domain_review_decisions` (`decision_revision_id`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_domain_review_decisions_draft_domain_idx` ON `inspiration_wiki_domain_review_decisions` (`draft_material_receipt_id`,`review_domain`,`decided_at`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_draft_revisions` (
	`draft_material_receipt_id` text PRIMARY KEY NOT NULL,
	`draft_material_receipt_hash` text NOT NULL,
	`candidate_id` text NOT NULL,
	`candidate_revision` integer NOT NULL,
	`page_id` text NOT NULL,
	`page_draft_revision_id` text NOT NULL,
	`page_draft_revision_hash` text NOT NULL,
	`canonical_input_bundle_id` text NOT NULL,
	`canonical_input_bundle_hash` text NOT NULL,
	`page_revision_id` text NOT NULL,
	`page_revision_hash` text NOT NULL,
	`compilation_receipt_id` text NOT NULL,
	`compilation_receipt_hash` text NOT NULL,
	`review_package_revision_id` text NOT NULL,
	`review_package_revision_hash` text NOT NULL,
	`policy_revision_id` text NOT NULL,
	`policy_revision_hash` text NOT NULL,
	`risk_scope_revision_id` text NOT NULL,
	`risk_scope_revision_hash` text NOT NULL,
	`target_hash` text NOT NULL,
	`draft_material_json` text NOT NULL,
	`risk_scope_json` text NOT NULL,
	`proposer_editor_actor_ids_json` text NOT NULL,
	`state` text NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`policy_revision_id`) REFERENCES `inspiration_wiki_role_policies`(`revision_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_draft_revisions_candidate_revision_check" CHECK("inspiration_wiki_draft_revisions"."candidate_revision" > 0),
	CONSTRAINT "inspiration_wiki_draft_revisions_json_check" CHECK(json_valid("inspiration_wiki_draft_revisions"."draft_material_json") and json_type("inspiration_wiki_draft_revisions"."draft_material_json") = 'object' and json_valid("inspiration_wiki_draft_revisions"."risk_scope_json") and json_type("inspiration_wiki_draft_revisions"."risk_scope_json") = 'object' and json_valid("inspiration_wiki_draft_revisions"."proposer_editor_actor_ids_json") and json_type("inspiration_wiki_draft_revisions"."proposer_editor_actor_ids_json") = 'array'),
	CONSTRAINT "inspiration_wiki_draft_revisions_internal_only_check" CHECK("inspiration_wiki_draft_revisions"."state" = 'LINTED' and "inspiration_wiki_draft_revisions"."student_visible" = 0),
	CONSTRAINT "inspiration_wiki_draft_revisions_hash_check" CHECK(length("inspiration_wiki_draft_revisions"."draft_material_receipt_hash") = 71 and "inspiration_wiki_draft_revisions"."draft_material_receipt_hash" like 'sha256:%' and length("inspiration_wiki_draft_revisions"."target_hash") = 71 and "inspiration_wiki_draft_revisions"."target_hash" like 'sha256:%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_draft_revisions_page_draft_unique` ON `inspiration_wiki_draft_revisions` (`page_draft_revision_id`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_draft_revisions_candidate_idx` ON `inspiration_wiki_draft_revisions` (`candidate_id`,`candidate_revision`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_draft_revisions_page_idx` ON `inspiration_wiki_draft_revisions` (`page_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_internal_catalog_entries` (
	`draft_material_receipt_id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`state` text NOT NULL,
	`hold_reason` text,
	`accepted_decision_ids_json` text NOT NULL,
	`accepted_decision_set_hash` text NOT NULL,
	`policy_revision_id` text NOT NULL,
	`policy_revision_hash` text NOT NULL,
	`target_hash` text NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`browse_release` text DEFAULT 'DISABLED' NOT NULL,
	`student_search` text DEFAULT 'DISABLED' NOT NULL,
	`wiki_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`activated_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_material_receipt_id`) REFERENCES `inspiration_wiki_draft_revisions`(`draft_material_receipt_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`policy_revision_id`) REFERENCES `inspiration_wiki_role_policies`(`revision_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_internal_catalog_entries_json_check" CHECK(json_valid("inspiration_wiki_internal_catalog_entries"."accepted_decision_ids_json") and json_type("inspiration_wiki_internal_catalog_entries"."accepted_decision_ids_json") = 'array'),
	CONSTRAINT "inspiration_wiki_internal_catalog_entries_state_check" CHECK(("inspiration_wiki_internal_catalog_entries"."state" = 'INTERNAL_CATALOG_ACTIVE' and "inspiration_wiki_internal_catalog_entries"."hold_reason" is null) or ("inspiration_wiki_internal_catalog_entries"."state" = 'REVIEW_HOLD' and length("inspiration_wiki_internal_catalog_entries"."hold_reason") > 0)),
	CONSTRAINT "inspiration_wiki_internal_catalog_entries_internal_only_check" CHECK("inspiration_wiki_internal_catalog_entries"."student_visible" = 0 and "inspiration_wiki_internal_catalog_entries"."browse_release" = 'DISABLED' and "inspiration_wiki_internal_catalog_entries"."student_search" = 'DISABLED' and "inspiration_wiki_internal_catalog_entries"."wiki_retrieval" = 'DISABLED'),
	CONSTRAINT "inspiration_wiki_internal_catalog_entries_hash_check" CHECK(length("inspiration_wiki_internal_catalog_entries"."accepted_decision_set_hash") = 71 and "inspiration_wiki_internal_catalog_entries"."accepted_decision_set_hash" like 'sha256:%' and length("inspiration_wiki_internal_catalog_entries"."policy_revision_hash") = 71 and "inspiration_wiki_internal_catalog_entries"."policy_revision_hash" like 'sha256:%' and length("inspiration_wiki_internal_catalog_entries"."target_hash") = 71 and "inspiration_wiki_internal_catalog_entries"."target_hash" like 'sha256:%')
);
--> statement-breakpoint
CREATE INDEX `inspiration_wiki_internal_catalog_entries_page_state_idx` ON `inspiration_wiki_internal_catalog_entries` (`page_id`,`state`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_reviewer_assignments` (
	`assignment_id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`policy_version` text NOT NULL,
	`policy_revision_id` text NOT NULL,
	`policy_revision_hash` text NOT NULL,
	`assignment_json` text NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`policy_revision_id`) REFERENCES `inspiration_wiki_role_policies`(`revision_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_reviewer_assignments_json_check" CHECK(json_valid("inspiration_wiki_reviewer_assignments"."assignment_json") and json_type("inspiration_wiki_reviewer_assignments"."assignment_json") = 'object'),
	CONSTRAINT "inspiration_wiki_reviewer_assignments_hash_check" CHECK(length("inspiration_wiki_reviewer_assignments"."policy_revision_hash") = 71 and "inspiration_wiki_reviewer_assignments"."policy_revision_hash" like 'sha256:%'),
	CONSTRAINT "inspiration_wiki_reviewer_assignments_validity_check" CHECK("inspiration_wiki_reviewer_assignments"."valid_until" is null or "inspiration_wiki_reviewer_assignments"."valid_until" >= "inspiration_wiki_reviewer_assignments"."valid_from")
);
--> statement-breakpoint
CREATE INDEX `inspiration_wiki_reviewer_assignments_actor_status_idx` ON `inspiration_wiki_reviewer_assignments` (`actor_id`,`status`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_reviewer_assignments_policy_idx` ON `inspiration_wiki_reviewer_assignments` (`policy_revision_id`,`status`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_role_policies` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`revision_hash` text NOT NULL,
	`version` text NOT NULL,
	`policy_json` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "inspiration_wiki_role_policies_json_check" CHECK(json_valid("inspiration_wiki_role_policies"."policy_json") and json_type("inspiration_wiki_role_policies"."policy_json") = 'object'),
	CONSTRAINT "inspiration_wiki_role_policies_hash_check" CHECK(length("inspiration_wiki_role_policies"."revision_hash") = 71 and "inspiration_wiki_role_policies"."revision_hash" like 'sha256:%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_role_policies_version_unique` ON `inspiration_wiki_role_policies` (`version`);
