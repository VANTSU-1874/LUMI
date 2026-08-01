PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tool_path_plans` (
	`project_id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`requirements_json` text NOT NULL,
	`reasons_json` text NOT NULL,
	`milestones_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tool_path_plans_path_check" CHECK("__new_tool_path_plans"."path" in ('DIGISHOW', 'TOUCHDESIGNER', 'COLLABORATIVE')),
	CONSTRAINT "tool_path_plans_requirements_json_check" CHECK(json_valid("__new_tool_path_plans"."requirements_json") and json_type("__new_tool_path_plans"."requirements_json") = 'object' and coalesce(json_type("__new_tool_path_plans"."requirements_json", '$.needsRealtimeVisuals'), '') in ('true', 'false') and coalesce(json_type("__new_tool_path_plans"."requirements_json", '$.needsPhysicalControl'), '') in ('true', 'false') and coalesce(json_type("__new_tool_path_plans"."requirements_json", '$.hasOsc'), '') in ('true', 'false')),
	CONSTRAINT "tool_path_plans_reasons_json_check" CHECK(json_valid("__new_tool_path_plans"."reasons_json") and json_type("__new_tool_path_plans"."reasons_json") = 'array'),
	CONSTRAINT "tool_path_plans_milestones_json_check" CHECK(json_valid("__new_tool_path_plans"."milestones_json") and json_type("__new_tool_path_plans"."milestones_json") = 'array')
);
--> statement-breakpoint
INSERT INTO `__new_tool_path_plans`("project_id", "path", "requirements_json", "reasons_json", "milestones_json", "created_at", "updated_at") SELECT "project_id", "path", "requirements_json", "reasons_json", "milestones_json", "created_at", "updated_at" FROM `tool_path_plans`;--> statement-breakpoint
DROP TABLE `tool_path_plans`;--> statement-breakpoint
ALTER TABLE `__new_tool_path_plans` RENAME TO `tool_path_plans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_logic_cards` (
	`project_id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`rule_ready` integer NOT NULL,
	`semantic_ready` integer NOT NULL,
	`semantic_review_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`card_hash` text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "logic_cards_payload_json_check" CHECK(json_valid("__new_logic_cards"."payload_json")),
	CONSTRAINT "logic_cards_semantic_review_json_check" CHECK(json_valid("__new_logic_cards"."semantic_review_json")),
	CONSTRAINT "logic_cards_rule_ready_check" CHECK("__new_logic_cards"."rule_ready" in (0, 1)),
	CONSTRAINT "logic_cards_semantic_ready_check" CHECK("__new_logic_cards"."semantic_ready" in (0, 1)),
	CONSTRAINT "logic_cards_revision_positive_check" CHECK("__new_logic_cards"."revision" > 0),
	CONSTRAINT "logic_cards_card_hash_check" CHECK(length("__new_logic_cards"."card_hash") = 64 and "__new_logic_cards"."card_hash" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
INSERT INTO `__new_logic_cards`("project_id", "payload_json", "rule_ready", "semantic_ready", "semantic_review_json", "revision", "card_hash") SELECT "project_id", "payload_json", "rule_ready", "semantic_ready", "semantic_review_json", 1, '0000000000000000000000000000000000000000000000000000000000000000' FROM `logic_cards`;--> statement-breakpoint
DROP TABLE `logic_cards`;--> statement-breakpoint
ALTER TABLE `__new_logic_cards` RENAME TO `logic_cards`;
