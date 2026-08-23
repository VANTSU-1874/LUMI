import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

import { MAX_AGENT_TURN_LATENCY_MS } from "../agent/latency-limits";
import type { LogicCard, ToolPath } from "../domain/schemas";
import type { ToolPathMilestone, ToolPathRequirements } from "../domain/tool-path";
import type {
  TransferAnswer,
  TransferChallengeSnapshot,
  TransferRubric,
} from "../domain/transfer";
import { PROJECT_STAGES } from "../domain/stages";

const userRoles = ["STUDENT", "TEACHER"] as const;
const studentDeclaredMajors = [
  "general-design",
  "digital-interaction",
  "book-design",
] as const;
const learnerLevels = ["L1", "L2", "L3", "L4"] as const;
const evidenceKinds = ["TEXT", "IMAGE", "VALUE", "VIDEO_LINK", "PROBE"] as const;
const signalLayers = ["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"] as const;
const evidenceCodes = ["INPUT_OK", "MAPPING_OK", "TRANSPORT_OK", "BINDING_OK", "OUTPUT_OK"] as const;
const evidenceVerificationStatuses = ["SUBMITTED", "RULE_VERIFIED", "TEACHER_VERIFIED", "REJECTED"] as const;
const evidenceStorageStatuses = ["PENDING", "READY"] as const;
const troubleshootingStatuses = ["ACTIVE", "RESOLVED", "ESCALATED"] as const;
const transferStatuses = ["OPEN", "PASSED", "LOCKED"] as const;
const teacherDecisionTargets = ["LOGIC_REVIEW", "EVIDENCE", "TRANSFER", "BOOK_LAYOUT_EVIDENCE"] as const;
const teacherDecisionKinds = ["CONFIRMED", "CORRECTED", "NEEDS_REVIEW"] as const;
const dataTypes = ["REAL", "DEMONSTRATION_DATA"] as const;
const agentStudentMemoryKinds = [
  "LEARNED_CONCEPT",
  "RECURRING_STRUGGLE",
  "PREFERENCE",
  "PROJECT_FACT",
  "MISCONCEPTION_CORRECTED",
] as const;
const agentStudentMemorySourceKeys = [
  "ONBOARDING_SELF_ASSESSMENT",
  "ONBOARDING_INTERESTS",
] as const;
const learningEpisodes = ["EXPLORE", "UNDERSTAND", "BUILD", "DEBUG", "TRANSFER", "REFLECT"] as const;
const agentModes = ["MODEL_ASSISTED", "DETERMINISTIC_FALLBACK"] as const;
const agentResponseStrategies = [
  "DIRECT_INSTRUCTION", "CONCEPT_EXPLANATION", "DIAGNOSTIC_GUIDANCE", "TRANSFER_COACHING",
  "REFLECTION_PROMPT", "CLARIFY", "OUT_OF_SCOPE",
] as const;
const agentActionTypes = [
  "OPEN_WORKSPACE", "OPEN_RESOURCE", "START_DIAGNOSTIC", "REQUEST_EVIDENCE",
  "START_TROUBLESHOOTING", "START_TRANSFER", "ESCALATE_TEACHER",
] as const;
const agentActionStatuses = ["PROPOSED", "EXECUTED", "REJECTED", "EXPIRED"] as const;
const agentEffects = ["READ_CONTEXT", "NAVIGATE", "WRITE_PROJECT", "CHANGE_TOOL_STATE", "SUBMIT_EVALUATION", "FORMAL_AUTHORITY"] as const;
const agentApprovalModes = ["AUTOMATIC", "REQUIRES_CONFIRMATION", "FORBIDDEN"] as const;
const agentToolCallStatuses = ["SUCCESS", "EMPTY", "ERROR"] as const;
const agentStepKinds = ["MODEL_DECISION", "TOOL_CALL", "TOOL_OBSERVATION", "FINAL_RESPONSE", "DEGRADED"] as const;
const agentStepStatuses = ["SUCCEEDED", "FAILED", "EMPTY", "SKIPPED"] as const;
const agentRuntimeEventKinds = [
  "CONTEXT_PREPARATION", "RETRIEVAL", "POLICY_CHECK", "MODEL_DECISION", "TOOL_CALL",
  "TOOL_OBSERVATION", "SOURCE_SELECTION", "PERSISTENCE", "FINAL_RESPONSE", "DEGRADED",
] as const;
const agentRuntimeUsageStatuses = ["RECORDED", "UNAVAILABLE"] as const;
const designTaskStatuses = ["ACTIVE", "ARCHIVED"] as const;
const assistantThreadModes = ["conversation", "engineering"] as const;
const agentMessageRoles = ["user", "assistant"] as const;
const agentRunStatuses = ["QUEUED", "RUNNING", "WAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"] as const;
const agentRunEventKinds = [
  "RUN_CREATED", "STATUS_CHANGED", "RUN_CLAIMED", "STEP", "TOOL", "APPROVAL",
  "COMPLETION", "ERROR", "CANCELLED", "TOKEN",
] as const;
const previewScenarioIds = ["S1_INTENT", "S3_TRANSFER", "S5_BOOK_KNOWLEDGE"] as const;
const previewRunStatuses = ["RUNNING", "COMPLETED", "FAILED"] as const;
const agentRunControlKinds = ["CANCEL", "RETRY"] as const;
const agentRunInterventionModes = ["FOLLOW_UP", "STEER"] as const;
const agentRunInterventionStatuses = [
  "QUEUED",
  "ACTIVE",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
const inspirationCandidateStates = [
  "DISCOVERED", "DOWNLOADED/IMPORTED", "NORMALIZED/DEDUPED", "VISUALLY_ANALYZED",
  "READY_FOR_TEACHER_REVIEW", "APPROVED", "AUTO_ADMITTED/INDEXED", "ACTIVE", "REJECTED", "WITHDRAWN",
] as const;
const inspirationReviewDecisionKinds = ["APPROVE", "REJECT", "DEFER"] as const;
const inspirationWikiReviewerRoles = [
  "CANDIDATE_PROPOSER", "WIKI_EDITOR", "CURATION_REVIEWER", "TEACHING_REVIEWER",
  "RIGHTS_REVIEWER", "SAFETY_REVIEWER", "RELEASE_APPROVER", "WITHDRAWAL_OPERATOR",
] as const;
const inspirationWikiReviewDomains = ["CURATION", "TEACHING", "RIGHTS", "SAFETY"] as const;
const inspirationWikiReviewDecisions = ["APPROVE", "REJECT", "HOLD"] as const;
const inspirationWikiReviewStatuses = ["ACTIVE", "REVOKED", "EXPIRED"] as const;
const inspirationWikiCatalogStates = ["INTERNAL_CATALOG_ACTIVE", "REVIEW_HOLD"] as const;
const projectStageSql = sql.raw(PROJECT_STAGES.map((stage) => `'${stage}'`).join(", "));
const maxAgentTurnLatencySql = sql.raw(String(MAX_AGENT_TURN_LATENCY_MS));

export type JsonRecord = Record<string, unknown>;

function transferSnapshotBoundsCheck(
  snapshotJson: AnySQLiteColumn,
  projectId: AnySQLiteColumn,
  revision: AnySQLiteColumn,
  snapshotHash: AnySQLiteColumn,
) {
  return sql`coalesce((json_valid(${snapshotJson}) and json_type(${snapshotJson}) = 'object'
    and json_type(${snapshotJson}, '$.projectId') = 'text' and length(trim(json_extract(${snapshotJson}, '$.projectId'))) between 1 and 128
    and json_extract(${snapshotJson}, '$.projectId') = ${projectId}
    and json_type(${snapshotJson}, '$.challengeRevision') = 'integer' and json_extract(${snapshotJson}, '$.challengeRevision') = ${revision}
    and json_extract(${snapshotJson}, '$.changedDimension') in ('input', 'mapping', 'output')
    and json_type(${snapshotJson}, '$.prompt') = 'text' and length(trim(json_extract(${snapshotJson}, '$.prompt'))) between 10 and 1000
    and json_type(${snapshotJson}, '$.mustRetain') = 'object'
    and json_type(${snapshotJson}, '$.mustRetain.culturalIntent') = 'text' and length(trim(json_extract(${snapshotJson}, '$.mustRetain.culturalIntent'))) between 2 and 500
    and json_type(${snapshotJson}, '$.mustRetain.structure') = 'text' and length(trim(json_extract(${snapshotJson}, '$.mustRetain.structure'))) between 2 and 1000
    and json_type(${snapshotJson}, '$.mustRetain.input') = 'text' and length(trim(json_extract(${snapshotJson}, '$.mustRetain.input'))) between 2 and 500
    and json_type(${snapshotJson}, '$.mustRetain.mapping') = 'text' and length(trim(json_extract(${snapshotJson}, '$.mustRetain.mapping'))) between 2 and 500
    and json_type(${snapshotJson}, '$.mustRetain.output') = 'text' and length(trim(json_extract(${snapshotJson}, '$.mustRetain.output'))) between 2 and 500
    and json_type(${snapshotJson}, '$.change') = 'object'
    and json_type(${snapshotJson}, '$.change.candidateId') = 'text' and length(trim(json_extract(${snapshotJson}, '$.change.candidateId'))) between 1 and 64
    and json_extract(${snapshotJson}, '$.change.dimension') = json_extract(${snapshotJson}, '$.changedDimension')
    and json_type(${snapshotJson}, '$.change.from') = 'text' and length(trim(json_extract(${snapshotJson}, '$.change.from'))) between 2 and 500
    and json_type(${snapshotJson}, '$.change.to') = 'text' and length(trim(json_extract(${snapshotJson}, '$.change.to'))) between 2 and 500
    and trim(json_extract(${snapshotJson}, '$.change.from')) <> trim(json_extract(${snapshotJson}, '$.change.to'))
    and json_type(${snapshotJson}, '$.unitPolicy') = 'object'
    and json_extract(${snapshotJson}, '$.unitPolicy.sourceKind') in ('SOUND', 'DISTANCE', 'NORMALIZED', 'GENERIC')
    and json_extract(${snapshotJson}, '$.unitPolicy.sourceUnit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
    and json_type(${snapshotJson}, '$.unitPolicy.sourceRanges') = 'array' and json_array_length(${snapshotJson}, '$.unitPolicy.sourceRanges') between 1 and 4
    and json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[0]') = 'object'
    and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[0].unit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
    and json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[0].minInclusive') in ('integer','real') and json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[0].maxInclusive') in ('integer','real')
    and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[0].minInclusive') between -1000000 and 1000000 and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[0].maxInclusive') between -1000000 and 1000000
    and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[0].minInclusive') < json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[0].maxInclusive')
    and (json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[1]') is null or (json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[1]')='object' and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[1].unit') in ('dB','mm','cm','m','normalized','raw') and json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[1].minInclusive') in ('integer','real') and json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[1].maxInclusive') in ('integer','real') and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[1].minInclusive') between -1000000 and 1000000 and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[1].maxInclusive') between -1000000 and 1000000 and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[1].minInclusive') < json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[1].maxInclusive')))
    and (json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[2]') is null or (json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[2]')='object' and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[2].unit') in ('dB','mm','cm','m','normalized','raw') and json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[2].minInclusive') in ('integer','real') and json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[2].maxInclusive') in ('integer','real') and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[2].minInclusive') between -1000000 and 1000000 and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[2].maxInclusive') between -1000000 and 1000000 and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[2].minInclusive') < json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[2].maxInclusive')))
    and (json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[3]') is null or (json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[3]')='object' and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[3].unit') in ('dB','mm','cm','m','normalized','raw') and json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[3].minInclusive') in ('integer','real') and json_type(${snapshotJson}, '$.unitPolicy.sourceRanges[3].maxInclusive') in ('integer','real') and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[3].minInclusive') between -1000000 and 1000000 and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[3].maxInclusive') between -1000000 and 1000000 and json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[3].minInclusive') < json_extract(${snapshotJson}, '$.unitPolicy.sourceRanges[3].maxInclusive')))
    and json_extract(${snapshotJson}, '$.unitPolicy.targetMin') = 0 and json_extract(${snapshotJson}, '$.unitPolicy.targetMax') = 1
    and json_extract(${snapshotJson}, '$.unitPolicy.targetUnit') = 'normalized'
    and json_type(${snapshotJson}, '$.unitPolicy.allowedRelationships') = 'array' and json_array_length(${snapshotJson}, '$.unitPolicy.allowedRelationships') between 1 and 4
    and json_extract(${snapshotJson}, '$.unitPolicy.allowedRelationships[0]') in ('LINEAR','DIRECT','INVERSE','THRESHOLD')
    and (json_type(${snapshotJson}, '$.unitPolicy.allowedRelationships[1]') is null or json_extract(${snapshotJson}, '$.unitPolicy.allowedRelationships[1]') in ('LINEAR','DIRECT','INVERSE','THRESHOLD'))
    and (json_type(${snapshotJson}, '$.unitPolicy.allowedRelationships[2]') is null or json_extract(${snapshotJson}, '$.unitPolicy.allowedRelationships[2]') in ('LINEAR','DIRECT','INVERSE','THRESHOLD'))
    and (json_type(${snapshotJson}, '$.unitPolicy.allowedRelationships[3]') is null or json_extract(${snapshotJson}, '$.unitPolicy.allowedRelationships[3]') in ('LINEAR','DIRECT','INVERSE','THRESHOLD'))
    and json_type(${snapshotJson}, '$.culturalPolicy') = 'object' and json_type(${snapshotJson}, '$.culturalPolicy.intentAnchor') = 'object'
    and json_type(${snapshotJson}, '$.culturalPolicy.intentAnchor.id') = 'text' and length(json_extract(${snapshotJson}, '$.culturalPolicy.intentAnchor.id')) = 23
    and substr(json_extract(${snapshotJson}, '$.culturalPolicy.intentAnchor.id'),1,7)='intent_' and substr(json_extract(${snapshotJson}, '$.culturalPolicy.intentAnchor.id'),8) not glob '*[^0-9a-f]*'
    and json_type(${snapshotJson}, '$.culturalPolicy.intentAnchor.label') = 'text' and length(trim(json_extract(${snapshotJson}, '$.culturalPolicy.intentAnchor.label'))) between 2 and 500
    and json_type(${snapshotJson}, '$.culturalPolicy.allowedAudienceTypes') = 'array' and json_array_length(${snapshotJson}, '$.culturalPolicy.allowedAudienceTypes') between 1 and 4
    and json_extract(${snapshotJson}, '$.culturalPolicy.allowedAudienceTypes[0]') in ('GENERAL_VISITORS','YOUNG_LEARNERS','COMMUNITY_MEMBERS','CULTURAL_HERITAGE_AUDIENCE')
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedAudienceTypes[1]') is null or json_extract(${snapshotJson}, '$.culturalPolicy.allowedAudienceTypes[1]') in ('GENERAL_VISITORS','YOUNG_LEARNERS','COMMUNITY_MEMBERS','CULTURAL_HERITAGE_AUDIENCE'))
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedAudienceTypes[2]') is null or json_extract(${snapshotJson}, '$.culturalPolicy.allowedAudienceTypes[2]') in ('GENERAL_VISITORS','YOUNG_LEARNERS','COMMUNITY_MEMBERS','CULTURAL_HERITAGE_AUDIENCE'))
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedAudienceTypes[3]') is null or json_extract(${snapshotJson}, '$.culturalPolicy.allowedAudienceTypes[3]') in ('GENERAL_VISITORS','YOUNG_LEARNERS','COMMUNITY_MEMBERS','CULTURAL_HERITAGE_AUDIENCE'))
    and json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions') = 'array' and json_array_length(${snapshotJson}, '$.culturalPolicy.allowedTransitions') between 1 and 9
    and json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[0]')='object' and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[0].before') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[0].after') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[0].before')<>json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[0].after')
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[1]') is null or (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[1]')='object' and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[1].before') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[1].after') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[1].before')<>json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[1].after')))
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[2]') is null or (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[2]')='object' and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[2].before') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[2].after') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[2].before')<>json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[2].after')))
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[3]') is null or (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[3]')='object' and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[3].before') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[3].after') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[3].before')<>json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[3].after')))
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[4]') is null or (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[4]')='object' and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[4].before') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[4].after') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[4].before')<>json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[4].after')))
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[5]') is null or (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[5]')='object' and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[5].before') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[5].after') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[5].before')<>json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[5].after')))
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[6]') is null or (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[6]')='object' and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[6].before') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[6].after') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[6].before')<>json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[6].after')))
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[7]') is null or (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[7]')='object' and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[7].before') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[7].after') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[7].before')<>json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[7].after')))
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[8]') is null or (json_type(${snapshotJson}, '$.culturalPolicy.allowedTransitions[8]')='object' and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[8].before') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[8].after') in ('PASSIVE_VIEWING','FOLLOWING_INSTRUCTIONS','INDIVIDUAL_INTERACTION','ACTIVE_EXPLORATION','COLLABORATIVE_CREATION','REFLECTIVE_SHARING') and json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[8].before')<>json_extract(${snapshotJson}, '$.culturalPolicy.allowedTransitions[8].after')))
    and json_type(${snapshotJson}, '$.culturalPolicy.allowedMechanisms') = 'array' and json_array_length(${snapshotJson}, '$.culturalPolicy.allowedMechanisms') between 1 and 3
    and json_extract(${snapshotJson}, '$.culturalPolicy.allowedMechanisms[0]') in ('PARTICIPATORY_TRIGGER','COLLECTIVE_RESPONSE','NARRATIVE_MAPPING','SENSORY_FEEDBACK','CULTURAL_SYMBOL_REINFORCEMENT')
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedMechanisms[1]') is null or json_extract(${snapshotJson}, '$.culturalPolicy.allowedMechanisms[1]') in ('PARTICIPATORY_TRIGGER','COLLECTIVE_RESPONSE','NARRATIVE_MAPPING','SENSORY_FEEDBACK','CULTURAL_SYMBOL_REINFORCEMENT'))
    and (json_type(${snapshotJson}, '$.culturalPolicy.allowedMechanisms[2]') is null or json_extract(${snapshotJson}, '$.culturalPolicy.allowedMechanisms[2]') in ('PARTICIPATORY_TRIGGER','COLLECTIVE_RESPONSE','NARRATIVE_MAPPING','SENSORY_FEEDBACK','CULTURAL_SYMBOL_REINFORCEMENT'))
    and json_extract(${snapshotJson}, '$.path') in ('DIGISHOW','TOUCHDESIGNER','COLLABORATIVE')
    and json_type(${snapshotJson}, '$.verifiedEvidenceHash')='text' and length(json_extract(${snapshotJson}, '$.verifiedEvidenceHash'))=64 and json_extract(${snapshotJson}, '$.verifiedEvidenceHash') not glob '*[^0-9a-f]*'
    and json_type(${snapshotJson}, '$.snapshotHash')='text' and json_extract(${snapshotJson}, '$.snapshotHash')=${snapshotHash}
    and length(${snapshotHash})=64 and ${snapshotHash} not glob '*[^0-9a-f]*'),0)`;
}

export const classes = sqliteTable("classes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  accessCode: text("access_code").notNull().unique(),
});

export const authUser = sqliteTable(
  "auth_user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    role: text("role", { enum: userRoles }).notNull(),
    classId: text("class_id").references(() => classes.id, { onDelete: "restrict" }),
    alias: text("alias").notNull(),
  },
  (table) => [
    uniqueIndex("auth_user_email_unique").on(table.email),
    index("auth_user_class_id_idx").on(table.classId),
    check("auth_user_role_check", sql`${table.role} in ('STUDENT', 'TEACHER')`),
    check(
      "auth_user_role_class_check",
      sql`(${table.role} = 'STUDENT' and ${table.classId} is not null) or (${table.role} = 'TEACHER' and ${table.classId} is null)`,
    ),
  ],
);

export const authSession = sqliteTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("auth_session_token_unique").on(table.token),
    index("auth_session_user_id_idx").on(table.userId),
  ],
);

export const authAccount = sqliteTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("auth_account_user_id_idx").on(table.userId),
    uniqueIndex("auth_account_provider_account_unique").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const authVerification = sqliteTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("auth_verification_identifier_idx").on(table.identifier),
  ],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").references(() => classes.id, { onDelete: "restrict" }),
    role: text("role", { enum: userRoles }).notNull(),
    alias: text("alias").notNull(),
    nickname: text("nickname"),
    major: text("major", { enum: studentDeclaredMajors }),
    onboardingCompletedAt: integer("onboarding_completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("id")} glob 'demo-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    uniqueIndex("users_id_class_id_unique").on(table.id, table.classId),
    uniqueIndex("users_class_id_alias_unique").on(table.classId, table.alias),
    check("users_role_check", sql`${table.role} in ('STUDENT', 'TEACHER')`),
    check(
      "users_nickname_check",
      sql`${table.nickname} is null or length(trim(${table.nickname})) between 1 and 40`,
    ),
    check(
      "users_major_check",
      sql`${table.major} is null or ${table.major} in ('general-design','digital-interaction','book-design')`,
    ),
    check(
      "users_onboarding_role_check",
      sql`${table.role} = 'STUDENT' or (${table.nickname} is null and ${table.major} is null and ${table.onboardingCompletedAt} is null)`,
    ),
    check(
      "users_onboarding_completed_at_check",
      sql`${table.onboardingCompletedAt} is null or ${table.onboardingCompletedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const teacherAccessScopes = sqliteTable(
  "teacher_access_scopes",
  {
    teacherId: text("teacher_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    scopeKind: text("scope_kind", { enum: ["GLOBAL", "CLASS"] }).notNull(),
    classId: text("class_id").references(() => classes.id, { onDelete: "restrict" }),
    grantedBy: text("granted_by").notNull(),
    grantReason: text("grant_reason").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("teacher_access_scopes_class_idx").on(table.classId),
    check(
      "teacher_access_scopes_kind_check",
      sql`${table.scopeKind} in ('GLOBAL', 'CLASS')`,
    ),
    check(
      "teacher_access_scopes_class_check",
      sql`(${table.scopeKind} = 'GLOBAL' and ${table.classId} is null) or (${table.scopeKind} = 'CLASS' and ${table.classId} is not null)`,
    ),
    check(
      "teacher_access_scopes_audit_check",
      sql`length(trim(${table.grantedBy})) between 1 and 120 and length(trim(${table.grantReason})) between 1 and 500`,
    ),
  ],
);

export const authRateLimits = sqliteTable(
  "auth_rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    failures: integer("failures").notNull(),
    windowStartedAt: integer("window_started_at", { mode: "timestamp" }).notNull(),
    blockedUntil: integer("blocked_until", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("auth_rate_limits_blocked_until_idx").on(table.blockedUntil),
    check("auth_rate_limits_key_hash_check", sql`length(${table.keyHash}) = 64`),
    check("auth_rate_limits_failures_check", sql`${table.failures} >= 0`),
  ],
);

export const studentIdentityCodes = sqliteTable(
  "student_identity_codes",
  {
    codeDigest: text("code_digest").primaryKey(),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    claimedUserId: text("claimed_user_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    claimedAt: integer("claimed_at", { mode: "timestamp" }),
  },
  (table) => [
    index("student_identity_codes_class_id_idx").on(table.classId),
    foreignKey({
      columns: [table.claimedUserId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "student_identity_codes_claimed_user_class_fk",
    }).onDelete("restrict"),
    check(
      "student_identity_codes_digest_check",
      sql`length(${table.codeDigest}) = 64`,
    ),
    check(
      "student_identity_codes_claim_state_check",
      sql`(${table.claimedUserId} is null and ${table.claimedAt} is null) or (${table.claimedUserId} is not null and ${table.claimedAt} is not null)`,
    ),
  ],
);

export const learnerProfiles = sqliteTable(
  "learner_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    level: text("level", { enum: learnerLevels }).notNull(),
    decomposition: integer("decomposition").notNull(),
    signalUnderstanding: integer("signal_understanding").notNull(),
    mappingDesign: integer("mapping_design").notNull(),
    troubleshooting: integer("troubleshooting").notNull(),
    transfer: integer("transfer").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("user_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    check("learner_profiles_level_check", sql`${table.level} in ('L1', 'L2', 'L3', 'L4')`),
    check(
      "learner_profiles_decomposition_range_check",
      sql`${table.decomposition} in (1, 1.5, 2, 2.5, 3, 3.5, 4)`,
    ),
    check(
      "learner_profiles_signal_understanding_range_check",
      sql`${table.signalUnderstanding} in (1, 1.5, 2, 2.5, 3, 3.5, 4)`,
    ),
    check(
      "learner_profiles_mapping_design_range_check",
      sql`${table.mappingDesign} in (1, 1.5, 2, 2.5, 3, 3.5, 4)`,
    ),
    check(
      "learner_profiles_troubleshooting_range_check",
      sql`${table.troubleshooting} in (1, 1.5, 2, 2.5, 3, 3.5, 4)`,
    ),
    check(
      "learner_profiles_transfer_range_check",
      sql`${table.transfer} in (1, 1.5, 2, 2.5, 3, 3.5, 4)`,
    ),
  ],
);

export const courseModules = sqliteTable(
  "course_modules",
  {
    id: text("id").primaryKey(),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    title: text("title").notNull(),
    hours: integer("hours").notNull(),
    focus: text("focus").notNull(),
  },
  (table) => [
    uniqueIndex("course_modules_id_class_id_unique").on(table.id, table.classId),
    uniqueIndex("course_modules_class_id_sequence_unique").on(table.classId, table.sequence),
  ],
);

export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    moduleId: text("module_id").notNull(),
    title: text("title").notNull(),
    brief: text("brief").notNull(),
    allowedTools: text("allowed_tools", { mode: "json" }).$type<ToolPath[]>().notNull(),
    // The competition core has one formal project pack. Virtual generated
    // columns keep legacy positional INSERT statements valid while exposing a
    // versioned, immutable binding to new reads.
    coursePackId: text("course_pack_id").generatedAlwaysAs(sql`'digital-interaction'`),
    coursePackVersion: text("course_pack_version").generatedAlwaysAs(sql`'1'`),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("assignments_id_class_id_unique").on(table.id, table.classId),
    index("assignments_class_id_idx").on(table.classId),
    index("assignments_module_id_class_id_idx").on(table.moduleId, table.classId),
    foreignKey({
      columns: [table.moduleId, table.classId],
      foreignColumns: [courseModules.id, courseModules.classId],
      name: "assignments_module_class_fk",
    }).onDelete("restrict"),
    check("assignments_allowed_tools_json_check", sql`json_valid(${table.allowedTools})`),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    assignmentId: text("assignment_id").notNull(),
    studentId: text("student_id").notNull(),
    stage: text("stage", { enum: PROJECT_STAGES }).notNull(),
    coursePackId: text("course_pack_id").generatedAlwaysAs(sql`'digital-interaction'`),
    coursePackVersion: text("course_pack_version").generatedAlwaysAs(sql`'1'`),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    evidenceRevision: integer("evidence_revision").notNull().default(0),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    uniqueIndex("projects_id_class_id_unique").on(table.id, table.classId),
    uniqueIndex("projects_id_class_student_unique").on(table.id, table.classId, table.studentId),
    index("projects_assignment_id_class_id_idx").on(table.assignmentId, table.classId),
    index("projects_student_id_class_id_idx").on(table.studentId, table.classId),
    index("projects_class_student_current_idx").on(table.classId, table.studentId, table.updatedAt, table.createdAt, table.id),
    index("projects_stage_idx").on(table.stage),
    foreignKey({
      columns: [table.assignmentId, table.classId],
      foreignColumns: [assignments.id, assignments.classId],
      name: "projects_assignment_class_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "projects_student_class_fk",
    }).onDelete("restrict"),
    check("projects_stage_check", sql`${table.stage} in (${projectStageSql})`),
    check("projects_evidence_revision_check", sql`${table.evidenceRevision} >= 0`),
  ],
);

export const logicCards = sqliteTable(
  "logic_cards",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    payloadJson: text("payload_json", { mode: "json" }).$type<LogicCard>().notNull(),
    ruleReady: integer("rule_ready", { mode: "boolean" }).notNull(),
    semanticReady: integer("semantic_ready", { mode: "boolean" }).notNull(),
    semanticReviewJson: text("semantic_review_json", { mode: "json" })
      .$type<JsonRecord>()
      .notNull(),
    revision: integer("revision").notNull().default(1),
    cardHash: text("card_hash").notNull().default("0".repeat(64)),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("project_id")} glob 'demo-project-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    check("logic_cards_payload_json_check", sql`json_valid(${table.payloadJson})`),
    check(
      "logic_cards_semantic_review_json_check",
      sql`json_valid(${table.semanticReviewJson})`,
    ),
    check("logic_cards_rule_ready_check", sql`${table.ruleReady} in (0, 1)`),
    check("logic_cards_semantic_ready_check", sql`${table.semanticReady} in (0, 1)`),
    check("logic_cards_revision_positive_check", sql`${table.revision} > 0`),
    check(
      "logic_cards_card_hash_check",
      sql`length(${table.cardHash}) = 64 and ${table.cardHash} not glob '*[^0-9a-f]*'`,
    ),
  ],
);

export const toolPathPlans = sqliteTable(
  "tool_path_plans",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path", { enum: ["DIGISHOW", "TOUCHDESIGNER", "COLLABORATIVE"] })
      .$type<ToolPath>()
      .notNull(),
    requirementsJson: text("requirements_json", { mode: "json" })
      .$type<ToolPathRequirements>()
      .notNull(),
    reasonsJson: text("reasons_json", { mode: "json" }).$type<string[]>().notNull(),
    milestonesJson: text("milestones_json", { mode: "json" })
      .$type<ToolPathMilestone[]>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("project_id")} glob 'demo-project-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    check(
      "tool_path_plans_path_check",
      sql`${table.path} in ('DIGISHOW', 'TOUCHDESIGNER', 'COLLABORATIVE')`,
    ),
    check(
      "tool_path_plans_requirements_json_check",
      sql`json_valid(${table.requirementsJson}) and json_type(${table.requirementsJson}) = 'object' and coalesce(json_type(${table.requirementsJson}, '$.needsRealtimeVisuals'), '') in ('true', 'false') and coalesce(json_type(${table.requirementsJson}, '$.needsPhysicalControl'), '') in ('true', 'false') and coalesce(json_type(${table.requirementsJson}, '$.hasOsc'), '') in ('true', 'false')`,
    ),
    check(
      "tool_path_plans_reasons_json_check",
      sql`json_valid(${table.reasonsJson}) and json_type(${table.reasonsJson}) = 'array'`,
    ),
    check(
      "tool_path_plans_milestones_json_check",
      sql`json_valid(${table.milestonesJson}) and json_type(${table.milestonesJson}) = 'array'`,
    ),
  ],
);

export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    classId: text("class_id").notNull(),
    studentId: text("student_id").notNull(),
    evidenceSequence: integer("evidence_sequence").notNull(),
    kind: text("kind", { enum: evidenceKinds }).notNull(),
    signalLayer: text("signal_layer", { enum: signalLayers }).notNull(),
    confirmedCode: text("confirmed_code", { enum: evidenceCodes }),
    verificationStatus: text("verification_status", { enum: evidenceVerificationStatuses }).notNull(),
    storageStatus: text("storage_status", { enum: evidenceStorageStatuses }).notNull(),
    label: text("label").notNull(),
    content: text("content").notNull(),
    contentDigest: text("content_digest").notNull(),
    probeJson: text("probe_json", { mode: "json" }).$type<JsonRecord>(),
    originalName: text("original_name"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    uniqueIndex("evidence_id_project_student_class_unique").on(table.id, table.projectId, table.studentId, table.classId),
    uniqueIndex("evidence_exact_consumption_unique").on(
      table.id,
      table.projectId,
      table.studentId,
      table.classId,
      table.evidenceSequence,
      table.contentDigest,
    ),
    uniqueIndex("evidence_project_student_sequence_unique").on(table.projectId, table.studentId, table.evidenceSequence),
    index("evidence_project_class_kind_idx").on(table.projectId, table.classId, table.kind),
    index("evidence_student_class_project_sequence_idx").on(table.studentId, table.classId, table.projectId, table.evidenceSequence),
    foreignKey({
      columns: [table.projectId, table.classId],
      foreignColumns: [projects.id, projects.classId],
      name: "evidence_project_class_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "evidence_student_class_fk",
    }).onDelete("restrict"),
    check(
      "evidence_kind_check",
      sql`${table.kind} in ('TEXT', 'IMAGE', 'VALUE', 'VIDEO_LINK', 'PROBE')`,
    ),
    check("evidence_signal_layer_check", sql`${table.signalLayer} in ('INPUT', 'MAPPING', 'TRANSPORT', 'BINDING', 'OUTPUT')`),
    check("evidence_sequence_positive_check", sql`${table.evidenceSequence} > 0`),
    check("evidence_verification_status_check", sql`${table.verificationStatus} in ('SUBMITTED', 'RULE_VERIFIED', 'TEACHER_VERIFIED', 'REJECTED')`),
    check("evidence_storage_status_check", sql`${table.storageStatus} in ('PENDING', 'READY') and (${table.kind} = 'IMAGE' or ${table.storageStatus} = 'READY')`),
    check(
      "evidence_probe_json_check",
      sql`(
        ${table.kind} = 'PROBE' and ${table.probeJson} is not null and json_valid(${table.probeJson}) and json_type(${table.probeJson}) = 'object'
      ) or (
        ${table.kind} <> 'PROBE' and ${table.probeJson} is null
      )`,
    ),
    check(
      "evidence_verification_code_layer_check",
      sql`(
        ${table.verificationStatus} in ('SUBMITTED', 'REJECTED') and ${table.confirmedCode} is null
      ) or (
        ${table.verificationStatus} in ('RULE_VERIFIED', 'TEACHER_VERIFIED') and ${table.confirmedCode} is not null and (
          (${table.signalLayer} = 'INPUT' and ${table.confirmedCode} = 'INPUT_OK') or
          (${table.signalLayer} = 'MAPPING' and ${table.confirmedCode} = 'MAPPING_OK') or
          (${table.signalLayer} = 'TRANSPORT' and ${table.confirmedCode} = 'TRANSPORT_OK') or
          (${table.signalLayer} = 'BINDING' and ${table.confirmedCode} = 'BINDING_OK') or
          (${table.signalLayer} = 'OUTPUT' and ${table.confirmedCode} = 'OUTPUT_OK')
        )
      )`,
    ),
    check("evidence_digest_check", sql`length(${table.contentDigest}) = 64 and ${table.contentDigest} not glob '*[^0-9a-f]*'`),
    check("evidence_label_length_check", sql`length(${table.label}) between 1 and 80`),
    check("evidence_original_name_length_check", sql`${table.originalName} is null or length(${table.originalName}) between 1 and 120`),
  ],
);

export const troubleshootingRuns = sqliteTable(
  "troubleshooting_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    symptom: text("symptom").notNull(),
    currentLayer: text("current_layer").notNull(),
    stateJson: text("state_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    status: text("status", { enum: troubleshootingStatuses }).notNull(),
    revision: integer("revision").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("project_id")} glob 'demo-project-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    index("troubleshooting_runs_project_status_layer_idx").on(table.projectId, table.status, table.currentLayer),
    check(
      "troubleshooting_runs_state_json_check",
      sql`json_valid(${table.stateJson})
        and json_type(${table.stateJson}) = 'object'
        and coalesce(
          json_extract(${table.stateJson}, '$.currentLayer'),
          json_extract(${table.stateJson}, '$.current_layer')
        ) is not null
        and coalesce(
          json_extract(${table.stateJson}, '$.currentLayer'),
          json_extract(${table.stateJson}, '$.current_layer')
        ) = ${table.currentLayer}
        and json_extract(${table.stateJson}, '$.status') is not null
        and json_extract(${table.stateJson}, '$.status') = ${table.status}`,
    ),
    check("troubleshooting_runs_layer_check", sql`${table.currentLayer} in ('INPUT', 'MAPPING', 'TRANSPORT', 'BINDING', 'OUTPUT')`),
    check("troubleshooting_runs_revision_positive_check", sql`${table.revision} > 0`),
    check(
      "troubleshooting_runs_status_check",
      sql`${table.status} in ('ACTIVE', 'RESOLVED', 'ESCALATED')`,
    ),
  ],
);

export const hintRecords = sqliteTable(
  "hint_records",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    classId: text("class_id").notNull(),
    studentId: text("student_id").notNull(),
    hintSequence: integer("hint_sequence").notNull(),
    evidenceSequenceWatermark: integer("evidence_sequence_watermark").notNull(),
    contextHash: text("context_hash").notNull(),
    hintLevel: integer("hint_level").notNull(),
    responseJson: text("response_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    uniqueIndex("hint_records_id_project_student_class_unique").on(table.id, table.projectId, table.studentId, table.classId),
    uniqueIndex("hint_records_project_student_sequence_unique").on(table.projectId, table.studentId, table.hintSequence),
    index("hint_records_student_class_project_sequence_idx").on(table.studentId, table.classId, table.projectId, table.hintSequence),
    index("hint_records_project_class_sequence_idx").on(table.projectId, table.classId, table.hintSequence),
    foreignKey({ columns: [table.projectId, table.classId], foreignColumns: [projects.id, projects.classId], name: "hint_records_project_class_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.studentId, table.classId], foreignColumns: [users.id, users.classId], name: "hint_records_student_class_fk" }).onDelete("restrict"),
    check("hint_records_level_check", sql`${table.hintLevel} in (1, 2, 3)`),
    check("hint_records_sequence_check", sql`${table.hintSequence} > 0 and ${table.evidenceSequenceWatermark} >= 0`),
    check("hint_records_context_hash_check", sql`length(${table.contextHash}) = 64 and ${table.contextHash} not glob '*[^0-9a-f]*'`),
    check("hint_records_response_json_check", sql`json_valid(${table.responseJson}) and json_type(${table.responseJson}) = 'object'`),
  ],
);

export const hintEvidenceConsumptions = sqliteTable(
  "hint_evidence_consumptions",
  {
    evidenceId: text("evidence_id").primaryKey(),
    hintRecordId: text("hint_record_id").notNull().unique(),
    projectId: text("project_id").notNull(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    evidenceSequence: integer("evidence_sequence").notNull(),
    contentDigest: text("content_digest").notNull(),
    consumedAt: integer("consumed_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("hint_evidence_consumptions_project_student_class_idx").on(table.projectId, table.studentId, table.classId),
    index("hint_evidence_consumptions_evidence_owner_idx").on(
      table.evidenceId,
      table.projectId,
      table.studentId,
      table.classId,
      table.evidenceSequence,
      table.contentDigest,
    ),
    index("hint_evidence_consumptions_hint_owner_idx").on(table.hintRecordId, table.projectId, table.studentId, table.classId),
    foreignKey({
      columns: [
        table.evidenceId,
        table.projectId,
        table.studentId,
        table.classId,
        table.evidenceSequence,
        table.contentDigest,
      ],
      foreignColumns: [
        evidence.id,
        evidence.projectId,
        evidence.studentId,
        evidence.classId,
        evidence.evidenceSequence,
        evidence.contentDigest,
      ],
      name: "hint_consumption_evidence_owner_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.hintRecordId, table.projectId, table.studentId, table.classId],
      foreignColumns: [hintRecords.id, hintRecords.projectId, hintRecords.studentId, hintRecords.classId],
      name: "hint_consumption_hint_owner_fk",
    }).onDelete("cascade"),
    check("hint_evidence_consumptions_sequence_check", sql`${table.evidenceSequence} > 0`),
    check("hint_evidence_consumptions_digest_check", sql`length(${table.contentDigest}) = 64 and ${table.contentDigest} not glob '*[^0-9a-f]*'`),
  ],
);

export const actionRateLimits = sqliteTable(
  "action_rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    requests: integer("requests").notNull(),
    windowStartedAt: integer("window_started_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("action_rate_limits_updated_idx").on(table.updatedAt),
    check("action_rate_limits_key_hash_check", sql`length(${table.keyHash}) = 64 and ${table.keyHash} not glob '*[^0-9a-f]*'`),
    check("action_rate_limits_requests_check", sql`${table.requests} >= 1`),
  ],
);

export const evidenceRecoveryLocks = sqliteTable(
  "evidence_recovery_locks",
  {
    name: text("name").primaryKey(),
    owner: text("owner").notNull(),
    acquiredAt: integer("acquired_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    check("evidence_recovery_locks_name_check", sql`length(${table.name}) between 1 and 80`),
    check("evidence_recovery_locks_owner_check", sql`length(${table.owner}) = 36`),
    check("evidence_recovery_locks_acquired_at_check", sql`${table.acquiredAt} >= 0`),
    check("evidence_recovery_locks_expires_at_check", sql`${table.expiresAt} > ${table.acquiredAt}`),
  ],
);

export const transferChallenges = sqliteTable(
  "transfer_challenges",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    classId: text("class_id").notNull(),
    studentId: text("student_id").notNull(),
    revision: integer("revision").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    snapshotJson: text("snapshot_json", { mode: "json" }).$type<TransferChallengeSnapshot>().notNull(),
    status: text("status", { enum: transferStatuses }).notNull(),
    attemptCount: integer("attempt_count").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    uniqueIndex("transfer_challenges_project_unique").on(table.projectId),
    uniqueIndex("transfer_challenges_id_project_student_class_revision_unique")
      .on(table.id, table.projectId, table.studentId, table.classId, table.revision),
    uniqueIndex("transfer_challenges_id_project_student_class_unique")
      .on(table.id, table.projectId, table.studentId, table.classId),
    index("transfer_challenges_student_class_status_idx").on(table.studentId, table.classId, table.status),
    foreignKey({
      columns: [table.projectId, table.classId],
      foreignColumns: [projects.id, projects.classId],
      name: "transfer_challenges_project_class_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "transfer_challenges_student_class_fk",
    }).onDelete("restrict"),
    check("transfer_challenges_revision_check", sql`${table.revision} > 0`),
    check("transfer_challenges_hash_check", sql`length(${table.snapshotHash}) = 64 and ${table.snapshotHash} not glob '*[^0-9a-f]*'`),
    check("transfer_challenges_snapshot_bounds_check", transferSnapshotBoundsCheck(table.snapshotJson, table.projectId, table.revision, table.snapshotHash)),
    check("transfer_challenges_status_check", sql`${table.status} in ('OPEN', 'PASSED', 'LOCKED')`),
    check("transfer_challenges_attempt_count_check", sql`${table.attemptCount} between 0 and 2`),
    check("transfer_challenges_status_attempt_check", sql`(${table.status} = 'OPEN' and ${table.attemptCount} between 0 and 1) or (${table.status} = 'PASSED' and ${table.attemptCount} between 1 and 2) or (${table.status} = 'LOCKED' and ${table.attemptCount} = 2)`),
    check("transfer_challenges_snapshot_json_check", sql`coalesce((
      json_valid(${table.snapshotJson}) and json_type(${table.snapshotJson}) = 'object'
      and json_type(${table.snapshotJson}, '$.projectId') = 'text'
      and json_extract(${table.snapshotJson}, '$.projectId') = ${table.projectId}
      and json_type(${table.snapshotJson}, '$.challengeRevision') = 'integer'
      and json_extract(${table.snapshotJson}, '$.challengeRevision') = ${table.revision}
      and json_type(${table.snapshotJson}, '$.changedDimension') = 'text'
      and json_extract(${table.snapshotJson}, '$.changedDimension') in ('input', 'mapping', 'output')
      and json_type(${table.snapshotJson}, '$.prompt') = 'text'
      and json_type(${table.snapshotJson}, '$.mustRetain') = 'object'
      and json_type(${table.snapshotJson}, '$.mustRetain.culturalIntent') = 'text'
      and json_type(${table.snapshotJson}, '$.mustRetain.structure') = 'text'
      and json_type(${table.snapshotJson}, '$.mustRetain.input') = 'text'
      and json_type(${table.snapshotJson}, '$.mustRetain.mapping') = 'text'
      and json_type(${table.snapshotJson}, '$.mustRetain.output') = 'text'
      and json_type(${table.snapshotJson}, '$.change') = 'object'
      and json_type(${table.snapshotJson}, '$.change.candidateId') = 'text'
      and json_extract(${table.snapshotJson}, '$.change.dimension') = json_extract(${table.snapshotJson}, '$.changedDimension')
      and json_type(${table.snapshotJson}, '$.change.from') = 'text'
      and json_type(${table.snapshotJson}, '$.change.to') = 'text'
      and trim(json_extract(${table.snapshotJson}, '$.change.from')) <> trim(json_extract(${table.snapshotJson}, '$.change.to'))
      and json_type(${table.snapshotJson}, '$.unitPolicy') = 'object'
      and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceKind') in ('SOUND', 'DISTANCE', 'NORMALIZED', 'GENERIC')
      and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceUnit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
      and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges') = 'array'
      and json_array_length(${table.snapshotJson}, '$.unitPolicy.sourceRanges') between 1 and 4
      and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0]') = 'object'
      and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].unit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
      and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].minInclusive') in ('integer', 'real')
      and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].maxInclusive') in ('integer', 'real')
      and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].minInclusive') between -1000000 and 1000000
      and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].maxInclusive') between -1000000 and 1000000
      and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].minInclusive') < json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].maxInclusive')
      and (json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[1]') is null or (json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[1]') = 'object'
        and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[1].unit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
        and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[1].minInclusive') in ('integer', 'real') and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[1].maxInclusive') in ('integer', 'real')
        and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[1].minInclusive') between -1000000 and 1000000 and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[1].maxInclusive') between -1000000 and 1000000
        and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[1].minInclusive') < json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[1].maxInclusive')))
      and (json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[2]') is null or (json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[2]') = 'object'
        and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[2].unit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
        and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[2].minInclusive') in ('integer', 'real') and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[2].maxInclusive') in ('integer', 'real')
        and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[2].minInclusive') between -1000000 and 1000000 and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[2].maxInclusive') between -1000000 and 1000000
        and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[2].minInclusive') < json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[2].maxInclusive')))
      and (json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[3]') is null or (json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[3]') = 'object'
        and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[3].unit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
        and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[3].minInclusive') in ('integer', 'real') and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[3].maxInclusive') in ('integer', 'real')
        and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[3].minInclusive') between -1000000 and 1000000 and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[3].maxInclusive') between -1000000 and 1000000
        and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[3].minInclusive') < json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[3].maxInclusive')))
      and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceUnit') in (
        json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].unit'), json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[1].unit'),
        json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[2].unit'), json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[3].unit'))
      and json_type(${table.snapshotJson}, '$.unitPolicy.targetMin') in ('integer', 'real')
      and json_type(${table.snapshotJson}, '$.unitPolicy.targetMax') in ('integer', 'real')
      and json_extract(${table.snapshotJson}, '$.unitPolicy.targetMin') = 0
      and json_extract(${table.snapshotJson}, '$.unitPolicy.targetMax') = 1
      and json_extract(${table.snapshotJson}, '$.unitPolicy.targetUnit') = 'normalized'
      and json_type(${table.snapshotJson}, '$.unitPolicy.allowedRelationships') = 'array'
      and json_array_length(${table.snapshotJson}, '$.unitPolicy.allowedRelationships') between 1 and 4
      and json_extract(${table.snapshotJson}, '$.unitPolicy.allowedRelationships[0]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD')
      and (json_type(${table.snapshotJson}, '$.unitPolicy.allowedRelationships[1]') is null or json_extract(${table.snapshotJson}, '$.unitPolicy.allowedRelationships[1]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD'))
      and (json_type(${table.snapshotJson}, '$.unitPolicy.allowedRelationships[2]') is null or json_extract(${table.snapshotJson}, '$.unitPolicy.allowedRelationships[2]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD'))
      and (json_type(${table.snapshotJson}, '$.unitPolicy.allowedRelationships[3]') is null or json_extract(${table.snapshotJson}, '$.unitPolicy.allowedRelationships[3]') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD'))
      and json_type(${table.snapshotJson}, '$.culturalPolicy') = 'object'
      and json_type(${table.snapshotJson}, '$.culturalPolicy.intentAnchor') = 'object'
      and json_type(${table.snapshotJson}, '$.culturalPolicy.intentAnchor.id') = 'text'
      and length(json_extract(${table.snapshotJson}, '$.culturalPolicy.intentAnchor.id')) = 23
      and substr(json_extract(${table.snapshotJson}, '$.culturalPolicy.intentAnchor.id'), 1, 7) = 'intent_'
      and substr(json_extract(${table.snapshotJson}, '$.culturalPolicy.intentAnchor.id'), 8) not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.culturalPolicy.intentAnchor.label') = 'text'
      and length(trim(json_extract(${table.snapshotJson}, '$.culturalPolicy.intentAnchor.label'))) between 2 and 500
      and json_type(${table.snapshotJson}, '$.culturalPolicy.allowedAudienceTypes') = 'array'
      and json_array_length(${table.snapshotJson}, '$.culturalPolicy.allowedAudienceTypes') = 4
      and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedAudienceTypes[0]') in ('GENERAL_VISITORS', 'YOUNG_LEARNERS', 'COMMUNITY_MEMBERS', 'CULTURAL_HERITAGE_AUDIENCE')
      and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedAudienceTypes[1]') in ('GENERAL_VISITORS', 'YOUNG_LEARNERS', 'COMMUNITY_MEMBERS', 'CULTURAL_HERITAGE_AUDIENCE')
      and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedAudienceTypes[2]') in ('GENERAL_VISITORS', 'YOUNG_LEARNERS', 'COMMUNITY_MEMBERS', 'CULTURAL_HERITAGE_AUDIENCE')
      and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedAudienceTypes[3]') in ('GENERAL_VISITORS', 'YOUNG_LEARNERS', 'COMMUNITY_MEMBERS', 'CULTURAL_HERITAGE_AUDIENCE')
      and json_type(${table.snapshotJson}, '$.culturalPolicy.allowedTransitions') = 'array'
      and json_array_length(${table.snapshotJson}, '$.culturalPolicy.allowedTransitions') = 3
      and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedTransitions[0].before') = 'PASSIVE_VIEWING'
      and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedTransitions[0].after') = 'ACTIVE_EXPLORATION'
      and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedTransitions[1].before') = 'FOLLOWING_INSTRUCTIONS'
      and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedTransitions[1].after') = 'COLLABORATIVE_CREATION'
      and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedTransitions[2].before') = 'INDIVIDUAL_INTERACTION'
      and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedTransitions[2].after') = 'REFLECTIVE_SHARING'
      and json_type(${table.snapshotJson}, '$.culturalPolicy.allowedMechanisms') = 'array'
      and json_array_length(${table.snapshotJson}, '$.culturalPolicy.allowedMechanisms') = 2
      and ((json_extract(${table.snapshotJson}, '$.changedDimension') = 'input'
        and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedMechanisms[0]') in ('PARTICIPATORY_TRIGGER', 'COLLECTIVE_RESPONSE')
        and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedMechanisms[1]') in ('PARTICIPATORY_TRIGGER', 'COLLECTIVE_RESPONSE'))
        or (json_extract(${table.snapshotJson}, '$.changedDimension') = 'mapping'
        and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedMechanisms[0]') = 'NARRATIVE_MAPPING'
        and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedMechanisms[1]') = 'COLLECTIVE_RESPONSE')
        or (json_extract(${table.snapshotJson}, '$.changedDimension') = 'output'
        and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedMechanisms[0]') = 'SENSORY_FEEDBACK'
        and json_extract(${table.snapshotJson}, '$.culturalPolicy.allowedMechanisms[1]') = 'CULTURAL_SYMBOL_REINFORCEMENT'))
      and json_extract(${table.snapshotJson}, '$.path') in ('DIGISHOW', 'TOUCHDESIGNER', 'COLLABORATIVE')
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot') = 'array'
      and json_array_length(${table.snapshotJson}, '$.verifiedEvidenceSnapshot') = 5
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].layer') = 'INPUT'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].code') = 'INPUT_OK'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].layer') = 'MAPPING'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].code') = 'MAPPING_OK'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].layer') = 'TRANSPORT'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].code') = 'TRANSPORT_OK'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].layer') = 'BINDING'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].code') = 'BINDING_OK'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].layer') = 'OUTPUT'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].code') = 'OUTPUT_OK'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceHash') = 'text'
      and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceHash')) = 64
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceHash') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].sequence') = 'integer' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].sequence') > 0
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].sequence') = 'integer' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].sequence') > 0
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].sequence') = 'integer' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].sequence') > 0
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].sequence') = 'integer' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].sequence') > 0
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].sequence') = 'integer' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].sequence') > 0
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id')) = 36 and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id'),9,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id'),14,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id'),19,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id'),24,1)='-' and replace(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id'),'-','') not glob '*[^0-9a-f]*'
      and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id')) = 36 and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id'),9,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id'),14,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id'),19,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id'),24,1)='-' and replace(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id'),'-','') not glob '*[^0-9a-f]*'
      and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id')) = 36 and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id'),9,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id'),14,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id'),19,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id'),24,1)='-' and replace(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id'),'-','') not glob '*[^0-9a-f]*'
      and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id')) = 36 and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id'),9,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id'),14,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id'),19,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id'),24,1)='-' and replace(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id'),'-','') not glob '*[^0-9a-f]*'
      and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id')) = 36 and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id'),9,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id'),14,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id'),19,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id'),24,1)='-' and replace(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].digest') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].digest')) = 64 and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].digest') not glob '*[^0-9a-f]*'
      and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].digest')) = 64 and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].digest') not glob '*[^0-9a-f]*'
      and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].digest')) = 64 and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].digest') not glob '*[^0-9a-f]*'
      and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].digest')) = 64 and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].digest') not glob '*[^0-9a-f]*'
      and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].digest')) = 64 and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].digest') not glob '*[^0-9a-f]*'
      and json_extract(${table.snapshotJson}, '$.snapshotHash') = ${table.snapshotHash}
    ), 0)`),
  ],
);

export const transferChallengeRevisions = sqliteTable(
  "transfer_challenge_revisions",
  {
    challengeId: text("challenge_id").notNull(),
    projectId: text("project_id").notNull(),
    classId: text("class_id").notNull(),
    studentId: text("student_id").notNull(),
    revision: integer("revision").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    snapshotJson: text("snapshot_json", { mode: "json" }).$type<TransferChallengeSnapshot>().notNull(),
    status: text("status", { enum: transferStatuses }).notNull(),
    attemptCount: integer("attempt_count").notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    uniqueIndex("transfer_challenge_revisions_challenge_revision_unique").on(table.challengeId, table.revision),
    index("transfer_challenge_revisions_project_revision_idx").on(table.projectId, table.revision),
    foreignKey({
      columns: [table.challengeId, table.projectId, table.studentId, table.classId],
      foreignColumns: [transferChallenges.id, transferChallenges.projectId, transferChallenges.studentId, transferChallenges.classId],
      name: "transfer_challenge_revisions_active_owner_fk",
    }).onDelete("cascade"),
    check("transfer_challenge_revisions_revision_check", sql`${table.revision} > 0`),
    check("transfer_challenge_revisions_hash_check", sql`length(${table.snapshotHash}) = 64 and ${table.snapshotHash} not glob '*[^0-9a-f]*'`),
    check("transfer_challenge_revisions_snapshot_bounds_check", transferSnapshotBoundsCheck(table.snapshotJson, table.projectId, table.revision, table.snapshotHash)),
    check("transfer_challenge_revisions_status_check", sql`${table.status} in ('OPEN', 'PASSED', 'LOCKED')`),
    check("transfer_challenge_revisions_attempt_count_check", sql`${table.attemptCount} between 0 and 2`),
    check("transfer_challenge_revisions_snapshot_check", sql`coalesce((json_valid(${table.snapshotJson}) and json_type(${table.snapshotJson}) = 'object'
      and json_extract(${table.snapshotJson}, '$.projectId') = ${table.projectId}
      and json_extract(${table.snapshotJson}, '$.challengeRevision') = ${table.revision}
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot') = 'array'
      and json_array_length(${table.snapshotJson}, '$.verifiedEvidenceSnapshot') = 5
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].layer') = 'INPUT' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].code') = 'INPUT_OK'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].layer') = 'MAPPING' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].code') = 'MAPPING_OK'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].layer') = 'TRANSPORT' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].code') = 'TRANSPORT_OK'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].layer') = 'BINDING' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].code') = 'BINDING_OK'
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].layer') = 'OUTPUT' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].code') = 'OUTPUT_OK'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceHash') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceHash')) = 64
      and json_extract(${table.snapshotJson}, '$.verifiedEvidenceHash') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].sequence') = 'integer' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].sequence') > 0
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].sequence') = 'integer' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].sequence') > 0
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].sequence') = 'integer' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].sequence') > 0
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].sequence') = 'integer' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].sequence') > 0
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].sequence') = 'integer' and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].sequence') > 0
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id')) = 36 and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id'),9,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id'),14,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id'),19,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id'),24,1)='-' and replace(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id')) = 36 and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id'),9,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id'),14,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id'),19,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id'),24,1)='-' and replace(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id')) = 36 and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id'),9,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id'),14,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id'),19,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id'),24,1)='-' and replace(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id')) = 36 and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id'),9,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id'),14,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id'),19,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id'),24,1)='-' and replace(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id')) = 36 and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id'),9,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id'),14,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id'),19,1)='-' and substr(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id'),24,1)='-' and replace(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].id'),'-','') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].digest') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].digest')) = 64 and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[0].digest') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].digest') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].digest')) = 64 and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[1].digest') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].digest') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].digest')) = 64 and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[2].digest') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].digest') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].digest')) = 64 and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[3].digest') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].digest') = 'text' and length(json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].digest')) = 64 and json_extract(${table.snapshotJson}, '$.verifiedEvidenceSnapshot[4].digest') not glob '*[^0-9a-f]*'
      and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges') = 'array' and json_array_length(${table.snapshotJson}, '$.unitPolicy.sourceRanges') between 1 and 4
      and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0]') = 'object'
      and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].unit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
      and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].minInclusive') in ('integer', 'real') and json_type(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].maxInclusive') in ('integer', 'real')
      and json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].minInclusive') < json_extract(${table.snapshotJson}, '$.unitPolicy.sourceRanges[0].maxInclusive')
      and json_extract(${table.snapshotJson}, '$.snapshotHash') = ${table.snapshotHash}), 0)`),
  ],
);

export const transferAttempts = sqliteTable(
  "transfer_attempts",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id").notNull(),
    projectId: text("project_id").notNull(),
    classId: text("class_id").notNull(),
    studentId: text("student_id").notNull(),
    challengeRevision: integer("challenge_revision").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    responseJson: text("response_json", { mode: "json" }).$type<TransferAnswer>().notNull(),
    rubricJson: text("rubric_json", { mode: "json" }).$type<TransferRubric>().notNull(),
    passed: integer("passed", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    uniqueIndex("transfer_attempts_challenge_attempt_unique").on(table.challengeId, table.attemptNumber),
    index("transfer_attempts_student_class_project_idx").on(table.studentId, table.classId, table.projectId),
    foreignKey({
      columns: [table.challengeId, table.projectId, table.studentId, table.classId],
      foreignColumns: [transferChallenges.id, transferChallenges.projectId, transferChallenges.studentId, transferChallenges.classId],
      name: "transfer_attempts_challenge_owner_fk",
    }).onDelete("cascade"),
    check("transfer_attempts_revision_check", sql`${table.challengeRevision} > 0`),
    check("transfer_attempts_number_check", sql`${table.attemptNumber} between 1 and 2`),
    check("transfer_attempts_passed_check", sql`${table.passed} in (0, 1)`),
    check("transfer_attempts_response_json_check", sql`coalesce((
      json_valid(${table.responseJson}) and json_type(${table.responseJson}) = 'object'
      and json_type(${table.responseJson}, '$.retainedStructure') = 'object'
      and json_type(${table.responseJson}, '$.retainedStructure.culturalIntent') = 'text'
      and length(trim(json_extract(${table.responseJson}, '$.retainedStructure.culturalIntent'))) between 2 and 500
      and json_type(${table.responseJson}, '$.retainedStructure.input') = 'text'
      and length(trim(json_extract(${table.responseJson}, '$.retainedStructure.input'))) between 2 and 500
      and json_type(${table.responseJson}, '$.retainedStructure.mapping') = 'text'
      and length(trim(json_extract(${table.responseJson}, '$.retainedStructure.mapping'))) between 2 and 500
      and json_type(${table.responseJson}, '$.retainedStructure.output') = 'text'
      and length(trim(json_extract(${table.responseJson}, '$.retainedStructure.output'))) between 2 and 500
      and json_type(${table.responseJson}, '$.changedParts') = 'object'
      and json_extract(${table.responseJson}, '$.changedParts.dimension') in ('input', 'mapping', 'output')
      and json_type(${table.responseJson}, '$.changedParts.from') = 'text'
      and length(trim(json_extract(${table.responseJson}, '$.changedParts.from'))) between 2 and 500
      and json_type(${table.responseJson}, '$.changedParts.to') = 'text'
      and length(trim(json_extract(${table.responseJson}, '$.changedParts.to'))) between 2 and 500
      and trim(json_extract(${table.responseJson}, '$.changedParts.from')) <> trim(json_extract(${table.responseJson}, '$.changedParts.to'))
      and (json_type(${table.responseJson}, '$.changedParts.rationale') is null or (json_type(${table.responseJson}, '$.changedParts.rationale') = 'text'
        and length(trim(json_extract(${table.responseJson}, '$.changedParts.rationale'))) between 10 and 300))
      and json_type(${table.responseJson}, '$.normalization') = 'object'
      and json_type(${table.responseJson}, '$.normalization.sourceMin') in ('integer', 'real')
      and json_type(${table.responseJson}, '$.normalization.sourceMax') in ('integer', 'real')
      and json_extract(${table.responseJson}, '$.normalization.sourceMin') between -1000000 and 1000000
      and json_extract(${table.responseJson}, '$.normalization.sourceMax') between -1000000 and 1000000
      and json_extract(${table.responseJson}, '$.normalization.sourceMin') < json_extract(${table.responseJson}, '$.normalization.sourceMax')
      and json_extract(${table.responseJson}, '$.normalization.sourceUnit') in ('dB', 'mm', 'cm', 'm', 'normalized', 'raw')
      and json_type(${table.responseJson}, '$.normalization.targetMin') in ('integer', 'real')
      and json_type(${table.responseJson}, '$.normalization.targetMax') in ('integer', 'real')
      and json_extract(${table.responseJson}, '$.normalization.targetMin') = 0
      and json_extract(${table.responseJson}, '$.normalization.targetMax') = 1
      and json_extract(${table.responseJson}, '$.normalization.targetUnit') = 'normalized'
      and json_extract(${table.responseJson}, '$.normalization.relationship') in ('LINEAR', 'DIRECT', 'INVERSE', 'THRESHOLD')
      and json_type(${table.responseJson}, '$.culturalImpact') = 'object'
      and json_extract(${table.responseJson}, '$.culturalImpact.audienceType') in ('GENERAL_VISITORS', 'YOUNG_LEARNERS', 'COMMUNITY_MEMBERS', 'CULTURAL_HERITAGE_AUDIENCE')
      and json_extract(${table.responseJson}, '$.culturalImpact.behaviorBefore') in ('PASSIVE_VIEWING', 'FOLLOWING_INSTRUCTIONS', 'INDIVIDUAL_INTERACTION', 'ACTIVE_EXPLORATION', 'COLLABORATIVE_CREATION', 'REFLECTIVE_SHARING')
      and json_extract(${table.responseJson}, '$.culturalImpact.behaviorAfter') in ('PASSIVE_VIEWING', 'FOLLOWING_INSTRUCTIONS', 'INDIVIDUAL_INTERACTION', 'ACTIVE_EXPLORATION', 'COLLABORATIVE_CREATION', 'REFLECTIVE_SHARING')
      and json_extract(${table.responseJson}, '$.culturalImpact.behaviorBefore') <> json_extract(${table.responseJson}, '$.culturalImpact.behaviorAfter')
      and json_type(${table.responseJson}, '$.culturalImpact.intentAnchorId') = 'text'
      and length(json_extract(${table.responseJson}, '$.culturalImpact.intentAnchorId')) = 23
      and substr(json_extract(${table.responseJson}, '$.culturalImpact.intentAnchorId'), 1, 7) = 'intent_'
      and substr(json_extract(${table.responseJson}, '$.culturalImpact.intentAnchorId'), 8) not glob '*[^0-9a-f]*'
      and json_extract(${table.responseJson}, '$.culturalImpact.mechanism') in ('PARTICIPATORY_TRIGGER', 'COLLECTIVE_RESPONSE', 'NARRATIVE_MAPPING', 'SENSORY_FEEDBACK', 'CULTURAL_SYMBOL_REINFORCEMENT')
      and (json_type(${table.responseJson}, '$.culturalImpact.reflection') is null
        or (json_type(${table.responseJson}, '$.culturalImpact.reflection') = 'text'
        and length(trim(json_extract(${table.responseJson}, '$.culturalImpact.reflection'))) between 4 and 300))
    ), 0)`),
    check("transfer_attempts_rubric_json_check", sql`coalesce((
      json_valid(${table.rubricJson}) and json_type(${table.rubricJson}) = 'object'
      and json_type(${table.rubricJson}, '$.criteria') = 'object'
      and json_type(${table.rubricJson}, '$.criteria.retainedStructure') = 'object'
      and json_type(${table.rubricJson}, '$.criteria.retainedStructure.passed') in ('true', 'false')
      and ((json_extract(${table.rubricJson}, '$.criteria.retainedStructure.passed') = 1 and json_extract(${table.rubricJson}, '$.criteria.retainedStructure.reasonCode') = 'RETAINED_MATCH')
        or (json_extract(${table.rubricJson}, '$.criteria.retainedStructure.passed') = 0 and json_extract(${table.rubricJson}, '$.criteria.retainedStructure.reasonCode') = 'RETAINED_MISMATCH'))
      and json_type(${table.rubricJson}, '$.criteria.changedParts') = 'object'
      and json_type(${table.rubricJson}, '$.criteria.changedParts.passed') in ('true', 'false')
      and ((json_extract(${table.rubricJson}, '$.criteria.changedParts.passed') = 1 and json_extract(${table.rubricJson}, '$.criteria.changedParts.reasonCode') = 'CHANGE_TARGETED')
        or (json_extract(${table.rubricJson}, '$.criteria.changedParts.passed') = 0 and json_extract(${table.rubricJson}, '$.criteria.changedParts.reasonCode') = 'CHANGE_MISMATCH'))
      and json_type(${table.rubricJson}, '$.criteria.normalization') = 'object'
      and json_type(${table.rubricJson}, '$.criteria.normalization.passed') in ('true', 'false')
      and ((json_extract(${table.rubricJson}, '$.criteria.normalization.passed') = 1 and json_extract(${table.rubricJson}, '$.criteria.normalization.reasonCode') = 'NORMALIZATION_VALID')
        or (json_extract(${table.rubricJson}, '$.criteria.normalization.passed') = 0 and json_extract(${table.rubricJson}, '$.criteria.normalization.reasonCode') in ('NORMALIZATION_INVALID_UNIT', 'NORMALIZATION_INVALID_RANGE', 'NORMALIZATION_INVALID_RELATIONSHIP')))
      and json_type(${table.rubricJson}, '$.criteria.culturalImpact') = 'object'
      and json_type(${table.rubricJson}, '$.criteria.culturalImpact.passed') in ('true', 'false')
      and ((json_extract(${table.rubricJson}, '$.criteria.culturalImpact.passed') = 1 and json_extract(${table.rubricJson}, '$.criteria.culturalImpact.reasonCode') = 'CULTURAL_CONCRETE')
        or (json_extract(${table.rubricJson}, '$.criteria.culturalImpact.passed') = 0 and json_extract(${table.rubricJson}, '$.criteria.culturalImpact.reasonCode') in ('CULTURAL_INVALID_ANCHOR', 'CULTURAL_INVALID_TRANSITION', 'CULTURAL_INVALID_MECHANISM')))
      and json_type(${table.rubricJson}, '$.score') = 'integer'
      and json_extract(${table.rubricJson}, '$.score') between 0 and 4
      and json_type(${table.rubricJson}, '$.passed') in ('true', 'false')
      and json_extract(${table.rubricJson}, '$.passed') = ${table.passed}
      and json_extract(${table.rubricJson}, '$.score') = (json_extract(${table.rubricJson}, '$.criteria.retainedStructure.passed') + json_extract(${table.rubricJson}, '$.criteria.changedParts.passed') + json_extract(${table.rubricJson}, '$.criteria.normalization.passed') + json_extract(${table.rubricJson}, '$.criteria.culturalImpact.passed'))
      and json_extract(${table.rubricJson}, '$.passed') = (json_extract(${table.rubricJson}, '$.score') = 4)
      and json_extract(${table.rubricJson}, '$.outcome') in ('RETRY', 'PASSED', 'LOCKED')
      and ((json_extract(${table.rubricJson}, '$.passed') = 1 and json_extract(${table.rubricJson}, '$.outcome') = 'PASSED')
        or (json_extract(${table.rubricJson}, '$.passed') = 0 and json_extract(${table.rubricJson}, '$.outcome') in ('RETRY', 'LOCKED')))
      and (json_extract(${table.rubricJson}, '$.outcome') <> 'LOCKED' or ${table.attemptNumber} = 2)
      and json_type(${table.rubricJson}, '$.feedback') = 'object'
      and json_type(${table.rubricJson}, '$.feedback.retained') in ('true', 'false')
      and json_extract(${table.rubricJson}, '$.feedback.retained') = (1 - json_extract(${table.rubricJson}, '$.criteria.retainedStructure.passed'))
      and json_type(${table.rubricJson}, '$.feedback.changed') in ('true', 'false')
      and json_extract(${table.rubricJson}, '$.feedback.changed') = (1 - json_extract(${table.rubricJson}, '$.criteria.changedParts.passed'))
      and json_type(${table.rubricJson}, '$.feedback.normalization') in ('true', 'false')
      and json_extract(${table.rubricJson}, '$.feedback.normalization') = (1 - json_extract(${table.rubricJson}, '$.criteria.normalization.passed'))
      and json_type(${table.rubricJson}, '$.feedback.cultural') in ('true', 'false')
      and json_extract(${table.rubricJson}, '$.feedback.cultural') = (1 - json_extract(${table.rubricJson}, '$.criteria.culturalImpact.passed'))
      and json_type(${table.rubricJson}, '$.feedback.teacherReview') in ('true', 'false')
      and json_extract(${table.rubricJson}, '$.feedback.teacherReview') = (json_extract(${table.rubricJson}, '$.outcome') = 'LOCKED')
      and (json_type(${table.rubricJson}, '$.feedback.aiCode') = 'null'
        or (json_type(${table.rubricJson}, '$.feedback.aiCode') = 'text' and json_extract(${table.rubricJson}, '$.feedback.aiCode') in ('COHERENCE_NOTE', 'CLARITY_NOTE')))
    ), 0)`),
  ],
);

export const knowledgeChunks = sqliteTable(
  "knowledge_chunks",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    content: text("content").notNull(),
    coursePackId: text("course_pack_id").notNull().default("digital-interaction"),
    coursePackVersion: text("course_pack_version").notNull().default("1"),
    namespace: text("namespace").notNull().default("interaction-principles"),
    authority: text("authority", { enum: ["OFFICIAL", "COURSE_DESIGN", "TEACHER_EXPERIENCE", "ANONYMIZED_CASE"] }).notNull().default("COURSE_DESIGN"),
    contentHash: text("content_hash").notNull().default("0".repeat(64)),
    verifiedDate: text("verified_date").notNull().default("2026-07-14"),
  },
  (table) => [
    uniqueIndex("knowledge_chunks_pack_source_unique").on(table.coursePackId, table.coursePackVersion, table.id),
    index("knowledge_chunks_pack_namespace_idx").on(table.coursePackId, table.coursePackVersion, table.namespace),
    check("knowledge_chunks_tags_json_check", sql`json_valid(${table.tags})`),
    check("knowledge_chunks_hash_check", sql`length(${table.contentHash}) = 64 and ${table.contentHash} not glob '*[^0-9a-f]*'`),
  ],
);

export const knowledgeCorporaV2 = sqliteTable(
  "knowledge_corpora_v2",
  {
    bundleHash: text("bundle_hash").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    corpusVersion: text("corpus_version").notNull(),
    parserId: text("parser_id").notNull(),
    parserVersion: text("parser_version").notNull(),
    contentVersion: text("content_version").notNull(),
    objectCount: integer("object_count").notNull(),
    assetCount: integer("asset_count").notNull(),
    canonicalJson: text("canonical_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_corpora_v2_version_unique").on(table.corpusVersion),
    check("knowledge_corpora_v2_schema_check", sql`${table.schemaVersion} = 2`),
    check("knowledge_corpora_v2_hash_check", sql`length(${table.bundleHash}) = 64 and ${table.bundleHash} not glob '*[^0-9a-f]*'`),
    check("knowledge_corpora_v2_counts_check", sql`${table.objectCount} >= 0 and ${table.assetCount} >= 0`),
    check("knowledge_corpora_v2_json_check", sql`json_valid(${table.canonicalJson}) and json_type(${table.canonicalJson}) = 'object'`),
  ],
);

export const knowledgeActiveCorpusV2 = sqliteTable(
  "knowledge_active_corpus_v2",
  {
    id: integer("id").primaryKey(),
    bundleHash: text("bundle_hash").notNull().unique().references(() => knowledgeCorporaV2.bundleHash, { onDelete: "restrict" }),
    activatedAt: integer("activated_at").notNull(),
  },
  (table) => [
    check("knowledge_active_corpus_v2_singleton_check", sql`${table.id} = 1`),
  ],
);

export const knowledgeDocumentsV2 = sqliteTable(
  "knowledge_documents_v2",
  {
    corpusHash: text("corpus_hash").notNull().references(() => knowledgeCorporaV2.bundleHash, { onDelete: "cascade" }),
    id: text("id").notNull(),
    title: text("title").notNull(),
    topic: text("topic").notNull(),
    tagsJson: text("tags_json", { mode: "json" }).$type<string[]>().notNull(),
    sourceCoursePackId: text("source_course_pack_id").notNull(),
    sourceCoursePackVersion: text("source_course_pack_version").notNull(),
    sourceIdentityBasis: text("source_identity_basis").notNull(),
    legacyCoursePackId: text("legacy_course_pack_id").notNull(),
    legacyCoursePackVersion: text("legacy_course_pack_version").notNull(),
    legacyNamespace: text("legacy_namespace").notNull(),
    provenanceJson: text("provenance_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    parserId: text("parser_id").notNull(),
    parserVersion: text("parser_version").notNull(),
    contentVersion: text("content_version").notNull(),
    rootNodeId: text("root_node_id").notNull(),
    contentHash: text("content_hash").notNull(),
    annotationHash: text("annotation_hash").notNull(),
    legacyItemJson: text("legacy_item_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    canonicalJson: text("canonical_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.corpusHash, table.id], name: "knowledge_documents_v2_pk" }),
    index("knowledge_documents_v2_source_pack_idx").on(
      table.corpusHash,
      table.sourceCoursePackId,
      table.sourceCoursePackVersion,
    ),
    index("knowledge_documents_v2_legacy_pack_idx").on(
      table.corpusHash,
      table.legacyCoursePackId,
      table.legacyCoursePackVersion,
    ),
    check("knowledge_documents_v2_tags_json_check", sql`json_valid(${table.tagsJson}) and json_type(${table.tagsJson}) = 'array'`),
    check("knowledge_documents_v2_provenance_json_check", sql`json_valid(${table.provenanceJson}) and json_type(${table.provenanceJson}) = 'object'`),
    check("knowledge_documents_v2_legacy_json_check", sql`json_valid(${table.legacyItemJson}) and json_type(${table.legacyItemJson}) = 'object'`),
    check("knowledge_documents_v2_canonical_json_check", sql`json_valid(${table.canonicalJson}) and json_type(${table.canonicalJson}) = 'object'`),
    check("knowledge_documents_v2_hashes_check", sql`
      length(${table.contentHash}) = 64 and ${table.contentHash} not glob '*[^0-9a-f]*'
      and length(${table.annotationHash}) = 64 and ${table.annotationHash} not glob '*[^0-9a-f]*'
    `),
  ],
);

export const knowledgeAssetsV2 = sqliteTable(
  "knowledge_assets_v2",
  {
    corpusHash: text("corpus_hash").notNull().references(() => knowledgeCorporaV2.bundleHash, { onDelete: "cascade" }),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    locatorRoot: text("locator_root").notNull(),
    locatorPath: text("locator_path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    widthPx: integer("width_px").notNull(),
    heightPx: integer("height_px").notNull(),
    sha256: text("sha256").notNull(),
    explicitlyUnreferenced: integer("explicitly_unreferenced", { mode: "boolean" }).notNull(),
    canonicalJson: text("canonical_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.corpusHash, table.id], name: "knowledge_assets_v2_pk" }),
    uniqueIndex("knowledge_assets_v2_corpus_path_unique").on(table.corpusHash, table.locatorRoot, table.locatorPath),
    index("knowledge_assets_v2_hash_idx").on(table.sha256),
    check("knowledge_assets_v2_kind_check", sql`${table.kind} = 'IMAGE'`),
    check("knowledge_assets_v2_mime_check", sql`${table.mimeType} = 'image/png'`),
    check("knowledge_assets_v2_size_check", sql`${table.sizeBytes} > 0 and ${table.widthPx} > 0 and ${table.heightPx} > 0`),
    check("knowledge_assets_v2_hash_check", sql`length(${table.sha256}) = 64 and ${table.sha256} not glob '*[^0-9a-f]*'`),
    check("knowledge_assets_v2_unreferenced_check", sql`${table.explicitlyUnreferenced} in (0,1)`),
    check("knowledge_assets_v2_json_check", sql`json_valid(${table.canonicalJson}) and json_type(${table.canonicalJson}) = 'object'`),
  ],
);

export const knowledgeDocumentAssetsV2 = sqliteTable(
  "knowledge_document_assets_v2",
  {
    corpusHash: text("corpus_hash").notNull(),
    documentId: text("document_id").notNull(),
    assetId: text("asset_id").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.corpusHash, table.documentId, table.assetId],
      name: "knowledge_document_assets_v2_pk",
    }),
    uniqueIndex("knowledge_document_assets_v2_document_ordinal_unique").on(
      table.corpusHash,
      table.documentId,
      table.ordinal,
    ),
    foreignKey({
      columns: [table.corpusHash, table.documentId],
      foreignColumns: [knowledgeDocumentsV2.corpusHash, knowledgeDocumentsV2.id],
      name: "knowledge_document_assets_v2_document_corpus_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.corpusHash, table.assetId],
      foreignColumns: [knowledgeAssetsV2.corpusHash, knowledgeAssetsV2.id],
      name: "knowledge_document_assets_v2_asset_corpus_fk",
    }).onDelete("cascade"),
    check("knowledge_document_assets_v2_ordinal_check", sql`${table.ordinal} >= 0`),
  ],
);

export const knowledgeNodesV2 = sqliteTable(
  "knowledge_nodes_v2",
  {
    corpusHash: text("corpus_hash").notNull(),
    id: text("id").notNull(),
    documentId: text("document_id").notNull(),
    kind: text("kind").notNull(),
    assetId: text("asset_id"),
    contentHash: text("content_hash").notNull(),
    canonicalJson: text("canonical_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.corpusHash, table.id], name: "knowledge_nodes_v2_pk" }),
    index("knowledge_nodes_v2_document_kind_idx").on(table.corpusHash, table.documentId, table.kind),
    foreignKey({
      columns: [table.corpusHash, table.documentId],
      foreignColumns: [knowledgeDocumentsV2.corpusHash, knowledgeDocumentsV2.id],
      name: "knowledge_nodes_v2_document_corpus_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.corpusHash, table.assetId],
      foreignColumns: [knowledgeAssetsV2.corpusHash, knowledgeAssetsV2.id],
      name: "knowledge_nodes_v2_asset_corpus_fk",
    }).onDelete("restrict"),
    check("knowledge_nodes_v2_kind_check", sql`${table.kind} in ('DOCUMENT','SECTION','TEXT','IMAGE','TABLE','REGION')`),
    check("knowledge_nodes_v2_asset_kind_check", sql`
      (${table.kind} in ('IMAGE','REGION') and ${table.assetId} is not null)
      or (${table.kind} not in ('IMAGE','REGION') and ${table.assetId} is null)
    `),
    check("knowledge_nodes_v2_json_check", sql`json_valid(${table.canonicalJson}) and json_type(${table.canonicalJson}) = 'object'`),
    check("knowledge_nodes_v2_hash_check", sql`length(${table.contentHash}) = 64 and ${table.contentHash} not glob '*[^0-9a-f]*'`),
  ],
);

export const knowledgeNodeRelationsV2 = sqliteTable(
  "knowledge_node_relations_v2",
  {
    corpusHash: text("corpus_hash").notNull(),
    sourceNodeId: text("source_node_id").notNull(),
    targetNodeId: text("target_node_id").notNull(),
    kind: text("kind").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.corpusHash,
        table.sourceNodeId,
        table.kind,
        table.targetNodeId,
      ],
      name: "knowledge_node_relations_v2_pk",
    }),
    uniqueIndex("knowledge_node_relations_v2_parent_target_unique")
      .on(table.corpusHash, table.targetNodeId)
      .where(sql`${table.kind} = 'PARENT_CHILD'`),
    uniqueIndex("knowledge_node_relations_v2_source_ordinal_unique").on(
      table.corpusHash,
      table.sourceNodeId,
      table.kind,
      table.ordinal,
    ),
    foreignKey({
      columns: [table.corpusHash, table.sourceNodeId],
      foreignColumns: [knowledgeNodesV2.corpusHash, knowledgeNodesV2.id],
      name: "knowledge_node_relations_v2_source_corpus_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.corpusHash, table.targetNodeId],
      foreignColumns: [knowledgeNodesV2.corpusHash, knowledgeNodesV2.id],
      name: "knowledge_node_relations_v2_target_corpus_fk",
    }).onDelete("cascade"),
    check("knowledge_node_relations_v2_kind_check", sql`${table.kind} in ('PARENT_CHILD','RELATED')`),
    check("knowledge_node_relations_v2_self_check", sql`${table.sourceNodeId} <> ${table.targetNodeId}`),
    check("knowledge_node_relations_v2_ordinal_check", sql`${table.ordinal} >= 0`),
  ],
);

export const knowledgeAnnotationsV2 = sqliteTable(
  "knowledge_annotations_v2",
  {
    corpusHash: text("corpus_hash").notNull(),
    id: text("id").notNull(),
    documentId: text("document_id").notNull(),
    targetNodeId: text("target_node_id").notNull(),
    kind: text("kind").notNull(),
    origin: text("origin").notNull(),
    producerId: text("producer_id").notNull(),
    producerVersion: text("producer_version").notNull(),
    modelId: text("model_id"),
    modelRevision: text("model_revision"),
    annotationHash: text("annotation_hash").notNull(),
    canonicalJson: text("canonical_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.corpusHash, table.id], name: "knowledge_annotations_v2_pk" }),
    index("knowledge_annotations_v2_target_idx").on(table.corpusHash, table.targetNodeId, table.kind),
    foreignKey({
      columns: [table.corpusHash, table.documentId],
      foreignColumns: [knowledgeDocumentsV2.corpusHash, knowledgeDocumentsV2.id],
      name: "knowledge_annotations_v2_document_corpus_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.corpusHash, table.targetNodeId],
      foreignColumns: [knowledgeNodesV2.corpusHash, knowledgeNodesV2.id],
      name: "knowledge_annotations_v2_target_corpus_fk",
    }).onDelete("cascade"),
    check("knowledge_annotations_v2_kind_check", sql`${table.kind} in ('CAPTION','OCR','VISUAL_TAGS')`),
    check("knowledge_annotations_v2_origin_check", sql`${table.origin} in ('SOURCE','MODEL_DERIVED','HUMAN_REVIEWED')`),
    check("knowledge_annotations_v2_model_pair_check", sql`
      (${table.modelId} is null and ${table.modelRevision} is null)
      or (${table.modelId} is not null and ${table.modelRevision} is not null)
    `),
    check("knowledge_annotations_v2_json_check", sql`json_valid(${table.canonicalJson}) and json_type(${table.canonicalJson}) = 'object'`),
    check("knowledge_annotations_v2_hash_check", sql`length(${table.annotationHash}) = 64 and ${table.annotationHash} not glob '*[^0-9a-f]*'`),
  ],
);

export const knowledgeAnnotationInputsV2 = sqliteTable(
  "knowledge_annotation_inputs_v2",
  {
    corpusHash: text("corpus_hash").notNull(),
    annotationId: text("annotation_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").notNull(),
    inputHash: text("input_hash").notNull(),
    assetId: text("asset_id"),
    canonicalJson: text("canonical_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.corpusHash, table.annotationId, table.ordinal],
      name: "knowledge_annotation_inputs_v2_pk",
    }),
    foreignKey({
      columns: [table.corpusHash, table.annotationId],
      foreignColumns: [knowledgeAnnotationsV2.corpusHash, knowledgeAnnotationsV2.id],
      name: "knowledge_annotation_inputs_v2_annotation_corpus_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.corpusHash, table.assetId],
      foreignColumns: [knowledgeAssetsV2.corpusHash, knowledgeAssetsV2.id],
      name: "knowledge_annotation_inputs_v2_asset_corpus_fk",
    }).onDelete("restrict"),
    check("knowledge_annotation_inputs_v2_ordinal_check", sql`${table.ordinal} >= 0`),
    check("knowledge_annotation_inputs_v2_kind_check", sql`${table.kind} in ('SOURCE_DOCUMENT','SOURCE_SECTION','ASSET')`),
    check("knowledge_annotation_inputs_v2_asset_kind_check", sql`
      (${table.kind} = 'ASSET' and ${table.assetId} is not null)
      or (${table.kind} <> 'ASSET' and ${table.assetId} is null)
    `),
    check("knowledge_annotation_inputs_v2_hash_check", sql`length(${table.inputHash}) = 64 and ${table.inputHash} not glob '*[^0-9a-f]*'`),
    check("knowledge_annotation_inputs_v2_json_check", sql`json_valid(${table.canonicalJson}) and json_type(${table.canonicalJson}) = 'object'`),
  ],
);

export const knowledgeIndexBundlesV2 = sqliteTable(
  "knowledge_index_bundles_v2",
  {
    indexBundleHash: text("index_bundle_hash").primaryKey(),
    corpusHash: text("corpus_hash").notNull().references(() => knowledgeCorporaV2.bundleHash, { onDelete: "cascade" }),
    representationCount: integer("representation_count").notNull(),
    sharedPayloadCount: integer("shared_payload_count").notNull().default(0),
    canonicalJson: text("canonical_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_index_bundles_v2_corpus_hash_unique").on(table.corpusHash, table.indexBundleHash),
    check("knowledge_index_bundles_v2_hash_check", sql`length(${table.indexBundleHash}) = 64 and ${table.indexBundleHash} not glob '*[^0-9a-f]*'`),
    check("knowledge_index_bundles_v2_count_check", sql`
      ${table.representationCount} >= 0
      and (${table.sharedPayloadCount} = 0 or ${table.sharedPayloadCount} >= 2)
    `),
    check("knowledge_index_bundles_v2_json_check", sql`json_valid(${table.canonicalJson}) and json_type(${table.canonicalJson}) = 'object'`),
  ],
);

export const knowledgeIndexVersionsV2 = sqliteTable(
  "knowledge_index_versions_v2",
  {
    indexBundleHash: text("index_bundle_hash").notNull(),
    id: text("id").notNull(),
    builderId: text("builder_id").notNull(),
    builderVersion: text("builder_version").notNull(),
    modelId: text("model_id"),
    modelRevision: text("model_revision"),
    configJson: text("config_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    configHash: text("config_hash").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.indexBundleHash, table.id],
      name: "knowledge_index_versions_v2_pk",
    }),
    foreignKey({
      columns: [table.indexBundleHash],
      foreignColumns: [knowledgeIndexBundlesV2.indexBundleHash],
      name: "knowledge_index_versions_v2_bundle_fk",
    }).onDelete("cascade"),
    check("knowledge_index_versions_v2_model_pair_check", sql`
      (${table.modelId} is null and ${table.modelRevision} is null)
      or (${table.modelId} is not null and ${table.modelRevision} is not null)
    `),
    check("knowledge_index_versions_v2_hash_check", sql`length(${table.configHash}) = 64 and ${table.configHash} not glob '*[^0-9a-f]*'`),
    check("knowledge_index_versions_v2_config_json_check", sql`json_valid(${table.configJson}) and json_type(${table.configJson}) = 'object'`),
  ],
);

export const knowledgeIndexPayloadsV2 = sqliteTable(
  "knowledge_index_payloads_v2",
  {
    indexBundleHash: text("index_bundle_hash").notNull(),
    id: text("id").notNull(),
    role: text("role").notNull(),
    format: text("format").notNull(),
    providerIndexHash: text("provider_index_hash"),
    storageKind: text("storage_kind").notNull(),
    storageKey: text("storage_key").notNull(),
    byteLength: integer("byte_length").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    tensorLayoutJson: text("tensor_layout_json", { mode: "json" }).$type<JsonRecord[]>(),
  },
  (table) => [
    primaryKey({
      columns: [table.indexBundleHash, table.id],
      name: "knowledge_index_payloads_v2_pk",
    }),
    foreignKey({
      columns: [table.indexBundleHash],
      foreignColumns: [knowledgeIndexBundlesV2.indexBundleHash],
      name: "knowledge_index_payloads_v2_bundle_fk",
    }).onDelete("cascade"),
    uniqueIndex("knowledge_index_payloads_v2_storage_key_unique").on(
      table.indexBundleHash,
      table.storageKey,
    ),
    check("knowledge_index_payloads_v2_role_format_check", sql`
      (
        ${table.role} = 'PROVIDER_MANIFEST'
        and ${table.format} = 'JSON'
        and ${table.providerIndexHash} is not null
        and ${table.tensorLayoutJson} is null
      )
      or (
        ${table.role} = 'VECTOR_TENSORS'
        and ${table.format} = 'SAFETENSORS'
        and ${table.providerIndexHash} is null
        and json_valid(${table.tensorLayoutJson})
        and json_type(${table.tensorLayoutJson}) = 'array'
        and json_array_length(${table.tensorLayoutJson}) > 0
      )
    `),
    check("knowledge_index_payloads_v2_storage_check", sql`${table.storageKind} = 'CONTROLLED_FILE' and ${table.byteLength} > 0`),
    check("knowledge_index_payloads_v2_hash_check", sql`
      length(${table.payloadSha256}) = 64
      and ${table.payloadSha256} not glob '*[^0-9a-f]*'
      and (
        ${table.providerIndexHash} is null
        or (
          length(${table.providerIndexHash}) = 64
          and ${table.providerIndexHash} not glob '*[^0-9a-f]*'
        )
      )
    `),
  ],
);

export const knowledgeIndexEntriesV2 = sqliteTable(
  "knowledge_index_entries_v2",
  {
    indexBundleHash: text("index_bundle_hash").notNull(),
    id: text("id").notNull(),
    indexVersionId: text("index_version_id").notNull(),
    channel: text("channel").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    representationJson: text("representation_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    dimensions: integer("dimensions"),
    vectorCount: integer("vector_count").notNull(),
    storageKind: text("storage_kind"),
    storageKey: text("storage_key"),
    byteLength: integer("byte_length"),
    payloadSha256: text("payload_sha256"),
    manifestPayloadId: text("manifest_payload_id"),
    tensorPayloadId: text("tensor_payload_id"),
    locatorJson: text("locator_json", { mode: "json" }).$type<JsonRecord>(),
  },
  (table) => [
    primaryKey({
      columns: [table.indexBundleHash, table.id],
      name: "knowledge_index_entries_v2_pk",
    }),
    foreignKey({
      columns: [table.indexBundleHash, table.indexVersionId],
      foreignColumns: [knowledgeIndexVersionsV2.indexBundleHash, knowledgeIndexVersionsV2.id],
      name: "knowledge_index_entries_v2_version_bundle_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.indexBundleHash, table.manifestPayloadId],
      foreignColumns: [knowledgeIndexPayloadsV2.indexBundleHash, knowledgeIndexPayloadsV2.id],
      name: "knowledge_index_entries_v2_manifest_payload_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.indexBundleHash, table.tensorPayloadId],
      foreignColumns: [knowledgeIndexPayloadsV2.indexBundleHash, knowledgeIndexPayloadsV2.id],
      name: "knowledge_index_entries_v2_tensor_payload_fk",
    }).onDelete("cascade"),
    uniqueIndex("knowledge_index_entries_v2_version_target_unique").on(
      table.indexBundleHash,
      table.indexVersionId,
      table.channel,
      table.targetKind,
      table.targetId,
    ),
    index("knowledge_index_entries_v2_target_idx").on(
      table.indexBundleHash,
      table.channel,
      table.targetKind,
      table.targetId,
    ),
    check("knowledge_index_entries_v2_channel_check", sql`${table.channel} in ('LEXICAL','TEXT_VECTOR','VISUAL_VECTOR','MULTIMODAL_VECTOR')`),
    check("knowledge_index_entries_v2_target_kind_check", sql`${table.targetKind} in ('OBJECT','NODE','ASSET','ANNOTATION')`),
    check("knowledge_index_entries_v2_json_check", sql`json_valid(${table.representationJson}) and json_type(${table.representationJson}) = 'object'`),
    check("knowledge_index_entries_v2_vector_count_check", sql`${table.vectorCount} > 0 and (${table.dimensions} is null or ${table.dimensions} > 0)`),
    check("knowledge_index_entries_v2_storage_check", sql`
      (
        ${table.manifestPayloadId} is null
        and ${table.tensorPayloadId} is null
        and ${table.locatorJson} is null
        and ${table.storageKind} = 'CONTROLLED_FILE'
        and ${table.storageKey} is not null
        and ${table.byteLength} > 0
        and ${table.payloadSha256} is not null
      )
      or (
        ${table.manifestPayloadId} is not null
        and ${table.tensorPayloadId} is not null
        and json_valid(${table.locatorJson})
        and json_type(${table.locatorJson}) = 'object'
        and ${table.storageKind} is null
        and ${table.storageKey} is null
        and ${table.byteLength} is null
        and ${table.payloadSha256} is null
      )
    `),
    check("knowledge_index_entries_v2_hash_check", sql`
      ${table.payloadSha256} is null
      or (length(${table.payloadSha256}) = 64 and ${table.payloadSha256} not glob '*[^0-9a-f]*')
    `),
  ],
);

export const knowledgeActiveIndexBundleV2 = sqliteTable(
  "knowledge_active_index_bundle_v2",
  {
    id: integer("id").primaryKey(),
    corpusHash: text("corpus_hash").notNull(),
    indexBundleHash: text("index_bundle_hash").notNull().unique(),
    activatedAt: integer("activated_at").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.corpusHash, table.indexBundleHash],
      foreignColumns: [knowledgeIndexBundlesV2.corpusHash, knowledgeIndexBundlesV2.indexBundleHash],
      name: "knowledge_active_index_bundle_v2_corpus_bundle_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.corpusHash],
      foreignColumns: [knowledgeActiveCorpusV2.bundleHash],
      name: "knowledge_active_index_bundle_v2_active_corpus_fk",
    }).onDelete("restrict"),
    check("knowledge_active_index_bundle_v2_singleton_check", sql`${table.id} = 1`),
  ],
);

export const coursePackProfiles = sqliteTable(
  "course_pack_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    classId: text("class_id").notNull(),
    coursePackId: text("course_pack_id").notNull(),
    coursePackVersion: text("course_pack_version").notNull(),
    level: text("level", { enum: learnerLevels }).notNull(),
    dimensionsJson: text("dimensions_json", { mode: "json" }).$type<Record<string, number>>().notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("user_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    uniqueIndex("course_pack_profiles_user_pack_unique").on(table.userId, table.coursePackId, table.coursePackVersion),
    index("course_pack_profiles_class_pack_idx").on(table.classId, table.coursePackId, table.coursePackVersion),
    foreignKey({
      columns: [table.userId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "course_pack_profiles_user_class_fk",
    }).onDelete("cascade"),
    check("course_pack_profiles_level_check", sql`${table.level} in ('L1', 'L2', 'L3', 'L4')`),
    check("course_pack_profiles_dimensions_json_check", sql`json_valid(${table.dimensionsJson}) and json_type(${table.dimensionsJson}) = 'object'`),
  ],
);

export const designProjectTasks = sqliteTable(
  "design_project_tasks",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: designTaskStatuses }).notNull().default("ACTIVE"),
    mode: text("mode", { enum: assistantThreadModes }).notNull().default("conversation"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("design_project_tasks_owner_unique").on(table.id, table.studentId, table.classId),
    index("design_project_tasks_student_updated_idx").on(table.studentId, table.status, table.updatedAt),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "design_project_tasks_student_class_fk",
    }).onDelete("cascade"),
    check("design_project_tasks_title_check", sql`length(trim(${table.title})) between 1 and 80`),
    check("design_project_tasks_status_check", sql`${table.status} in ('ACTIVE','ARCHIVED')`),
    check("design_project_tasks_mode_check", sql`${table.mode} in ('conversation','engineering')`),
    check("design_project_tasks_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    runtimeId: text("runtime_id").notNull(),
    runtimeVersion: text("runtime_version").notNull(),
    status: text("status", { enum: agentRunStatuses }).notNull().default("QUEUED"),
    requestJson: text("request_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    requestHash: text("request_hash").notNull(),
    responseJson: text("response_json", { mode: "json" }).$type<JsonRecord>(),
    checkpointJson: text("checkpoint_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attempt: integer("attempt").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
    cancelRequestedAt: integer("cancel_requested_at", { mode: "timestamp" }),
    retryRequestedAt: integer("retry_requested_at", { mode: "timestamp" }),
    lastErrorCode: text("last_error_code"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_runs_student_idempotency_unique").on(table.studentId, table.idempotencyKey),
    uniqueIndex("agent_runs_owner_unique").on(table.id, table.studentId, table.classId),
    index("agent_runs_task_updated_idx").on(table.taskId, table.updatedAt),
    index("agent_runs_recovery_idx").on(table.status, table.leaseExpiresAt),
    foreignKey({
      columns: [table.taskId, table.studentId, table.classId],
      foreignColumns: [designProjectTasks.id, designProjectTasks.studentId, designProjectTasks.classId],
      name: "agent_runs_task_owner_fk",
    }).onDelete("cascade"),
    check("agent_runs_status_check", sql`${table.status} in ('QUEUED','RUNNING','WAITING_APPROVAL','COMPLETED','FAILED','CANCELLED')`),
    check("agent_runs_runtime_id_check", sql`length(${table.runtimeId}) between 2 and 64`),
    check("agent_runs_runtime_version_check", sql`length(${table.runtimeVersion}) between 1 and 16`),
    check("agent_runs_request_json_check", sql`json_valid(${table.requestJson}) and json_type(${table.requestJson}) = 'object'`),
    check("agent_runs_request_hash_check", sql`length(${table.requestHash}) = 64 and ${table.requestHash} not glob '*[^0-9a-f]*'`),
    check("agent_runs_response_json_check", sql`${table.responseJson} is null or (json_valid(${table.responseJson}) and json_type(${table.responseJson}) = 'object')`),
    check("agent_runs_checkpoint_json_check", sql`json_valid(${table.checkpointJson}) and json_type(${table.checkpointJson}) = 'object'`),
    check("agent_runs_idempotency_key_check", sql`length(${table.idempotencyKey}) between 1 and 128`),
    check("agent_runs_attempt_check", sql`${table.attempt} between 0 and 100`),
    check("agent_runs_error_code_check", sql`${table.lastErrorCode} is null or (${table.lastErrorCode} not glob '*[^A-Z0-9_]*' and ${table.lastErrorCode} glob '[A-Z]*' and length(${table.lastErrorCode}) between 3 and 64)`),
    check("agent_runs_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentRunControls = sqliteTable(
  "agent_run_controls",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: agentRunControlKinds }).notNull(),
    generation: integer("generation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_run_controls_key_unique").on(table.runId, table.kind, table.idempotencyKey),
    uniqueIndex("agent_run_controls_generation_unique").on(table.runId, table.kind, table.generation),
    check("agent_run_controls_kind_check", sql`${table.kind} in ('CANCEL','RETRY')`),
    check("agent_run_controls_generation_check", sql`${table.generation} between 0 and 100`),
    check("agent_run_controls_key_check", sql`length(${table.idempotencyKey}) between 1 and 128`),
    check("agent_run_controls_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentRunArtworkInputs = sqliteTable(
  "agent_run_artwork_inputs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    mimeType: text("mime_type").notNull(),
    storagePath: text("storage_path").notNull(),
    digest: text("digest").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_run_artwork_inputs_run_unique").on(table.runId),
    check("agent_run_artwork_inputs_mime_check", sql`${table.mimeType} in ('image/png','image/jpeg','image/webp')`),
    check("agent_run_artwork_inputs_path_check", sql`length(${table.storagePath}) between 1 and 255`),
    check("agent_run_artwork_inputs_digest_check", sql`length(${table.digest}) = 64 and ${table.digest} not glob '*[^0-9a-f]*'`),
    check("agent_run_artwork_inputs_size_check", sql`${table.byteSize} between 1 and ${sql.raw("5242880")}`),
    check("agent_run_artwork_inputs_dimensions_check", sql`${table.width} between 1 and 10000 and ${table.height} between 1 and 10000 and ${table.width} * ${table.height} <= 12000000`),
    check("agent_run_artwork_inputs_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentConversations = sqliteTable(
  "agent_conversations",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => designProjectTasks.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    projectId: text("project_id"),
    coursePackId: text("course_pack_id").notNull(),
    coursePackVersion: text("course_pack_version").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    index("agent_conversations_student_updated_idx").on(table.studentId, table.taskId, table.updatedAt),
    index("agent_conversations_pack_idx").on(table.coursePackId, table.coursePackVersion),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "agent_conversations_student_class_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.projectId, table.classId, table.studentId],
      foreignColumns: [projects.id, projects.classId, projects.studentId],
      name: "agent_conversations_project_owner_fk",
    }).onDelete("cascade"),
  ],
);

export const agentProjectBriefs = sqliteTable(
  "agent_project_briefs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => designProjectTasks.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    briefJson: text("brief_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_project_briefs_task_unique").on(table.taskId),
    index("agent_project_briefs_updated_idx").on(table.updatedAt),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "agent_project_briefs_student_class_fk",
    }).onDelete("cascade"),
    check("agent_project_briefs_revision_check", sql`${table.revision} > 0`),
    check("agent_project_briefs_json_check", sql`json_valid(${table.briefJson}) and json_type(${table.briefJson}) = 'object'`),
    check("agent_project_briefs_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentTurns = sqliteTable(
  "agent_turns",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").notNull().references(() => agentConversations.id, { onDelete: "cascade" }),
    turnSequence: integer("turn_sequence").notNull(),
    studentMessage: text("student_message").notNull(),
    episode: text("episode", { enum: learningEpisodes }).notNull(),
    decisionCode: text("decision_code").notNull(),
    policyId: text("policy_id").notNull().default("competition-core"),
    policyVersion: text("policy_version").notNull().default("1"),
    policyTraceJson: text("policy_trace_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    responseStrategy: text("response_strategy", { enum: agentResponseStrategies }).notNull().default("CLARIFY"),
    responseLatencyMs: integer("response_latency_ms").notNull().default(0),
    replyJson: text("reply_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    aiMode: text("ai_mode", { enum: agentModes }).notNull(),
    sourceIdsJson: text("source_ids_json", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_turns_run_unique").on(table.runId),
    uniqueIndex("agent_turns_conversation_sequence_unique").on(table.conversationId, table.turnSequence),
    index("agent_turns_created_idx").on(table.createdAt),
    check("agent_turns_episode_check", sql`${table.episode} in ('EXPLORE','UNDERSTAND','BUILD','DEBUG','TRANSFER','REFLECT')`),
    check("agent_turns_mode_check", sql`${table.aiMode} in ('MODEL_ASSISTED','DETERMINISTIC_FALLBACK')`),
    check("agent_turns_strategy_check", sql`${table.responseStrategy} in ('DIRECT_INSTRUCTION','CONCEPT_EXPLANATION','DIAGNOSTIC_GUIDANCE','TRANSFER_COACHING','REFLECTION_PROMPT','CLARIFY','OUT_OF_SCOPE')`),
    check("agent_turns_latency_check", sql`${table.responseLatencyMs} between 0 and ${maxAgentTurnLatencySql}`),
    check("agent_turns_policy_id_check", sql`length(${table.policyId}) between 1 and 64`),
    check("agent_turns_policy_version_check", sql`length(${table.policyVersion}) between 1 and 8 and ${table.policyVersion} not glob '*[^0-9]*'`),
    check("agent_turns_policy_trace_json_check", sql`json_valid(${table.policyTraceJson}) and json_type(${table.policyTraceJson}) = 'object'`),
    check("agent_turns_reply_json_check", sql`json_valid(${table.replyJson}) and json_type(${table.replyJson}) = 'object'`),
    check("agent_turns_source_ids_json_check", sql`json_valid(${table.sourceIdsJson}) and json_type(${table.sourceIdsJson}) = 'array'`),
  ],
);

export const agentSessionSummaries = sqliteTable(
  "agent_session_summaries",
  {
    taskId: text("task_id").primaryKey(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    summary: text("summary").notNull(),
    throughTurnId: text("through_turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
    throughCreatedAt: integer("through_created_at", { mode: "timestamp" }).notNull(),
    coveredTurnCount: integer("covered_turn_count").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    index("agent_session_summaries_student_updated_idx").on(table.studentId, table.classId, table.updatedAt),
    foreignKey({
      columns: [table.taskId, table.studentId, table.classId],
      foreignColumns: [designProjectTasks.id, designProjectTasks.studentId, designProjectTasks.classId],
      name: "agent_session_summaries_task_owner_fk",
    }).onDelete("cascade"),
    check("agent_session_summaries_content_check", sql`length(trim(${table.summary})) between 1 and 6000`),
    check("agent_session_summaries_turn_count_check", sql`${table.coveredTurnCount} > 0`),
    check("agent_session_summaries_revision_check", sql`${table.revision} > 0`),
    check("agent_session_summaries_updated_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    check("agent_session_summaries_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentStudentMemories = sqliteTable(
  "agent_student_memory",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    kind: text("kind", { enum: agentStudentMemoryKinds }).notNull(),
    content: text("content").notNull(),
    salience: integer("salience").notNull().default(1),
    embeddingJson: text("embedding_json"),
    embeddingCacheKey: text("embedding_cache_key"),
    sourceKey: text("source_key", { enum: agentStudentMemorySourceKeys }),
    sourceTurnId: text("source_turn_id").references(() => agentTurns.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    // Compatibility-only legacy columns from the currently deployed schema.
    // New student disputes are authoritative in agentStudentMemoryDisputes.
    studentDisputed: integer("student_disputed", { mode: "boolean" }).notNull().default(false),
    studentDisputeNote: text("student_dispute_note"),
    studentDisputedAt: integer("student_disputed_at", { mode: "timestamp" }),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    uniqueIndex(
      "agent_student_memory_owner_unique",
    ).on(
      table.id,
      table.studentId,
      table.classId,
    ),
    index("agent_student_memory_student_created_idx").on(table.studentId, table.classId, table.createdAt),
    index("agent_student_memory_student_kind_idx").on(table.studentId, table.classId, table.kind, table.salience),
    index("agent_student_memory_source_turn_idx").on(table.sourceTurnId),
    uniqueIndex("agent_student_memory_student_source_key_unique").on(
      table.studentId,
      table.classId,
      table.sourceKey,
    ),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "agent_student_memory_student_class_fk",
    }).onDelete("cascade"),
    check("agent_student_memory_kind_check", sql`${table.kind} in ('LEARNED_CONCEPT','RECURRING_STRUGGLE','PREFERENCE','PROJECT_FACT','MISCONCEPTION_CORRECTED')`),
    check("agent_student_memory_content_check", sql`length(trim(${table.content})) between 1 and 2000`),
    check("agent_student_memory_salience_check", sql`${table.salience} between 1 and 10`),
    check("agent_student_memory_last_used_check", sql`${table.lastUsedAt} is null or ${table.lastUsedAt} >= ${table.createdAt}`),
    check("agent_student_memory_source_key_check", sql`
      ${table.sourceKey} is null
      or (
        ${table.sourceKey} in ('ONBOARDING_SELF_ASSESSMENT','ONBOARDING_INTERESTS')
        and ${table.kind} = 'PREFERENCE'
        and ${table.sourceTurnId} is null
      )
    `),
    check("agent_student_memory_dispute_kind_check", sql`
      ${table.studentDisputed} = 0
      or ${table.kind} in ('LEARNED_CONCEPT','RECURRING_STRUGGLE','MISCONCEPTION_CORRECTED')
    `),
    check("agent_student_memory_dispute_state_check", sql`
      (${table.studentDisputed} = 0 and ${table.studentDisputeNote} is null and ${table.studentDisputedAt} is null)
      or (
        ${table.studentDisputed} = 1
        and ${table.studentDisputedAt} is not null
        and ${table.studentDisputedAt} >= ${table.createdAt}
      )
    `),
    check("agent_student_memory_dispute_note_check", sql`
      ${table.studentDisputeNote} is null
      or length(trim(${table.studentDisputeNote})) between 1 and 500
    `),
    check("agent_student_memory_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentStudentMemoryDisputes = sqliteTable(
  "agent_student_memory_disputes",
  {
    memoryId: text("memory_id").primaryKey(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    reason: text("reason"),
    createdAt:
      integer("created_at", { mode: "timestamp" })
        .notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`
        case when ${sql.raw("student_id")} glob 'demo-*'
        then 'DEMONSTRATION_DATA' else 'REAL' end
      `),
  },
  (table) => [
    foreignKey({
      columns: [
        table.memoryId,
        table.studentId,
        table.classId,
      ],
      foreignColumns: [
        agentStudentMemories.id,
        agentStudentMemories.studentId,
        agentStudentMemories.classId,
      ],
      name:
        "agent_student_memory_disputes_owner_fk",
    }).onDelete("cascade"),
    index(
      "agent_student_memory_disputes_owner_idx",
    ).on(
      table.studentId,
      table.classId,
      table.createdAt,
    ),
    check(
      "agent_student_memory_disputes_reason_check",
      sql`${table.reason} is null or length(trim(${table.reason})) between 1 and 500`,
    ),
    check(
      "agent_student_memory_disputes_data_type_check",
      sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`,
    ),
  ],
);

export const agentExternalSearchConsents = sqliteTable(
  "agent_external_search_consents",
  {
    nonce: text("nonce").primaryKey(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    taskId: text("task_id").notNull(),
    messageDigest: text("message_digest").notNull(),
    issuedAtMs: integer("issued_at_ms").notNull(),
    consumedAtMs: integer("consumed_at_ms").notNull(),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    usedAtMs: integer("used_at_ms"),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_external_search_consents_run_unique").on(table.runId),
    index("agent_external_search_consents_student_consumed_idx")
      .on(table.studentId, table.classId, table.consumedAtMs),
    foreignKey({
      columns: [table.taskId, table.studentId, table.classId],
      foreignColumns: [designProjectTasks.id, designProjectTasks.studentId, designProjectTasks.classId],
      name: "agent_external_search_consents_task_owner_fk",
    }).onDelete("cascade"),
    check("agent_external_search_consents_digest_check", sql`
      length(${table.messageDigest}) = 64
      and ${table.messageDigest} not glob '*[^0-9a-f]*'
    `),
    check("agent_external_search_consents_time_check", sql`
      ${table.issuedAtMs} >= 0
      and ${table.consumedAtMs} >= ${table.issuedAtMs} - 30000
      and ${table.consumedAtMs} <= ${table.issuedAtMs} + 600000
      and (${table.usedAtMs} is null or (
        ${table.usedAtMs} >= ${table.issuedAtMs} - 30000
        and ${table.usedAtMs} <= ${table.issuedAtMs} + 600000
      ))
    `),
    check("agent_external_search_consents_data_type_check", sql`
      ${table.dataType} in ('REAL','DEMONSTRATION_DATA')
    `),
  ],
);

export const agentArtworkAttachments = sqliteTable(
  "agent_artwork_attachments",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    mimeType: text("mime_type").notNull(),
    storagePath: text("storage_path").notNull(),
    digest: text("digest").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_artwork_attachments_turn_unique").on(table.turnId),
    uniqueIndex("agent_artwork_attachments_critique_owner_unique").on(
      table.id,
      table.turnId,
      table.studentId,
      table.classId,
      table.dataType,
    ),
    index("agent_artwork_attachments_student_created_idx").on(table.studentId, table.createdAt),
    foreignKey({
      columns: [table.taskId, table.studentId, table.classId],
      foreignColumns: [designProjectTasks.id, designProjectTasks.studentId, designProjectTasks.classId],
      name: "agent_artwork_attachments_task_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "agent_artwork_attachments_student_class_fk",
    }).onDelete("cascade"),
    check("agent_artwork_attachments_mime_check", sql`${table.mimeType} in ('image/png','image/jpeg','image/webp')`),
    check("agent_artwork_attachments_path_check", sql`length(${table.storagePath}) between 1 and 255`),
    check("agent_artwork_attachments_digest_check", sql`length(${table.digest}) = 64 and ${table.digest} not glob '*[^0-9a-f]*'`),
    check("agent_artwork_attachments_size_check", sql`${table.byteSize} between 1 and ${sql.raw("5242880")}`),
    check("agent_artwork_attachments_dimensions_check", sql`${table.width} between 1 and 10000 and ${table.height} between 1 and 10000 and ${table.width} * ${table.height} <= 12000000`),
    check("agent_artwork_attachments_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const studentProjects = sqliteTable(
  "student_projects",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    name: text("name").notNull(),
    icon: text("icon").notNull().default("folder"),
    color: text("color").notNull().default("emerald"),
    instructions: text("instructions").notNull().default(""),
    memoryMode: text("memory_mode", { enum: ["PROJECT_ONLY"] }).notNull().default("PROJECT_ONLY"),
    status: text("status", { enum: ["ACTIVE", "ARCHIVED"] }).notNull().default("ACTIVE"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("student_projects_owner_unique").on(table.id, table.studentId, table.classId),
    index("student_projects_student_updated_idx").on(table.studentId, table.classId, table.status, table.updatedAt),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "student_projects_student_class_fk",
    }).onDelete("cascade"),
    check("student_projects_name_check", sql`length(trim(${table.name})) between 1 and 80`),
    check("student_projects_icon_check", sql`${table.icon} in ('folder','book','palette','sparkles','graduation-cap','presentation')`),
    check("student_projects_color_check", sql`${table.color} in ('emerald','blue','violet','amber','rose','slate')`),
    check("student_projects_instructions_check", sql`length(${table.instructions}) <= 6000`),
    check("student_projects_memory_mode_check", sql`${table.memoryMode} = 'PROJECT_ONLY'`),
    check("student_projects_status_check", sql`${table.status} in ('ACTIVE','ARCHIVED')`),
    check("student_projects_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const studentProjectThreads = sqliteTable(
  "student_project_threads",
  {
    projectId: text("project_id").notNull().references(() => studentProjects.id, { onDelete: "cascade" }),
    taskId: text("task_id").primaryKey().references(() => designProjectTasks.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("student_project_threads_project_created_idx").on(table.projectId, table.createdAt),
    foreignKey({
      columns: [table.projectId, table.studentId, table.classId],
      foreignColumns: [studentProjects.id, studentProjects.studentId, studentProjects.classId],
      name: "student_project_threads_project_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.taskId, table.studentId, table.classId],
      foreignColumns: [designProjectTasks.id, designProjectTasks.studentId, designProjectTasks.classId],
      name: "student_project_threads_task_owner_fk",
    }).onDelete("cascade"),
  ],
);

export const studentLibraryAssets = sqliteTable(
  "student_library_assets",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    taskId: text("task_id").references(() => designProjectTasks.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => studentProjects.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["DIRECT_UPLOAD"] }).notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    storagePath: text("storage_path").notNull(),
    digest: text("digest").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    uniqueIndex("student_library_assets_owner_unique").on(table.id, table.studentId, table.classId),
    index("student_library_assets_student_created_idx").on(table.studentId, table.classId, table.createdAt),
    index("student_library_assets_task_created_idx").on(table.taskId, table.createdAt),
    index("student_library_assets_project_created_idx").on(table.projectId, table.createdAt),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "student_library_assets_student_class_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.projectId, table.studentId, table.classId],
      foreignColumns: [studentProjects.id, studentProjects.studentId, studentProjects.classId],
      name: "student_library_assets_project_owner_fk",
    }).onDelete("cascade"),
    check("student_library_assets_source_check", sql`${table.source} = 'DIRECT_UPLOAD'`),
    check("student_library_assets_name_check", sql`length(trim(${table.originalName})) between 1 and 160`),
    check("student_library_assets_mime_check", sql`${table.mimeType} in ('image/png','image/jpeg','image/webp')`),
    check("student_library_assets_path_check", sql`length(${table.storagePath}) between 1 and 255`),
    check("student_library_assets_digest_check", sql`length(${table.digest}) = 64 and ${table.digest} not glob '*[^0-9a-f]*'`),
    check("student_library_assets_size_check", sql`${table.byteSize} between 1 and ${sql.raw("5242880")}`),
    check("student_library_assets_dimensions_check", sql`${table.width} between 1 and 10000 and ${table.height} between 1 and 10000 and ${table.width} * ${table.height} <= 12000000`),
    check("student_library_assets_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentCritiques = sqliteTable(
  "agent_critiques",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id").notNull(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    courseId: text("course_id").notNull(),
    artworkId: text("artwork_id").notNull(),
    frameworkId: text("framework_id").notNull(),
    frameworkVersion: text("framework_version").notNull(),
    dimensionsJson: text("dimensions_json", { mode: "json" }).$type<JsonRecord[]>().notNull(),
    closureJson: text("closure_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_critiques_turn_unique").on(table.turnId),
    index("agent_critiques_owner_course_created_idx").on(
      table.studentId,
      table.classId,
      table.courseId,
      table.dataType,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.artworkId, table.turnId, table.studentId, table.classId, table.dataType],
      foreignColumns: [
        agentArtworkAttachments.id,
        agentArtworkAttachments.turnId,
        agentArtworkAttachments.studentId,
        agentArtworkAttachments.classId,
        agentArtworkAttachments.dataType,
      ],
      name: "agent_critiques_artwork_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "agent_critiques_student_class_fk",
    }).onDelete("cascade"),
    check("agent_critiques_course_id_check", sql`length(${table.courseId}) between 1 and 64 and ${table.courseId} not glob '*[^a-z0-9-]*'`),
    check("agent_critiques_framework_check", sql`${table.frameworkId} = 'critique-framework-five-plus-closure' and ${table.frameworkVersion} = '1.0'`),
    check("agent_critiques_dimensions_json_check", sql`json_valid(${table.dimensionsJson}) and json_type(${table.dimensionsJson}) = 'array' and json_array_length(${table.dimensionsJson}) = 5`),
    check("agent_critiques_closure_json_check", sql`json_valid(${table.closureJson}) and json_type(${table.closureJson}) = 'object' and json_type(${table.closureJson}, '$.established') = 'text' and json_type(${table.closureJson}, '$.nextStep') = 'text'`),
    check("agent_critiques_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentActions = sqliteTable(
  "agent_actions",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
    actionSequence: integer("action_sequence").notNull(),
    type: text("type", { enum: agentActionTypes }).notNull(),
    label: text("label").notNull(),
    adapterId: text("adapter_id"),
    target: text("target").notNull(),
    focus: text("focus"),
    payloadJson: text("payload_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    status: text("status", { enum: agentActionStatuses }).notNull(),
    effect: text("effect", { enum: agentEffects }).notNull().default("NAVIGATE"),
    approvalMode: text("approval_mode", { enum: agentApprovalModes }).notNull().default("REQUIRES_CONFIRMATION"),
    idempotencyKey: text("idempotency_key"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    executedAt: integer("executed_at", { mode: "timestamp" }),
    rejectedAt: integer("rejected_at", { mode: "timestamp" }),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_actions_turn_sequence_unique").on(table.turnId, table.actionSequence),
    uniqueIndex("agent_actions_turn_idempotency_unique").on(table.turnId, table.idempotencyKey),
    index("agent_actions_status_created_idx").on(table.status, table.createdAt),
    check("agent_actions_type_check", sql`${table.type} in ('OPEN_WORKSPACE','OPEN_RESOURCE','START_DIAGNOSTIC','REQUEST_EVIDENCE','START_TROUBLESHOOTING','START_TRANSFER','ESCALATE_TEACHER')`),
    check("agent_actions_status_check", sql`${table.status} in ('PROPOSED','EXECUTED','REJECTED','EXPIRED')`),
    check("agent_actions_effect_check", sql`${table.effect} in ('READ_CONTEXT','NAVIGATE','WRITE_PROJECT','CHANGE_TOOL_STATE','SUBMIT_EVALUATION','FORMAL_AUTHORITY')`),
    check("agent_actions_approval_mode_check", sql`${table.approvalMode} in ('AUTOMATIC','REQUIRES_CONFIRMATION','FORBIDDEN')`),
    check("agent_actions_policy_effect_check", sql`(${table.effect} = 'READ_CONTEXT' and ${table.approvalMode} = 'AUTOMATIC') or (${table.effect} in ('NAVIGATE','WRITE_PROJECT','CHANGE_TOOL_STATE','SUBMIT_EVALUATION') and ${table.approvalMode} = 'REQUIRES_CONFIRMATION')`),
    check("agent_actions_resolution_check", sql`(${table.status} = 'EXECUTED' and ${table.executedAt} is not null and ${table.rejectedAt} is null) or (${table.status} = 'REJECTED' and ${table.rejectedAt} is not null and ${table.executedAt} is null) or (${table.status} in ('PROPOSED','EXPIRED') and ${table.executedAt} is null and ${table.rejectedAt} is null)`),
    check("agent_actions_payload_json_check", sql`json_valid(${table.payloadJson}) and json_type(${table.payloadJson}) = 'object'`),
  ],
);

export const agentToolCalls = sqliteTable(
  "agent_tool_calls",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
    callSequence: integer("call_sequence").notNull(),
    toolId: text("tool_id").notNull(),
    toolVersion: text("tool_version").notNull(),
    adapterId: text("adapter_id").notNull(),
    inputJson: text("input_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    outputJson: text("output_json", { mode: "json" }).$type<JsonRecord>(),
    status: text("status", { enum: agentToolCallStatuses }).notNull(),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_tool_calls_turn_sequence_unique").on(table.turnId, table.callSequence),
    index("agent_tool_calls_tool_created_idx").on(table.toolId, table.createdAt),
    check("agent_tool_calls_status_check", sql`${table.status} in ('SUCCESS','EMPTY','ERROR')`),
    check("agent_tool_calls_latency_check", sql`${table.latencyMs} between 0 and 60000`),
    check("agent_tool_calls_input_json_check", sql`json_valid(${table.inputJson}) and json_type(${table.inputJson}) = 'object'`),
    check("agent_tool_calls_output_json_check", sql`${table.outputJson} is null or (json_valid(${table.outputJson}) and json_type(${table.outputJson}) = 'object')`),
    check("agent_tool_calls_error_check", sql`(${table.status} = 'ERROR' and ${table.errorCode} is not null) or (${table.status} <> 'ERROR' and ${table.errorCode} is null)`),
  ],
);

export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    role: text("role", { enum: agentMessageRoles }).notNull(),
    content: text("content").notNull(),
    structureJson: text("structure_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    attachmentId: text("attachment_id").references(() => agentArtworkAttachments.id, { onDelete: "set null" }),
    toolCallRefsJson: text("tool_call_refs_json", { mode: "json" }).$type<string[]>().notNull(),
    turnId: text("turn_id").references(() => agentTurns.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_messages_turn_role_unique").on(table.turnId, table.role),
    index("agent_messages_task_created_idx").on(table.taskId, table.createdAt),
    foreignKey({
      columns: [table.taskId, table.studentId, table.classId],
      foreignColumns: [designProjectTasks.id, designProjectTasks.studentId, designProjectTasks.classId],
      name: "agent_messages_task_owner_fk",
    }).onDelete("cascade"),
    check("agent_messages_id_check", sql`length(${table.id}) between 1 and 128`),
    check("agent_messages_role_check", sql`${table.role} in ('user','assistant')`),
    check("agent_messages_content_check", sql`length(trim(${table.content})) between 1 and 32000`),
    check("agent_messages_structure_json_check", sql`
      json_valid(${table.structureJson})
      and json_type(${table.structureJson}) = 'object'
      and json_extract(${table.structureJson}, '$.version') = 1
      and json_extract(${table.structureJson}, '$.kind') = ${table.role}
    `),
    check("agent_messages_tool_refs_json_check", sql`
      json_valid(${table.toolCallRefsJson})
      and json_type(${table.toolCallRefsJson}) = 'array'
    `),
    check("agent_messages_role_shape_check", sql`
      (${table.role} = 'user' and json_array_length(${table.toolCallRefsJson}) = 0)
      or (${table.role} = 'assistant' and ${table.turnId} is not null and ${table.attachmentId} is null)
    `),
    check("agent_messages_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentRunInterventions = sqliteTable(
  "agent_run_interventions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    sourceRunId: text("source_run_id").notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    predecessorRunId: text("predecessor_run_id").notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    userMessageId: text("user_message_id").notNull()
      .references(() => agentMessages.id, { onDelete: "cascade" }),
    requestedMode: text("requested_mode", { enum: agentRunInterventionModes }).notNull(),
    actualMode: text("actual_mode", { enum: agentRunInterventionModes }).notNull(),
    queueSequence: integer("queue_sequence").notNull(),
    nextRunId: text("next_run_id").notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    status: text("status", { enum: agentRunInterventionStatuses }).notNull().default("QUEUED"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    activatedAt: integer("activated_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_run_interventions_student_key_unique")
      .on(table.studentId, table.idempotencyKey),
    uniqueIndex("agent_run_interventions_task_sequence_unique")
      .on(table.taskId, table.queueSequence),
    uniqueIndex("agent_run_interventions_message_unique").on(table.userMessageId),
    uniqueIndex("agent_run_interventions_next_run_unique").on(table.nextRunId),
    index("agent_run_interventions_task_status_idx")
      .on(table.taskId, table.status, table.queueSequence),
    foreignKey({
      columns: [table.taskId, table.studentId, table.classId],
      foreignColumns: [designProjectTasks.id, designProjectTasks.studentId, designProjectTasks.classId],
      name: "agent_run_interventions_task_owner_fk",
    }).onDelete("cascade"),
    check(
      "agent_run_interventions_requested_mode_check",
      sql`${table.requestedMode} in ('FOLLOW_UP','STEER')`,
    ),
    check(
      "agent_run_interventions_actual_mode_check",
      sql`${table.actualMode} in ('FOLLOW_UP','STEER')`,
    ),
    check(
      "agent_run_interventions_status_check",
      sql`${table.status} in ('QUEUED','ACTIVE','COMPLETED','FAILED','CANCELLED')`,
    ),
    check("agent_run_interventions_sequence_check", sql`${table.queueSequence} > 0`),
    check(
      "agent_run_interventions_key_check",
      sql`length(${table.idempotencyKey}) between 1 and 128`,
    ),
    check(
      "agent_run_interventions_hash_check",
      sql`length(${table.requestHash}) = 64 and ${table.requestHash} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "agent_run_interventions_timeline_check",
      sql`
        ${table.updatedAt} >= ${table.createdAt}
        and (
          (${table.status} = 'QUEUED' and ${table.activatedAt} is null and ${table.completedAt} is null)
          or (${table.status} = 'ACTIVE' and ${table.activatedAt} is not null and ${table.completedAt} is null)
          or (${table.status} in ('COMPLETED','FAILED','CANCELLED') and ${table.completedAt} is not null)
        )
      `,
    ),
    check(
      "agent_run_interventions_data_type_check",
      sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`,
    ),
  ],
);

export const agentSteps = sqliteTable(
  "agent_steps",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
    stepSequence: integer("step_sequence").notNull(),
    kind: text("kind", { enum: agentStepKinds }).notNull(),
    status: text("status", { enum: agentStepStatuses }).notNull(),
    label: text("label").notNull(),
    summary: text("summary").notNull(),
    toolCallId: text("tool_call_id").references(() => agentToolCalls.id, { onDelete: "set null" }),
    toolId: text("tool_id"),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_steps_turn_sequence_unique").on(table.turnId, table.stepSequence),
    index("agent_steps_tool_call_idx").on(table.toolCallId),
    check("agent_steps_kind_check", sql`${table.kind} in ('MODEL_DECISION','TOOL_CALL','TOOL_OBSERVATION','FINAL_RESPONSE','DEGRADED')`),
    check("agent_steps_status_check", sql`${table.status} in ('SUCCEEDED','FAILED','EMPTY','SKIPPED')`),
    check("agent_steps_latency_check", sql`${table.latencyMs} between 0 and ${maxAgentTurnLatencySql}`),
    check("agent_steps_label_check", sql`length(${table.label}) between 1 and 100`),
    check("agent_steps_summary_check", sql`length(${table.summary}) between 1 and 300`),
  ],
);

export const agentRuntimeEvents = sqliteTable(
  "agent_runtime_events",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
    eventSequence: integer("event_sequence").notNull(),
    runtimeId: text("runtime_id").notNull(),
    runtimeVersion: text("runtime_version").notNull(),
    kind: text("kind", { enum: agentRuntimeEventKinds }).notNull(),
    status: text("status", { enum: agentStepStatuses }).notNull(),
    label: text("label").notNull(),
    summary: text("summary").notNull(),
    toolCallId: text("tool_call_id").references(() => agentToolCalls.id, { onDelete: "set null" }),
    toolId: text("tool_id"),
    sourceIdsJson: text("source_ids_json", { mode: "json" }).$type<string[]>().notNull(),
    policyRule: text("policy_rule"),
    errorCode: text("error_code"),
    modelProvider: text("model_provider", { enum: ["OPENAI_COMPATIBLE", "TEST"] }),
    modelId: text("model_id"),
    usageStatus: text("usage_status", { enum: agentRuntimeUsageStatuses }).notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_runtime_events_turn_sequence_unique").on(table.turnId, table.eventSequence),
    index("agent_runtime_events_kind_idx").on(table.kind, table.createdAt),
    index("agent_runtime_events_tool_call_idx").on(table.toolCallId),
    check("agent_runtime_events_kind_check", sql`${table.kind} in ('CONTEXT_PREPARATION','RETRIEVAL','POLICY_CHECK','MODEL_DECISION','TOOL_CALL','TOOL_OBSERVATION','SOURCE_SELECTION','PERSISTENCE','FINAL_RESPONSE','DEGRADED')`),
    check("agent_runtime_events_status_check", sql`${table.status} in ('SUCCEEDED','FAILED','EMPTY','SKIPPED')`),
    check("agent_runtime_events_runtime_id_check", sql`length(${table.runtimeId}) between 2 and 64`),
    check("agent_runtime_events_runtime_version_check", sql`length(${table.runtimeVersion}) between 1 and 16`),
    check("agent_runtime_events_label_check", sql`length(${table.label}) between 1 and 100`),
    check("agent_runtime_events_summary_check", sql`length(${table.summary}) between 1 and 300`),
    check("agent_runtime_events_source_ids_check", sql`json_valid(${table.sourceIdsJson}) and json_type(${table.sourceIdsJson}) = 'array'`),
    check("agent_runtime_events_usage_status_check", sql`${table.usageStatus} in ('RECORDED','UNAVAILABLE')`),
    check("agent_runtime_events_usage_check", sql`(${table.usageStatus} = 'RECORDED' and ${table.inputTokens} is not null and ${table.outputTokens} is not null and ${table.totalTokens} = ${table.inputTokens} + ${table.outputTokens}) or (${table.usageStatus} = 'UNAVAILABLE' and ${table.inputTokens} is null and ${table.outputTokens} is null and ${table.totalTokens} is null)`),
    check("agent_runtime_events_latency_check", sql`${table.latencyMs} between 0 and ${maxAgentTurnLatencySql}`),
    check("agent_runtime_events_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentRunEvents = sqliteTable(
  "agent_run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    eventSequence: integer("event_sequence").notNull(),
    kind: text("kind", { enum: agentRunEventKinds }).notNull(),
    label: text("label").notNull(),
    summary: text("summary").notNull(),
    payloadJson: text("payload_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_run_events_run_sequence_unique").on(table.runId, table.eventSequence),
    index("agent_run_events_kind_created_idx").on(table.kind, table.createdAt),
    check("agent_run_events_kind_check", sql`${table.kind} in ('RUN_CREATED','STATUS_CHANGED','RUN_CLAIMED','STEP','TOOL','APPROVAL','COMPLETION','ERROR','CANCELLED','TOKEN')`),
    check("agent_run_events_label_check", sql`length(${table.label}) between 1 and 100`),
    check("agent_run_events_summary_check", sql`length(${table.summary}) between 1 and 300`),
    check("agent_run_events_payload_check", sql`json_valid(${table.payloadJson}) and json_type(${table.payloadJson}) = 'object'`),
    check("agent_run_events_data_type_check", sql`${table.dataType} in ('REAL','DEMONSTRATION_DATA')`),
  ],
);

export const agentDecisionReviews = sqliteTable(
  "agent_decision_reviews",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
    teacherId: text("teacher_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    decision: text("decision", { enum: teacherDecisionKinds }).notNull(),
    notes: text("notes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_decision_reviews_turn_teacher_unique").on(table.turnId, table.teacherId),
    check("agent_decision_reviews_decision_check", sql`${table.decision} in ('CONFIRMED','CORRECTED','NEEDS_REVIEW')`),
    check("agent_decision_reviews_notes_check", sql`length(${table.notes}) <= 1000`),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    payloadJson: text("payload_json", { mode: "json" }).$type<JsonRecord>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("user_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    index("audit_events_user_id_idx").on(table.userId),
    check("audit_events_payload_json_check", sql`json_valid(${table.payloadJson})`),
  ],
);

export const teacherDecisions = sqliteTable(
  "teacher_decisions",
  {
    id: text("id").primaryKey(),
    teacherId: text("teacher_id").notNull(),
    classId: text("class_id").notNull(),
    studentId: text("student_id").notNull(),
    projectId: text("project_id"),
    targetType: text("target_type", { enum: teacherDecisionTargets }).notNull(),
    targetId: text("target_id").notNull(),
    originalRevision: integer("original_revision").notNull(),
    decision: text("decision", { enum: teacherDecisionKinds }).notNull(),
    reasonCode: text("reason_code").notNull(),
    notes: text("notes").notNull(),
    sequence: integer("sequence").notNull(),
    timelineSequence: integer("timeline_sequence").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull().default("0".repeat(64)),
    originalSnapshotJson: text("original_snapshot_json", { mode: "json" }).$type<JsonRecord>().notNull().default({ targetType: "LOGIC_REVIEW", revision: 1, status: "PENDING", ruleReady: false, semanticReady: false, source: "LEGACY", issues: [] }),
    originalSnapshotHash: text("original_snapshot_hash").notNull().default("0".repeat(64)),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-student-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
    uniqueIndex("teacher_decisions_teacher_class_idempotency_unique").on(table.teacherId, table.classId, table.idempotencyKey),
    uniqueIndex("teacher_decisions_target_sequence_unique").on(table.classId, table.targetType, table.targetId, table.sequence),
    uniqueIndex("teacher_decisions_student_timeline_unique").on(table.classId, table.studentId, table.timelineSequence),
    index("teacher_decisions_class_created_idx").on(table.classId, table.createdAt),
    index("teacher_decisions_student_project_created_idx").on(table.studentId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.studentId, table.classId],
      foreignColumns: [users.id, users.classId],
      name: "teacher_decisions_student_class_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.classId, table.studentId],
      foreignColumns: [projects.id, projects.classId, projects.studentId],
      name: "teacher_decisions_project_class_student_fk",
    }).onDelete("restrict"),
    check("teacher_decisions_target_check", sql`${table.targetType} in ('LOGIC_REVIEW', 'EVIDENCE', 'TRANSFER', 'BOOK_LAYOUT_EVIDENCE')`),
    check("teacher_decisions_project_scope_check", sql`((${table.targetType}='BOOK_LAYOUT_EVIDENCE' and ${table.projectId} is null) or (${table.targetType}<>'BOOK_LAYOUT_EVIDENCE' and ${table.projectId} is not null))`),
    check("teacher_decisions_decision_check", sql`${table.decision} in ('CONFIRMED', 'CORRECTED', 'NEEDS_REVIEW')`),
    check("teacher_decisions_revision_check", sql`${table.originalRevision} > 0`),
    check("teacher_decisions_sequence_check", sql`${table.sequence} > 0`),
    check("teacher_decisions_timeline_sequence_check", sql`${table.timelineSequence} > 0`),
    check("teacher_decisions_teacher_length_check", sql`length(trim(${table.teacherId})) between 1 and 128`),
    check("teacher_decisions_target_id_length_check", sql`length(trim(${table.targetId})) between 1 and 128`),
    check("teacher_decisions_reason_length_check", sql`length(trim(${table.reasonCode})) between 1 and 64`),
    check("teacher_decisions_notes_length_check", sql`length(${table.notes}) <= 1000`),
    check("teacher_decisions_idempotency_length_check", sql`length(${table.idempotencyKey}) between 8 and 128`),
    check("teacher_decisions_request_hash_check", sql`length(${table.requestHash}) = 64 and ${table.requestHash} not glob '*[^0-9a-f]*'`),
    check("teacher_decisions_snapshot_hash_check", sql`length(${table.originalSnapshotHash}) = 64 and ${table.originalSnapshotHash} not glob '*[^0-9a-f]*'`),
    check("teacher_decisions_snapshot_json_check", sql`coalesce((json_valid(${table.originalSnapshotJson}) and json_type(${table.originalSnapshotJson})='object'
      and json_extract(${table.originalSnapshotJson}, '$.targetType')=${table.targetType}
      and json_type(${table.originalSnapshotJson}, '$.revision')='integer' and json_extract(${table.originalSnapshotJson}, '$.revision')=${table.originalRevision}
      and ((${table.targetType}='LOGIC_REVIEW' and json_extract(${table.originalSnapshotJson}, '$.status') in ('APPROVED','NEEDS_REVISION','PENDING')
        and json_type(${table.originalSnapshotJson}, '$.ruleReady') in ('true','false') and json_type(${table.originalSnapshotJson}, '$.semanticReady') in ('true','false')
        and json_type(${table.originalSnapshotJson}, '$.source')='text' and length(json_extract(${table.originalSnapshotJson}, '$.source')) between 1 and 64
        and json_type(${table.originalSnapshotJson}, '$.issues')='array' and json_array_length(${table.originalSnapshotJson}, '$.issues') between 0 and 10)
      or (${table.targetType}='EVIDENCE' and json_type(${table.originalSnapshotJson}, '$.id')='text' and json_extract(${table.originalSnapshotJson}, '$.id')=${table.targetId}
        and json_extract(${table.originalSnapshotJson}, '$.kind') in ('TEXT','IMAGE','VALUE','VIDEO_LINK','PROBE')
        and json_extract(${table.originalSnapshotJson}, '$.layer') in ('INPUT','MAPPING','TRANSPORT','BINDING','OUTPUT')
        and json_extract(${table.originalSnapshotJson}, '$.verification') in ('SUBMITTED','RULE_VERIFIED','TEACHER_VERIFIED','REJECTED')
        and (json_type(${table.originalSnapshotJson}, '$.code')='null' or json_extract(${table.originalSnapshotJson}, '$.code') in ('INPUT_OK','MAPPING_OK','TRANSPORT_OK','BINDING_OK','OUTPUT_OK'))
        and json_type(${table.originalSnapshotJson}, '$.sequence')='integer' and json_extract(${table.originalSnapshotJson}, '$.sequence')>0)
      or (${table.targetType}='TRANSFER' and json_extract(${table.originalSnapshotJson}, '$.status') in ('OPEN','PASSED','LOCKED')
        and json_type(${table.originalSnapshotJson}, '$.attemptCount')='integer' and json_extract(${table.originalSnapshotJson}, '$.attemptCount')>=0
        and (json_type(${table.originalSnapshotJson}, '$.latestOutcome')='null' or json_extract(${table.originalSnapshotJson}, '$.latestOutcome') in ('RETRY','PASSED','LOCKED'))
        and (json_type(${table.originalSnapshotJson}, '$.latestRubric')='null' or json_type(${table.originalSnapshotJson}, '$.latestRubric')='object'))
      or (${table.targetType}='BOOK_LAYOUT_EVIDENCE' and json_type(${table.originalSnapshotJson}, '$.id')='text' and json_extract(${table.originalSnapshotJson}, '$.id')=${table.targetId}
        and json_extract(${table.originalSnapshotJson}, '$.audience') in ('NEW_STUDENTS','COMMUNITY_RESIDENTS')
        and json_type(${table.originalSnapshotJson}, '$.pageOrder')='array' and json_array_length(${table.originalSnapshotJson}, '$.pageOrder')=8
        and json_type(${table.originalSnapshotJson}, '$.diagnosticAnswers')='array' and json_array_length(${table.originalSnapshotJson}, '$.diagnosticAnswers')=3
        and json_type(${table.originalSnapshotJson}, '$.transferChoices')='array' and json_array_length(${table.originalSnapshotJson}, '$.transferChoices') between 0 and 3
        and json_type(${table.originalSnapshotJson}, '$.criteria')='array' and json_array_length(${table.originalSnapshotJson}, '$.criteria')=4
        and json_type(${table.originalSnapshotJson}, '$.score')='integer' and json_extract(${table.originalSnapshotJson}, '$.score') between 0 and 4
        and json_type(${table.originalSnapshotJson}, '$.passed') in ('true','false')))),0)`),
  ],
);

/** Anonymous evaluator sessions are deliberately outside users/classes. */
export const previewSessions = sqliteTable(
  "preview_sessions",
  {
    id: text("id").primaryKey(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull().default("DEMONSTRATION_DATA"),
  },
  (table) => [
    index("preview_sessions_expiry_idx").on(table.expiresAt),
    check("preview_sessions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check("preview_sessions_data_type_check", sql`${table.dataType} = 'DEMONSTRATION_DATA'`),
  ],
);

export const previewScenarioUsage = sqliteTable(
  "preview_scenario_usage",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => previewSessions.id, { onDelete: "cascade" }),
    scenarioId: text("scenario_id", { enum: previewScenarioIds }).notNull(),
    runCount: integer("run_count").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull().default("DEMONSTRATION_DATA"),
  },
  (table) => [
    uniqueIndex("preview_scenario_usage_session_scenario_unique").on(table.sessionId, table.scenarioId),
    check("preview_scenario_usage_count_check", sql`${table.runCount} between 0 and 3`),
    check("preview_scenario_usage_data_type_check", sql`${table.dataType} = 'DEMONSTRATION_DATA'`),
  ],
);

export const previewRuns = sqliteTable(
  "preview_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => previewSessions.id, { onDelete: "cascade" }),
    scenarioId: text("scenario_id", { enum: previewScenarioIds }).notNull(),
    status: text("status", { enum: previewRunStatuses }).notNull(),
    responseJson: text("response_json", { mode: "json" }).$type<JsonRecord>(),
    errorCode: text("error_code"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    dataType: text("data_type", { enum: dataTypes }).notNull().default("DEMONSTRATION_DATA"),
  },
  (table) => [
    index("preview_runs_session_created_idx").on(table.sessionId, table.createdAt),
    index("preview_runs_expiry_idx").on(table.expiresAt),
    check("preview_runs_status_check", sql`${table.status} in ('RUNNING','COMPLETED','FAILED')`),
    check("preview_runs_response_check", sql`${table.responseJson} is null or (json_valid(${table.responseJson}) and json_type(${table.responseJson}) = 'object')`),
    check("preview_runs_error_code_check", sql`${table.errorCode} is null or (${table.errorCode} not glob '*[^A-Z0-9_]*' and length(${table.errorCode}) between 3 and 64)`),
    check("preview_runs_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check("preview_runs_data_type_check", sql`${table.dataType} = 'DEMONSTRATION_DATA'`),
  ],
);

/** Private-only acquisition and teacher-review records for the Inspiration Wiki. */
export const inspirationSources = sqliteTable("inspiration_sources", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  adapterId: text("adapter_id").notNull(),
  configurationJson: text("configuration_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  check("inspiration_sources_configuration_json_check", sql`json_valid(${table.configurationJson})`),
  check("inspiration_sources_private_only_check", sql`json_extract(${table.configurationJson}, '$.scope') = 'PRIVATE_CANDIDATE_ONLY'`),
]);

export const inspirationCandidates = sqliteTable("inspiration_candidates", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => inspirationSources.id, { onDelete: "restrict" }),
  state: text("state", { enum: inspirationCandidateStates }).notNull(),
  revision: integer("revision").notNull().default(1),
  curationJson: text("curation_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  assetJson: text("asset_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  rightsJson: text("rights_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  analysisJson: text("analysis_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  reviewPackageJson: text("review_package_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  withdrawalStatus: text("withdrawal_status").notNull(),
  contentHash: text("content_hash"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_candidates_source_content_hash_unique").on(table.sourceId, table.contentHash),
  index("inspiration_candidates_review_queue_idx").on(table.state, table.updatedAt),
  check("inspiration_candidates_state_check", sql`${table.state} in ('DISCOVERED','DOWNLOADED/IMPORTED','NORMALIZED/DEDUPED','VISUALLY_ANALYZED','READY_FOR_TEACHER_REVIEW','APPROVED','AUTO_ADMITTED/INDEXED','ACTIVE','REJECTED','WITHDRAWN')`),
  check("inspiration_candidates_revision_check", sql`${table.revision} > 0`),
  check("inspiration_candidates_json_check", sql`json_valid(${table.curationJson}) and json_valid(${table.assetJson}) and json_valid(${table.rightsJson}) and json_valid(${table.analysisJson}) and json_valid(${table.reviewPackageJson})`),
]);

export const inspirationCandidateAnalyses = sqliteTable("inspiration_candidate_analyses", {
  candidateId: text("candidate_id").primaryKey().references(() => inspirationCandidates.id, { onDelete: "restrict" }),
  candidateRevision: integer("candidate_revision").notNull(),
  analysisJson: text("analysis_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  actualChannel: text("actual_channel").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  check("inspiration_candidate_analyses_json_check", sql`json_valid(${table.analysisJson})`),
  check("inspiration_candidate_analyses_revision_check", sql`${table.candidateRevision} > 0`),
  check("inspiration_candidate_analyses_channel_check", sql`${table.actualChannel} in ('NONE','LOCAL','REMOTE')`),
]);

export const inspirationReviewDecisions = sqliteTable("inspiration_review_decisions", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull().references(() => inspirationCandidates.id, { onDelete: "restrict" }),
  candidateRevision: integer("candidate_revision").notNull(),
  teacherId: text("teacher_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  decision: text("decision", { enum: inspirationReviewDecisionKinds }).notNull(),
  courseTagsJson: text("course_tags_json", { mode: "json" }).$type<string[]>().notNull(),
  notes: text("notes").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_review_decisions_teacher_idempotency_unique").on(table.teacherId, table.idempotencyKey),
  index("inspiration_review_decisions_candidate_created_idx").on(table.candidateId, table.createdAt),
  check("inspiration_review_decisions_check", sql`${table.decision} in ('APPROVE','REJECT','DEFER')`),
  check("inspiration_review_decisions_revision_check", sql`${table.candidateRevision} > 0`),
  check("inspiration_review_decisions_tags_json_check", sql`json_valid(${table.courseTagsJson}) and json_type(${table.courseTagsJson}) = 'array'`),
  check("inspiration_review_decisions_notes_check", sql`length(${table.notes}) <= 1000`),
]);

export const inspirationAdmissions = sqliteTable("inspiration_admissions", {
  candidateId: text("candidate_id").primaryKey().references(() => inspirationCandidates.id, { onDelete: "restrict" }),
  candidateRevision: integer("candidate_revision").notNull(),
  status: text("status", { enum: ["AUTO_ADMITTED/INDEXED", "ACTIVE"] }).notNull(),
  readModelJson: text("read_model_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  publicationScope: text("publication_scope", { enum: ["INTERNAL_CATALOG_ONLY", "AUTHENTICATED_STUDENT_ONLY"] })
    .notNull().default("INTERNAL_CATALOG_ONLY"),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  studentDisplayDecision: text("student_display_decision", { enum: ["PENDING", "ALLOW"] }).notNull().default("PENDING"),
  sourceDisclosureDecision: text("source_disclosure_decision", { enum: ["PENDING", "ALLOW"] }).notNull().default("PENDING"),
  teachingDecision: text("teaching_decision", { enum: ["PENDING", "ALLOW"] }).notNull().default("PENDING"),
  safetyDecision: text("safety_decision", { enum: ["PENDING", "ALLOW"] }).notNull().default("PENDING"),
  qualityDecision: text("quality_decision", { enum: ["PENDING", "ALLOW"] }).notNull().default("PENDING"),
  withdrawalReadiness: text("withdrawal_readiness", { enum: ["PENDING", "READY"] }).notNull().default("PENDING"),
  browserChannel: text("browser_channel", { enum: ["DISABLED", "ACTIVE"] }).notNull().default("DISABLED"),
  bridgeChannel: text("bridge_channel", { enum: ["DISABLED", "ACTIVE"] }).notNull().default("DISABLED"),
  publicationRevision: integer("publication_revision").notNull().default(0),
  publishedBy: text("published_by").references(() => users.id, { onDelete: "restrict" }),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  // Physical column name is retained for migration compatibility. It is true
  // only after the explicit, auditable student-publication decision below.
  formalWikiActivationRecorded: integer("citation_eligibility_recorded", { mode: "boolean" }).notNull(),
  indexedAt: integer("indexed_at", { mode: "timestamp" }).notNull(),
  activatedAt: integer("activated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  check("inspiration_admissions_status_check", sql`${table.status} in ('AUTO_ADMITTED/INDEXED','ACTIVE')`),
  check("inspiration_admissions_read_model_json_check", sql`json_valid(${table.readModelJson})`),
  check("inspiration_admissions_publication_revision_check", sql`${table.publicationRevision} >= 0`),
  check("inspiration_admissions_publication_contract_check", sql`
    (
      ${table.publicationScope} = 'INTERNAL_CATALOG_ONLY'
      and ${table.studentVisible} = 0
      and ${table.studentDisplayDecision} = 'PENDING'
      and ${table.sourceDisclosureDecision} = 'PENDING'
      and ${table.teachingDecision} = 'PENDING'
      and ${table.safetyDecision} = 'PENDING'
      and ${table.qualityDecision} = 'PENDING'
      and ${table.withdrawalReadiness} = 'PENDING'
      and ${table.browserChannel} = 'DISABLED'
      and ${table.bridgeChannel} = 'DISABLED'
      and ${table.publicationRevision} = 0
      and ${table.publishedBy} is null
      and ${table.publishedAt} is null
      and ${table.formalWikiActivationRecorded} = 0
    ) or (
      ${table.publicationScope} = 'AUTHENTICATED_STUDENT_ONLY'
      and ${table.studentVisible} = 1
      and ${table.studentDisplayDecision} = 'ALLOW'
      and ${table.sourceDisclosureDecision} = 'ALLOW'
      and ${table.teachingDecision} = 'ALLOW'
      and ${table.safetyDecision} = 'ALLOW'
      and ${table.qualityDecision} = 'ALLOW'
      and ${table.withdrawalReadiness} = 'READY'
      and ${table.browserChannel} = 'ACTIVE'
      and ${table.bridgeChannel} = 'ACTIVE'
      and ${table.publicationRevision} > 0
      and ${table.publishedBy} is not null
      and ${table.publishedAt} is not null
      and ${table.formalWikiActivationRecorded} = 1
    )
  `),
]);

export const inspirationCandidateAuditEvents = sqliteTable("inspiration_candidate_audit_events", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull().references(() => inspirationCandidates.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(),
  actorId: text("actor_id").references(() => users.id, { onDelete: "restrict" }),
  payloadJson: text("payload_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  index("inspiration_candidate_audit_events_candidate_created_idx").on(table.candidateId, table.createdAt),
  check("inspiration_candidate_audit_events_payload_json_check", sql`json_valid(${table.payloadJson})`),
]);

/** S2-local LLM Wiki persistence. These records remain internal-only and are not wired to student routes. */
export const inspirationWikiRolePolicies = sqliteTable("inspiration_wiki_role_policies", {
  revisionId: text("revision_id").primaryKey(),
  revisionHash: text("revision_hash").notNull(),
  version: text("version").notNull(),
  policyJson: text("policy_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_role_policies_version_unique").on(table.version),
  check("inspiration_wiki_role_policies_json_check", sql`json_valid(${table.policyJson}) and json_type(${table.policyJson}) = 'object'`),
  check("inspiration_wiki_role_policies_hash_check", sql`length(${table.revisionHash}) = 71 and ${table.revisionHash} like 'sha256:%'`),
]);

export const inspirationWikiReviewerAssignments = sqliteTable("inspiration_wiki_reviewer_assignments", {
  assignmentId: text("assignment_id").primaryKey(),
  actorId: text("actor_id").notNull(),
  role: text("role", { enum: inspirationWikiReviewerRoles }).notNull(),
  status: text("status", { enum: inspirationWikiReviewStatuses }).notNull(),
  policyVersion: text("policy_version").notNull(),
  policyRevisionId: text("policy_revision_id").notNull()
    .references(() => inspirationWikiRolePolicies.revisionId, { onDelete: "restrict" }),
  policyRevisionHash: text("policy_revision_hash").notNull(),
  assignmentJson: text("assignment_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  validFrom: integer("valid_from", { mode: "timestamp" }).notNull(),
  validUntil: integer("valid_until", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  index("inspiration_wiki_reviewer_assignments_actor_status_idx").on(table.actorId, table.status),
  index("inspiration_wiki_reviewer_assignments_policy_idx").on(table.policyRevisionId, table.status),
  check("inspiration_wiki_reviewer_assignments_json_check", sql`json_valid(${table.assignmentJson}) and json_type(${table.assignmentJson}) = 'object'`),
  check("inspiration_wiki_reviewer_assignments_hash_check", sql`length(${table.policyRevisionHash}) = 71 and ${table.policyRevisionHash} like 'sha256:%'`),
  check("inspiration_wiki_reviewer_assignments_validity_check", sql`${table.validUntil} is null or ${table.validUntil} >= ${table.validFrom}`),
]);

export const inspirationWikiDraftRevisions = sqliteTable("inspiration_wiki_draft_revisions", {
  draftMaterialReceiptId: text("draft_material_receipt_id").primaryKey(),
  draftMaterialReceiptHash: text("draft_material_receipt_hash").notNull(),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationCandidates.id, { onDelete: "restrict" }),
  candidateRevision: integer("candidate_revision").notNull(),
  pageId: text("page_id").notNull(),
  pageDraftRevisionId: text("page_draft_revision_id").notNull(),
  pageDraftRevisionHash: text("page_draft_revision_hash").notNull(),
  canonicalInputBundleId: text("canonical_input_bundle_id").notNull(),
  canonicalInputBundleHash: text("canonical_input_bundle_hash").notNull(),
  pageRevisionId: text("page_revision_id").notNull(),
  pageRevisionHash: text("page_revision_hash").notNull(),
  compilationReceiptId: text("compilation_receipt_id").notNull(),
  compilationReceiptHash: text("compilation_receipt_hash").notNull(),
  reviewPackageRevisionId: text("review_package_revision_id").notNull(),
  reviewPackageRevisionHash: text("review_package_revision_hash").notNull(),
  policyRevisionId: text("policy_revision_id").notNull()
    .references(() => inspirationWikiRolePolicies.revisionId, { onDelete: "restrict" }),
  policyRevisionHash: text("policy_revision_hash").notNull(),
  riskScopeRevisionId: text("risk_scope_revision_id").notNull(),
  riskScopeRevisionHash: text("risk_scope_revision_hash").notNull(),
  targetHash: text("target_hash").notNull(),
  draftMaterialJson: text("draft_material_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  riskScopeJson: text("risk_scope_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  proposerEditorActorIdsJson: text("proposer_editor_actor_ids_json", { mode: "json" }).$type<string[]>().notNull(),
  state: text("state", { enum: ["LINTED"] }).notNull(),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_draft_revisions_page_draft_unique").on(table.pageDraftRevisionId),
  index("inspiration_wiki_draft_revisions_candidate_idx").on(table.candidateId, table.candidateRevision),
  index("inspiration_wiki_draft_revisions_page_idx").on(table.pageId, table.createdAt),
  check("inspiration_wiki_draft_revisions_candidate_revision_check", sql`${table.candidateRevision} > 0`),
  check("inspiration_wiki_draft_revisions_json_check", sql`json_valid(${table.draftMaterialJson}) and json_type(${table.draftMaterialJson}) = 'object' and json_valid(${table.riskScopeJson}) and json_type(${table.riskScopeJson}) = 'object' and json_valid(${table.proposerEditorActorIdsJson}) and json_type(${table.proposerEditorActorIdsJson}) = 'array'`),
  check("inspiration_wiki_draft_revisions_internal_only_check", sql`${table.state} = 'LINTED' and ${table.studentVisible} = 0`),
  check("inspiration_wiki_draft_revisions_hash_check", sql`length(${table.draftMaterialReceiptHash}) = 71 and ${table.draftMaterialReceiptHash} like 'sha256:%' and length(${table.targetHash}) = 71 and ${table.targetHash} like 'sha256:%'`),
]);

export const inspirationWikiDomainReviewDecisions = sqliteTable("inspiration_wiki_domain_review_decisions", {
  decisionId: text("decision_id").primaryKey(),
  decisionRevisionId: text("decision_revision_id").notNull(),
  decisionRevisionHash: text("decision_revision_hash").notNull(),
  draftMaterialReceiptId: text("draft_material_receipt_id").notNull()
    .references(() => inspirationWikiDraftRevisions.draftMaterialReceiptId, { onDelete: "restrict" }),
  reviewDomain: text("review_domain", { enum: inspirationWikiReviewDomains }).notNull(),
  decision: text("decision", { enum: inspirationWikiReviewDecisions }).notNull(),
  actorId: text("actor_id").notNull(),
  actorRoleAssignmentId: text("actor_role_assignment_id").notNull()
    .references(() => inspirationWikiReviewerAssignments.assignmentId, { onDelete: "restrict" }),
  policyRevisionId: text("policy_revision_id").notNull()
    .references(() => inspirationWikiRolePolicies.revisionId, { onDelete: "restrict" }),
  policyRevisionHash: text("policy_revision_hash").notNull(),
  targetHash: text("target_hash").notNull(),
  requiredReviewerCount: integer("required_reviewer_count").notNull(),
  coReviewerDecisionIdsJson: text("co_reviewer_decision_ids_json", { mode: "json" }).$type<string[]>().notNull(),
  reviewJson: text("review_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  status: text("status", { enum: inspirationWikiReviewStatuses }).notNull(),
  validUntil: integer("valid_until", { mode: "timestamp" }),
  decidedAt: integer("decided_at", { mode: "timestamp" }).notNull(),
  supersedesDecisionId: text("supersedes_decision_id")
    .references((): AnySQLiteColumn => inspirationWikiDomainReviewDecisions.decisionId, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_domain_review_decisions_revision_unique").on(table.decisionRevisionId),
  index("inspiration_wiki_domain_review_decisions_draft_domain_idx").on(table.draftMaterialReceiptId, table.reviewDomain, table.decidedAt),
  check("inspiration_wiki_domain_review_decisions_count_check", sql`${table.requiredReviewerCount} between 1 and 2`),
  check("inspiration_wiki_domain_review_decisions_json_check", sql`json_valid(${table.coReviewerDecisionIdsJson}) and json_type(${table.coReviewerDecisionIdsJson}) = 'array' and json_valid(${table.reviewJson}) and json_type(${table.reviewJson}) = 'object'`),
  check("inspiration_wiki_domain_review_decisions_hash_check", sql`length(${table.decisionRevisionHash}) = 71 and ${table.decisionRevisionHash} like 'sha256:%' and length(${table.policyRevisionHash}) = 71 and ${table.policyRevisionHash} like 'sha256:%' and length(${table.targetHash}) = 71 and ${table.targetHash} like 'sha256:%'`),
]);

export const inspirationWikiInternalCatalogEntries = sqliteTable("inspiration_wiki_internal_catalog_entries", {
  draftMaterialReceiptId: text("draft_material_receipt_id").primaryKey()
    .references(() => inspirationWikiDraftRevisions.draftMaterialReceiptId, { onDelete: "restrict" }),
  pageId: text("page_id").notNull(),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationCandidates.id, { onDelete: "restrict" }),
  state: text("state", { enum: inspirationWikiCatalogStates }).notNull(),
  holdReason: text("hold_reason"),
  acceptedDecisionIdsJson: text("accepted_decision_ids_json", { mode: "json" }).$type<string[]>().notNull(),
  acceptedDecisionSetHash: text("accepted_decision_set_hash").notNull(),
  policyRevisionId: text("policy_revision_id").notNull()
    .references(() => inspirationWikiRolePolicies.revisionId, { onDelete: "restrict" }),
  policyRevisionHash: text("policy_revision_hash").notNull(),
  targetHash: text("target_hash").notNull(),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  browseRelease: text("browse_release", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  studentSearch: text("student_search", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  wikiRetrieval: text("wiki_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  activatedAt: integer("activated_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  index("inspiration_wiki_internal_catalog_entries_page_state_idx").on(table.pageId, table.state),
  check("inspiration_wiki_internal_catalog_entries_json_check", sql`json_valid(${table.acceptedDecisionIdsJson}) and json_type(${table.acceptedDecisionIdsJson}) = 'array'`),
  check("inspiration_wiki_internal_catalog_entries_state_check", sql`(${table.state} = 'INTERNAL_CATALOG_ACTIVE' and ${table.holdReason} is null) or (${table.state} = 'REVIEW_HOLD' and length(${table.holdReason}) > 0)`),
  check("inspiration_wiki_internal_catalog_entries_internal_only_check", sql`${table.studentVisible} = 0 and ${table.browseRelease} = 'DISABLED' and ${table.studentSearch} = 'DISABLED' and ${table.wikiRetrieval} = 'DISABLED'`),
  check("inspiration_wiki_internal_catalog_entries_hash_check", sql`length(${table.acceptedDecisionSetHash}) = 71 and ${table.acceptedDecisionSetHash} like 'sha256:%' and length(${table.policyRevisionHash}) = 71 and ${table.policyRevisionHash} like 'sha256:%' and length(${table.targetHash}) = 71 and ${table.targetHash} like 'sha256:%'`),
]);

/** D-18 private Hermes intake. These tables cannot represent a release or student-visible record. */
export const inspirationWikiHermesBatches = sqliteTable("inspiration_wiki_hermes_batches", {
  batchId: text("batch_id").primaryKey(),
  contractVersion: text("contract_version", { enum: ["LEGACY_V1"] }).notNull(),
  packageDigest: text("package_digest").notNull(),
  manifestJson: text("manifest_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  doneJson: text("done_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  candidateCount: integer("candidate_count").notNull(),
  failureCount: integer("failure_count").notNull(),
  intakeState: text("intake_state", { enum: ["VALIDATED_PRIVATE"] }).notNull(),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  importedAt: integer("imported_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_hermes_batches_digest_unique").on(table.packageDigest),
  check("inspiration_wiki_hermes_batches_digest_check", sql`length(${table.packageDigest}) = 64 and ${table.packageDigest} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_hermes_batches_counts_check", sql`${table.candidateCount} between 0 and 10000 and ${table.failureCount} between 0 and 10000`),
  check("inspiration_wiki_hermes_batches_json_check", sql`json_valid(${table.manifestJson}) and json_type(${table.manifestJson}) = 'object' and json_valid(${table.doneJson}) and json_type(${table.doneJson}) = 'object'`),
  check("inspiration_wiki_hermes_batches_private_check", sql`${table.contractVersion} = 'LEGACY_V1' and ${table.intakeState} = 'VALIDATED_PRIVATE' and ${table.studentVisible} = 0 and ${table.currentPage} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED'`),
]);

export const inspirationWikiHermesCandidates = sqliteTable("inspiration_wiki_hermes_candidates", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull()
    .references(() => inspirationWikiHermesBatches.batchId, { onDelete: "restrict" }),
  sourceCandidateId: text("source_candidate_id").notNull(),
  revision: integer("revision").notNull().default(1),
  contractState: text("contract_state", { enum: ["V1_UPGRADE_REQUIRED"] }).notNull(),
  reviewState: text("review_state", { enum: [
    "PENDING_REVIEW",
    "NORMALIZATION_REQUIRED",
    "DUPLICATE_HOLD",
    "RIGHTS_HOLD",
    "REJECTED",
  ] }).notNull().default("PENDING_REVIEW"),
  sourceId: text("source_id").notNull(),
  sourcePlatform: text("source_platform").notNull(),
  pageUrl: text("page_url").notNull(),
  canonicalUrl: text("canonical_url"),
  title: text("title"),
  description: text("description"),
  authorJson: text("author_json", { mode: "json" }).$type<JsonRecord>(),
  licenseJson: text("license_json", { mode: "json" }).$type<JsonRecord>(),
  mediaJson: text("media_json", { mode: "json" }).$type<JsonRecord[]>().notNull(),
  designCategoriesJson: text("design_categories_json", { mode: "json" }).$type<string[]>().notNull(),
  screeningJson: text("screening_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  rawCandidateJson: text("raw_candidate_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  rawDigest: text("raw_digest").notNull(),
  dedupeFingerprint: text("dedupe_fingerprint").notNull(),
  scope: text("scope", { enum: ["PRIVATE_CANDIDATE"] }).notNull().default("PRIVATE_CANDIDATE"),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  wikiDraft: text("wiki_draft", { enum: ["NOT_CREATED"] }).notNull().default("NOT_CREATED"),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_hermes_candidates_batch_source_unique").on(table.batchId, table.sourceCandidateId),
  index("inspiration_wiki_hermes_candidates_queue_idx").on(table.reviewState, table.updatedAt),
  index("inspiration_wiki_hermes_candidates_fingerprint_idx").on(table.dedupeFingerprint),
  index("inspiration_wiki_hermes_candidates_page_idx").on(table.pageUrl),
  check("inspiration_wiki_hermes_candidates_revision_check", sql`${table.revision} > 0`),
  check("inspiration_wiki_hermes_candidates_url_check", sql`${table.pageUrl} like 'https://%' and (${table.canonicalUrl} is null or ${table.canonicalUrl} like 'https://%')`),
  check("inspiration_wiki_hermes_candidates_digest_check", sql`length(${table.rawDigest}) = 64 and ${table.rawDigest} not glob '*[^0-9a-f]*' and length(${table.dedupeFingerprint}) = 64 and ${table.dedupeFingerprint} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_hermes_candidates_json_check", sql`(${table.authorJson} is null or (json_valid(${table.authorJson}) and json_type(${table.authorJson}) = 'object')) and (${table.licenseJson} is null or (json_valid(${table.licenseJson}) and json_type(${table.licenseJson}) = 'object')) and json_valid(${table.mediaJson}) and json_type(${table.mediaJson}) = 'array' and json_array_length(${table.mediaJson}) > 0 and json_valid(${table.designCategoriesJson}) and json_type(${table.designCategoriesJson}) = 'array' and json_array_length(${table.designCategoriesJson}) > 0 and json_valid(${table.screeningJson}) and json_type(${table.screeningJson}) = 'object' and json_valid(${table.rawCandidateJson}) and json_type(${table.rawCandidateJson}) = 'object'`),
  check("inspiration_wiki_hermes_candidates_state_check", sql`${table.contractState} = 'V1_UPGRADE_REQUIRED' and ${table.reviewState} in ('PENDING_REVIEW','NORMALIZATION_REQUIRED','DUPLICATE_HOLD','RIGHTS_HOLD','REJECTED')`),
  check("inspiration_wiki_hermes_candidates_private_check", sql`${table.scope} = 'PRIVATE_CANDIDATE' and ${table.studentVisible} = 0 and ${table.wikiDraft} = 'NOT_CREATED' and ${table.currentPage} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED'`),
]);

export const inspirationWikiHermesTriageDecisions = sqliteTable("inspiration_wiki_hermes_triage_decisions", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  candidateRevision: integer("candidate_revision").notNull(),
  teacherId: text("teacher_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  decision: text("decision", { enum: [
    "RESTORE_PENDING",
    "REQUEST_NORMALIZATION",
    "HOLD_DUPLICATE",
    "HOLD_RIGHTS",
    "REJECT",
  ] }).notNull(),
  previousState: text("previous_state").notNull(),
  nextState: text("next_state").notNull(),
  note: text("note").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_hermes_triage_teacher_key_unique").on(table.teacherId, table.idempotencyKey),
  index("inspiration_wiki_hermes_triage_candidate_created_idx").on(table.candidateId, table.createdAt),
  check("inspiration_wiki_hermes_triage_revision_check", sql`${table.candidateRevision} > 0`),
  check("inspiration_wiki_hermes_triage_note_check", sql`length(${table.note}) <= 1000`),
  check("inspiration_wiki_hermes_triage_key_check", sql`length(${table.idempotencyKey}) between 8 and 128`),
  check("inspiration_wiki_hermes_triage_hash_check", sql`length(${table.requestHash}) = 64 and ${table.requestHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_hermes_triage_state_check", sql`${table.previousState} in ('PENDING_REVIEW','NORMALIZATION_REQUIRED','DUPLICATE_HOLD','RIGHTS_HOLD','REJECTED') and ${table.nextState} in ('PENDING_REVIEW','NORMALIZATION_REQUIRED','DUPLICATE_HOLD','RIGHTS_HOLD','REJECTED')`),
  check("inspiration_wiki_hermes_triage_transition_check", sql`(${table.decision} = 'RESTORE_PENDING' and ${table.nextState} = 'PENDING_REVIEW') or (${table.decision} = 'REQUEST_NORMALIZATION' and ${table.nextState} = 'NORMALIZATION_REQUIRED') or (${table.decision} = 'HOLD_DUPLICATE' and ${table.nextState} = 'DUPLICATE_HOLD') or (${table.decision} = 'HOLD_RIGHTS' and ${table.nextState} = 'RIGHTS_HOLD') or (${table.decision} = 'REJECT' and ${table.nextState} = 'REJECTED')`),
]);

/** Teacher-private ReviewPacks. A row can never represent a release or student-visible object. */
export const inspirationWikiReviewPacks = sqliteTable("inspiration_wiki_review_packs", {
  reviewPackId: text("review_pack_id").primaryKey(),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull().default(1),
  stage: text("stage", { enum: [
    "READY_FOR_TEACHER_REVIEW",
    "RETURNED_TO_CODEX",
    "REJECTED",
    "PRIVATE_WIKIDRAFT",
  ] }).notNull(),
  materialHash: text("material_hash").notNull(),
  packJson: text("pack_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  mediaAssetsJson: text("media_assets_json", { mode: "json" }).$type<JsonRecord[]>().notNull(),
  primaryPreviewUrl: text("primary_preview_url").notNull(),
  title: text("title").notNull(),
  sourceSummary: text("source_summary").notNull(),
  teacherPrivate: integer("teacher_private", { mode: "boolean" }).notNull().default(true),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_review_packs_candidate_unique").on(table.candidateId),
  index("inspiration_wiki_review_packs_queue_idx").on(table.stage, table.updatedAt),
  check("inspiration_wiki_review_packs_revision_check", sql`${table.revision} > 0`),
  check("inspiration_wiki_review_packs_hash_check", sql`length(${table.materialHash}) = 64 and ${table.materialHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_review_packs_json_check", sql`json_valid(${table.packJson}) and json_type(${table.packJson}) = 'object' and json_valid(${table.mediaAssetsJson}) and json_type(${table.mediaAssetsJson}) = 'array' and json_array_length(${table.mediaAssetsJson}) > 0`),
  check("inspiration_wiki_review_packs_stage_check", sql`${table.stage} in ('READY_FOR_TEACHER_REVIEW','RETURNED_TO_CODEX','REJECTED','PRIVATE_WIKIDRAFT')`),
  check("inspiration_wiki_review_packs_private_check", sql`${table.teacherPrivate} = 1 and ${table.studentVisible} = 0 and ${table.currentPage} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED'`),
]);

export const inspirationWikiReviewPackDecisions = sqliteTable("inspiration_wiki_review_pack_decisions", {
  id: text("id").primaryKey(),
  reviewPackId: text("review_pack_id").notNull()
    .references(() => inspirationWikiReviewPacks.reviewPackId, { onDelete: "restrict" }),
  reviewPackRevision: integer("review_pack_revision").notNull(),
  teacherId: text("teacher_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  assessmentJson: text("assessment_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  finalAction: text("final_action", { enum: [
    "RETURN_TO_CODEX",
    "REJECT_CANDIDATE",
    "ENTER_PRIVATE_WIKIDRAFT",
  ] }).notNull(),
  previousStage: text("previous_stage").notNull(),
  nextStage: text("next_stage").notNull(),
  note: text("note").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_review_pack_decisions_teacher_key_unique").on(table.teacherId, table.idempotencyKey),
  index("inspiration_wiki_review_pack_decisions_pack_created_idx").on(table.reviewPackId, table.createdAt),
  check("inspiration_wiki_review_pack_decisions_revision_check", sql`${table.reviewPackRevision} > 0`),
  check("inspiration_wiki_review_pack_decisions_json_check", sql`json_valid(${table.assessmentJson}) and json_type(${table.assessmentJson}) = 'object'`),
  check("inspiration_wiki_review_pack_decisions_note_check", sql`length(${table.note}) <= 300`),
  check("inspiration_wiki_review_pack_decisions_key_check", sql`length(${table.idempotencyKey}) between 8 and 128`),
  check("inspiration_wiki_review_pack_decisions_hash_check", sql`length(${table.requestHash}) = 64 and ${table.requestHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_review_pack_decisions_transition_check", sql`(${table.finalAction} = 'RETURN_TO_CODEX' and ${table.nextStage} = 'RETURNED_TO_CODEX') or (${table.finalAction} = 'REJECT_CANDIDATE' and ${table.nextStage} = 'REJECTED') or (${table.finalAction} = 'ENTER_PRIVATE_WIKIDRAFT' and ${table.nextStage} = 'PRIVATE_WIKIDRAFT')`),
]);

/** Teacher-private evidence-gap review. These rows never claim the strict nine-gate contract. */
export const inspirationWikiEvidenceGapReviewPacks = sqliteTable("inspiration_wiki_evidence_gap_review_packs", {
  reviewPackId: text("review_pack_id").primaryKey(),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull().default(1),
  contractKind: text("contract_kind", { enum: ["EVIDENCE_GAP_REVIEW"] }).notNull(),
  stage: text("stage", { enum: [
    "READY_FOR_TEACHER_TRIAGE",
    "RETURNED_TO_CODEX",
    "REJECTED",
    "PRIVATE_WIKIDRAFT_WITH_GAPS",
  ] }).notNull(),
  materialHash: text("material_hash").notNull(),
  packJson: text("pack_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  mediaAssetsJson: text("media_assets_json", { mode: "json" }).$type<JsonRecord[]>().notNull(),
  readinessJson: text("readiness_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  verifiedGateCount: integer("verified_gate_count").notNull(),
  primaryPreviewUrl: text("primary_preview_url"),
  title: text("title"),
  sourceSummary: text("source_summary"),
  teacherPrivate: integer("teacher_private", { mode: "boolean" }).notNull().default(true),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_evidence_gap_review_packs_candidate_unique").on(table.candidateId),
  index("inspiration_wiki_evidence_gap_review_packs_queue_idx").on(table.stage, table.updatedAt),
  check("inspiration_wiki_evidence_gap_review_packs_revision_check", sql`${table.revision} > 0`),
  check("inspiration_wiki_evidence_gap_review_packs_contract_check", sql`${table.contractKind} = 'EVIDENCE_GAP_REVIEW'`),
  check("inspiration_wiki_evidence_gap_review_packs_hash_check", sql`length(${table.materialHash}) = 64 and ${table.materialHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_evidence_gap_review_packs_json_check", sql`json_valid(${table.packJson}) and json_type(${table.packJson}) = 'object' and json_valid(${table.mediaAssetsJson}) and json_type(${table.mediaAssetsJson}) = 'array' and json_valid(${table.readinessJson}) and json_type(${table.readinessJson}) = 'object'`),
  check("inspiration_wiki_evidence_gap_review_packs_gate_count_check", sql`${table.verifiedGateCount} between 0 and 8`),
  check("inspiration_wiki_evidence_gap_review_packs_preview_check", sql`${table.primaryPreviewUrl} is null or ${table.primaryPreviewUrl} like '/api/teacher/inspiration-wiki/review-packs/%'`),
  check("inspiration_wiki_evidence_gap_review_packs_stage_check", sql`${table.stage} in ('READY_FOR_TEACHER_TRIAGE','RETURNED_TO_CODEX','REJECTED','PRIVATE_WIKIDRAFT_WITH_GAPS')`),
  check("inspiration_wiki_evidence_gap_review_packs_private_check", sql`${table.teacherPrivate} = 1 and ${table.studentVisible} = 0 and ${table.currentPage} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED'`),
]);

export const inspirationWikiEvidenceGapReviewDecisions = sqliteTable("inspiration_wiki_evidence_gap_review_decisions", {
  id: text("id").primaryKey(),
  reviewPackId: text("review_pack_id").notNull()
    .references(() => inspirationWikiEvidenceGapReviewPacks.reviewPackId, { onDelete: "restrict" }),
  reviewPackRevision: integer("review_pack_revision").notNull(),
  teacherId: text("teacher_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  acceptedGapKeysJson: text("accepted_gap_keys_json", { mode: "json" }).$type<string[]>().notNull(),
  finalAction: text("final_action", { enum: [
    "RETURN_TO_CODEX",
    "REJECT_CANDIDATE",
    "ENTER_PRIVATE_WIKIDRAFT",
  ] }).notNull(),
  previousStage: text("previous_stage").notNull(),
  nextStage: text("next_stage").notNull(),
  note: text("note").notNull(),
  privateDraftOnly: integer("private_draft_only", { mode: "boolean" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_evidence_gap_review_decisions_teacher_key_unique").on(table.teacherId, table.idempotencyKey),
  index("inspiration_wiki_evidence_gap_review_decisions_pack_created_idx").on(table.reviewPackId, table.createdAt),
  check("inspiration_wiki_evidence_gap_review_decisions_revision_check", sql`${table.reviewPackRevision} > 0`),
  check("inspiration_wiki_evidence_gap_review_decisions_gaps_json_check", sql`json_valid(${table.acceptedGapKeysJson}) and json_type(${table.acceptedGapKeysJson}) = 'array' and json_array_length(${table.acceptedGapKeysJson}) between 0 and 9`),
  check("inspiration_wiki_evidence_gap_review_decisions_note_check", sql`length(trim(${table.note})) <= 300 and (${table.finalAction} = 'ENTER_PRIVATE_WIKIDRAFT' or length(trim(${table.note})) >= 1)`),
  check("inspiration_wiki_evidence_gap_review_decisions_key_check", sql`length(${table.idempotencyKey}) between 8 and 128`),
  check("inspiration_wiki_evidence_gap_review_decisions_hash_check", sql`length(${table.requestHash}) = 64 and ${table.requestHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_evidence_gap_review_decisions_action_check", sql`(${table.finalAction} = 'ENTER_PRIVATE_WIKIDRAFT' and ${table.privateDraftOnly} = 1) or (${table.finalAction} in ('RETURN_TO_CODEX','REJECT_CANDIDATE') and ${table.privateDraftOnly} = 0 and json_array_length(${table.acceptedGapKeysJson}) = 0)`),
  check("inspiration_wiki_evidence_gap_review_decisions_transition_check", sql`(${table.finalAction} = 'RETURN_TO_CODEX' and ${table.nextStage} = 'RETURNED_TO_CODEX') or (${table.finalAction} = 'REJECT_CANDIDATE' and ${table.nextStage} = 'REJECTED') or (${table.finalAction} = 'ENTER_PRIVATE_WIKIDRAFT' and ${table.nextStage} = 'PRIVATE_WIKIDRAFT_WITH_GAPS')`),
]);

/** Append-only audit for the one permitted evidence-gap material correction: adding one unverified local preview. */
export const inspirationWikiEvidenceGapMediaAmendments = sqliteTable("inspiration_wiki_evidence_gap_media_amendments", {
  id: text("id").primaryKey(),
  reviewPackId: text("review_pack_id").notNull()
    .references(() => inspirationWikiEvidenceGapReviewPacks.reviewPackId, { onDelete: "restrict" }),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  amendmentKind: text("amendment_kind", { enum: ["ADD_UNVERIFIED_LOCAL_PREVIEW"] }).notNull(),
  previousRevision: integer("previous_revision").notNull(),
  nextRevision: integer("next_revision").notNull(),
  previousMaterialHash: text("previous_material_hash").notNull(),
  nextMaterialHash: text("next_material_hash").notNull(),
  mediaId: text("media_id").notNull(),
  assetStoragePath: text("asset_storage_path").notNull(),
  assetSha256: text("asset_sha256").notNull(),
  assetMimeType: text("asset_mime_type", { enum: ["image/jpeg", "image/png", "image/webp"] }).notNull(),
  assetBytes: integer("asset_bytes").notNull(),
  sourcePackageDigest: text("source_package_digest").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  previousPackJson: text("previous_pack_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  amendedPackJson: text("amended_pack_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  previousAssetsJson: text("previous_assets_json", { mode: "json" }).$type<JsonRecord[]>().notNull(),
  amendedAssetsJson: text("amended_assets_json", { mode: "json" }).$type<JsonRecord[]>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_evidence_gap_media_amendments_key_unique").on(table.idempotencyKey),
  uniqueIndex("inspiration_wiki_evidence_gap_media_amendments_pack_revision_unique").on(table.reviewPackId, table.nextRevision),
  index("inspiration_wiki_evidence_gap_media_amendments_pack_created_idx").on(table.reviewPackId, table.createdAt),
  check("inspiration_wiki_evidence_gap_media_amendments_kind_check", sql`${table.amendmentKind} = 'ADD_UNVERIFIED_LOCAL_PREVIEW'`),
  check("inspiration_wiki_evidence_gap_media_amendments_revision_check", sql`${table.previousRevision} > 0 and ${table.nextRevision} = ${table.previousRevision} + 1`),
  check("inspiration_wiki_evidence_gap_media_amendments_hash_check", sql`length(${table.previousMaterialHash}) = 64 and ${table.previousMaterialHash} not glob '*[^0-9a-f]*' and length(${table.nextMaterialHash}) = 64 and ${table.nextMaterialHash} not glob '*[^0-9a-f]*' and length(${table.assetSha256}) = 64 and ${table.assetSha256} not glob '*[^0-9a-f]*' and length(${table.sourcePackageDigest}) = 64 and ${table.sourcePackageDigest} not glob '*[^0-9a-f]*' and length(${table.requestHash}) = 64 and ${table.requestHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_evidence_gap_media_amendments_asset_check", sql`${table.assetBytes} between 1 and 26214400 and ${table.assetMimeType} in ('image/jpeg','image/png','image/webp')`),
  check("inspiration_wiki_evidence_gap_media_amendments_key_check", sql`length(${table.idempotencyKey}) between 8 and 128`),
  check("inspiration_wiki_evidence_gap_media_amendments_json_check", sql`json_valid(${table.previousPackJson}) and json_type(${table.previousPackJson}) = 'object' and json_valid(${table.amendedPackJson}) and json_type(${table.amendedPackJson}) = 'object' and json_valid(${table.previousAssetsJson}) and json_type(${table.previousAssetsJson}) = 'array' and json_array_length(${table.previousAssetsJson}) = 0 and json_valid(${table.amendedAssetsJson}) and json_type(${table.amendedAssetsJson}) = 'array' and json_array_length(${table.amendedAssetsJson}) = 1`),
]);

/** Append-only audit for Codex analysis revisions that keep exactly three requirements unknown. */
export const inspirationWikiEvidenceGapAnalysisRevisions = sqliteTable("inspiration_wiki_evidence_gap_analysis_revisions", {
  id: text("id").primaryKey(),
  reviewPackId: text("review_pack_id").notNull()
    .references(() => inspirationWikiEvidenceGapReviewPacks.reviewPackId, { onDelete: "restrict" }),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  analysisKind: text("analysis_kind", { enum: ["SIX_ANALYZED_THREE_UNKNOWN"] }).notNull(),
  previousRevision: integer("previous_revision").notNull(),
  nextRevision: integer("next_revision").notNull(),
  previousMaterialHash: text("previous_material_hash").notNull(),
  nextMaterialHash: text("next_material_hash").notNull(),
  sourceArtifactDigest: text("source_artifact_digest").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  previousPackJson: text("previous_pack_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  revisedPackJson: text("revised_pack_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_evidence_gap_analysis_revisions_key_unique").on(table.idempotencyKey),
  uniqueIndex("inspiration_wiki_evidence_gap_analysis_revisions_pack_revision_unique").on(table.reviewPackId, table.nextRevision),
  index("inspiration_wiki_evidence_gap_analysis_revisions_pack_created_idx").on(table.reviewPackId, table.createdAt),
  check("inspiration_wiki_evidence_gap_analysis_revisions_kind_check", sql`${table.analysisKind} = 'SIX_ANALYZED_THREE_UNKNOWN'`),
  check("inspiration_wiki_evidence_gap_analysis_revisions_revision_check", sql`${table.previousRevision} > 0 and ${table.nextRevision} = ${table.previousRevision} + 1`),
  check("inspiration_wiki_evidence_gap_analysis_revisions_hash_check", sql`length(${table.previousMaterialHash}) = 64 and ${table.previousMaterialHash} not glob '*[^0-9a-f]*' and length(${table.nextMaterialHash}) = 64 and ${table.nextMaterialHash} not glob '*[^0-9a-f]*' and length(${table.sourceArtifactDigest}) = 64 and ${table.sourceArtifactDigest} not glob '*[^0-9a-f]*' and length(${table.requestHash}) = 64 and ${table.requestHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_evidence_gap_analysis_revisions_key_check", sql`length(${table.idempotencyKey}) between 8 and 128`),
  check("inspiration_wiki_evidence_gap_analysis_revisions_json_check", sql`json_valid(${table.previousPackJson}) and json_type(${table.previousPackJson}) = 'object' and json_valid(${table.revisedPackJson}) and json_type(${table.revisedPackJson}) = 'object'`),
]);

/** D-19 editable private drafts. These precede canonical compilation and remain teacher-only. */
export const inspirationWikiPrivateWorkingDrafts = sqliteTable("inspiration_wiki_private_working_drafts", {
  draftId: text("draft_id").primaryKey(),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  sourceReviewPackId: text("source_review_pack_id").notNull(),
  sourceContractKind: text("source_contract_kind", { enum: ["STRICT_REVIEW_PACK", "EVIDENCE_GAP_REVIEW"] }).notNull(),
  sourceReviewRevision: integer("source_review_revision").notNull(),
  sourceDecisionId: text("source_decision_id").notNull(),
  revision: integer("revision").notNull(),
  stage: text("stage", { enum: ["EDITING", "READY_FOR_DOMAIN_REVIEW"] }).notNull(),
  contentHash: text("content_hash").notNull(),
  draftJson: text("draft_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  title: text("title").notNull(),
  primaryCategory: text("primary_category").notNull(),
  completionCount: integer("completion_count").notNull(),
  primaryPreviewUrl: text("primary_preview_url").notNull(),
  rightsStatus: text("rights_status", { enum: ["UNKNOWN"] }).notNull(),
  teacherPrivate: integer("teacher_private", { mode: "boolean" }).notNull().default(true),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_private_working_drafts_candidate_unique").on(table.candidateId),
  uniqueIndex("inspiration_wiki_private_working_drafts_review_pack_unique").on(table.sourceReviewPackId),
  uniqueIndex("inspiration_wiki_private_working_drafts_decision_unique").on(table.sourceDecisionId),
  index("inspiration_wiki_private_working_drafts_stage_category_idx").on(table.stage, table.primaryCategory),
  check("inspiration_wiki_private_working_drafts_revision_check", sql`${table.revision} > 0 and ${table.sourceReviewRevision} > 0`),
  check("inspiration_wiki_private_working_drafts_hash_check", sql`length(${table.contentHash}) = 64 and ${table.contentHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_private_working_drafts_json_check", sql`json_valid(${table.draftJson}) and json_type(${table.draftJson}) = 'object'`),
  check("inspiration_wiki_private_working_drafts_completion_check", sql`${table.completionCount} between 0 and 7`),
  check("inspiration_wiki_private_working_drafts_preview_check", sql`${table.primaryPreviewUrl} like '/api/teacher/inspiration-wiki/review-packs/%'`),
  check("inspiration_wiki_private_working_drafts_private_check", sql`${table.rightsStatus} = 'UNKNOWN' and ${table.teacherPrivate} = 1 and ${table.studentVisible} = 0 and ${table.currentPage} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED'`),
]);

export const inspirationWikiPrivateWorkingDraftRevisions = sqliteTable("inspiration_wiki_private_working_draft_revisions", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull()
    .references(() => inspirationWikiPrivateWorkingDrafts.draftId, { onDelete: "restrict" }),
  previousRevision: integer("previous_revision").notNull(),
  nextRevision: integer("next_revision").notNull(),
  operation: text("operation", { enum: ["INITIAL_COMPILE", "TEACHER_EDIT", "MARK_READY", "REOPEN_EDITING"] }).notNull(),
  actorType: text("actor_type", { enum: ["CODEX", "TEACHER"] }).notNull(),
  actorId: text("actor_id").notNull(),
  previousContentHash: text("previous_content_hash"),
  nextContentHash: text("next_content_hash").notNull(),
  previousDraftJson: text("previous_draft_json", { mode: "json" }).$type<JsonRecord>(),
  nextDraftJson: text("next_draft_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  note: text("note").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_private_working_draft_revisions_pack_revision_unique").on(table.draftId, table.nextRevision),
  uniqueIndex("inspiration_wiki_private_working_draft_revisions_actor_key_unique").on(table.actorId, table.idempotencyKey),
  index("inspiration_wiki_private_working_draft_revisions_created_idx").on(table.draftId, table.createdAt),
  check("inspiration_wiki_private_working_draft_revisions_revision_check", sql`${table.previousRevision} >= 0 and ${table.nextRevision} = ${table.previousRevision} + 1`),
  check("inspiration_wiki_private_working_draft_revisions_hash_check", sql`(${table.previousRevision} = 0 and ${table.previousContentHash} is null) or (${table.previousRevision} > 0 and length(${table.previousContentHash}) = 64 and ${table.previousContentHash} not glob '*[^0-9a-f]*')`),
  check("inspiration_wiki_private_working_draft_revisions_next_hash_check", sql`length(${table.nextContentHash}) = 64 and ${table.nextContentHash} not glob '*[^0-9a-f]*' and length(${table.requestHash}) = 64 and ${table.requestHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_private_working_draft_revisions_json_check", sql`((${table.previousRevision} = 0 and ${table.previousDraftJson} is null) or (${table.previousRevision} > 0 and json_valid(${table.previousDraftJson}) and json_type(${table.previousDraftJson}) = 'object')) and json_valid(${table.nextDraftJson}) and json_type(${table.nextDraftJson}) = 'object'`),
  check("inspiration_wiki_private_working_draft_revisions_key_check", sql`length(${table.idempotencyKey}) between 8 and 128 and length(trim(${table.note})) between 1 and 300`),
  check("inspiration_wiki_private_working_draft_revisions_actor_check", sql`(${table.operation} = 'INITIAL_COMPILE' and ${table.actorType} = 'CODEX') or (${table.operation} <> 'INITIAL_COMPILE' and ${table.actorType} = 'TEACHER')`),
]);

/** D-20 teacher-private pre-review. This does not satisfy the canonical S1 role gate. */
export const inspirationWikiPrivateDomainReviewCases = sqliteTable("inspiration_wiki_private_domain_review_cases", {
  reviewCaseId: text("review_case_id").primaryKey(),
  draftId: text("draft_id").notNull()
    .references(() => inspirationWikiPrivateWorkingDrafts.draftId, { onDelete: "restrict" }),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  draftRevision: integer("draft_revision").notNull(),
  draftContentHash: text("draft_content_hash").notNull(),
  revision: integer("revision").notNull(),
  stateHash: text("state_hash").notNull(),
  stage: text("stage", { enum: [
    "PENDING_DOMAIN_REVIEW",
    "DOMAIN_REVIEW_HOLD",
    "PRIVATE_DRAFT_REJECTED",
    "DOMAIN_REVIEW_COMPLETE",
  ] }).notNull(),
  domainsJson: text("domains_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  caseJson: text("case_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  reviewedDomainCount: integer("reviewed_domain_count").notNull(),
  title: text("title").notNull(),
  primaryCategory: text("primary_category").notNull(),
  primaryPreviewUrl: text("primary_preview_url").notNull(),
  rightsScope: text("rights_scope", { enum: ["UNKNOWN_PRIVATE_ONLY"] }).notNull(),
  teacherPrivate: integer("teacher_private", { mode: "boolean" }).notNull().default(true),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  canonicalCompilation: text("canonical_compilation", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_private_domain_review_cases_draft_revision_unique").on(table.draftId, table.draftRevision),
  index("inspiration_wiki_private_domain_review_cases_stage_updated_idx").on(table.stage, table.updatedAt),
  check("inspiration_wiki_private_domain_review_cases_revision_check", sql`${table.draftRevision} > 0 and ${table.revision} > 0`),
  check("inspiration_wiki_private_domain_review_cases_hash_check", sql`length(${table.draftContentHash}) = 64 and ${table.draftContentHash} not glob '*[^0-9a-f]*' and length(${table.stateHash}) = 64 and ${table.stateHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_private_domain_review_cases_stage_check", sql`${table.stage} in ('PENDING_DOMAIN_REVIEW','DOMAIN_REVIEW_HOLD','PRIVATE_DRAFT_REJECTED','DOMAIN_REVIEW_COMPLETE')`),
  check("inspiration_wiki_private_domain_review_cases_json_check", sql`json_valid(${table.domainsJson}) and json_type(${table.domainsJson}) = 'object' and json_valid(${table.caseJson}) and json_type(${table.caseJson}) = 'object'`),
  check("inspiration_wiki_private_domain_review_cases_count_check", sql`${table.reviewedDomainCount} between 0 and 4`),
  check("inspiration_wiki_private_domain_review_cases_preview_check", sql`${table.primaryPreviewUrl} like '/api/teacher/inspiration-wiki/review-packs/%'`),
  check("inspiration_wiki_private_domain_review_cases_boundary_check", sql`${table.rightsScope} = 'UNKNOWN_PRIVATE_ONLY' and ${table.teacherPrivate} = 1 and ${table.studentVisible} = 0 and ${table.currentPage} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED' and ${table.canonicalCompilation} = 'DISABLED'`),
]);

export const inspirationWikiPrivateDomainReviewDecisions = sqliteTable("inspiration_wiki_private_domain_review_decisions", {
  id: text("id").primaryKey(),
  reviewCaseId: text("review_case_id").notNull()
    .references(() => inspirationWikiPrivateDomainReviewCases.reviewCaseId, { onDelete: "restrict" }),
  previousCaseRevision: integer("previous_case_revision").notNull(),
  nextCaseRevision: integer("next_case_revision").notNull(),
  reviewDomain: text("review_domain", { enum: ["CURATION", "TEACHING", "RIGHTS", "SAFETY"] }).notNull(),
  decision: text("decision", { enum: ["APPROVE", "HOLD", "REJECT"] }).notNull(),
  assessmentJson: text("assessment_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  note: text("note").notNull(),
  reviewerId: text("reviewer_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  previousStage: text("previous_stage").notNull(),
  nextStage: text("next_stage").notNull(),
  previousStateHash: text("previous_state_hash").notNull(),
  nextStateHash: text("next_state_hash").notNull(),
  supersedesDecisionId: text("supersedes_decision_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  previousCaseJson: text("previous_case_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  nextCaseJson: text("next_case_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_private_domain_review_decisions_reviewer_key_unique").on(table.reviewerId, table.idempotencyKey),
  uniqueIndex("inspiration_wiki_private_domain_review_decisions_case_revision_unique").on(table.reviewCaseId, table.nextCaseRevision),
  index("inspiration_wiki_private_domain_review_decisions_case_created_idx").on(table.reviewCaseId, table.createdAt),
  check("inspiration_wiki_private_domain_review_decisions_revision_check", sql`${table.previousCaseRevision} > 0 and ${table.nextCaseRevision} = ${table.previousCaseRevision} + 1`),
  check("inspiration_wiki_private_domain_review_decisions_domain_check", sql`${table.reviewDomain} in ('CURATION','TEACHING','RIGHTS','SAFETY') and ${table.decision} in ('APPROVE','HOLD','REJECT')`),
  check("inspiration_wiki_private_domain_review_decisions_json_check", sql`json_valid(${table.assessmentJson}) and json_type(${table.assessmentJson}) = 'object' and json_valid(${table.previousCaseJson}) and json_type(${table.previousCaseJson}) = 'object' and json_valid(${table.nextCaseJson}) and json_type(${table.nextCaseJson}) = 'object'`),
  check("inspiration_wiki_private_domain_review_decisions_hash_check", sql`length(${table.previousStateHash}) = 64 and ${table.previousStateHash} not glob '*[^0-9a-f]*' and length(${table.nextStateHash}) = 64 and ${table.nextStateHash} not glob '*[^0-9a-f]*' and length(${table.requestHash}) = 64 and ${table.requestHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_private_domain_review_decisions_note_check", sql`length(${table.note}) <= 300 and ((${table.decision} = 'APPROVE') or length(trim(${table.note})) between 1 and 300)`),
  check("inspiration_wiki_private_domain_review_decisions_key_check", sql`length(${table.idempotencyKey}) between 8 and 128`),
]);

/** D-21 private compilation. These pages are not formal/current Wiki pages. */
export const inspirationWikiPrivatePages = sqliteTable("inspiration_wiki_private_pages", {
  pageId: text("page_id").primaryKey(),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  pageType: text("page_type", { enum: ["INSPIRATION_CASE"] }).notNull(),
  state: text("state", { enum: ["PRIVATE_COMPILED"] }).notNull(),
  title: text("title").notNull(),
  latestRevisionId: text("latest_revision_id").notNull(),
  latestTruthId: text("latest_truth_id").notNull(),
  revisionCount: integer("revision_count").notNull(),
  rightsScope: text("rights_scope", { enum: ["UNKNOWN_PRIVATE_ONLY"] }).notNull(),
  pageJson: text("page_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  teacherPrivate: integer("teacher_private", { mode: "boolean" }).notNull().default(true),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  privateCompilation: text("private_compilation", { enum: ["ENABLED"] }).notNull().default("ENABLED"),
  canonicalCompilation: text("canonical_compilation", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  formalRelease: text("formal_release", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_private_pages_candidate_unique").on(table.candidateId),
  index("inspiration_wiki_private_pages_updated_idx").on(table.updatedAt),
  check("inspiration_wiki_private_pages_identity_check", sql`${table.pageId} glob 'private-wiki-page:*' and ${table.pageType} = 'INSPIRATION_CASE' and ${table.state} = 'PRIVATE_COMPILED' and ${table.revisionCount} > 0`),
  check("inspiration_wiki_private_pages_json_check", sql`json_valid(${table.pageJson}) and json_type(${table.pageJson}) = 'object'`),
  check("inspiration_wiki_private_pages_boundary_check", sql`${table.rightsScope} = 'UNKNOWN_PRIVATE_ONLY' and ${table.teacherPrivate} = 1 and ${table.studentVisible} = 0 and ${table.privateCompilation} = 'ENABLED' and ${table.canonicalCompilation} = 'DISABLED' and ${table.currentPage} = 'DISABLED' and ${table.formalRelease} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED'`),
]);

export const inspirationWikiPrivatePageRevisions = sqliteTable("inspiration_wiki_private_page_revisions", {
  revisionId: text("revision_id").primaryKey(),
  pageId: text("page_id").notNull()
    .references(() => inspirationWikiPrivatePages.pageId, { onDelete: "restrict" }),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  revisionHash: text("revision_hash").notNull(),
  contentHash: text("content_hash").notNull(),
  draftId: text("draft_id").notNull()
    .references(() => inspirationWikiPrivateWorkingDrafts.draftId, { onDelete: "restrict" }),
  draftRevision: integer("draft_revision").notNull(),
  draftContentHash: text("draft_content_hash").notNull(),
  reviewCaseId: text("review_case_id").notNull()
    .references(() => inspirationWikiPrivateDomainReviewCases.reviewCaseId, { onDelete: "restrict" }),
  reviewCaseRevision: integer("review_case_revision").notNull(),
  reviewStateHash: text("review_state_hash").notNull(),
  decisionIdsJson: text("decision_ids_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  contentJson: text("content_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  revisionJson: text("revision_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  compiledAt: integer("compiled_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_private_page_revisions_page_revision_unique").on(table.pageId, table.revision),
  uniqueIndex("inspiration_wiki_private_page_revisions_source_unique").on(table.reviewCaseId, table.reviewCaseRevision),
  index("inspiration_wiki_private_page_revisions_candidate_idx").on(table.candidateId),
  check("inspiration_wiki_private_page_revisions_revision_check", sql`${table.revision} > 0 and ${table.draftRevision} > 0 and ${table.reviewCaseRevision} > 0`),
  check("inspiration_wiki_private_page_revisions_hash_check", sql`length(${table.revisionHash}) = 64 and ${table.revisionHash} not glob '*[^0-9a-f]*' and length(${table.contentHash}) = 64 and ${table.contentHash} not glob '*[^0-9a-f]*' and length(${table.draftContentHash}) = 64 and ${table.draftContentHash} not glob '*[^0-9a-f]*' and length(${table.reviewStateHash}) = 64 and ${table.reviewStateHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_private_page_revisions_json_check", sql`json_valid(${table.decisionIdsJson}) and json_type(${table.decisionIdsJson}) = 'object' and json_valid(${table.contentJson}) and json_type(${table.contentJson}) = 'object' and json_valid(${table.revisionJson}) and json_type(${table.revisionJson}) = 'object'`),
]);

export const inspirationWikiPrivateCompiledTruths = sqliteTable("inspiration_wiki_private_compiled_truths", {
  truthId: text("truth_id").primaryKey(),
  pageId: text("page_id").notNull()
    .references(() => inspirationWikiPrivatePages.pageId, { onDelete: "restrict" }),
  revisionId: text("revision_id").notNull()
    .references(() => inspirationWikiPrivatePageRevisions.revisionId, { onDelete: "restrict" }),
  truthHash: text("truth_hash").notNull(),
  contentHash: text("content_hash").notNull(),
  state: text("state", { enum: ["PRIVATE_COMPILED_PREVIEW"] }).notNull(),
  rightsScope: text("rights_scope", { enum: ["UNKNOWN_PRIVATE_ONLY"] }).notNull(),
  truthJson: text("truth_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  teacherPrivate: integer("teacher_private", { mode: "boolean" }).notNull().default(true),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  canonicalCompilation: text("canonical_compilation", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  formalRelease: text("formal_release", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  compiledAt: integer("compiled_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_private_compiled_truths_revision_unique").on(table.revisionId),
  index("inspiration_wiki_private_compiled_truths_page_idx").on(table.pageId),
  check("inspiration_wiki_private_compiled_truths_hash_check", sql`length(${table.truthHash}) = 64 and ${table.truthHash} not glob '*[^0-9a-f]*' and length(${table.contentHash}) = 64 and ${table.contentHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_private_compiled_truths_json_check", sql`json_valid(${table.truthJson}) and json_type(${table.truthJson}) = 'object'`),
  check("inspiration_wiki_private_compiled_truths_boundary_check", sql`${table.state} = 'PRIVATE_COMPILED_PREVIEW' and ${table.rightsScope} = 'UNKNOWN_PRIVATE_ONLY' and ${table.teacherPrivate} = 1 and ${table.studentVisible} = 0 and ${table.canonicalCompilation} = 'DISABLED' and ${table.currentPage} = 'DISABLED' and ${table.formalRelease} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED'`),
]);

/** D-22 role-governed private internal catalog. This is not a release or Current Page. */
export const inspirationWikiPrivateCatalogGovernanceCases = sqliteTable("inspiration_wiki_private_catalog_governance_cases", {
  governanceCaseId: text("governance_case_id").primaryKey(),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  pageId: text("page_id").notNull()
    .references(() => inspirationWikiPrivatePages.pageId, { onDelete: "restrict" }),
  pageRevisionId: text("page_revision_id").notNull()
    .references(() => inspirationWikiPrivatePageRevisions.revisionId, { onDelete: "restrict" }),
  truthId: text("truth_id").notNull()
    .references(() => inspirationWikiPrivateCompiledTruths.truthId, { onDelete: "restrict" }),
  reviewCaseId: text("review_case_id").notNull()
    .references(() => inspirationWikiPrivateDomainReviewCases.reviewCaseId, { onDelete: "restrict" }),
  policyRevisionId: text("policy_revision_id").notNull()
    .references(() => inspirationWikiRolePolicies.revisionId, { onDelete: "restrict" }),
  policyRevisionHash: text("policy_revision_hash").notNull(),
  targetHash: text("target_hash").notNull(),
  roleAssignmentIdsJson: text("role_assignment_ids_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  sourceDecisionIdsJson: text("source_decision_ids_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  decisionIdsJson: text("decision_ids_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  stage: text("stage", { enum: ["ROLE_REVIEW_COMPLETE"] }).notNull(),
  reviewerModel: text("reviewer_model", { enum: ["SINGLE_TEACHER_EXPLICIT_ROLES"] }).notNull(),
  rightsScope: text("rights_scope", { enum: ["UNKNOWN_PRIVATE_ONLY"] }).notNull(),
  caseJson: text("case_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  teacherPrivate: integer("teacher_private", { mode: "boolean" }).notNull().default(true),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  internalCatalog: text("internal_catalog", { enum: ["ENABLED"] }).notNull().default("ENABLED"),
  canonicalCompilation: text("canonical_compilation", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  formalRelease: text("formal_release", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_private_catalog_cases_revision_unique").on(table.pageRevisionId),
  index("inspiration_wiki_private_catalog_cases_page_idx").on(table.pageId, table.reviewedAt),
  check("inspiration_wiki_private_catalog_cases_identity_check", sql`${table.governanceCaseId} glob 'private-catalog-governance:*' and ${table.stage} = 'ROLE_REVIEW_COMPLETE' and ${table.reviewerModel} = 'SINGLE_TEACHER_EXPLICIT_ROLES'`),
  check("inspiration_wiki_private_catalog_cases_hash_check", sql`length(${table.policyRevisionHash}) = 71 and ${table.policyRevisionHash} like 'sha256:%' and length(${table.targetHash}) = 71 and ${table.targetHash} like 'sha256:%'`),
  check("inspiration_wiki_private_catalog_cases_json_check", sql`json_valid(${table.roleAssignmentIdsJson}) and json_type(${table.roleAssignmentIdsJson}) = 'object' and json_valid(${table.sourceDecisionIdsJson}) and json_type(${table.sourceDecisionIdsJson}) = 'object' and json_valid(${table.decisionIdsJson}) and json_type(${table.decisionIdsJson}) = 'object' and json_valid(${table.caseJson}) and json_type(${table.caseJson}) = 'object'`),
  check("inspiration_wiki_private_catalog_cases_boundary_check", sql`${table.rightsScope} = 'UNKNOWN_PRIVATE_ONLY' and ${table.teacherPrivate} = 1 and ${table.studentVisible} = 0 and ${table.internalCatalog} = 'ENABLED' and ${table.canonicalCompilation} = 'DISABLED' and ${table.currentPage} = 'DISABLED' and ${table.formalRelease} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED'`),
]);

export const inspirationWikiPrivateCatalogDomainDecisions = sqliteTable("inspiration_wiki_private_catalog_domain_decisions", {
  decisionId: text("decision_id").primaryKey(),
  decisionHash: text("decision_hash").notNull(),
  governanceCaseId: text("governance_case_id").notNull()
    .references(() => inspirationWikiPrivateCatalogGovernanceCases.governanceCaseId, { onDelete: "restrict" }),
  reviewDomain: text("review_domain", { enum: ["CURATION", "TEACHING", "RIGHTS", "SAFETY"] }).notNull(),
  decision: text("decision", { enum: ["APPROVE_PRIVATE_INTERNAL_CATALOG"] }).notNull(),
  actorId: text("actor_id").notNull(),
  authenticatedTeacherId: text("authenticated_teacher_id").notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  actorRoleAssignmentId: text("actor_role_assignment_id").notNull()
    .references(() => inspirationWikiReviewerAssignments.assignmentId, { onDelete: "restrict" }),
  sourcePrivateDecisionId: text("source_private_decision_id").notNull()
    .references(() => inspirationWikiPrivateDomainReviewDecisions.id, { onDelete: "restrict" }),
  targetHash: text("target_hash").notNull(),
  interpretation: text("interpretation", { enum: ["CURATION_ACCEPTED", "TEACHING_ACCEPTED", "UNKNOWN_PRIVATE_ONLY_ACCEPTED", "SAFETY_ACCEPTED"] }).notNull(),
  decisionJson: text("decision_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  decidedAt: integer("decided_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_private_catalog_decisions_case_domain_unique").on(table.governanceCaseId, table.reviewDomain),
  uniqueIndex("inspiration_wiki_private_catalog_decisions_source_unique").on(table.sourcePrivateDecisionId),
  index("inspiration_wiki_private_catalog_decisions_actor_idx").on(table.actorId, table.reviewDomain),
  index("inspiration_wiki_private_catalog_decisions_teacher_idx").on(table.authenticatedTeacherId, table.reviewDomain),
  check("inspiration_wiki_private_catalog_decisions_hash_check", sql`length(${table.decisionHash}) = 71 and ${table.decisionHash} like 'sha256:%' and length(${table.targetHash}) = 71 and ${table.targetHash} like 'sha256:%'`),
  check("inspiration_wiki_private_catalog_decisions_json_check", sql`json_valid(${table.decisionJson}) and json_type(${table.decisionJson}) = 'object'`),
]);

export const inspirationWikiPrivateInternalCatalogEntries = sqliteTable("inspiration_wiki_private_internal_catalog_entries", {
  entryId: text("entry_id").primaryKey(),
  entryHash: text("entry_hash").notNull(),
  governanceCaseId: text("governance_case_id").notNull()
    .references(() => inspirationWikiPrivateCatalogGovernanceCases.governanceCaseId, { onDelete: "restrict" }),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  pageId: text("page_id").notNull()
    .references(() => inspirationWikiPrivatePages.pageId, { onDelete: "restrict" }),
  pageRevisionId: text("page_revision_id").notNull()
    .references(() => inspirationWikiPrivatePageRevisions.revisionId, { onDelete: "restrict" }),
  truthId: text("truth_id").notNull()
    .references(() => inspirationWikiPrivateCompiledTruths.truthId, { onDelete: "restrict" }),
  policyRevisionId: text("policy_revision_id").notNull()
    .references(() => inspirationWikiRolePolicies.revisionId, { onDelete: "restrict" }),
  policyRevisionHash: text("policy_revision_hash").notNull(),
  targetHash: text("target_hash").notNull(),
  acceptedDecisionIdsJson: text("accepted_decision_ids_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  state: text("state", { enum: ["INTERNAL_CATALOG_ACTIVE"] }).notNull(),
  rightsScope: text("rights_scope", { enum: ["UNKNOWN_PRIVATE_ONLY"] }).notNull(),
  entryJson: text("entry_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  teacherPrivate: integer("teacher_private", { mode: "boolean" }).notNull().default(true),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  internalCatalog: text("internal_catalog", { enum: ["ENABLED"] }).notNull().default("ENABLED"),
  canonicalCompilation: text("canonical_compilation", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  formalRelease: text("formal_release", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  activatedAt: integer("activated_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_private_internal_catalog_case_unique").on(table.governanceCaseId),
  uniqueIndex("inspiration_wiki_private_internal_catalog_revision_unique").on(table.pageRevisionId),
  index("inspiration_wiki_private_internal_catalog_page_idx").on(table.pageId, table.activatedAt),
  check("inspiration_wiki_private_internal_catalog_hash_check", sql`length(${table.entryHash}) = 71 and ${table.entryHash} like 'sha256:%' and length(${table.policyRevisionHash}) = 71 and ${table.policyRevisionHash} like 'sha256:%' and length(${table.targetHash}) = 71 and ${table.targetHash} like 'sha256:%'`),
  check("inspiration_wiki_private_internal_catalog_json_check", sql`json_valid(${table.acceptedDecisionIdsJson}) and json_type(${table.acceptedDecisionIdsJson}) = 'object' and json_valid(${table.entryJson}) and json_type(${table.entryJson}) = 'object'`),
  check("inspiration_wiki_private_internal_catalog_boundary_check", sql`${table.state} = 'INTERNAL_CATALOG_ACTIVE' and ${table.rightsScope} = 'UNKNOWN_PRIVATE_ONLY' and ${table.teacherPrivate} = 1 and ${table.studentVisible} = 0 and ${table.internalCatalog} = 'ENABLED' and ${table.canonicalCompilation} = 'DISABLED' and ${table.currentPage} = 'DISABLED' and ${table.formalRelease} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED'`),
]);

/** P2 migration snapshot. SHADOW is a hard student-read interlock, never a release. */
export const inspirationWikiP2ChannelSnapshots = sqliteTable("inspiration_wiki_p2_channel_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(),
  snapshotHash: text("snapshot_hash").notNull(),
  sourceReadinessHash: text("source_readiness_hash").notNull(),
  sourceSetHash: text("source_set_hash").notNull(),
  schemaVersion: text("schema_version", { enum: ["lumi-inspiration-p2-channel-shadow-snapshot/v1"] }).notNull(),
  mode: text("mode", { enum: ["SHADOW"] }).notNull(),
  browseRelease: text("browse_release", { enum: ["SHADOW"] }).notNull(),
  studentSearch: text("student_search", { enum: ["SHADOW"] }).notNull(),
  wikiRetrieval: text("wiki_retrieval", { enum: ["DISABLED"] }).notNull(),
  totalCount: integer("total_count").notNull(),
  eligibleCount: integer("eligible_count").notNull(),
  blockedCount: integer("blocked_count").notNull(),
  rightsUnknownCount: integer("rights_unknown_count").notNull(),
  eligiblePageIdsJson: text("eligible_page_ids_json", { mode: "json" }).$type<string[]>().notNull(),
  restrictedPageIdsJson: text("restricted_page_ids_json", { mode: "json" }).$type<string[]>().notNull(),
  snapshotJson: text("snapshot_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  productionDeployment: text("production_deployment", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  formalRelease: text("formal_release", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_p2_channel_source_unique").on(table.sourceReadinessHash),
  index("inspiration_wiki_p2_channel_created_idx").on(table.createdAt, table.snapshotId),
  check("inspiration_wiki_p2_channel_id_check", sql`${table.snapshotId} glob 'p2-channel-shadow:*'`),
  check("inspiration_wiki_p2_channel_hash_check", sql`length(${table.snapshotHash}) = 71 and ${table.snapshotHash} like 'sha256:%' and length(${table.sourceReadinessHash}) = 71 and ${table.sourceReadinessHash} like 'sha256:%' and length(${table.sourceSetHash}) = 71 and ${table.sourceSetHash} like 'sha256:%'`),
  check("inspiration_wiki_p2_channel_count_check", sql`${table.totalCount} >= 0 and ${table.eligibleCount} = 0 and ${table.totalCount} = ${table.blockedCount} and ${table.totalCount} = ${table.rightsUnknownCount}`),
  check("inspiration_wiki_p2_channel_json_check", sql`json_valid(${table.eligiblePageIdsJson}) and json_type(${table.eligiblePageIdsJson}) = 'array' and json_array_length(${table.eligiblePageIdsJson}) = 0 and json_valid(${table.restrictedPageIdsJson}) and json_type(${table.restrictedPageIdsJson}) = 'array' and json_array_length(${table.restrictedPageIdsJson}) = ${table.blockedCount} and json_valid(${table.snapshotJson}) and json_type(${table.snapshotJson}) = 'object'`),
  check("inspiration_wiki_p2_channel_boundary_check", sql`${table.mode} = 'SHADOW' and ${table.browseRelease} = 'SHADOW' and ${table.studentSearch} = 'SHADOW' and ${table.wikiRetrieval} = 'DISABLED' and ${table.studentVisible} = 0 and ${table.productionDeployment} = 'DISABLED' and ${table.formalRelease} = 'DISABLED' and ${table.currentPage} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED'`),
]);

/** D-25 formal-release qualification workbench. Qualification is not release or student activation. */
export const inspirationWikiReleaseQualificationCases = sqliteTable("inspiration_wiki_release_qualification_cases", {
  caseId: text("case_id").primaryKey(),
  caseHash: text("case_hash").notNull(),
  entryId: text("entry_id").notNull().references(() => inspirationWikiPrivateInternalCatalogEntries.entryId, { onDelete: "restrict" }),
  pageId: text("page_id").notNull().references(() => inspirationWikiPrivatePages.pageId, { onDelete: "restrict" }),
  pageRevisionId: text("page_revision_id").notNull().references(() => inspirationWikiPrivatePageRevisions.revisionId, { onDelete: "restrict" }),
  contentHash: text("content_hash").notNull(),
  primaryCategory: text("primary_category").notNull(),
  caseJson: text("case_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  teacherPrivate: integer("teacher_private", { mode: "boolean" }).notNull().default(true),
  formalQualificationOnly: integer("formal_qualification_only", { mode: "boolean" }).notNull().default(true),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  formalRelease: text("formal_release", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  browseRelease: text("browse_release", { enum: ["SHADOW"] }).notNull().default("SHADOW"),
  studentSearch: text("student_search", { enum: ["SHADOW"] }).notNull().default("SHADOW"),
  wikiRetrieval: text("wiki_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  productionDeployment: text("production_deployment", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_release_qualification_entry_unique").on(table.entryId),
  uniqueIndex("inspiration_wiki_release_qualification_revision_unique").on(table.pageRevisionId),
  index("inspiration_wiki_release_qualification_category_idx").on(table.primaryCategory, table.createdAt),
  check("inspiration_wiki_release_qualification_case_id_check", sql`${table.caseId} glob 'release-qualification:*'`),
  check("inspiration_wiki_release_qualification_case_hash_check", sql`length(${table.caseHash}) = 71 and ${table.caseHash} like 'sha256:%' and length(${table.contentHash}) = 64 and ${table.contentHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_release_qualification_case_json_check", sql`json_valid(${table.caseJson}) and json_type(${table.caseJson}) = 'object'`),
  check("inspiration_wiki_release_qualification_case_boundary_check", sql`${table.teacherPrivate} = 1 and ${table.formalQualificationOnly} = 1 and ${table.studentVisible} = 0 and ${table.formalRelease} = 'DISABLED' and ${table.currentPage} = 'DISABLED' and ${table.browseRelease} = 'SHADOW' and ${table.studentSearch} = 'SHADOW' and ${table.wikiRetrieval} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED' and ${table.productionDeployment} = 'DISABLED'`),
]);

export const inspirationWikiReleaseQualificationDecisions = sqliteTable("inspiration_wiki_release_qualification_decisions", {
  decisionId: text("decision_id").primaryKey(),
  decisionHash: text("decision_hash").notNull(),
  requestHash: text("request_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  caseId: text("case_id").notNull().references(() => inspirationWikiReleaseQualificationCases.caseId, { onDelete: "restrict" }),
  gate: text("gate", { enum: ["STUDENT_DISPLAY_RIGHTS", "AUDIENCE_POLICY", "SOURCE_DISCLOSURE", "WITHDRAWAL_READINESS", "RELEASE_ROLE_SIGNOFF"] }).notNull(),
  status: text("status", { enum: ["SATISFIED", "BLOCKED"] }).notNull(),
  evidenceRef: text("evidence_ref"),
  note: text("note").notNull(),
  actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  decisionJson: text("decision_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  decidedAt: integer("decided_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_release_qualification_idempotency_unique").on(table.idempotencyKey),
  uniqueIndex("inspiration_wiki_release_qualification_gate_revision_unique").on(table.caseId, table.gate, table.revision),
  index("inspiration_wiki_release_qualification_decision_case_idx").on(table.caseId, table.decidedAt),
  check("inspiration_wiki_release_qualification_decision_id_check", sql`${table.decisionId} glob 'release-qualification-decision:*'`),
  check("inspiration_wiki_release_qualification_decision_hash_check", sql`length(${table.decisionHash}) = 71 and ${table.decisionHash} like 'sha256:%' and length(${table.requestHash}) = 71 and ${table.requestHash} like 'sha256:%'`),
  check("inspiration_wiki_release_qualification_decision_json_check", sql`json_valid(${table.decisionJson}) and json_type(${table.decisionJson}) = 'object'`),
  check("inspiration_wiki_release_qualification_decision_revision_check", sql`${table.revision} >= 1`),
  check("inspiration_wiki_release_qualification_rights_evidence_check", sql`${table.gate} <> 'STUDENT_DISPLAY_RIGHTS' or ${table.status} <> 'SATISFIED' or (${table.evidenceRef} is not null and length(trim(${table.evidenceRef})) > 0)`),
]);

/** Canonical inspiration pages remain inert until an immutable formal release activates a Current Page event. */
export const inspirationWikiCanonicalPages = sqliteTable("inspiration_wiki_canonical_pages", {
  canonicalPageId: text("canonical_page_id").primaryKey(),
  candidateId: text("candidate_id").notNull()
    .references(() => inspirationWikiHermesCandidates.id, { onDelete: "restrict" }),
  pageType: text("page_type", { enum: ["INSPIRATION_CASE"] }).notNull(),
  pageJson: text("page_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  canonical: integer("canonical", { mode: "boolean" }).notNull().default(true),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  formalRelease: text("formal_release", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_canonical_pages_candidate_unique").on(table.candidateId),
  check("inspiration_wiki_canonical_pages_id_check", sql`${table.canonicalPageId} glob 'wiki-page:*' and length(${table.canonicalPageId}) = 42`),
  check("inspiration_wiki_canonical_pages_json_check", sql`json_valid(${table.pageJson}) and json_type(${table.pageJson}) = 'object'`),
  check("inspiration_wiki_canonical_pages_inert_check", sql`${table.pageType} = 'INSPIRATION_CASE' and ${table.canonical} = 1 and ${table.studentVisible} = 0 and ${table.currentPage} = 'DISABLED' and ${table.formalRelease} = 'DISABLED'`),
]);

export const inspirationWikiCanonicalPageRevisions = sqliteTable("inspiration_wiki_canonical_page_revisions", {
  canonicalRevisionId: text("canonical_revision_id").primaryKey(),
  canonicalPageId: text("canonical_page_id").notNull()
    .references(() => inspirationWikiCanonicalPages.canonicalPageId, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  revisionHash: text("revision_hash").notNull(),
  caseId: text("case_id").notNull()
    .references(() => inspirationWikiReleaseQualificationCases.caseId, { onDelete: "restrict" }),
  sourcePrivatePageId: text("source_private_page_id").notNull()
    .references(() => inspirationWikiPrivatePages.pageId, { onDelete: "restrict" }),
  sourcePrivateRevisionId: text("source_private_revision_id").notNull()
    .references(() => inspirationWikiPrivatePageRevisions.revisionId, { onDelete: "restrict" }),
  sourceContentHash: text("source_content_hash").notNull(),
  materialJson: text("material_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  assetsJson: text("assets_json", { mode: "json" }).$type<JsonRecord[]>().notNull(),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(false),
  formalRelease: text("formal_release", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  currentPage: text("current_page", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  productionDeployment: text("production_deployment", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  compiledAt: integer("compiled_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_canonical_revisions_case_unique").on(table.caseId),
  uniqueIndex("inspiration_wiki_canonical_revisions_page_revision_unique").on(table.canonicalPageId, table.revision),
  check("inspiration_wiki_canonical_revisions_id_check", sql`${table.canonicalRevisionId} glob 'wiki-page-revision:*'`),
  check("inspiration_wiki_canonical_revisions_revision_check", sql`${table.revision} >= 1`),
  check("inspiration_wiki_canonical_revisions_hash_check", sql`length(${table.revisionHash}) = 71 and ${table.revisionHash} like 'sha256:%' and length(${table.sourceContentHash}) = 64 and ${table.sourceContentHash} not glob '*[^0-9a-f]*'`),
  check("inspiration_wiki_canonical_revisions_json_check", sql`json_valid(${table.materialJson}) and json_type(${table.materialJson}) = 'object' and json_valid(${table.assetsJson}) and json_type(${table.assetsJson}) = 'array' and json_array_length(${table.assetsJson}) >= 1`),
  check("inspiration_wiki_canonical_revisions_inert_check", sql`${table.studentVisible} = 0 and ${table.formalRelease} = 'DISABLED' and ${table.currentPage} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED' and ${table.productionDeployment} = 'DISABLED'`),
]);

export const inspirationWikiFormalReleases = sqliteTable("inspiration_wiki_formal_releases", {
  releaseId: text("release_id").primaryKey(),
  releaseHash: text("release_hash").notNull(),
  requestHash: text("request_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  caseId: text("case_id").notNull()
    .references(() => inspirationWikiReleaseQualificationCases.caseId, { onDelete: "restrict" }),
  caseHash: text("case_hash").notNull(),
  canonicalPageId: text("canonical_page_id").notNull()
    .references(() => inspirationWikiCanonicalPages.canonicalPageId, { onDelete: "restrict" }),
  canonicalRevisionId: text("canonical_revision_id").notNull()
    .references(() => inspirationWikiCanonicalPageRevisions.canonicalRevisionId, { onDelete: "restrict" }),
  qualificationDecisionIdsJson: text("qualification_decision_ids_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  releaseJson: text("release_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  status: text("status", { enum: ["PUBLISHED"] }).notNull(),
  publishedBy: text("published_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(true),
  formalRelease: text("formal_release", { enum: ["ACTIVE"] }).notNull().default("ACTIVE"),
  currentPage: text("current_page", { enum: ["ACTIVE"] }).notNull().default("ACTIVE"),
  browseRelease: text("browse_release", { enum: ["ACTIVE"] }).notNull().default("ACTIVE"),
  studentSearch: text("student_search", { enum: ["ACTIVE"] }).notNull().default("ACTIVE"),
  preview: text("preview", { enum: ["ACTIVE"] }).notNull().default("ACTIVE"),
  wikiRetrieval: text("wiki_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  productionDeployment: text("production_deployment", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_formal_releases_idempotency_unique").on(table.idempotencyKey),
  uniqueIndex("inspiration_wiki_formal_releases_case_unique").on(table.caseId),
  uniqueIndex("inspiration_wiki_formal_releases_revision_unique").on(table.canonicalRevisionId),
  check("inspiration_wiki_formal_releases_id_check", sql`${table.releaseId} glob 'wiki-release:*' and length(${table.releaseId}) = 45`),
  check("inspiration_wiki_formal_releases_hash_check", sql`length(${table.releaseHash}) = 71 and ${table.releaseHash} like 'sha256:%' and length(${table.requestHash}) = 71 and ${table.requestHash} like 'sha256:%' and length(${table.caseHash}) = 71 and ${table.caseHash} like 'sha256:%'`),
  check("inspiration_wiki_formal_releases_json_check", sql`json_valid(${table.qualificationDecisionIdsJson}) and json_type(${table.qualificationDecisionIdsJson}) = 'object' and json_valid(${table.releaseJson}) and json_type(${table.releaseJson}) = 'object'`),
  check("inspiration_wiki_formal_releases_boundary_check", sql`${table.status} = 'PUBLISHED' and ${table.studentVisible} = 1 and ${table.formalRelease} = 'ACTIVE' and ${table.currentPage} = 'ACTIVE' and ${table.browseRelease} = 'ACTIVE' and ${table.studentSearch} = 'ACTIVE' and ${table.preview} = 'ACTIVE' and ${table.wikiRetrieval} = 'DISABLED' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED' and ${table.productionDeployment} = 'DISABLED'`),
]);

export const inspirationWikiCurrentPageEvents = sqliteTable("inspiration_wiki_current_page_events", {
  eventId: text("event_id").primaryKey(),
  eventHash: text("event_hash").notNull(),
  requestHash: text("request_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  canonicalPageId: text("canonical_page_id").notNull()
    .references(() => inspirationWikiCanonicalPages.canonicalPageId, { onDelete: "restrict" }),
  canonicalRevisionId: text("canonical_revision_id").notNull()
    .references(() => inspirationWikiCanonicalPageRevisions.canonicalRevisionId, { onDelete: "restrict" }),
  releaseId: text("release_id").notNull()
    .references(() => inspirationWikiFormalReleases.releaseId, { onDelete: "restrict" }),
  eventType: text("event_type", { enum: ["ACTIVATED", "WITHDRAWN"] }).notNull(),
  reason: text("reason").notNull(),
  actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  eventJson: text("event_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_current_page_events_idempotency_unique").on(table.idempotencyKey),
  index("inspiration_wiki_current_page_events_page_created_idx").on(table.canonicalPageId, table.createdAt),
  check("inspiration_wiki_current_page_events_id_check", sql`${table.eventId} glob 'current-page-event:*' and length(${table.eventId}) = 51`),
  check("inspiration_wiki_current_page_events_hash_check", sql`length(${table.eventHash}) = 71 and ${table.eventHash} like 'sha256:%' and length(${table.requestHash}) = 71 and ${table.requestHash} like 'sha256:%'`),
  check("inspiration_wiki_current_page_events_json_check", sql`json_valid(${table.eventJson}) and json_type(${table.eventJson}) = 'object' and length(trim(${table.reason})) > 0`),
]);

export const inspirationWikiP2ActiveChannelSnapshots = sqliteTable("inspiration_wiki_p2_active_channel_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(),
  snapshotHash: text("snapshot_hash").notNull(),
  releaseSetHash: text("release_set_hash").notNull(),
  schemaVersion: text("schema_version", { enum: ["lumi-inspiration-p2-active-channel-snapshot/v1"] }).notNull(),
  mode: text("mode", { enum: ["ACTIVE"] }).notNull(),
  releaseIdsJson: text("release_ids_json", { mode: "json" }).$type<string[]>().notNull(),
  canonicalPageIdsJson: text("canonical_page_ids_json", { mode: "json" }).$type<string[]>().notNull(),
  browseRelease: text("browse_release", { enum: ["ACTIVE"] }).notNull(),
  studentSearch: text("student_search", { enum: ["ACTIVE"] }).notNull(),
  preview: text("preview", { enum: ["ACTIVE"] }).notNull(),
  wikiRetrieval: text("wiki_retrieval", { enum: ["DISABLED"] }).notNull(),
  snapshotJson: text("snapshot_json", { mode: "json" }).$type<JsonRecord>().notNull(),
  studentVisible: integer("student_visible", { mode: "boolean" }).notNull().default(true),
  formalRelease: text("formal_release", { enum: ["ACTIVE"] }).notNull(),
  currentPage: text("current_page", { enum: ["ACTIVE"] }).notNull(),
  r2: text("r2", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  embedding: text("embedding", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  lumiRetrieval: text("lumi_retrieval", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  productionDeployment: text("production_deployment", { enum: ["DISABLED"] }).notNull().default("DISABLED"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("inspiration_wiki_p2_active_release_set_unique").on(table.releaseSetHash),
  index("inspiration_wiki_p2_active_created_idx").on(table.createdAt, table.snapshotId),
  check("inspiration_wiki_p2_active_id_check", sql`${table.snapshotId} glob 'p2-channel-active:*' and length(${table.snapshotId}) = 50`),
  check("inspiration_wiki_p2_active_hash_check", sql`length(${table.snapshotHash}) = 71 and ${table.snapshotHash} like 'sha256:%' and length(${table.releaseSetHash}) = 71 and ${table.releaseSetHash} like 'sha256:%'`),
  check("inspiration_wiki_p2_active_json_check", sql`json_valid(${table.releaseIdsJson}) and json_type(${table.releaseIdsJson}) = 'array' and json_valid(${table.canonicalPageIdsJson}) and json_type(${table.canonicalPageIdsJson}) = 'array' and json_array_length(${table.canonicalPageIdsJson}) = json_array_length(${table.releaseIdsJson}) and json_valid(${table.snapshotJson}) and json_type(${table.snapshotJson}) = 'object'`),
  check("inspiration_wiki_p2_active_boundary_check", sql`${table.mode} = 'ACTIVE' and ${table.browseRelease} = 'ACTIVE' and ${table.studentSearch} = 'ACTIVE' and ${table.preview} = 'ACTIVE' and ${table.wikiRetrieval} = 'DISABLED' and ${table.studentVisible} = 1 and ${table.formalRelease} = 'ACTIVE' and ${table.currentPage} = 'ACTIVE' and ${table.r2} = 'DISABLED' and ${table.embedding} = 'DISABLED' and ${table.lumiRetrieval} = 'DISABLED' and ${table.productionDeployment} = 'DISABLED'`),
]);
