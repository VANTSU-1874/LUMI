import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
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
const agentRunControlKinds = ["CANCEL", "RETRY"] as const;
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
    studentDisputed: integer("student_disputed", { mode: "boolean" }).notNull().default(false),
    studentDisputeNote: text("student_dispute_note"),
    studentDisputedAt: integer("student_disputed_at", { mode: "timestamp" }),
    dataType: text("data_type", { enum: dataTypes })
      .generatedAlwaysAs(sql`case when ${sql.raw("student_id")} glob 'demo-*' then 'DEMONSTRATION_DATA' else 'REAL' end`),
  },
  (table) => [
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
