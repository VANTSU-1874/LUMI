CREATE TABLE `inspiration_wiki_p2_channel_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`snapshot_hash` text NOT NULL,
	`source_readiness_hash` text NOT NULL,
	`source_set_hash` text NOT NULL,
	`schema_version` text NOT NULL,
	`mode` text NOT NULL,
	`browse_release` text NOT NULL,
	`student_search` text NOT NULL,
	`wiki_retrieval` text NOT NULL,
	`total_count` integer NOT NULL,
	`eligible_count` integer NOT NULL,
	`blocked_count` integer NOT NULL,
	`rights_unknown_count` integer NOT NULL,
	`eligible_page_ids_json` text NOT NULL,
	`restricted_page_ids_json` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`student_visible` integer DEFAULT false NOT NULL,
	`production_deployment` text DEFAULT 'DISABLED' NOT NULL,
	`formal_release` text DEFAULT 'DISABLED' NOT NULL,
	`current_page` text DEFAULT 'DISABLED' NOT NULL,
	`r2` text DEFAULT 'DISABLED' NOT NULL,
	`embedding` text DEFAULT 'DISABLED' NOT NULL,
	`lumi_retrieval` text DEFAULT 'DISABLED' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "inspiration_wiki_p2_channel_id_check" CHECK("inspiration_wiki_p2_channel_snapshots"."snapshot_id" glob 'p2-channel-shadow:*'),
	CONSTRAINT "inspiration_wiki_p2_channel_hash_check" CHECK(length("inspiration_wiki_p2_channel_snapshots"."snapshot_hash") = 71 and "inspiration_wiki_p2_channel_snapshots"."snapshot_hash" like 'sha256:%' and length("inspiration_wiki_p2_channel_snapshots"."source_readiness_hash") = 71 and "inspiration_wiki_p2_channel_snapshots"."source_readiness_hash" like 'sha256:%' and length("inspiration_wiki_p2_channel_snapshots"."source_set_hash") = 71 and "inspiration_wiki_p2_channel_snapshots"."source_set_hash" like 'sha256:%'),
	CONSTRAINT "inspiration_wiki_p2_channel_count_check" CHECK("inspiration_wiki_p2_channel_snapshots"."total_count" >= 0 and "inspiration_wiki_p2_channel_snapshots"."eligible_count" = 0 and "inspiration_wiki_p2_channel_snapshots"."total_count" = "inspiration_wiki_p2_channel_snapshots"."blocked_count" and "inspiration_wiki_p2_channel_snapshots"."total_count" = "inspiration_wiki_p2_channel_snapshots"."rights_unknown_count"),
	CONSTRAINT "inspiration_wiki_p2_channel_json_check" CHECK(json_valid("inspiration_wiki_p2_channel_snapshots"."eligible_page_ids_json") and json_type("inspiration_wiki_p2_channel_snapshots"."eligible_page_ids_json") = 'array' and json_array_length("inspiration_wiki_p2_channel_snapshots"."eligible_page_ids_json") = 0 and json_valid("inspiration_wiki_p2_channel_snapshots"."restricted_page_ids_json") and json_type("inspiration_wiki_p2_channel_snapshots"."restricted_page_ids_json") = 'array' and json_array_length("inspiration_wiki_p2_channel_snapshots"."restricted_page_ids_json") = "inspiration_wiki_p2_channel_snapshots"."blocked_count" and json_valid("inspiration_wiki_p2_channel_snapshots"."snapshot_json") and json_type("inspiration_wiki_p2_channel_snapshots"."snapshot_json") = 'object'),
	CONSTRAINT "inspiration_wiki_p2_channel_boundary_check" CHECK("inspiration_wiki_p2_channel_snapshots"."mode" = 'SHADOW' and "inspiration_wiki_p2_channel_snapshots"."browse_release" = 'SHADOW' and "inspiration_wiki_p2_channel_snapshots"."student_search" = 'SHADOW' and "inspiration_wiki_p2_channel_snapshots"."wiki_retrieval" = 'DISABLED' and "inspiration_wiki_p2_channel_snapshots"."student_visible" = 0 and "inspiration_wiki_p2_channel_snapshots"."production_deployment" = 'DISABLED' and "inspiration_wiki_p2_channel_snapshots"."formal_release" = 'DISABLED' and "inspiration_wiki_p2_channel_snapshots"."current_page" = 'DISABLED' and "inspiration_wiki_p2_channel_snapshots"."r2" = 'DISABLED' and "inspiration_wiki_p2_channel_snapshots"."embedding" = 'DISABLED' and "inspiration_wiki_p2_channel_snapshots"."lumi_retrieval" = 'DISABLED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_p2_channel_source_unique` ON `inspiration_wiki_p2_channel_snapshots` (`source_readiness_hash`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_p2_channel_created_idx` ON `inspiration_wiki_p2_channel_snapshots` (`created_at`,`snapshot_id`);--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_p2_channel_snapshots_no_update
BEFORE UPDATE ON inspiration_wiki_p2_channel_snapshots
BEGIN SELECT RAISE(ABORT, 'P2_CHANNEL_SNAPSHOT_APPEND_ONLY'); END;--> statement-breakpoint
CREATE TRIGGER inspiration_wiki_p2_channel_snapshots_no_delete
BEFORE DELETE ON inspiration_wiki_p2_channel_snapshots
BEGIN SELECT RAISE(ABORT, 'P2_CHANNEL_SNAPSHOT_APPEND_ONLY'); END;
