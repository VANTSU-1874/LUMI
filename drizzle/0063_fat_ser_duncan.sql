CREATE TABLE `inspiration_wiki_canonical_page_revisions` (
	`canonical_revision_id` text PRIMARY KEY NOT NULL,
	`canonical_page_id` text NOT NULL,
	`revision` integer NOT NULL,
	`revision_hash` text NOT NULL,
	`case_id` text NOT NULL,
	`source_private_page_id` text NOT NULL,
	`source_private_revision_id` text NOT NULL,
	`source_content_hash` text NOT NULL,
	`material_json` text NOT NULL,
	`assets_json` text NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`formal_release` text DEFAULT 'DISABLED' NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`production_deployment` text DEFAULT 'DISABLED' NOT NULL,
	`compiled_at` integer NOT NULL,
	FOREIGN KEY (`canonical_page_id`) REFERENCES `inspiration_wiki_canonical_pages`(`canonical_page_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`case_id`) REFERENCES `inspiration_wiki_release_qualification_cases`(`case_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_private_page_id`) REFERENCES `inspiration_wiki_private_pages`(`page_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_private_revision_id`) REFERENCES `inspiration_wiki_private_page_revisions`(`revision_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_canonical_revisions_id_check" CHECK("inspiration_wiki_canonical_page_revisions"."canonical_revision_id" glob 'wiki-page-revision:*'),
	CONSTRAINT "inspiration_wiki_canonical_revisions_revision_check" CHECK("inspiration_wiki_canonical_page_revisions"."revision" >= 1),
	CONSTRAINT "inspiration_wiki_canonical_revisions_hash_check" CHECK(length("inspiration_wiki_canonical_page_revisions"."revision_hash") = 71 and "inspiration_wiki_canonical_page_revisions"."revision_hash" like 'sha256:%' and length("inspiration_wiki_canonical_page_revisions"."source_content_hash") = 64 and "inspiration_wiki_canonical_page_revisions"."source_content_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_canonical_revisions_json_check" CHECK(json_valid("inspiration_wiki_canonical_page_revisions"."material_json") and json_type("inspiration_wiki_canonical_page_revisions"."material_json") = 'object' and json_valid("inspiration_wiki_canonical_page_revisions"."assets_json") and json_type("inspiration_wiki_canonical_page_revisions"."assets_json") = 'array' and json_array_length("inspiration_wiki_canonical_page_revisions"."assets_json") >= 1),
	CONSTRAINT "inspiration_wiki_canonical_revisions_inert_check" CHECK("inspiration_wiki_canonical_page_revisions"."student_visible" = 0 and "inspiration_wiki_canonical_page_revisions"."formal_release" = 'DISABLED' and "inspiration_wiki_canonical_page_revisions"."current_page" = 'DISABLED' and "inspiration_wiki_canonical_page_revisions"."r2" = 'DISABLED' and "inspiration_wiki_canonical_page_revisions"."embedding" = 'DISABLED' and "inspiration_wiki_canonical_page_revisions"."lumi_retrieval" = 'DISABLED' and "inspiration_wiki_canonical_page_revisions"."production_deployment" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_canonical_revisions_case_unique` ON `inspiration_wiki_canonical_page_revisions` (`case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_canonical_revisions_page_revision_unique` ON `inspiration_wiki_canonical_page_revisions` (`canonical_page_id`,`revision`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_canonical_pages` (
	`canonical_page_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`page_type` text NOT NULL,
	`page_json` text NOT NULL,
	`canonical` integer DEFAULT true NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`formal_release` text DEFAULT 'DISABLED' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_wiki_hermes_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_canonical_pages_id_check" CHECK("inspiration_wiki_canonical_pages"."canonical_page_id" glob 'wiki-page:*' and length("inspiration_wiki_canonical_pages"."canonical_page_id") = 42),
	CONSTRAINT "inspiration_wiki_canonical_pages_json_check" CHECK(json_valid("inspiration_wiki_canonical_pages"."page_json") and json_type("inspiration_wiki_canonical_pages"."page_json") = 'object'),
	CONSTRAINT "inspiration_wiki_canonical_pages_inert_check" CHECK("inspiration_wiki_canonical_pages"."page_type" = 'INSPIRATION_CASE' and "inspiration_wiki_canonical_pages"."canonical" = 1 and "inspiration_wiki_canonical_pages"."student_visible" = 0 and "inspiration_wiki_canonical_pages"."current_page" = 'DISABLED' and "inspiration_wiki_canonical_pages"."formal_release" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_canonical_pages_candidate_unique` ON `inspiration_wiki_canonical_pages` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_current_page_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_hash` text NOT NULL,
	`request_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`canonical_page_id` text NOT NULL,
	`canonical_revision_id` text NOT NULL,
	`release_id` text NOT NULL,
	`event_type` text NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`event_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`canonical_page_id`) REFERENCES `inspiration_wiki_canonical_pages`(`canonical_page_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`canonical_revision_id`) REFERENCES `inspiration_wiki_canonical_page_revisions`(`canonical_revision_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`release_id`) REFERENCES `inspiration_wiki_formal_releases`(`release_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_current_page_events_id_check" CHECK("inspiration_wiki_current_page_events"."event_id" glob 'current-page-event:*' and length("inspiration_wiki_current_page_events"."event_id") = 51),
	CONSTRAINT "inspiration_wiki_current_page_events_hash_check" CHECK(length("inspiration_wiki_current_page_events"."event_hash") = 71 and "inspiration_wiki_current_page_events"."event_hash" like 'sha256:%' and length("inspiration_wiki_current_page_events"."request_hash") = 71 and "inspiration_wiki_current_page_events"."request_hash" like 'sha256:%'),
	CONSTRAINT "inspiration_wiki_current_page_events_json_check" CHECK(json_valid("inspiration_wiki_current_page_events"."event_json") and json_type("inspiration_wiki_current_page_events"."event_json") = 'object' and length(trim("inspiration_wiki_current_page_events"."reason")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_current_page_events_idempotency_unique` ON `inspiration_wiki_current_page_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_current_page_events_page_created_idx` ON `inspiration_wiki_current_page_events` (`canonical_page_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_formal_releases` (
	`release_id` text PRIMARY KEY NOT NULL,
	`release_hash` text NOT NULL,
	`request_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`case_id` text NOT NULL,
	`case_hash` text NOT NULL,
	`canonical_page_id` text NOT NULL,
	`canonical_revision_id` text NOT NULL,
	`qualification_decision_ids_json` text NOT NULL,
	`release_json` text NOT NULL,
	`status` text NOT NULL,
	`published_by` text NOT NULL,
	`student_visible` integer DEFAULT true NOT NULL,
	`formal_release` text DEFAULT 'ACTIVE' NOT NULL,
	`current_page` text DEFAULT 'ACTIVE' NOT NULL,
	`browse_release` text DEFAULT 'ACTIVE' NOT NULL,
	`student_search` text DEFAULT 'ACTIVE' NOT NULL,
	`preview` text DEFAULT 'ACTIVE' NOT NULL,
	`wiki_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`production_deployment` text DEFAULT 'DISABLED' NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `inspiration_wiki_release_qualification_cases`(`case_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`canonical_page_id`) REFERENCES `inspiration_wiki_canonical_pages`(`canonical_page_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`canonical_revision_id`) REFERENCES `inspiration_wiki_canonical_page_revisions`(`canonical_revision_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_formal_releases_id_check" CHECK("inspiration_wiki_formal_releases"."release_id" glob 'wiki-release:*' and length("inspiration_wiki_formal_releases"."release_id") = 45),
	CONSTRAINT "inspiration_wiki_formal_releases_hash_check" CHECK(length("inspiration_wiki_formal_releases"."release_hash") = 71 and "inspiration_wiki_formal_releases"."release_hash" like 'sha256:%' and length("inspiration_wiki_formal_releases"."request_hash") = 71 and "inspiration_wiki_formal_releases"."request_hash" like 'sha256:%' and length("inspiration_wiki_formal_releases"."case_hash") = 71 and "inspiration_wiki_formal_releases"."case_hash" like 'sha256:%'),
	CONSTRAINT "inspiration_wiki_formal_releases_json_check" CHECK(json_valid("inspiration_wiki_formal_releases"."qualification_decision_ids_json") and json_type("inspiration_wiki_formal_releases"."qualification_decision_ids_json") = 'object' and json_valid("inspiration_wiki_formal_releases"."release_json") and json_type("inspiration_wiki_formal_releases"."release_json") = 'object'),
	CONSTRAINT "inspiration_wiki_formal_releases_boundary_check" CHECK("inspiration_wiki_formal_releases"."status" = 'PUBLISHED' and "inspiration_wiki_formal_releases"."student_visible" = 1 and "inspiration_wiki_formal_releases"."formal_release" = 'ACTIVE' and "inspiration_wiki_formal_releases"."current_page" = 'ACTIVE' and "inspiration_wiki_formal_releases"."browse_release" = 'ACTIVE' and "inspiration_wiki_formal_releases"."student_search" = 'ACTIVE' and "inspiration_wiki_formal_releases"."preview" = 'ACTIVE' and "inspiration_wiki_formal_releases"."wiki_retrieval" = 'DISABLED' and "inspiration_wiki_formal_releases"."r2" = 'DISABLED' and "inspiration_wiki_formal_releases"."embedding" = 'DISABLED' and "inspiration_wiki_formal_releases"."lumi_retrieval" = 'DISABLED' and "inspiration_wiki_formal_releases"."production_deployment" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_formal_releases_idempotency_unique` ON `inspiration_wiki_formal_releases` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_formal_releases_case_unique` ON `inspiration_wiki_formal_releases` (`case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_formal_releases_revision_unique` ON `inspiration_wiki_formal_releases` (`canonical_revision_id`);--> statement-breakpoint
CREATE TABLE `inspiration_wiki_p2_active_channel_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`snapshot_hash` text NOT NULL,
	`release_set_hash` text NOT NULL,
	`schema_version` text NOT NULL,
	`mode` text NOT NULL,
	`release_ids_json` text NOT NULL,
	`canonical_page_ids_json` text NOT NULL,
	`browse_release` text NOT NULL,
	`student_search` text NOT NULL,
	`preview` text NOT NULL,
	`wiki_retrieval` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`student_visible` integer DEFAULT true NOT NULL,
	`formal_release` text NOT NULL,
	`current_page` text NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`production_deployment` text DEFAULT 'DISABLED' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "inspiration_wiki_p2_active_id_check" CHECK("inspiration_wiki_p2_active_channel_snapshots"."snapshot_id" glob 'p2-channel-active:*' and length("inspiration_wiki_p2_active_channel_snapshots"."snapshot_id") = 50),
	CONSTRAINT "inspiration_wiki_p2_active_hash_check" CHECK(length("inspiration_wiki_p2_active_channel_snapshots"."snapshot_hash") = 71 and "inspiration_wiki_p2_active_channel_snapshots"."snapshot_hash" like 'sha256:%' and length("inspiration_wiki_p2_active_channel_snapshots"."release_set_hash") = 71 and "inspiration_wiki_p2_active_channel_snapshots"."release_set_hash" like 'sha256:%'),
	CONSTRAINT "inspiration_wiki_p2_active_json_check" CHECK(json_valid("inspiration_wiki_p2_active_channel_snapshots"."release_ids_json") and json_type("inspiration_wiki_p2_active_channel_snapshots"."release_ids_json") = 'array' and json_valid("inspiration_wiki_p2_active_channel_snapshots"."canonical_page_ids_json") and json_type("inspiration_wiki_p2_active_channel_snapshots"."canonical_page_ids_json") = 'array' and json_array_length("inspiration_wiki_p2_active_channel_snapshots"."canonical_page_ids_json") = json_array_length("inspiration_wiki_p2_active_channel_snapshots"."release_ids_json") and json_valid("inspiration_wiki_p2_active_channel_snapshots"."snapshot_json") and json_type("inspiration_wiki_p2_active_channel_snapshots"."snapshot_json") = 'object'),
	CONSTRAINT "inspiration_wiki_p2_active_boundary_check" CHECK("inspiration_wiki_p2_active_channel_snapshots"."mode" = 'ACTIVE' and "inspiration_wiki_p2_active_channel_snapshots"."browse_release" = 'ACTIVE' and "inspiration_wiki_p2_active_channel_snapshots"."student_search" = 'ACTIVE' and "inspiration_wiki_p2_active_channel_snapshots"."preview" = 'ACTIVE' and "inspiration_wiki_p2_active_channel_snapshots"."wiki_retrieval" = 'DISABLED' and "inspiration_wiki_p2_active_channel_snapshots"."student_visible" = 1 and "inspiration_wiki_p2_active_channel_snapshots"."formal_release" = 'ACTIVE' and "inspiration_wiki_p2_active_channel_snapshots"."current_page" = 'ACTIVE' and "inspiration_wiki_p2_active_channel_snapshots"."r2" = 'DISABLED' and "inspiration_wiki_p2_active_channel_snapshots"."embedding" = 'DISABLED' and "inspiration_wiki_p2_active_channel_snapshots"."lumi_retrieval" = 'DISABLED' and "inspiration_wiki_p2_active_channel_snapshots"."production_deployment" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_p2_active_release_set_unique` ON `inspiration_wiki_p2_active_channel_snapshots` (`release_set_hash`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_p2_active_created_idx` ON `inspiration_wiki_p2_active_channel_snapshots` (`created_at`,`snapshot_id`);
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_canonical_pages_no_update`
BEFORE UPDATE ON `inspiration_wiki_canonical_pages`
BEGIN SELECT RAISE(ABORT, 'INSPIRATION_WIKI_CANONICAL_PAGE_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_canonical_pages_no_delete`
BEFORE DELETE ON `inspiration_wiki_canonical_pages`
BEGIN SELECT RAISE(ABORT, 'INSPIRATION_WIKI_CANONICAL_PAGE_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_canonical_revisions_no_update`
BEFORE UPDATE ON `inspiration_wiki_canonical_page_revisions`
BEGIN SELECT RAISE(ABORT, 'INSPIRATION_WIKI_CANONICAL_REVISION_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_canonical_revisions_no_delete`
BEFORE DELETE ON `inspiration_wiki_canonical_page_revisions`
BEGIN SELECT RAISE(ABORT, 'INSPIRATION_WIKI_CANONICAL_REVISION_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_formal_releases_no_update`
BEFORE UPDATE ON `inspiration_wiki_formal_releases`
BEGIN SELECT RAISE(ABORT, 'INSPIRATION_WIKI_FORMAL_RELEASE_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_formal_releases_no_delete`
BEFORE DELETE ON `inspiration_wiki_formal_releases`
BEGIN SELECT RAISE(ABORT, 'INSPIRATION_WIKI_FORMAL_RELEASE_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_current_page_events_no_update`
BEFORE UPDATE ON `inspiration_wiki_current_page_events`
BEGIN SELECT RAISE(ABORT, 'INSPIRATION_WIKI_CURRENT_PAGE_EVENT_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_current_page_events_no_delete`
BEFORE DELETE ON `inspiration_wiki_current_page_events`
BEGIN SELECT RAISE(ABORT, 'INSPIRATION_WIKI_CURRENT_PAGE_EVENT_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_p2_active_snapshots_no_update`
BEFORE UPDATE ON `inspiration_wiki_p2_active_channel_snapshots`
BEGIN SELECT RAISE(ABORT, 'INSPIRATION_WIKI_P2_ACTIVE_SNAPSHOT_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_p2_active_snapshots_no_delete`
BEFORE DELETE ON `inspiration_wiki_p2_active_channel_snapshots`
BEGIN SELECT RAISE(ABORT, 'INSPIRATION_WIKI_P2_ACTIVE_SNAPSHOT_APPEND_ONLY'); END;
