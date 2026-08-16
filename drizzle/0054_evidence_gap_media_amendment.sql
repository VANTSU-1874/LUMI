CREATE TABLE `inspiration_wiki_evidence_gap_media_amendments` (
	`id` text PRIMARY KEY NOT NULL,
	`review_pack_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`amendment_kind` text NOT NULL,
	`previous_revision` integer NOT NULL,
	`next_revision` integer NOT NULL,
	`previous_material_hash` text NOT NULL,
	`next_material_hash` text NOT NULL,
	`media_id` text NOT NULL,
	`asset_storage_path` text NOT NULL,
	`asset_sha256` text NOT NULL,
	`asset_mime_type` text NOT NULL,
	`asset_bytes` integer NOT NULL,
	`source_package_digest` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`previous_pack_json` text NOT NULL,
	`amended_pack_json` text NOT NULL,
	`previous_assets_json` text NOT NULL,
	`amended_assets_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_pack_id`) REFERENCES `inspiration_wiki_evidence_gap_review_packs`(`review_pack_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`candidate_id`) REFERENCES `inspiration_wiki_hermes_candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inspiration_wiki_evidence_gap_media_amendments_kind_check" CHECK("inspiration_wiki_evidence_gap_media_amendments"."amendment_kind" = 'ADD_UNVERIFIED_LOCAL_PREVIEW'),
	CONSTRAINT "inspiration_wiki_evidence_gap_media_amendments_revision_check" CHECK("inspiration_wiki_evidence_gap_media_amendments"."previous_revision" > 0 and "inspiration_wiki_evidence_gap_media_amendments"."next_revision" = "inspiration_wiki_evidence_gap_media_amendments"."previous_revision" + 1),
	CONSTRAINT "inspiration_wiki_evidence_gap_media_amendments_hash_check" CHECK(length("inspiration_wiki_evidence_gap_media_amendments"."previous_material_hash") = 64 and "inspiration_wiki_evidence_gap_media_amendments"."previous_material_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_evidence_gap_media_amendments"."next_material_hash") = 64 and "inspiration_wiki_evidence_gap_media_amendments"."next_material_hash" not glob '*[^0-9a-f]*' and length("inspiration_wiki_evidence_gap_media_amendments"."asset_sha256") = 64 and "inspiration_wiki_evidence_gap_media_amendments"."asset_sha256" not glob '*[^0-9a-f]*' and length("inspiration_wiki_evidence_gap_media_amendments"."source_package_digest") = 64 and "inspiration_wiki_evidence_gap_media_amendments"."source_package_digest" not glob '*[^0-9a-f]*' and length("inspiration_wiki_evidence_gap_media_amendments"."request_hash") = 64 and "inspiration_wiki_evidence_gap_media_amendments"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inspiration_wiki_evidence_gap_media_amendments_asset_check" CHECK("inspiration_wiki_evidence_gap_media_amendments"."asset_bytes" between 1 and 26214400 and "inspiration_wiki_evidence_gap_media_amendments"."asset_mime_type" in ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "inspiration_wiki_evidence_gap_media_amendments_key_check" CHECK(length("inspiration_wiki_evidence_gap_media_amendments"."idempotency_key") between 8 and 128),
	CONSTRAINT "inspiration_wiki_evidence_gap_media_amendments_json_check" CHECK(json_valid("inspiration_wiki_evidence_gap_media_amendments"."previous_pack_json") and json_type("inspiration_wiki_evidence_gap_media_amendments"."previous_pack_json") = 'object' and json_valid("inspiration_wiki_evidence_gap_media_amendments"."amended_pack_json") and json_type("inspiration_wiki_evidence_gap_media_amendments"."amended_pack_json") = 'object' and json_valid("inspiration_wiki_evidence_gap_media_amendments"."previous_assets_json") and json_type("inspiration_wiki_evidence_gap_media_amendments"."previous_assets_json") = 'array' and json_array_length("inspiration_wiki_evidence_gap_media_amendments"."previous_assets_json") = 0 and json_valid("inspiration_wiki_evidence_gap_media_amendments"."amended_assets_json") and json_type("inspiration_wiki_evidence_gap_media_amendments"."amended_assets_json") = 'array' and json_array_length("inspiration_wiki_evidence_gap_media_amendments"."amended_assets_json") = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_evidence_gap_media_amendments_key_unique` ON `inspiration_wiki_evidence_gap_media_amendments` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspiration_wiki_evidence_gap_media_amendments_pack_revision_unique` ON `inspiration_wiki_evidence_gap_media_amendments` (`review_pack_id`,`next_revision`);--> statement-breakpoint
CREATE INDEX `inspiration_wiki_evidence_gap_media_amendments_pack_created_idx` ON `inspiration_wiki_evidence_gap_media_amendments` (`review_pack_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_evidence_gap_media_amendments_no_update`
BEFORE UPDATE ON `inspiration_wiki_evidence_gap_media_amendments`
BEGIN
	SELECT RAISE(ABORT, 'evidence-gap media amendment audit is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `inspiration_wiki_evidence_gap_media_amendments_no_delete`
BEFORE DELETE ON `inspiration_wiki_evidence_gap_media_amendments`
BEGIN
	SELECT RAISE(ABORT, 'evidence-gap media amendment audit is append-only');
END;
