CREATE TABLE `inspiration_wiki_evidence_gap_review_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_pack_id` text NOT NULL,
	`review_pack_revision` integer NOT NULL,
	`teacher_id` text NOT NULL,
	`accepted_gap_keys_json` text NOT NULL,
	`final_action` text NOT NULL,
	`previous_stage` text NOT NULL,
	`next_stage` text NOT NULL,
	`note` text NOT NULL,
	`private_draft_only` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_pack_id`) REFERENCES `inspiration_wiki_evidence_gap_review_packs`(`review_pack_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_revision_check" CHECK("inspiration_wiki_evidence_gap_review_decisions"."review_pack_revision" > 0),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_gaps_json_check" CHECK(json_valid("inspiration_wiki_evidence_gap_review_decisions"."accepted_gap_keys_json") and json_type("inspiration_wiki_evidence_gap_review_decisions"."accepted_gap_keys_json") = 'array' and json_array_length("inspiration_wiki_evidence_gap_review_decisions"."accepted_gap_keys_json") between 0 and 9),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_note_check" CHECK(length(trim("inspiration_wiki_evidence_gap_review_decisions"."note")) between 1 and 300),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_key_check" CHECK(length("inspiration_wiki_evidence_gap_review_decisions"."idempotency_key") between 8 and 128),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_hash_check" CHECK(length("inspiration_wiki_evidence_gap_review_decisions"."request_hash") = 64 and "inspiration_wiki_evidence_gap_review_decisions"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_action_check" CHECK(("inspiration_wiki_evidence_gap_review_decisions"."final_action" = 'ENTER_PRIVATE_WIKIDRAFT' and "inspiration_wiki_evidence_gap_review_decisions"."private_draft_only" = 1 and json_array_length("inspiration_wiki_evidence_gap_review_decisions"."accepted_gap_keys_json") > 0) or ("inspiration_wiki_evidence_gap_review_decisions"."final_action" in ('RETURN_TO_CODEX','REJECT_CANDIDATE') and "inspiration_wiki_evidence_gap_review_decisions"."private_draft_only" = 0 and json_array_length("inspiration_wiki_evidence_gap_review_decisions"."accepted_gap_keys_json") = 0)),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_transition_check" CHECK(("inspiration_wiki_evidence_gap_review_decisions"."final_action" = 'RETURN_TO_CODEX' and "inspiration_wiki_evidence_gap_review_decisions"."next_stage" = 'RETURNED_TO_CODEX') or ("inspiration_wiki_evidence_gap_review_decisions"."final_action" = 'REJECT_CANDIDATE' and "inspiration_wiki_evidence_gap_review_decisions"."next_stage" = 'REJECTED') or ("inspiration_wiki_evidence_gap_review_decisions"."final_action" = 'ENTER_PRIVATE_WIKIDRAFT' and "inspiration_wiki_evidence_gap_review_decisions"."next_stage" = 'PRIVATE_WIKIDRAFT_WITH_GAPS'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_evidence_gap_review_decisions_teacher_key_unique` ON `inspiration_wiki_evidence_gap_review_decisions` (`teacher_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_evidence_gap_review_decisions_pack_created_idx` ON `inspiration_wiki_evidence_gap_review_decisions` (`review_pack_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_evidence_gap_review_packs` (
	`review_pack_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`contract_kind` text NOT NULL,
	`stage` text NOT NULL,
	`material_hash` text NOT NULL,
	`pack_json` text NOT NULL,
	`media_assets_json` text NOT NULL,
	`readiness_json` text NOT NULL,
	`verified_gate_count` integer NOT NULL,
	`primary_preview_url` text,
	`title` text,
	`source_summary` text,
	`teacher_private` integer DEFAULT true NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_wiki_hermes_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_evidence_gap_review_packs_revision_check" CHECK("inspiration_wiki_evidence_gap_review_packs"."revision" > 0),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_packs_contract_check" CHECK("inspiration_wiki_evidence_gap_review_packs"."contract_kind" = 'EVIDENCE_GAP_REVIEW'),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_packs_hash_check" CHECK(length("inspiration_wiki_evidence_gap_review_packs"."material_hash") = 64 and "inspiration_wiki_evidence_gap_review_packs"."material_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_packs_json_check" CHECK(json_valid("inspiration_wiki_evidence_gap_review_packs"."pack_json") and json_type("inspiration_wiki_evidence_gap_review_packs"."pack_json") = 'object' and json_valid("inspiration_wiki_evidence_gap_review_packs"."media_assets_json") and json_type("inspiration_wiki_evidence_gap_review_packs"."media_assets_json") = 'array' and json_valid("inspiration_wiki_evidence_gap_review_packs"."readiness_json") and json_type("inspiration_wiki_evidence_gap_review_packs"."readiness_json") = 'object'),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_packs_gate_count_check" CHECK("inspiration_wiki_evidence_gap_review_packs"."verified_gate_count" between 0 and 8),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_packs_preview_check" CHECK("inspiration_wiki_evidence_gap_review_packs"."primary_preview_url" is null or "inspiration_wiki_evidence_gap_review_packs"."primary_preview_url" like '/api/teacher/inspiration-wiki/review-packs/%'),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_packs_stage_check" CHECK("inspiration_wiki_evidence_gap_review_packs"."stage" in ('READY_FOR_TEACHER_TRIAGE','RETURNED_TO_CODEX','REJECTED','PRIVATE_WIKIDRAFT_WITH_GAPS')),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_packs_private_check" CHECK("inspiration_wiki_evidence_gap_review_packs"."teacher_private" = 1 and "inspiration_wiki_evidence_gap_review_packs"."student_visible" = 0 and "inspiration_wiki_evidence_gap_review_packs"."current_page" = 'DISABLED' and "inspiration_wiki_evidence_gap_review_packs"."r2" = 'DISABLED' and "inspiration_wiki_evidence_gap_review_packs"."embedding" = 'DISABLED' and "inspiration_wiki_evidence_gap_review_packs"."lumi_retrieval" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_evidence_gap_review_packs_candidate_unique` ON `inspiration_wiki_evidence_gap_review_packs` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_evidence_gap_review_packs_queue_idx` ON `inspiration_wiki_evidence_gap_review_packs` (`stage`,`updated_at`);
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_evidence_gap_review_packs_no_strict_candidate`
BEFORE INSERT ON `inspiration_wiki_evidence_gap_review_packs`
WHEN EXISTS (
	SELECT 1 FROM `inspiration_wiki_review_packs`
	WHERE `candidate_id` = NEW.`candidate_id`
)
BEGIN
	SELECT RAISE(ABORT, 'candidate already assigned to strict review');
END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_review_packs_no_evidence_gap_candidate`
BEFORE INSERT ON `inspiration_wiki_review_packs`
WHEN EXISTS (
	SELECT 1 FROM `inspiration_wiki_evidence_gap_review_packs`
	WHERE `candidate_id` = NEW.`candidate_id`
)
BEGIN
	SELECT RAISE(ABORT, 'candidate already assigned to evidence-gap review');
END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_evidence_gap_review_packs_no_strict_candidate_update`
BEFORE UPDATE OF `candidate_id` ON `inspiration_wiki_evidence_gap_review_packs`
WHEN NEW.`candidate_id` <> OLD.`candidate_id` AND EXISTS (
	SELECT 1 FROM `inspiration_wiki_review_packs`
	WHERE `candidate_id` = NEW.`candidate_id`
)
BEGIN
	SELECT RAISE(ABORT, 'candidate already assigned to strict review');
END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_review_packs_no_evidence_gap_candidate_update`
BEFORE UPDATE OF `candidate_id` ON `inspiration_wiki_review_packs`
WHEN NEW.`candidate_id` <> OLD.`candidate_id` AND EXISTS (
	SELECT 1 FROM `inspiration_wiki_evidence_gap_review_packs`
	WHERE `candidate_id` = NEW.`candidate_id`
)
BEGIN
	SELECT RAISE(ABORT, 'candidate already assigned to evidence-gap review');
END;
