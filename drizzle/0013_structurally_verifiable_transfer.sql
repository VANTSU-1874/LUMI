PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `transfer_attempts` RENAME TO `legacy_transfer_attempts_v1`;--> statement-breakpoint
ALTER TABLE `transfer_challenges` RENAME TO `legacy_transfer_challenges_v1`;--> statement-breakpoint
DROP INDEX IF EXISTS `transfer_attempts_challenge_attempt_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `transfer_attempts_student_class_project_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `transfer_challenges_project_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `transfer_challenges_id_project_student_class_revision_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `transfer_challenges_student_class_status_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_transfer_challenges_v1_owner_revision_unique` ON `legacy_transfer_challenges_v1` (`id`,`project_id`,`student_id`,`class_id`,`revision`);--> statement-breakpoint
CREATE TABLE `transfer_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge_id` text NOT NULL,
	`project_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`challenge_revision` integer NOT NULL,
	`attempt_number` integer NOT NULL,
	`response_json` text NOT NULL,
	`rubric_json` text NOT NULL,
	`passed` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`challenge_id`,`project_id`,`student_id`,`class_id`,`challenge_revision`) REFERENCES `transfer_challenges`(`id`,`project_id`,`student_id`,`class_id`,`revision`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transfer_attempts_revision_check" CHECK("transfer_attempts"."challenge_revision" > 0),
	CONSTRAINT "transfer_attempts_number_check" CHECK("transfer_attempts"."attempt_number" between 1 and 2),
	CONSTRAINT "transfer_attempts_passed_check" CHECK("transfer_attempts"."passed" in (0, 1)),
	CONSTRAINT "transfer_attempts_response_json_check" CHECK(coalesce((
      json_valid("transfer_attempts"."response_json") and json_type("transfer_attempts"."response_json") = 'object'
      and json_type("transfer_attempts"."response_json", '$.retainedStructure') = 'object'
      and json_type("transfer_attempts"."response_json", '$.retainedStructure.culturalIntent') = 'text'
      and length(trim(json_extract("transfer_attempts"."response_json", '$.retainedStructure.culturalIntent'))) between 2 and 500
      and json_type("transfer_attempts"."response_json", '$.retainedStructure.input') = 'text'
      and length(trim(json_extract("transfer_attempts"."response_json", '$.retainedStructure.input'))) between 2 and 500
      and json_type("transfer_attempts"."response_json", '$.retainedStructure.mapping') = 'text'
      and length(trim(json_extract("transfer_attempts"."response_json", '$.retainedStructure.mapping'))) between 2 and 500
      and json_type("transfer_attempts"."response_json", '$.retainedStructure.output') = 'text'
      and length(trim(json_extract("transfer_attempts"."response_json", '$.retainedStructure.output'))) between 2 and 500
      and json_type("transfer_attempts"."response_json", '$.changedParts') = 'object'
      and json_extract("transfer_attempts"."response_json", '$.changedParts.dimension') in ('input', 'mapping', 'output')
      and json_type("transfer_attempts"."response_json", '$.changedParts.from') = 'text'
      and json_type("transfer_attempts"."response_json", '$.changedParts.to') = 'text'
      and trim(json_extract("transfer_attempts"."response_json", '$.changedParts.from')) <> trim(json_extract("transfer_attempts"."response_json", '$.changedParts.to'))
      and json_type("transfer_attempts"."response_json", '$.normalization') = 'object'
      and json_type("transfer_attempts"."response_json", '$.normalization.sourceMin') in ('integer', 'real')
      and json_type("transfer_attempts"."response_json", '$.normalization.sourceMax') in ('integer', 'real')
      and json_extract("transfer_attempts"."response_json", '$.normalization.sourceMin') between -1000000 and 1000000
      and json_extract("transfer_attempts"."response_json", '$.normalization.sourceMax') between -1000000 and 1000000
      and json_extract("transfer_attempts"."response_json", '$.normalization.sourceMin') < json_extract("transfer_attempts"."response_json", '$.normalization.sourceMax')
      and json_extract("transfer_attempts"."response_json", '$.normalization.sourceUnit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
      and json_extract("transfer_attempts"."response_json", '$.normalization.targetMin') = 0
      and json_extract("transfer_attempts"."response_json", '$.normalization.targetMax') = 1
      and json_extract("transfer_attempts"."response_json", '$.normalization.targetUnit') = 'normalized'
      and json_extract("transfer_attempts"."response_json", '$.normalization.relationship') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD')
      and json_type("transfer_attempts"."response_json", '$.culturalImpact') = 'object'
      and json_type("transfer_attempts"."response_json", '$.culturalImpact.audience') = 'text'
      and length(trim(json_extract("transfer_attempts"."response_json", '$.culturalImpact.audience'))) between 4 and 200
      and json_type("transfer_attempts"."response_json", '$.culturalImpact.behaviorChange') = 'text'
      and length(trim(json_extract("transfer_attempts"."response_json", '$.culturalImpact.behaviorChange'))) between 10 and 400
      and json_type("transfer_attempts"."response_json", '$.culturalImpact.connectionToIntent') = 'text'
      and length(trim(json_extract("transfer_attempts"."response_json", '$.culturalImpact.connectionToIntent'))) between 10 and 400
      and trim(json_extract("transfer_attempts"."response_json", '$.culturalImpact.audience')) <> trim(json_extract("transfer_attempts"."response_json", '$.culturalImpact.behaviorChange'))
      and trim(json_extract("transfer_attempts"."response_json", '$.culturalImpact.audience')) <> trim(json_extract("transfer_attempts"."response_json", '$.culturalImpact.connectionToIntent'))
      and trim(json_extract("transfer_attempts"."response_json", '$.culturalImpact.behaviorChange')) <> trim(json_extract("transfer_attempts"."response_json", '$.culturalImpact.connectionToIntent'))
    ), 0)),
	CONSTRAINT "transfer_attempts_rubric_json_check" CHECK(coalesce((
      json_valid("transfer_attempts"."rubric_json") and json_type("transfer_attempts"."rubric_json") = 'object'
      and json_type("transfer_attempts"."rubric_json", '$.criteria') = 'object'
      and json_type("transfer_attempts"."rubric_json", '$.criteria.retainedStructure') = 'object'
      and json_type("transfer_attempts"."rubric_json", '$.criteria.retainedStructure.passed') in ('true', 'false')
      and json_extract("transfer_attempts"."rubric_json", '$.criteria.retainedStructure.reasonCode') in ('RETAINED_EXACT', 'RETAINED_MISMATCH')
      and json_type("transfer_attempts"."rubric_json", '$.criteria.changedParts') = 'object'
      and json_type("transfer_attempts"."rubric_json", '$.criteria.changedParts.passed') in ('true', 'false')
      and json_extract("transfer_attempts"."rubric_json", '$.criteria.changedParts.reasonCode') in ('CHANGE_EXACT', 'CHANGE_MISMATCH')
      and json_type("transfer_attempts"."rubric_json", '$.criteria.normalization') = 'object'
      and json_type("transfer_attempts"."rubric_json", '$.criteria.normalization.passed') in ('true', 'false')
      and json_extract("transfer_attempts"."rubric_json", '$.criteria.normalization.reasonCode') in ('NORMALIZATION_VERIFIABLE', 'NORMALIZATION_INVALID_UNIT', 'NORMALIZATION_INVALID_RANGE', 'NORMALIZATION_INVALID_RELATIONSHIP')
      and json_type("transfer_attempts"."rubric_json", '$.criteria.culturalImpact') = 'object'
      and json_type("transfer_attempts"."rubric_json", '$.criteria.culturalImpact.passed') in ('true', 'false')
      and json_extract("transfer_attempts"."rubric_json", '$.criteria.culturalImpact.reasonCode') in ('CULTURAL_LINK_CONCRETE', 'CULTURAL_LINK_VAGUE')
      and json_type("transfer_attempts"."rubric_json", '$.score') = 'integer'
      and json_extract("transfer_attempts"."rubric_json", '$.score') between 0 and 4
      and json_type("transfer_attempts"."rubric_json", '$.passed') in ('true', 'false')
      and json_extract("transfer_attempts"."rubric_json", '$.passed') = "transfer_attempts"."passed"
      and json_type("transfer_attempts"."rubric_json", '$.feedbackCodes') = 'array'
      and json_array_length("transfer_attempts"."rubric_json", '$.feedbackCodes') between 0 and 5
      and (json_type("transfer_attempts"."rubric_json", '$.feedbackCodes[0]') is null or json_extract("transfer_attempts"."rubric_json", '$.feedbackCodes[0]') in ('RESTATE_RETAINED_STRUCTURE', 'CHANGE_ONLY_TARGET_DIMENSION', 'ADD_MEASURABLE_RANGE_AND_UNIT', 'CONNECT_INTENT_TO_AUDIENCE_BEHAVIOR', 'TEACHER_REVIEW_REQUIRED'))
      and (json_type("transfer_attempts"."rubric_json", '$.feedbackCodes[1]') is null or json_extract("transfer_attempts"."rubric_json", '$.feedbackCodes[1]') in ('RESTATE_RETAINED_STRUCTURE', 'CHANGE_ONLY_TARGET_DIMENSION', 'ADD_MEASURABLE_RANGE_AND_UNIT', 'CONNECT_INTENT_TO_AUDIENCE_BEHAVIOR', 'TEACHER_REVIEW_REQUIRED'))
      and (json_type("transfer_attempts"."rubric_json", '$.feedbackCodes[2]') is null or json_extract("transfer_attempts"."rubric_json", '$.feedbackCodes[2]') in ('RESTATE_RETAINED_STRUCTURE', 'CHANGE_ONLY_TARGET_DIMENSION', 'ADD_MEASURABLE_RANGE_AND_UNIT', 'CONNECT_INTENT_TO_AUDIENCE_BEHAVIOR', 'TEACHER_REVIEW_REQUIRED'))
      and (json_type("transfer_attempts"."rubric_json", '$.feedbackCodes[3]') is null or json_extract("transfer_attempts"."rubric_json", '$.feedbackCodes[3]') in ('RESTATE_RETAINED_STRUCTURE', 'CHANGE_ONLY_TARGET_DIMENSION', 'ADD_MEASURABLE_RANGE_AND_UNIT', 'CONNECT_INTENT_TO_AUDIENCE_BEHAVIOR', 'TEACHER_REVIEW_REQUIRED'))
      and (json_type("transfer_attempts"."rubric_json", '$.feedbackCodes[4]') is null or json_extract("transfer_attempts"."rubric_json", '$.feedbackCodes[4]') in ('RESTATE_RETAINED_STRUCTURE', 'CHANGE_ONLY_TARGET_DIMENSION', 'ADD_MEASURABLE_RANGE_AND_UNIT', 'CONNECT_INTENT_TO_AUDIENCE_BEHAVIOR', 'TEACHER_REVIEW_REQUIRED'))
    ), 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_attempts_challenge_attempt_unique` ON `transfer_attempts` (`challenge_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `transfer_attempts_student_class_project_idx` ON `transfer_attempts` (`student_id`,`class_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `transfer_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_hash` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`,`class_id`) REFERENCES `projects`(`id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`,`class_id`) REFERENCES `users`(`id`,`class_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transfer_challenges_revision_check" CHECK("transfer_challenges"."revision" > 0),
	CONSTRAINT "transfer_challenges_hash_check" CHECK(length("transfer_challenges"."snapshot_hash") = 64 and "transfer_challenges"."snapshot_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "transfer_challenges_status_check" CHECK("transfer_challenges"."status" in ('OPEN', 'PASSED', 'LOCKED')),
	CONSTRAINT "transfer_challenges_attempt_count_check" CHECK("transfer_challenges"."attempt_count" between 0 and 2),
	CONSTRAINT "transfer_challenges_status_attempt_check" CHECK(("transfer_challenges"."status" = 'OPEN' and "transfer_challenges"."attempt_count" between 0 and 1) or ("transfer_challenges"."status" = 'PASSED' and "transfer_challenges"."attempt_count" between 1 and 2) or ("transfer_challenges"."status" = 'LOCKED' and "transfer_challenges"."attempt_count" = 2)),
	CONSTRAINT "transfer_challenges_snapshot_json_check" CHECK(coalesce((
      json_valid("transfer_challenges"."snapshot_json") and json_type("transfer_challenges"."snapshot_json") = 'object'
      and json_type("transfer_challenges"."snapshot_json", '$.projectId') = 'text'
      and json_extract("transfer_challenges"."snapshot_json", '$.projectId') = "transfer_challenges"."project_id"
      and json_type("transfer_challenges"."snapshot_json", '$.challengeRevision') = 'integer'
      and json_extract("transfer_challenges"."snapshot_json", '$.challengeRevision') = "transfer_challenges"."revision"
      and json_type("transfer_challenges"."snapshot_json", '$.changedDimension') = 'text'
      and json_extract("transfer_challenges"."snapshot_json", '$.changedDimension') in ('input', 'mapping', 'output')
      and json_type("transfer_challenges"."snapshot_json", '$.prompt') = 'text'
      and json_type("transfer_challenges"."snapshot_json", '$.mustRetain') = 'object'
      and json_type("transfer_challenges"."snapshot_json", '$.mustRetain.culturalIntent') = 'text'
      and json_type("transfer_challenges"."snapshot_json", '$.mustRetain.structure') = 'text'
      and json_type("transfer_challenges"."snapshot_json", '$.mustRetain.input') = 'text'
      and json_type("transfer_challenges"."snapshot_json", '$.mustRetain.mapping') = 'text'
      and json_type("transfer_challenges"."snapshot_json", '$.mustRetain.output') = 'text'
      and json_type("transfer_challenges"."snapshot_json", '$.change') = 'object'
      and json_type("transfer_challenges"."snapshot_json", '$.change.candidateId') = 'text'
      and json_extract("transfer_challenges"."snapshot_json", '$.change.dimension') = json_extract("transfer_challenges"."snapshot_json", '$.changedDimension')
      and json_type("transfer_challenges"."snapshot_json", '$.change.from') = 'text'
      and json_type("transfer_challenges"."snapshot_json", '$.change.to') = 'text'
      and trim(json_extract("transfer_challenges"."snapshot_json", '$.change.from')) <> trim(json_extract("transfer_challenges"."snapshot_json", '$.change.to'))
      and json_type("transfer_challenges"."snapshot_json", '$.unitPolicy') = 'object'
      and json_extract("transfer_challenges"."snapshot_json", '$.unitPolicy.sourceKind') in ('SOUND', 'DISTANCE', 'NORMALIZED', 'GENERIC')
      and json_extract("transfer_challenges"."snapshot_json", '$.unitPolicy.sourceUnit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
      and json_type("transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges') = 'array'
      and json_array_length("transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges') between 1 and 4
      and json_extract("transfer_challenges"."snapshot_json", '$.unitPolicy.targetMin') = 0
      and json_extract("transfer_challenges"."snapshot_json", '$.unitPolicy.targetMax') = 1
      and json_extract("transfer_challenges"."snapshot_json", '$.unitPolicy.targetUnit') = 'normalized'
      and json_type("transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships') = 'array'
      and json_array_length("transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships') between 1 and 4
      and json_extract("transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[0]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD')
      and (json_type("transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[1]') is null or json_extract("transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[1]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD'))
      and (json_type("transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[2]') is null or json_extract("transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[2]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD'))
      and (json_type("transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[3]') is null or json_extract("transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[3]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD'))
      and json_type("transfer_challenges"."snapshot_json", '$.intentTokens') = 'array'
      and json_array_length("transfer_challenges"."snapshot_json", '$.intentTokens') between 1 and 10
      and json_extract("transfer_challenges"."snapshot_json", '$.path') in ('DIGISHOW', 'TOUCHDESIGNER', 'COLLABORATIVE')
      and json_type("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot') = 'array'
      and json_array_length("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot') = 5
      and json_extract("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].layer') = 'INPUT'
      and json_extract("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].code') = 'INPUT_OK'
      and json_extract("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].layer') = 'MAPPING'
      and json_extract("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].code') = 'MAPPING_OK'
      and json_extract("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].layer') = 'TRANSPORT'
      and json_extract("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].code') = 'TRANSPORT_OK'
      and json_extract("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].layer') = 'BINDING'
      and json_extract("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].code') = 'BINDING_OK'
      and json_extract("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].layer') = 'OUTPUT'
      and json_extract("transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].code') = 'OUTPUT_OK'
      and json_type("transfer_challenges"."snapshot_json", '$.verifiedEvidenceHash') = 'text'
      and length(json_extract("transfer_challenges"."snapshot_json", '$.verifiedEvidenceHash')) = 64
      and json_extract("transfer_challenges"."snapshot_json", '$.snapshotHash') = "transfer_challenges"."snapshot_hash"
    ), 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_challenges_project_unique` ON `transfer_challenges` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_challenges_id_project_student_class_revision_unique` ON `transfer_challenges` (`id`,`project_id`,`student_id`,`class_id`,`revision`);--> statement-breakpoint
CREATE INDEX `transfer_challenges_student_class_status_idx` ON `transfer_challenges` (`student_id`,`class_id`,`status`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
