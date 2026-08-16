CREATE TABLE `inspiration_wiki_private_catalog_domain_decisions` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`decision_hash` text NOT NULL,
	`governance_case_id` text NOT NULL,
	`review_domain` text NOT NULL,
	`decision` text NOT NULL,
	`actor_id` text NOT NULL,
	`authenticated_teacher_id` text NOT NULL,
	`actor_role_assignment_id` text NOT NULL,
	`source_private_decision_id` text NOT NULL,
	`target_hash` text NOT NULL,
	`interpretation` text NOT NULL,
	`decision_json` text NOT NULL,
	`decided_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`governance_case_id`) REFERENCES `inspiration_wiki_private_catalog_governance_cases`(`governance_case_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`authenticated_teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_role_assignment_id`) REFERENCES `inspiration_wiki_reviewer_assignments`(`assignment_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_private_decision_id`) REFERENCES `inspiration_wiki_private_domain_review_decisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_private_catalog_decisions_hash_check" CHECK(length("inspiration_wiki_private_catalog_domain_decisions"."decision_hash") = 71 and "inspiration_wiki_private_catalog_domain_decisions"."decision_hash" like 'sha256:%' and length("inspiration_wiki_private_catalog_domain_decisions"."target_hash") = 71 and "inspiration_wiki_private_catalog_domain_decisions"."target_hash" like 'sha256:%'),
	CONSTRAINT "inspiration_wiki_private_catalog_decisions_json_check" CHECK(json_valid("inspiration_wiki_private_catalog_domain_decisions"."decision_json") and json_type("inspiration_wiki_private_catalog_domain_decisions"."decision_json") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_catalog_decisions_case_domain_unique` ON `inspiration_wiki_private_catalog_domain_decisions` (`governance_case_id`,`review_domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_catalog_decisions_source_unique` ON `inspiration_wiki_private_catalog_domain_decisions` (`source_private_decision_id`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_private_catalog_decisions_actor_idx` ON `inspiration_wiki_private_catalog_domain_decisions` (`actor_id`,`review_domain`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_private_catalog_decisions_teacher_idx` ON `inspiration_wiki_private_catalog_domain_decisions` (`authenticated_teacher_id`,`review_domain`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_private_catalog_governance_cases` (
	`governance_case_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`page_id` text NOT NULL,
	`page_revision_id` text NOT NULL,
	`truth_id` text NOT NULL,
	`review_case_id` text NOT NULL,
	`policy_revision_id` text NOT NULL,
	`policy_revision_hash` text NOT NULL,
	`target_hash` text NOT NULL,
	`role_assignment_ids_json` text NOT NULL,
	`source_decision_ids_json` text NOT NULL,
	`decision_ids_json` text NOT NULL,
	`stage` text NOT NULL,
	`reviewer_model` text NOT NULL,
	`rights_scope` text NOT NULL,
	`case_json` text NOT NULL,
	`teacher_private` integer DEFAULT true NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`internal_catalog` text DEFAULT 'ENABLED' NOT NULL,
	`canonical_compilation` text DEFAULT 'DISABLED' NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`formal_release` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`reviewed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_wiki_hermes_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_id`) REFERENCES `inspiration_wiki_private_pages`(`page_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_revision_id`) REFERENCES `inspiration_wiki_private_page_revisions`(`revision_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`truth_id`) REFERENCES `inspiration_wiki_private_compiled_truths`(`truth_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`review_case_id`) REFERENCES `inspiration_wiki_private_domain_review_cases`(`review_case_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`policy_revision_id`) REFERENCES `inspiration_wiki_role_policies`(`revision_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_private_catalog_cases_identity_check" CHECK("inspiration_wiki_private_catalog_governance_cases"."governance_case_id" glob 'private-catalog-governance:*' and "inspiration_wiki_private_catalog_governance_cases"."stage" = 'ROLE_REVIEW_COMPLETE' and "inspiration_wiki_private_catalog_governance_cases"."reviewer_model" = 'SINGLE_TEACHER_EXPLICIT_ROLES'),
	CONSTRAINT "inspiration_wiki_private_catalog_cases_hash_check" CHECK(length("inspiration_wiki_private_catalog_governance_cases"."policy_revision_hash") = 71 and "inspiration_wiki_private_catalog_governance_cases"."policy_revision_hash" like 'sha256:%' and length("inspiration_wiki_private_catalog_governance_cases"."target_hash") = 71 and "inspiration_wiki_private_catalog_governance_cases"."target_hash" like 'sha256:%'),
	CONSTRAINT "inspiration_wiki_private_catalog_cases_json_check" CHECK(json_valid("inspiration_wiki_private_catalog_governance_cases"."role_assignment_ids_json") and json_type("inspiration_wiki_private_catalog_governance_cases"."role_assignment_ids_json") = 'object' and json_valid("inspiration_wiki_private_catalog_governance_cases"."source_decision_ids_json") and json_type("inspiration_wiki_private_catalog_governance_cases"."source_decision_ids_json") = 'object' and json_valid("inspiration_wiki_private_catalog_governance_cases"."decision_ids_json") and json_type("inspiration_wiki_private_catalog_governance_cases"."decision_ids_json") = 'object' and json_valid("inspiration_wiki_private_catalog_governance_cases"."case_json") and json_type("inspiration_wiki_private_catalog_governance_cases"."case_json") = 'object'),
	CONSTRAINT "inspiration_wiki_private_catalog_cases_boundary_check" CHECK("inspiration_wiki_private_catalog_governance_cases"."rights_scope" = 'UNKNOWN_PRIVATE_ONLY' and "inspiration_wiki_private_catalog_governance_cases"."teacher_private" = 1 and "inspiration_wiki_private_catalog_governance_cases"."student_visible" = 0 and "inspiration_wiki_private_catalog_governance_cases"."internal_catalog" = 'ENABLED' and "inspiration_wiki_private_catalog_governance_cases"."canonical_compilation" = 'DISABLED' and "inspiration_wiki_private_catalog_governance_cases"."current_page" = 'DISABLED' and "inspiration_wiki_private_catalog_governance_cases"."formal_release" = 'DISABLED' and "inspiration_wiki_private_catalog_governance_cases"."r2" = 'DISABLED' and "inspiration_wiki_private_catalog_governance_cases"."embedding" = 'DISABLED' and "inspiration_wiki_private_catalog_governance_cases"."lumi_retrieval" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_catalog_cases_revision_unique` ON `inspiration_wiki_private_catalog_governance_cases` (`page_revision_id`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_private_catalog_cases_page_idx` ON `inspiration_wiki_private_catalog_governance_cases` (`page_id`,`reviewed_at`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_private_internal_catalog_entries` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`entry_hash` text NOT NULL,
	`governance_case_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`page_id` text NOT NULL,
	`page_revision_id` text NOT NULL,
	`truth_id` text NOT NULL,
	`policy_revision_id` text NOT NULL,
	`policy_revision_hash` text NOT NULL,
	`target_hash` text NOT NULL,
	`accepted_decision_ids_json` text NOT NULL,
	`state` text NOT NULL,
	`rights_scope` text NOT NULL,
	`entry_json` text NOT NULL,
	`teacher_private` integer DEFAULT true NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`internal_catalog` text DEFAULT 'ENABLED' NOT NULL,
	`canonical_compilation` text DEFAULT 'DISABLED' NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`formal_release` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`activated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`governance_case_id`) REFERENCES `inspiration_wiki_private_catalog_governance_cases`(`governance_case_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_wiki_hermes_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_id`) REFERENCES `inspiration_wiki_private_pages`(`page_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_revision_id`) REFERENCES `inspiration_wiki_private_page_revisions`(`revision_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`truth_id`) REFERENCES `inspiration_wiki_private_compiled_truths`(`truth_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`policy_revision_id`) REFERENCES `inspiration_wiki_role_policies`(`revision_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_private_internal_catalog_hash_check" CHECK(length("inspiration_wiki_private_internal_catalog_entries"."entry_hash") = 71 and "inspiration_wiki_private_internal_catalog_entries"."entry_hash" like 'sha256:%' and length("inspiration_wiki_private_internal_catalog_entries"."policy_revision_hash") = 71 and "inspiration_wiki_private_internal_catalog_entries"."policy_revision_hash" like 'sha256:%' and length("inspiration_wiki_private_internal_catalog_entries"."target_hash") = 71 and "inspiration_wiki_private_internal_catalog_entries"."target_hash" like 'sha256:%'),
	CONSTRAINT "inspiration_wiki_private_internal_catalog_json_check" CHECK(json_valid("inspiration_wiki_private_internal_catalog_entries"."accepted_decision_ids_json") and json_type("inspiration_wiki_private_internal_catalog_entries"."accepted_decision_ids_json") = 'object' and json_valid("inspiration_wiki_private_internal_catalog_entries"."entry_json") and json_type("inspiration_wiki_private_internal_catalog_entries"."entry_json") = 'object'),
	CONSTRAINT "inspiration_wiki_private_internal_catalog_boundary_check" CHECK("inspiration_wiki_private_internal_catalog_entries"."state" = 'INTERNAL_CATALOG_ACTIVE' and "inspiration_wiki_private_internal_catalog_entries"."rights_scope" = 'UNKNOWN_PRIVATE_ONLY' and "inspiration_wiki_private_internal_catalog_entries"."teacher_private" = 1 and "inspiration_wiki_private_internal_catalog_entries"."student_visible" = 0 and "inspiration_wiki_private_internal_catalog_entries"."internal_catalog" = 'ENABLED' and "inspiration_wiki_private_internal_catalog_entries"."canonical_compilation" = 'DISABLED' and "inspiration_wiki_private_internal_catalog_entries"."current_page" = 'DISABLED' and "inspiration_wiki_private_internal_catalog_entries"."formal_release" = 'DISABLED' and "inspiration_wiki_private_internal_catalog_entries"."r2" = 'DISABLED' and "inspiration_wiki_private_internal_catalog_entries"."embedding" = 'DISABLED' and "inspiration_wiki_private_internal_catalog_entries"."lumi_retrieval" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_internal_catalog_case_unique` ON `inspiration_wiki_private_internal_catalog_entries` (`governance_case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_private_internal_catalog_revision_unique` ON `inspiration_wiki_private_internal_catalog_entries` (`page_revision_id`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_private_internal_catalog_page_idx` ON `inspiration_wiki_private_internal_catalog_entries` (`page_id`,`activated_at`);
--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_private_catalog_cases_no_update
BEFORE UPDATE ON inspiration_wiki_private_catalog_governance_cases
BEGIN SELECT RAISE(ABORT, 'PRIVATE_CATALOG_GOVERNANCE_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_private_catalog_cases_no_delete
BEFORE DELETE ON inspiration_wiki_private_catalog_governance_cases
BEGIN SELECT RAISE(ABORT, 'PRIVATE_CATALOG_GOVERNANCE_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_private_catalog_decisions_no_update
BEFORE UPDATE ON inspiration_wiki_private_catalog_domain_decisions
BEGIN SELECT RAISE(ABORT, 'PRIVATE_CATALOG_DECISION_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_private_catalog_decisions_no_delete
BEFORE DELETE ON inspiration_wiki_private_catalog_domain_decisions
BEGIN SELECT RAISE(ABORT, 'PRIVATE_CATALOG_DECISION_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_private_internal_catalog_no_update
BEFORE UPDATE ON inspiration_wiki_private_internal_catalog_entries
BEGIN SELECT RAISE(ABORT, 'PRIVATE_INTERNAL_CATALOG_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_private_internal_catalog_no_delete
BEFORE DELETE ON inspiration_wiki_private_internal_catalog_entries
BEGIN SELECT RAISE(ABORT, 'PRIVATE_INTERNAL_CATALOG_APPEND_ONLY'); END;
