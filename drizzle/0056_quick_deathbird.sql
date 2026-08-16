PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_inspiration_wiki_evidence_gap_review_decisions` (
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
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_revision_check" CHECK("__new_inspiration_wiki_evidence_gap_review_decisions"."review_pack_revision" > 0),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_gaps_json_check" CHECK(json_valid("__new_inspiration_wiki_evidence_gap_review_decisions"."accepted_gap_keys_json") and json_type("__new_inspiration_wiki_evidence_gap_review_decisions"."accepted_gap_keys_json") = 'array' and json_array_length("__new_inspiration_wiki_evidence_gap_review_decisions"."accepted_gap_keys_json") between 0 and 9),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_note_check" CHECK(length(trim("__new_inspiration_wiki_evidence_gap_review_decisions"."note")) <= 300 and ("__new_inspiration_wiki_evidence_gap_review_decisions"."final_action" = 'ENTER_PRIVATE_WIKIDRAFT' or length(trim("__new_inspiration_wiki_evidence_gap_review_decisions"."note")) >= 1)),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_key_check" CHECK(length("__new_inspiration_wiki_evidence_gap_review_decisions"."idempotency_key") between 8 and 128),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_hash_check" CHECK(length("__new_inspiration_wiki_evidence_gap_review_decisions"."request_hash") = 64 and "__new_inspiration_wiki_evidence_gap_review_decisions"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_action_check" CHECK(("__new_inspiration_wiki_evidence_gap_review_decisions"."final_action" = 'ENTER_PRIVATE_WIKIDRAFT' and "__new_inspiration_wiki_evidence_gap_review_decisions"."private_draft_only" = 1) or ("__new_inspiration_wiki_evidence_gap_review_decisions"."final_action" in ('RETURN_TO_CODEX','REJECT_CANDIDATE') and "__new_inspiration_wiki_evidence_gap_review_decisions"."private_draft_only" = 0 and json_array_length("__new_inspiration_wiki_evidence_gap_review_decisions"."accepted_gap_keys_json") = 0)),
	CONSTRAINT "inspiration_wiki_evidence_gap_review_decisions_transition_check" CHECK(("__new_inspiration_wiki_evidence_gap_review_decisions"."final_action" = 'RETURN_TO_CODEX' and "__new_inspiration_wiki_evidence_gap_review_decisions"."next_stage" = 'RETURNED_TO_CODEX') or ("__new_inspiration_wiki_evidence_gap_review_decisions"."final_action" = 'REJECT_CANDIDATE' and "__new_inspiration_wiki_evidence_gap_review_decisions"."next_stage" = 'REJECTED') or ("__new_inspiration_wiki_evidence_gap_review_decisions"."final_action" = 'ENTER_PRIVATE_WIKIDRAFT' and "__new_inspiration_wiki_evidence_gap_review_decisions"."next_stage" = 'PRIVATE_WIKIDRAFT_WITH_GAPS'))
);
--> statement-breakpoint
INSERT INTO `__new_inspiration_wiki_evidence_gap_review_decisions`("id", "review_pack_id", "review_pack_revision", "teacher_id", "accepted_gap_keys_json", "final_action", "previous_stage", "next_stage", "note", "private_draft_only", "idempotency_key", "request_hash", "created_at") SELECT "id", "review_pack_id", "review_pack_revision", "teacher_id", "accepted_gap_keys_json", "final_action", "previous_stage", "next_stage", "note", "private_draft_only", "idempotency_key", "request_hash", "created_at" FROM `inspiration_wiki_evidence_gap_review_decisions`;--> statement-breakpoint
DROP TABLE `inspiration_wiki_evidence_gap_review_decisions`;--> statement-breakpoint
ALTER TABLE `__new_inspiration_wiki_evidence_gap_review_decisions` RENAME TO `inspiration_wiki_evidence_gap_review_decisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_evidence_gap_review_decisions_teacher_key_unique` ON `inspiration_wiki_evidence_gap_review_decisions` (`teacher_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_evidence_gap_review_decisions_pack_created_idx` ON `inspiration_wiki_evidence_gap_review_decisions` (`review_pack_id`,`created_at`);