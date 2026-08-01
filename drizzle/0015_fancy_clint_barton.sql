CREATE TABLE `transfer_challenge_revisions` (
	`challenge_id` text NOT NULL,
	`project_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_hash` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`archived_at` integer NOT NULL,
	FOREIGN KEY (`challenge_id`,`project_id`,`student_id`,`class_id`) REFERENCES `transfer_challenges`(`id`,`project_id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transfer_challenge_revisions_revision_check" CHECK("transfer_challenge_revisions"."revision" > 0),
	CONSTRAINT "transfer_challenge_revisions_hash_check" CHECK(length("transfer_challenge_revisions"."snapshot_hash") = 64 and "transfer_challenge_revisions"."snapshot_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "transfer_challenge_revisions_status_check" CHECK("transfer_challenge_revisions"."status" in ('OPEN', 'PASSED', 'LOCKED')),
	CONSTRAINT "transfer_challenge_revisions_attempt_count_check" CHECK("transfer_challenge_revisions"."attempt_count" between 0 and 2),
	CONSTRAINT "transfer_challenge_revisions_snapshot_check" CHECK(coalesce((json_valid("transfer_challenge_revisions"."snapshot_json") and json_type("transfer_challenge_revisions"."snapshot_json") = 'object'
      and json_extract("transfer_challenge_revisions"."snapshot_json", '$.projectId') = "transfer_challenge_revisions"."project_id"
      and json_extract("transfer_challenge_revisions"."snapshot_json", '$.challengeRevision') = "transfer_challenge_revisions"."revision"
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot') = 'array'
      and json_array_length("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot') = 5
      and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].layer') = 'INPUT' and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].code') = 'INPUT_OK'
      and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].layer') = 'MAPPING' and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].code') = 'MAPPING_OK'
      and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].layer') = 'TRANSPORT' and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].code') = 'TRANSPORT_OK'
      and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].layer') = 'BINDING' and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].code') = 'BINDING_OK'
      and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].layer') = 'OUTPUT' and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].code') = 'OUTPUT_OK'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceHash') = 'text' and length(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceHash')) = 64
      and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceHash') not glob '*[^0-9a-f]*'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].sequence') = 'integer' and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].sequence') > 0
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].sequence') = 'integer' and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].sequence') > 0
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].sequence') = 'integer' and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].sequence') > 0
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].sequence') = 'integer' and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].sequence') > 0
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].sequence') = 'integer' and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].sequence') > 0
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id') = 'text' and length(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id')) = 36 and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id'),9,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id'),14,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id'),19,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id'),24,1)='-' and replace(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id') = 'text' and length(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id')) = 36 and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id'),9,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id'),14,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id'),19,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id'),24,1)='-' and replace(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id') = 'text' and length(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id')) = 36 and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id'),9,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id'),14,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id'),19,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id'),24,1)='-' and replace(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id') = 'text' and length(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id')) = 36 and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id'),9,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id'),14,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id'),19,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id'),24,1)='-' and replace(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id') = 'text' and length(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id')) = 36 and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id'),9,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id'),14,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id'),19,1)='-' and substr(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id'),24,1)='-' and replace(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].digest') = 'text' and length(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].digest')) = 64 and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[0].digest') not glob '*[^0-9a-f]*'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].digest') = 'text' and length(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].digest')) = 64 and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[1].digest') not glob '*[^0-9a-f]*'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].digest') = 'text' and length(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].digest')) = 64 and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[2].digest') not glob '*[^0-9a-f]*'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].digest') = 'text' and length(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].digest')) = 64 and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[3].digest') not glob '*[^0-9a-f]*'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].digest') = 'text' and length(json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].digest')) = 64 and json_extract("transfer_challenge_revisions"."snapshot_json", '$.verifiedEvidenceSnapshot[4].digest') not glob '*[^0-9a-f]*'
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.unitPolicy.sourceRanges') = 'array' and json_array_length("transfer_challenge_revisions"."snapshot_json", '$.unitPolicy.sourceRanges') between 1 and 4
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.unitPolicy.sourceRanges[0]') = 'object'
      and json_extract("transfer_challenge_revisions"."snapshot_json", '$.unitPolicy.sourceRanges[0].unit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
      and json_type("transfer_challenge_revisions"."snapshot_json", '$.unitPolicy.sourceRanges[0].minInclusive') in ('integer', 'real') and json_type("transfer_challenge_revisions"."snapshot_json", '$.unitPolicy.sourceRanges[0].maxInclusive') in ('integer', 'real')
      and json_extract("transfer_challenge_revisions"."snapshot_json", '$.unitPolicy.sourceRanges[0].minInclusive') < json_extract("transfer_challenge_revisions"."snapshot_json", '$.unitPolicy.sourceRanges[0].maxInclusive')
      and json_extract("transfer_challenge_revisions"."snapshot_json", '$.snapshotHash') = "transfer_challenge_revisions"."snapshot_hash"), 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_challenge_revisions_challenge_revision_unique` ON `transfer_challenge_revisions` (`challenge_id`,`revision`);--> statement-breakpoint
CREATE INDEX `transfer_challenge_revisions_project_revision_idx` ON `transfer_challenge_revisions` (`project_id`,`revision`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transfer_attempts` (
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
	FOREIGN KEY (`challenge_id`,`project_id`,`student_id`,`class_id`) REFERENCES `transfer_challenges`(`id`,`project_id`,`student_id`,`class_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transfer_attempts_revision_check" CHECK("__new_transfer_attempts"."challenge_revision" > 0),
	CONSTRAINT "transfer_attempts_number_check" CHECK("__new_transfer_attempts"."attempt_number" between 1 and 2),
	CONSTRAINT "transfer_attempts_passed_check" CHECK("__new_transfer_attempts"."passed" in (0, 1)),
	CONSTRAINT "transfer_attempts_response_json_check" CHECK(coalesce((
      json_valid("__new_transfer_attempts"."response_json") and json_type("__new_transfer_attempts"."response_json") = 'object'
      and json_type("__new_transfer_attempts"."response_json", '$.retainedStructure') = 'object'
      and json_type("__new_transfer_attempts"."response_json", '$.retainedStructure.culturalIntent') = 'text'
      and length(trim(json_extract("__new_transfer_attempts"."response_json", '$.retainedStructure.culturalIntent'))) between 2 and 500
      and json_type("__new_transfer_attempts"."response_json", '$.retainedStructure.input') = 'text'
      and length(trim(json_extract("__new_transfer_attempts"."response_json", '$.retainedStructure.input'))) between 2 and 500
      and json_type("__new_transfer_attempts"."response_json", '$.retainedStructure.mapping') = 'text'
      and length(trim(json_extract("__new_transfer_attempts"."response_json", '$.retainedStructure.mapping'))) between 2 and 500
      and json_type("__new_transfer_attempts"."response_json", '$.retainedStructure.output') = 'text'
      and length(trim(json_extract("__new_transfer_attempts"."response_json", '$.retainedStructure.output'))) between 2 and 500
      and json_type("__new_transfer_attempts"."response_json", '$.changedParts') = 'object'
      and json_extract("__new_transfer_attempts"."response_json", '$.changedParts.dimension') in ('input', 'mapping', 'output')
      and json_type("__new_transfer_attempts"."response_json", '$.changedParts.from') = 'text'
      and length(trim(json_extract("__new_transfer_attempts"."response_json", '$.changedParts.from'))) between 2 and 500
      and json_type("__new_transfer_attempts"."response_json", '$.changedParts.to') = 'text'
      and length(trim(json_extract("__new_transfer_attempts"."response_json", '$.changedParts.to'))) between 2 and 500
      and trim(json_extract("__new_transfer_attempts"."response_json", '$.changedParts.from')) <> trim(json_extract("__new_transfer_attempts"."response_json", '$.changedParts.to'))
      and (json_type("__new_transfer_attempts"."response_json", '$.changedParts.rationale') is null or (json_type("__new_transfer_attempts"."response_json", '$.changedParts.rationale') = 'text'
        and length(trim(json_extract("__new_transfer_attempts"."response_json", '$.changedParts.rationale'))) between 10 and 300))
      and json_type("__new_transfer_attempts"."response_json", '$.normalization') = 'object'
      and json_type("__new_transfer_attempts"."response_json", '$.normalization.sourceMin') in ('integer', 'real')
      and json_type("__new_transfer_attempts"."response_json", '$.normalization.sourceMax') in ('integer', 'real')
      and json_extract("__new_transfer_attempts"."response_json", '$.normalization.sourceMin') between -1000000 and 1000000
      and json_extract("__new_transfer_attempts"."response_json", '$.normalization.sourceMax') between -1000000 and 1000000
      and json_extract("__new_transfer_attempts"."response_json", '$.normalization.sourceMin') < json_extract("__new_transfer_attempts"."response_json", '$.normalization.sourceMax')
      and json_extract("__new_transfer_attempts"."response_json", '$.normalization.sourceUnit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
      and json_type("__new_transfer_attempts"."response_json", '$.normalization.targetMin') in ('integer', 'real')
      and json_type("__new_transfer_attempts"."response_json", '$.normalization.targetMax') in ('integer', 'real')
      and json_extract("__new_transfer_attempts"."response_json", '$.normalization.targetMin') = 0
      and json_extract("__new_transfer_attempts"."response_json", '$.normalization.targetMax') = 1
      and json_extract("__new_transfer_attempts"."response_json", '$.normalization.targetUnit') = 'normalized'
      and json_extract("__new_transfer_attempts"."response_json", '$.normalization.relationship') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD')
      and json_type("__new_transfer_attempts"."response_json", '$.culturalImpact') = 'object'
      and json_extract("__new_transfer_attempts"."response_json", '$.culturalImpact.audienceType') in ('GENERAL_VISITORS', 'YOUNG_LEARNERS', 'COMMUNITY_MEMBERS', 'CULTURAL_HERITAGE_AUDIENCE')
      and json_extract("__new_transfer_attempts"."response_json", '$.culturalImpact.behaviorBefore') in ('PASSIVE_VIEWING', 'FOLLOWING_INSTRUCTIONS', 'INDIVIDUAL_INTERACTION', 'ACTIVE_EXPLORATION', 'COLLABORATIVE_CREATION', 'REFLECTIVE_SHARING')
      and json_extract("__new_transfer_attempts"."response_json", '$.culturalImpact.behaviorAfter') in ('PASSIVE_VIEWING', 'FOLLOWING_INSTRUCTIONS', 'INDIVIDUAL_INTERACTION', 'ACTIVE_EXPLORATION', 'COLLABORATIVE_CREATION', 'REFLECTIVE_SHARING')
      and json_extract("__new_transfer_attempts"."response_json", '$.culturalImpact.behaviorBefore') <> json_extract("__new_transfer_attempts"."response_json", '$.culturalImpact.behaviorAfter')
      and json_type("__new_transfer_attempts"."response_json", '$.culturalImpact.intentAnchorId') = 'text'
      and length(json_extract("__new_transfer_attempts"."response_json", '$.culturalImpact.intentAnchorId')) = 23
      and substr(json_extract("__new_transfer_attempts"."response_json", '$.culturalImpact.intentAnchorId'), 1, 7) = 'intent_'
      and substr(json_extract("__new_transfer_attempts"."response_json", '$.culturalImpact.intentAnchorId'), 8) not glob '*[^0-9a-f]*'
      and json_extract("__new_transfer_attempts"."response_json", '$.culturalImpact.mechanism') in ('PARTICIPATORY_TRIGGER', 'COLLECTIVE_RESPONSE', 'NARRATIVE_MAPPING', 'SENSORY_FEEDBACK', 'CULTURAL_SYMBOL_REINFORCEMENT')
      and (json_type("__new_transfer_attempts"."response_json", '$.culturalImpact.reflection') is null
        or (json_type("__new_transfer_attempts"."response_json", '$.culturalImpact.reflection') = 'text'
        and length(trim(json_extract("__new_transfer_attempts"."response_json", '$.culturalImpact.reflection'))) between 4 and 300))
    ), 0)),
	CONSTRAINT "transfer_attempts_rubric_json_check" CHECK(coalesce((
      json_valid("__new_transfer_attempts"."rubric_json") and json_type("__new_transfer_attempts"."rubric_json") = 'object'
      and json_type("__new_transfer_attempts"."rubric_json", '$.criteria') = 'object'
      and json_type("__new_transfer_attempts"."rubric_json", '$.criteria.retainedStructure') = 'object'
      and json_type("__new_transfer_attempts"."rubric_json", '$.criteria.retainedStructure.passed') in ('true', 'false')
      and ((json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.retainedStructure.passed') = 1 and json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.retainedStructure.reasonCode') = 'RETAINED_MATCH')
        or (json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.retainedStructure.passed') = 0 and json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.retainedStructure.reasonCode') = 'RETAINED_MISMATCH'))
      and json_type("__new_transfer_attempts"."rubric_json", '$.criteria.changedParts') = 'object'
      and json_type("__new_transfer_attempts"."rubric_json", '$.criteria.changedParts.passed') in ('true', 'false')
      and ((json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.changedParts.passed') = 1 and json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.changedParts.reasonCode') = 'CHANGE_TARGETED')
        or (json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.changedParts.passed') = 0 and json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.changedParts.reasonCode') = 'CHANGE_MISMATCH'))
      and json_type("__new_transfer_attempts"."rubric_json", '$.criteria.normalization') = 'object'
      and json_type("__new_transfer_attempts"."rubric_json", '$.criteria.normalization.passed') in ('true', 'false')
      and ((json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.normalization.passed') = 1 and json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.normalization.reasonCode') = 'NORMALIZATION_VALID')
        or (json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.normalization.passed') = 0 and json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.normalization.reasonCode') in ('NORMALIZATION_INVALID_UNIT', 'NORMALIZATION_INVALID_RANGE', 'NORMALIZATION_INVALID_RELATIONSHIP')))
      and json_type("__new_transfer_attempts"."rubric_json", '$.criteria.culturalImpact') = 'object'
      and json_type("__new_transfer_attempts"."rubric_json", '$.criteria.culturalImpact.passed') in ('true', 'false')
      and ((json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.culturalImpact.passed') = 1 and json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.culturalImpact.reasonCode') = 'CULTURAL_CONCRETE')
        or (json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.culturalImpact.passed') = 0 and json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.culturalImpact.reasonCode') in ('CULTURAL_INVALID_ANCHOR', 'CULTURAL_INVALID_TRANSITION', 'CULTURAL_INVALID_MECHANISM')))
      and json_type("__new_transfer_attempts"."rubric_json", '$.score') = 'integer'
      and json_extract("__new_transfer_attempts"."rubric_json", '$.score') between 0 and 4
      and json_type("__new_transfer_attempts"."rubric_json", '$.passed') in ('true', 'false')
      and json_extract("__new_transfer_attempts"."rubric_json", '$.passed') = "__new_transfer_attempts"."passed"
      and json_extract("__new_transfer_attempts"."rubric_json", '$.score') = (json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.retainedStructure.passed') + json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.changedParts.passed') + json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.normalization.passed') + json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.culturalImpact.passed'))
      and json_extract("__new_transfer_attempts"."rubric_json", '$.passed') = (json_extract("__new_transfer_attempts"."rubric_json", '$.score') = 4)
      and json_extract("__new_transfer_attempts"."rubric_json", '$.outcome') in ('RETRY', 'PASSED', 'LOCKED')
      and ((json_extract("__new_transfer_attempts"."rubric_json", '$.passed') = 1 and json_extract("__new_transfer_attempts"."rubric_json", '$.outcome') = 'PASSED')
        or (json_extract("__new_transfer_attempts"."rubric_json", '$.passed') = 0 and json_extract("__new_transfer_attempts"."rubric_json", '$.outcome') in ('RETRY', 'LOCKED')))
      and (json_extract("__new_transfer_attempts"."rubric_json", '$.outcome') <> 'LOCKED' or "__new_transfer_attempts"."attempt_number" = 2)
      and json_type("__new_transfer_attempts"."rubric_json", '$.feedback') = 'object'
      and json_type("__new_transfer_attempts"."rubric_json", '$.feedback.retained') in ('true', 'false')
      and json_extract("__new_transfer_attempts"."rubric_json", '$.feedback.retained') = (1 - json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.retainedStructure.passed'))
      and json_type("__new_transfer_attempts"."rubric_json", '$.feedback.changed') in ('true', 'false')
      and json_extract("__new_transfer_attempts"."rubric_json", '$.feedback.changed') = (1 - json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.changedParts.passed'))
      and json_type("__new_transfer_attempts"."rubric_json", '$.feedback.normalization') in ('true', 'false')
      and json_extract("__new_transfer_attempts"."rubric_json", '$.feedback.normalization') = (1 - json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.normalization.passed'))
      and json_type("__new_transfer_attempts"."rubric_json", '$.feedback.cultural') in ('true', 'false')
      and json_extract("__new_transfer_attempts"."rubric_json", '$.feedback.cultural') = (1 - json_extract("__new_transfer_attempts"."rubric_json", '$.criteria.culturalImpact.passed'))
      and json_type("__new_transfer_attempts"."rubric_json", '$.feedback.teacherReview') in ('true', 'false')
      and json_extract("__new_transfer_attempts"."rubric_json", '$.feedback.teacherReview') = (json_extract("__new_transfer_attempts"."rubric_json", '$.outcome') = 'LOCKED')
      and (json_type("__new_transfer_attempts"."rubric_json", '$.feedback.aiCode') = 'null'
        or (json_type("__new_transfer_attempts"."rubric_json", '$.feedback.aiCode') = 'text' and json_extract("__new_transfer_attempts"."rubric_json", '$.feedback.aiCode') in ('COHERENCE_NOTE', 'CLARITY_NOTE')))
    ), 0))
);
--> statement-breakpoint
INSERT INTO `__new_transfer_attempts`("id", "challenge_id", "project_id", "class_id", "student_id", "challenge_revision", "attempt_number", "response_json", "rubric_json", "passed", "created_at") SELECT "id", "challenge_id", "project_id", "class_id", "student_id", "challenge_revision", "attempt_number", "response_json", CASE WHEN json_extract("rubric_json", '$.outcome') = 'OPEN' THEN json_set("rubric_json", '$.outcome', 'RETRY') ELSE "rubric_json" END, "passed", "created_at" FROM `transfer_attempts`;--> statement-breakpoint
DROP TABLE `transfer_attempts`;--> statement-breakpoint
ALTER TABLE `__new_transfer_attempts` RENAME TO `transfer_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_attempts_challenge_attempt_unique` ON `transfer_attempts` (`challenge_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `transfer_attempts_student_class_project_idx` ON `transfer_attempts` (`student_id`,`class_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `__new_transfer_challenges` (
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
	CONSTRAINT "transfer_challenges_revision_check" CHECK("__new_transfer_challenges"."revision" > 0),
	CONSTRAINT "transfer_challenges_hash_check" CHECK(length("__new_transfer_challenges"."snapshot_hash") = 64 and "__new_transfer_challenges"."snapshot_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "transfer_challenges_status_check" CHECK("__new_transfer_challenges"."status" in ('OPEN', 'PASSED', 'LOCKED')),
	CONSTRAINT "transfer_challenges_attempt_count_check" CHECK("__new_transfer_challenges"."attempt_count" between 0 and 2),
	CONSTRAINT "transfer_challenges_status_attempt_check" CHECK(("__new_transfer_challenges"."status" = 'OPEN' and "__new_transfer_challenges"."attempt_count" between 0 and 1) or ("__new_transfer_challenges"."status" = 'PASSED' and "__new_transfer_challenges"."attempt_count" between 1 and 2) or ("__new_transfer_challenges"."status" = 'LOCKED' and "__new_transfer_challenges"."attempt_count" = 2)),
	CONSTRAINT "transfer_challenges_snapshot_json_check" CHECK(coalesce((
      json_valid("__new_transfer_challenges"."snapshot_json") and json_type("__new_transfer_challenges"."snapshot_json") = 'object'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.projectId') = 'text'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.projectId') = "__new_transfer_challenges"."project_id"
      and json_type("__new_transfer_challenges"."snapshot_json", '$.challengeRevision') = 'integer'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.challengeRevision') = "__new_transfer_challenges"."revision"
      and json_type("__new_transfer_challenges"."snapshot_json", '$.changedDimension') = 'text'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.changedDimension') in ('input', 'mapping', 'output')
      and json_type("__new_transfer_challenges"."snapshot_json", '$.prompt') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain') = 'object'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain.culturalIntent') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain.structure') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain.input') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain.mapping') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.mustRetain.output') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.change') = 'object'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.change.candidateId') = 'text'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.change.dimension') = json_extract("__new_transfer_challenges"."snapshot_json", '$.changedDimension')
      and json_type("__new_transfer_challenges"."snapshot_json", '$.change.from') = 'text'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.change.to') = 'text'
      and trim(json_extract("__new_transfer_challenges"."snapshot_json", '$.change.from')) <> trim(json_extract("__new_transfer_challenges"."snapshot_json", '$.change.to'))
      and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy') = 'object'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceKind') in ('SOUND', 'DISTANCE', 'NORMALIZED', 'GENERIC')
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceUnit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
      and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges') = 'array'
      and json_array_length("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges') between 1 and 4
      and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[0]') = 'object'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[0].unit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
      and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[0].minInclusive') in ('integer', 'real')
      and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[0].maxInclusive') in ('integer', 'real')
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[0].minInclusive') between -1000000 and 1000000
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[0].maxInclusive') between -1000000 and 1000000
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[0].minInclusive') < json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[0].maxInclusive')
      and (json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[1]') is null or (json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[1]') = 'object'
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[1].unit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
        and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[1].minInclusive') in ('integer', 'real') and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[1].maxInclusive') in ('integer', 'real')
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[1].minInclusive') between -1000000 and 1000000 and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[1].maxInclusive') between -1000000 and 1000000
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[1].minInclusive') < json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[1].maxInclusive')))
      and (json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[2]') is null or (json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[2]') = 'object'
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[2].unit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
        and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[2].minInclusive') in ('integer', 'real') and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[2].maxInclusive') in ('integer', 'real')
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[2].minInclusive') between -1000000 and 1000000 and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[2].maxInclusive') between -1000000 and 1000000
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[2].minInclusive') < json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[2].maxInclusive')))
      and (json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[3]') is null or (json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[3]') = 'object'
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[3].unit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
        and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[3].minInclusive') in ('integer', 'real') and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[3].maxInclusive') in ('integer', 'real')
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[3].minInclusive') between -1000000 and 1000000 and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[3].maxInclusive') between -1000000 and 1000000
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[3].minInclusive') < json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[3].maxInclusive')))
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceUnit') in (
        json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[0].unit'), json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[1].unit'),
        json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[2].unit'), json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.sourceRanges[3].unit'))
      and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.targetMin') in ('integer', 'real')
      and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.targetMax') in ('integer', 'real')
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.targetMin') = 0
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.targetMax') = 1
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.targetUnit') = 'normalized'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships') = 'array'
      and json_array_length("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships') between 1 and 4
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[0]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD')
      and (json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[1]') is null or json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[1]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD'))
      and (json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[2]') is null or json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[2]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD'))
      and (json_type("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[3]') is null or json_extract("__new_transfer_challenges"."snapshot_json", '$.unitPolicy.allowedRelationships[3]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD'))
      and json_type("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy') = 'object'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.intentAnchor') = 'object'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.intentAnchor.id') = 'text'
      and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.intentAnchor.id')) = 23
      and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.intentAnchor.id'), 1, 7) = 'intent_'
      and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.intentAnchor.id'), 8) not glob '*[^0-9a-f]*'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.intentAnchor.label') = 'text'
      and length(trim(json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.intentAnchor.label'))) between 2 and 500
      and json_type("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedAudienceTypes') = 'array'
      and json_array_length("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedAudienceTypes') = 4
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedAudienceTypes[0]') in ('GENERAL_VISITORS', 'YOUNG_LEARNERS', 'COMMUNITY_MEMBERS', 'CULTURAL_HERITAGE_AUDIENCE')
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedAudienceTypes[1]') in ('GENERAL_VISITORS', 'YOUNG_LEARNERS', 'COMMUNITY_MEMBERS', 'CULTURAL_HERITAGE_AUDIENCE')
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedAudienceTypes[2]') in ('GENERAL_VISITORS', 'YOUNG_LEARNERS', 'COMMUNITY_MEMBERS', 'CULTURAL_HERITAGE_AUDIENCE')
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedAudienceTypes[3]') in ('GENERAL_VISITORS', 'YOUNG_LEARNERS', 'COMMUNITY_MEMBERS', 'CULTURAL_HERITAGE_AUDIENCE')
      and json_type("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedTransitions') = 'array'
      and json_array_length("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedTransitions') = 3
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedTransitions[0].before') = 'PASSIVE_VIEWING'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedTransitions[0].after') = 'ACTIVE_EXPLORATION'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedTransitions[1].before') = 'FOLLOWING_INSTRUCTIONS'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedTransitions[1].after') = 'COLLABORATIVE_CREATION'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedTransitions[2].before') = 'INDIVIDUAL_INTERACTION'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedTransitions[2].after') = 'REFLECTIVE_SHARING'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedMechanisms') = 'array'
      and json_array_length("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedMechanisms') = 2
      and ((json_extract("__new_transfer_challenges"."snapshot_json", '$.changedDimension') = 'input'
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedMechanisms[0]') in ('PARTICIPATORY_TRIGGER', 'COLLECTIVE_RESPONSE')
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedMechanisms[1]') in ('PARTICIPATORY_TRIGGER', 'COLLECTIVE_RESPONSE'))
        or (json_extract("__new_transfer_challenges"."snapshot_json", '$.changedDimension') = 'mapping'
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedMechanisms[0]') = 'NARRATIVE_MAPPING'
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedMechanisms[1]') = 'COLLECTIVE_RESPONSE')
        or (json_extract("__new_transfer_challenges"."snapshot_json", '$.changedDimension') = 'output'
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedMechanisms[0]') = 'SENSORY_FEEDBACK'
        and json_extract("__new_transfer_challenges"."snapshot_json", '$.culturalPolicy.allowedMechanisms[1]') = 'CULTURAL_SYMBOL_REINFORCEMENT'))
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.path') in ('DIGISHOW', 'TOUCHDESIGNER', 'COLLABORATIVE')
      and json_type("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot') = 'array'
      and json_array_length("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot') = 5
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].layer') = 'INPUT'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].code') = 'INPUT_OK'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].layer') = 'MAPPING'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].code') = 'MAPPING_OK'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].layer') = 'TRANSPORT'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].code') = 'TRANSPORT_OK'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].layer') = 'BINDING'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].code') = 'BINDING_OK'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].layer') = 'OUTPUT'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].code') = 'OUTPUT_OK'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceHash') = 'text'
      and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceHash')) = 64
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceHash') not glob '*[^0-9a-f]*'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].sequence') = 'integer' and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].sequence') > 0
      and json_type("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].sequence') = 'integer' and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].sequence') > 0
      and json_type("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].sequence') = 'integer' and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].sequence') > 0
      and json_type("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].sequence') = 'integer' and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].sequence') > 0
      and json_type("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].sequence') = 'integer' and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].sequence') > 0
      and json_type("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id') = 'text' and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id')) = 36 and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id'),9,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id'),14,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id'),19,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id'),24,1)='-' and replace(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].id'),'-','') not glob '*[^0-9a-f]*'
      and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id')) = 36 and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id'),9,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id'),14,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id'),19,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id'),24,1)='-' and replace(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].id'),'-','') not glob '*[^0-9a-f]*'
      and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id')) = 36 and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id'),9,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id'),14,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id'),19,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id'),24,1)='-' and replace(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].id'),'-','') not glob '*[^0-9a-f]*'
      and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id')) = 36 and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id'),9,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id'),14,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id'),19,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id'),24,1)='-' and replace(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].id'),'-','') not glob '*[^0-9a-f]*'
      and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id')) = 36 and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id'),9,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id'),14,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id'),19,1)='-' and substr(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id'),24,1)='-' and replace(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].digest') = 'text' and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].digest')) = 64 and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[0].digest') not glob '*[^0-9a-f]*'
      and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].digest')) = 64 and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[1].digest') not glob '*[^0-9a-f]*'
      and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].digest')) = 64 and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[2].digest') not glob '*[^0-9a-f]*'
      and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].digest')) = 64 and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[3].digest') not glob '*[^0-9a-f]*'
      and length(json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].digest')) = 64 and json_extract("__new_transfer_challenges"."snapshot_json", '$.verifiedEvidenceSnapshot[4].digest') not glob '*[^0-9a-f]*'
      and json_extract("__new_transfer_challenges"."snapshot_json", '$.snapshotHash') = "__new_transfer_challenges"."snapshot_hash"
    ), 0))
);
--> statement-breakpoint
INSERT INTO `__new_transfer_challenges`("id", "project_id", "class_id", "student_id", "revision", "snapshot_hash", "snapshot_json", "status", "attempt_count", "created_at", "updated_at") SELECT "id", "project_id", "class_id", "student_id", "revision", "snapshot_hash", "snapshot_json", "status", "attempt_count", "created_at", "updated_at" FROM `transfer_challenges`;--> statement-breakpoint
DROP TABLE `transfer_challenges`;--> statement-breakpoint
ALTER TABLE `__new_transfer_challenges` RENAME TO `transfer_challenges`;--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_challenges_project_unique` ON `transfer_challenges` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_challenges_id_project_student_class_revision_unique` ON `transfer_challenges` (`id`,`project_id`,`student_id`,`class_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_challenges_id_project_student_class_unique` ON `transfer_challenges` (`id`,`project_id`,`student_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `transfer_challenges_student_class_status_idx` ON `transfer_challenges` (`student_id`,`class_id`,`status`);--> statement-breakpoint
CREATE TRIGGER `transfer_attempts_revision_exists_before_insert`
BEFORE INSERT ON `transfer_attempts`
WHEN NOT EXISTS (
  SELECT 1 FROM `transfer_challenges` c WHERE c.id = NEW.challenge_id AND c.project_id = NEW.project_id
    AND c.student_id = NEW.student_id AND c.class_id = NEW.class_id AND c.revision = NEW.challenge_revision
) AND NOT EXISTS (
  SELECT 1 FROM `transfer_challenge_revisions` h WHERE h.challenge_id = NEW.challenge_id AND h.project_id = NEW.project_id
    AND h.student_id = NEW.student_id AND h.class_id = NEW.class_id AND h.revision = NEW.challenge_revision
)
BEGIN SELECT RAISE(ABORT, 'transfer attempt revision missing'); END;
