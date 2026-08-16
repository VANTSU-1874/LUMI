CREATE TABLE `agent_student_memory_disputes` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	`data_type` text GENERATED ALWAYS AS (
        case when student_id glob 'demo-*'
        then 'DEMONSTRATION_DATA' else 'REAL' end
      ) VIRTUAL,
	FOREIGN KEY (`memory_id`,`student_id`,`class_id`) REFERENCES `agent_student_memory`(`id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_student_memory_disputes_reason_check" CHECK("agent_student_memory_disputes"."reason" is null or length(trim("agent_student_memory_disputes"."reason")) between 1 and 500),
	CONSTRAINT "agent_student_memory_disputes_data_type_check" CHECK("agent_student_memory_disputes"."data_type" in ('REAL','DEMONSTRATION_DATA'))
);
--> statement-breakpoint
CREATE INDEX `agent_student_memory_disputes_owner_idx` ON `agent_student_memory_disputes` (`student_id`,`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `knowledge_active_corpus_v2` (
	`id` integer PRIMARY KEY NOT NULL,
	`bundle_hash` text NOT NULL,
	`activated_at` integer NOT NULL,
	FOREIGN KEY (`bundle_hash`) REFERENCES `knowledge_corpora_v2`(`bundle_hash`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "knowledge_active_corpus_v2_singleton_check" CHECK("knowledge_active_corpus_v2"."id" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_active_corpus_v2_bundle_hash_unique` ON `knowledge_active_corpus_v2` (`bundle_hash`);--> statement-breakpoint
CREATE TABLE `knowledge_active_index_bundle_v2` (
	`id` integer PRIMARY KEY NOT NULL,
	`corpus_hash` text NOT NULL,
	`index_bundle_hash` text NOT NULL,
	`activated_at` integer NOT NULL,
	FOREIGN KEY (`corpus_hash`,`index_bundle_hash`) REFERENCES `knowledge_index_bundles_v2`(`corpus_hash`,`index_bundle_hash`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`corpus_hash`) REFERENCES `knowledge_active_corpus_v2`(`bundle_hash`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "knowledge_active_index_bundle_v2_singleton_check" CHECK("knowledge_active_index_bundle_v2"."id" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_active_index_bundle_v2_index_bundle_hash_unique` ON `knowledge_active_index_bundle_v2` (`index_bundle_hash`);--> statement-breakpoint
CREATE TABLE `knowledge_annotation_inputs_v2` (
	`corpus_hash` text NOT NULL,
	`annotation_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`input_hash` text NOT NULL,
	`asset_id` text,
	`canonical_json` text NOT NULL,
	PRIMARY KEY(`corpus_hash`, `annotation_id`, `ordinal`),
	FOREIGN KEY (`corpus_hash`,`annotation_id`) REFERENCES `knowledge_annotations_v2`(`corpus_hash`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`corpus_hash`,`asset_id`) REFERENCES `knowledge_assets_v2`(`corpus_hash`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "knowledge_annotation_inputs_v2_ordinal_check" CHECK("knowledge_annotation_inputs_v2"."ordinal" >= 0),
	CONSTRAINT "knowledge_annotation_inputs_v2_kind_check" CHECK("knowledge_annotation_inputs_v2"."kind" in ('SOURCE_DOCUMENT','SOURCE_SECTION','ASSET')),
	CONSTRAINT "knowledge_annotation_inputs_v2_asset_kind_check" CHECK(
      ("knowledge_annotation_inputs_v2"."kind" = 'ASSET' and "knowledge_annotation_inputs_v2"."asset_id" is not null)
      or ("knowledge_annotation_inputs_v2"."kind" <> 'ASSET' and "knowledge_annotation_inputs_v2"."asset_id" is null)
    ),
	CONSTRAINT "knowledge_annotation_inputs_v2_hash_check" CHECK(length("knowledge_annotation_inputs_v2"."input_hash") = 64 and "knowledge_annotation_inputs_v2"."input_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "knowledge_annotation_inputs_v2_json_check" CHECK(json_valid("knowledge_annotation_inputs_v2"."canonical_json") and json_type("knowledge_annotation_inputs_v2"."canonical_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE `knowledge_annotations_v2` (
	`corpus_hash` text NOT NULL,
	`id` text NOT NULL,
	`document_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`kind` text NOT NULL,
	`origin` text NOT NULL,
	`producer_id` text NOT NULL,
	`producer_version` text NOT NULL,
	`model_id` text,
	`model_revision` text,
	`annotation_hash` text NOT NULL,
	`canonical_json` text NOT NULL,
	PRIMARY KEY(`corpus_hash`, `id`),
	FOREIGN KEY (`corpus_hash`,`document_id`) REFERENCES `knowledge_documents_v2`(`corpus_hash`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`corpus_hash`,`target_node_id`) REFERENCES `knowledge_nodes_v2`(`corpus_hash`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_annotations_v2_kind_check" CHECK("knowledge_annotations_v2"."kind" in ('CAPTION','OCR','VISUAL_TAGS')),
	CONSTRAINT "knowledge_annotations_v2_origin_check" CHECK("knowledge_annotations_v2"."origin" in ('SOURCE','MODEL_DERIVED','HUMAN_REVIEWED')),
	CONSTRAINT "knowledge_annotations_v2_model_pair_check" CHECK(
      ("knowledge_annotations_v2"."model_id" is null and "knowledge_annotations_v2"."model_revision" is null)
      or ("knowledge_annotations_v2"."model_id" is not null and "knowledge_annotations_v2"."model_revision" is not null)
    ),
	CONSTRAINT "knowledge_annotations_v2_json_check" CHECK(json_valid("knowledge_annotations_v2"."canonical_json") and json_type("knowledge_annotations_v2"."canonical_json") = 'object'),
	CONSTRAINT "knowledge_annotations_v2_hash_check" CHECK(length("knowledge_annotations_v2"."annotation_hash") = 64 and "knowledge_annotations_v2"."annotation_hash" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `knowledge_annotations_v2_target_idx` ON `knowledge_annotations_v2` (`corpus_hash`,`target_node_id`,`kind`);--> statement-breakpoint
CREATE TABLE `knowledge_assets_v2` (
	`corpus_hash` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`locator_root` text NOT NULL,
	`locator_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width_px` integer NOT NULL,
	`height_px` integer NOT NULL,
	`sha256` text NOT NULL,
	`explicitly_unreferenced` integer NOT NULL,
	`canonical_json` text NOT NULL,
	PRIMARY KEY(`corpus_hash`, `id`),
	FOREIGN KEY (`corpus_hash`) REFERENCES `knowledge_corpora_v2`(`bundle_hash`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_assets_v2_kind_check" CHECK("knowledge_assets_v2"."kind" = 'IMAGE'),
	CONSTRAINT "knowledge_assets_v2_mime_check" CHECK("knowledge_assets_v2"."mime_type" = 'image/png'),
	CONSTRAINT "knowledge_assets_v2_size_check" CHECK("knowledge_assets_v2"."size_bytes" > 0 and "knowledge_assets_v2"."width_px" > 0 and "knowledge_assets_v2"."height_px" > 0),
	CONSTRAINT "knowledge_assets_v2_hash_check" CHECK(length("knowledge_assets_v2"."sha256") = 64 and "knowledge_assets_v2"."sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "knowledge_assets_v2_unreferenced_check" CHECK("knowledge_assets_v2"."explicitly_unreferenced" in (0,1)),
	CONSTRAINT "knowledge_assets_v2_json_check" CHECK(json_valid("knowledge_assets_v2"."canonical_json") and json_type("knowledge_assets_v2"."canonical_json") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_assets_v2_corpus_path_unique` ON `knowledge_assets_v2` (`corpus_hash`,`locator_root`,`locator_path`);--> statement-breakpoint
CREATE INDEX `knowledge_assets_v2_hash_idx` ON `knowledge_assets_v2` (`sha256`);--> statement-breakpoint
CREATE TABLE `knowledge_corpora_v2` (
	`bundle_hash` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`corpus_version` text NOT NULL,
	`parser_id` text NOT NULL,
	`parser_version` text NOT NULL,
	`content_version` text NOT NULL,
	`object_count` integer NOT NULL,
	`asset_count` integer NOT NULL,
	`canonical_json` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "knowledge_corpora_v2_schema_check" CHECK("knowledge_corpora_v2"."schema_version" = 2),
	CONSTRAINT "knowledge_corpora_v2_hash_check" CHECK(length("knowledge_corpora_v2"."bundle_hash") = 64 and "knowledge_corpora_v2"."bundle_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "knowledge_corpora_v2_counts_check" CHECK("knowledge_corpora_v2"."object_count" >= 0 and "knowledge_corpora_v2"."asset_count" >= 0),
	CONSTRAINT "knowledge_corpora_v2_json_check" CHECK(json_valid("knowledge_corpora_v2"."canonical_json") and json_type("knowledge_corpora_v2"."canonical_json") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_corpora_v2_version_unique` ON `knowledge_corpora_v2` (`corpus_version`);--> statement-breakpoint
CREATE TABLE `knowledge_document_assets_v2` (
	`corpus_hash` text NOT NULL,
	`document_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`corpus_hash`, `document_id`, `asset_id`),
	FOREIGN KEY (`corpus_hash`,`document_id`) REFERENCES `knowledge_documents_v2`(`corpus_hash`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`corpus_hash`,`asset_id`) REFERENCES `knowledge_assets_v2`(`corpus_hash`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_document_assets_v2_ordinal_check" CHECK("knowledge_document_assets_v2"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_document_assets_v2_document_ordinal_unique` ON `knowledge_document_assets_v2` (`corpus_hash`,`document_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `knowledge_documents_v2` (
	`corpus_hash` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`topic` text NOT NULL,
	`tags_json` text NOT NULL,
	`source_course_pack_id` text NOT NULL,
	`source_course_pack_version` text NOT NULL,
	`source_identity_basis` text NOT NULL,
	`legacy_course_pack_id` text NOT NULL,
	`legacy_course_pack_version` text NOT NULL,
	`legacy_namespace` text NOT NULL,
	`provenance_json` text NOT NULL,
	`parser_id` text NOT NULL,
	`parser_version` text NOT NULL,
	`content_version` text NOT NULL,
	`root_node_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`annotation_hash` text NOT NULL,
	`legacy_item_json` text NOT NULL,
	`canonical_json` text NOT NULL,
	PRIMARY KEY(`corpus_hash`, `id`),
	FOREIGN KEY (`corpus_hash`) REFERENCES `knowledge_corpora_v2`(`bundle_hash`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_documents_v2_tags_json_check" CHECK(json_valid("knowledge_documents_v2"."tags_json") and json_type("knowledge_documents_v2"."tags_json") = 'array'),
	CONSTRAINT "knowledge_documents_v2_provenance_json_check" CHECK(json_valid("knowledge_documents_v2"."provenance_json") and json_type("knowledge_documents_v2"."provenance_json") = 'object'),
	CONSTRAINT "knowledge_documents_v2_legacy_json_check" CHECK(json_valid("knowledge_documents_v2"."legacy_item_json") and json_type("knowledge_documents_v2"."legacy_item_json") = 'object'),
	CONSTRAINT "knowledge_documents_v2_canonical_json_check" CHECK(json_valid("knowledge_documents_v2"."canonical_json") and json_type("knowledge_documents_v2"."canonical_json") = 'object'),
	CONSTRAINT "knowledge_documents_v2_hashes_check" CHECK(
      length("knowledge_documents_v2"."content_hash") = 64 and "knowledge_documents_v2"."content_hash" not glob '*[^0-9a-f]*'
      and length("knowledge_documents_v2"."annotation_hash") = 64 and "knowledge_documents_v2"."annotation_hash" not glob '*[^0-9a-f]*'
    )
);
--> statement-breakpoint
CREATE INDEX `knowledge_documents_v2_source_pack_idx` ON `knowledge_documents_v2` (`corpus_hash`,`source_course_pack_id`,`source_course_pack_version`);--> statement-breakpoint
CREATE INDEX `knowledge_documents_v2_legacy_pack_idx` ON `knowledge_documents_v2` (`corpus_hash`,`legacy_course_pack_id`,`legacy_course_pack_version`);--> statement-breakpoint
CREATE TABLE `knowledge_index_bundles_v2` (
	`index_bundle_hash` text PRIMARY KEY NOT NULL,
	`corpus_hash` text NOT NULL,
	`representation_count` integer NOT NULL,
	`shared_payload_count` integer DEFAULT 0 NOT NULL,
	`canonical_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`corpus_hash`) REFERENCES `knowledge_corpora_v2`(`bundle_hash`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_index_bundles_v2_hash_check" CHECK(length("knowledge_index_bundles_v2"."index_bundle_hash") = 64 and "knowledge_index_bundles_v2"."index_bundle_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "knowledge_index_bundles_v2_count_check" CHECK(
      "knowledge_index_bundles_v2"."representation_count" >= 0
      and ("knowledge_index_bundles_v2"."shared_payload_count" = 0 or "knowledge_index_bundles_v2"."shared_payload_count" >= 2)
    ),
	CONSTRAINT "knowledge_index_bundles_v2_json_check" CHECK(json_valid("knowledge_index_bundles_v2"."canonical_json") and json_type("knowledge_index_bundles_v2"."canonical_json") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_index_bundles_v2_corpus_hash_unique` ON `knowledge_index_bundles_v2` (`corpus_hash`,`index_bundle_hash`);--> statement-breakpoint
CREATE TABLE `knowledge_index_entries_v2` (
	`index_bundle_hash` text NOT NULL,
	`id` text NOT NULL,
	`index_version_id` text NOT NULL,
	`channel` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`representation_json` text NOT NULL,
	`dimensions` integer,
	`vector_count` integer NOT NULL,
	`storage_kind` text,
	`storage_key` text,
	`byte_length` integer,
	`payload_sha256` text,
	`manifest_payload_id` text,
	`tensor_payload_id` text,
	`locator_json` text,
	PRIMARY KEY(`index_bundle_hash`, `id`),
	FOREIGN KEY (`index_bundle_hash`,`index_version_id`) REFERENCES `knowledge_index_versions_v2`(`index_bundle_hash`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`index_bundle_hash`,`manifest_payload_id`) REFERENCES `knowledge_index_payloads_v2`(`index_bundle_hash`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`index_bundle_hash`,`tensor_payload_id`) REFERENCES `knowledge_index_payloads_v2`(`index_bundle_hash`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_index_entries_v2_channel_check" CHECK("knowledge_index_entries_v2"."channel" in ('LEXICAL','TEXT_VECTOR','VISUAL_VECTOR','MULTIMODAL_VECTOR')),
	CONSTRAINT "knowledge_index_entries_v2_target_kind_check" CHECK("knowledge_index_entries_v2"."target_kind" in ('OBJECT','NODE','ASSET','ANNOTATION')),
	CONSTRAINT "knowledge_index_entries_v2_json_check" CHECK(json_valid("knowledge_index_entries_v2"."representation_json") and json_type("knowledge_index_entries_v2"."representation_json") = 'object'),
	CONSTRAINT "knowledge_index_entries_v2_vector_count_check" CHECK("knowledge_index_entries_v2"."vector_count" > 0 and ("knowledge_index_entries_v2"."dimensions" is null or "knowledge_index_entries_v2"."dimensions" > 0)),
	CONSTRAINT "knowledge_index_entries_v2_storage_check" CHECK(
      (
        "knowledge_index_entries_v2"."manifest_payload_id" is null
        and "knowledge_index_entries_v2"."tensor_payload_id" is null
        and "knowledge_index_entries_v2"."locator_json" is null
        and "knowledge_index_entries_v2"."storage_kind" = 'CONTROLLED_FILE'
        and "knowledge_index_entries_v2"."storage_key" is not null
        and "knowledge_index_entries_v2"."byte_length" > 0
        and "knowledge_index_entries_v2"."payload_sha256" is not null
      )
      or (
        "knowledge_index_entries_v2"."manifest_payload_id" is not null
        and "knowledge_index_entries_v2"."tensor_payload_id" is not null
        and json_valid("knowledge_index_entries_v2"."locator_json")
        and json_type("knowledge_index_entries_v2"."locator_json") = 'object'
        and "knowledge_index_entries_v2"."storage_kind" is null
        and "knowledge_index_entries_v2"."storage_key" is null
        and "knowledge_index_entries_v2"."byte_length" is null
        and "knowledge_index_entries_v2"."payload_sha256" is null
      )
    ),
	CONSTRAINT "knowledge_index_entries_v2_hash_check" CHECK(
      "knowledge_index_entries_v2"."payload_sha256" is null
      or (length("knowledge_index_entries_v2"."payload_sha256") = 64 and "knowledge_index_entries_v2"."payload_sha256" not glob '*[^0-9a-f]*')
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_index_entries_v2_version_target_unique` ON `knowledge_index_entries_v2` (`index_bundle_hash`,`index_version_id`,`channel`,`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `knowledge_index_entries_v2_target_idx` ON `knowledge_index_entries_v2` (`index_bundle_hash`,`channel`,`target_kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `knowledge_index_payloads_v2` (
	`index_bundle_hash` text NOT NULL,
	`id` text NOT NULL,
	`role` text NOT NULL,
	`format` text NOT NULL,
	`provider_index_hash` text,
	`storage_kind` text NOT NULL,
	`storage_key` text NOT NULL,
	`byte_length` integer NOT NULL,
	`payload_sha256` text NOT NULL,
	`tensor_layout_json` text,
	PRIMARY KEY(`index_bundle_hash`, `id`),
	FOREIGN KEY (`index_bundle_hash`) REFERENCES `knowledge_index_bundles_v2`(`index_bundle_hash`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_index_payloads_v2_role_format_check" CHECK(
      (
        "knowledge_index_payloads_v2"."role" = 'PROVIDER_MANIFEST'
        and "knowledge_index_payloads_v2"."format" = 'JSON'
        and "knowledge_index_payloads_v2"."provider_index_hash" is not null
        and "knowledge_index_payloads_v2"."tensor_layout_json" is null
      )
      or (
        "knowledge_index_payloads_v2"."role" = 'VECTOR_TENSORS'
        and "knowledge_index_payloads_v2"."format" = 'SAFETENSORS'
        and "knowledge_index_payloads_v2"."provider_index_hash" is null
        and json_valid("knowledge_index_payloads_v2"."tensor_layout_json")
        and json_type("knowledge_index_payloads_v2"."tensor_layout_json") = 'array'
        and json_array_length("knowledge_index_payloads_v2"."tensor_layout_json") > 0
      )
    ),
	CONSTRAINT "knowledge_index_payloads_v2_storage_check" CHECK("knowledge_index_payloads_v2"."storage_kind" = 'CONTROLLED_FILE' and "knowledge_index_payloads_v2"."byte_length" > 0),
	CONSTRAINT "knowledge_index_payloads_v2_hash_check" CHECK(
      length("knowledge_index_payloads_v2"."payload_sha256") = 64
      and "knowledge_index_payloads_v2"."payload_sha256" not glob '*[^0-9a-f]*'
      and (
        "knowledge_index_payloads_v2"."provider_index_hash" is null
        or (
          length("knowledge_index_payloads_v2"."provider_index_hash") = 64
          and "knowledge_index_payloads_v2"."provider_index_hash" not glob '*[^0-9a-f]*'
        )
      )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_index_payloads_v2_storage_key_unique` ON `knowledge_index_payloads_v2` (`index_bundle_hash`,`storage_key`);--> statement-breakpoint
CREATE TABLE `knowledge_index_versions_v2` (
	`index_bundle_hash` text NOT NULL,
	`id` text NOT NULL,
	`builder_id` text NOT NULL,
	`builder_version` text NOT NULL,
	`model_id` text,
	`model_revision` text,
	`config_json` text NOT NULL,
	`config_hash` text NOT NULL,
	PRIMARY KEY(`index_bundle_hash`, `id`),
	FOREIGN KEY (`index_bundle_hash`) REFERENCES `knowledge_index_bundles_v2`(`index_bundle_hash`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_index_versions_v2_model_pair_check" CHECK(
      ("knowledge_index_versions_v2"."model_id" is null and "knowledge_index_versions_v2"."model_revision" is null)
      or ("knowledge_index_versions_v2"."model_id" is not null and "knowledge_index_versions_v2"."model_revision" is not null)
    ),
	CONSTRAINT "knowledge_index_versions_v2_hash_check" CHECK(length("knowledge_index_versions_v2"."config_hash") = 64 and "knowledge_index_versions_v2"."config_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "knowledge_index_versions_v2_config_json_check" CHECK(json_valid("knowledge_index_versions_v2"."config_json") and json_type("knowledge_index_versions_v2"."config_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE `knowledge_node_relations_v2` (
	`corpus_hash` text NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`kind` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`corpus_hash`, `source_node_id`, `kind`, `target_node_id`),
	FOREIGN KEY (`corpus_hash`,`source_node_id`) REFERENCES `knowledge_nodes_v2`(`corpus_hash`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`corpus_hash`,`target_node_id`) REFERENCES `knowledge_nodes_v2`(`corpus_hash`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_node_relations_v2_kind_check" CHECK("knowledge_node_relations_v2"."kind" in ('PARENT_CHILD','RELATED')),
	CONSTRAINT "knowledge_node_relations_v2_self_check" CHECK("knowledge_node_relations_v2"."source_node_id" <> "knowledge_node_relations_v2"."target_node_id"),
	CONSTRAINT "knowledge_node_relations_v2_ordinal_check" CHECK("knowledge_node_relations_v2"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_node_relations_v2_parent_target_unique` ON `knowledge_node_relations_v2` (`corpus_hash`,`target_node_id`) WHERE "knowledge_node_relations_v2"."kind" = 'PARENT_CHILD';--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_node_relations_v2_source_ordinal_unique` ON `knowledge_node_relations_v2` (`corpus_hash`,`source_node_id`,`kind`,`ordinal`);--> statement-breakpoint
CREATE TABLE `knowledge_nodes_v2` (
	`corpus_hash` text NOT NULL,
	`id` text NOT NULL,
	`document_id` text NOT NULL,
	`kind` text NOT NULL,
	`asset_id` text,
	`content_hash` text NOT NULL,
	`canonical_json` text NOT NULL,
	PRIMARY KEY(`corpus_hash`, `id`),
	FOREIGN KEY (`corpus_hash`,`document_id`) REFERENCES `knowledge_documents_v2`(`corpus_hash`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`corpus_hash`,`asset_id`) REFERENCES `knowledge_assets_v2`(`corpus_hash`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "knowledge_nodes_v2_kind_check" CHECK("knowledge_nodes_v2"."kind" in ('DOCUMENT','SECTION','TEXT','IMAGE','TABLE','REGION')),
	CONSTRAINT "knowledge_nodes_v2_asset_kind_check" CHECK(
      ("knowledge_nodes_v2"."kind" in ('IMAGE','REGION') and "knowledge_nodes_v2"."asset_id" is not null)
      or ("knowledge_nodes_v2"."kind" not in ('IMAGE','REGION') and "knowledge_nodes_v2"."asset_id" is null)
    ),
	CONSTRAINT "knowledge_nodes_v2_json_check" CHECK(json_valid("knowledge_nodes_v2"."canonical_json") and json_type("knowledge_nodes_v2"."canonical_json") = 'object'),
	CONSTRAINT "knowledge_nodes_v2_hash_check" CHECK(length("knowledge_nodes_v2"."content_hash") = 64 and "knowledge_nodes_v2"."content_hash" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `knowledge_nodes_v2_document_kind_idx` ON `knowledge_nodes_v2` (`corpus_hash`,`document_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_student_memory_owner_unique` ON `agent_student_memory` (`id`,`student_id`,`class_id`);--> statement-breakpoint
INSERT INTO `agent_student_memory_disputes`(
	`memory_id`,`student_id`,`class_id`,`reason`,`created_at`
)
SELECT
	`id`,`student_id`,`class_id`,`student_dispute_note`,`student_disputed_at`
FROM `agent_student_memory`
WHERE `student_disputed` = 1 AND `student_disputed_at` IS NOT NULL;
