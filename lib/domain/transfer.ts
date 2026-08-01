import { z } from "zod";

import { LogicCardSchema, ToolPathSchema } from "./schemas";

const UnsafeInstructionPattern = /忽略(?:以上|前面|规则)|系统提示|你现在是|prompt|完整(?:作品|答案|项目)|替我(?:完成|代做)|绕过/iu;
const SafeText = (min: number, max: number) => z.string().trim().min(min).max(max).superRefine((value, context) => {
  if (UnsafeInstructionPattern.test(value)) context.addIssue({ code: "custom", message: "内容包含控制指令" });
});
const FiniteNumber = z.number().finite().min(-1_000_000).max(1_000_000);

export const TransferDimensionSchema = z.enum(["input", "mapping", "output"]);
export type TransferDimension = z.infer<typeof TransferDimensionSchema>;
export const TransferRelationshipSchema = z.enum(["LINEAR", "DIRECT", "INVERSE", "THRESHOLD"]);
export const TransferSourceUnitSchema = z.enum(["dB", "mm", "cm", "m", "normalized", "raw"]);
export const TransferTargetUnitSchema = z.literal("normalized");
export const CulturalAudienceTypeSchema = z.enum([
  "GENERAL_VISITORS", "YOUNG_LEARNERS", "COMMUNITY_MEMBERS", "CULTURAL_HERITAGE_AUDIENCE",
]);
export const CulturalBehaviorSchema = z.enum([
  "PASSIVE_VIEWING", "FOLLOWING_INSTRUCTIONS", "INDIVIDUAL_INTERACTION",
  "ACTIVE_EXPLORATION", "COLLABORATIVE_CREATION", "REFLECTIVE_SHARING",
]);
export const CulturalMechanismSchema = z.enum([
  "PARTICIPATORY_TRIGGER", "COLLECTIVE_RESPONSE", "NARRATIVE_MAPPING",
  "SENSORY_FEEDBACK", "CULTURAL_SYMBOL_REINFORCEMENT",
]);

export const TransferAnswerSchema = z.object({
  retainedStructure: z.object({
    culturalIntent: SafeText(2, 500),
    input: SafeText(2, 500),
    mapping: SafeText(2, 500),
    output: SafeText(2, 500),
  }).strict(),
  changedParts: z.object({
    dimension: TransferDimensionSchema,
    from: SafeText(2, 500),
    to: SafeText(2, 500),
    rationale: SafeText(10, 300).optional(),
  }).strict().refine((value) => value.from.normalize("NFKC").trim() !== value.to.normalize("NFKC").trim(), {
    message: "改变前后不能相同",
  }),
  normalization: z.object({
    sourceMin: FiniteNumber,
    sourceMax: FiniteNumber,
    sourceUnit: TransferSourceUnitSchema,
    targetMin: FiniteNumber,
    targetMax: FiniteNumber,
    targetUnit: TransferTargetUnitSchema,
    relationship: TransferRelationshipSchema,
  }).strict().refine((value) => value.sourceMin < value.sourceMax && value.targetMin < value.targetMax, {
    message: "数值范围必须递增",
  }),
  culturalImpact: z.object({
    audienceType: CulturalAudienceTypeSchema,
    behaviorBefore: CulturalBehaviorSchema,
    behaviorAfter: CulturalBehaviorSchema,
    intentAnchorId: z.string().regex(/^intent_[a-f0-9]{16}$/),
    mechanism: CulturalMechanismSchema,
    reflection: SafeText(4, 300).optional(),
  }).strict().refine((value) => value.behaviorBefore !== value.behaviorAfter, { message: "行为前后必须不同" }),
}).strict();
export type TransferAnswer = z.infer<typeof TransferAnswerSchema>;

const DraftText = z.string().max(1_000);
const DraftChoice = <T extends z.ZodType>(schema: T) => z.union([z.literal(""), schema]);
export const TransferAnswerDraftSchema = z.object({
  retainedStructure: z.object({
    culturalIntent: DraftText, input: DraftText, mapping: DraftText, output: DraftText,
  }).strict(),
  changedParts: z.object({
    dimension: DraftChoice(TransferDimensionSchema), from: DraftText, to: DraftText, rationale: DraftText,
  }).strict(),
  normalization: z.object({
    sourceMin: DraftText, sourceMax: DraftText, sourceUnit: DraftChoice(TransferSourceUnitSchema),
    targetMin: DraftText, targetMax: DraftText, targetUnit: DraftChoice(TransferTargetUnitSchema),
    relationship: DraftChoice(TransferRelationshipSchema),
  }).strict(),
  culturalImpact: z.object({
    audienceType: DraftChoice(CulturalAudienceTypeSchema),
    behaviorBefore: DraftChoice(CulturalBehaviorSchema),
    behaviorAfter: DraftChoice(CulturalBehaviorSchema),
    intentAnchorId: DraftText,
    mechanism: DraftChoice(CulturalMechanismSchema),
  }).strict(),
}).strict();
export type TransferAnswerDraft = z.infer<typeof TransferAnswerDraftSchema>;

export function createEmptyTransferAnswerDraft(): TransferAnswerDraft {
  return {
    retainedStructure: { culturalIntent: "", input: "", mapping: "", output: "" },
    changedParts: { dimension: "", from: "", to: "", rationale: "" },
    normalization: {
      sourceMin: "", sourceMax: "", sourceUnit: "", targetMin: "", targetMax: "", targetUnit: "", relationship: "",
    },
    culturalImpact: { audienceType: "", behaviorBefore: "", behaviorAfter: "", intentAnchorId: "", mechanism: "" },
  };
}

export function draftToAnswer(rawDraft: unknown): TransferAnswer | null {
  const parsed = TransferAnswerDraftSchema.safeParse(rawDraft);
  if (!parsed.success) return null;
  const draft = parsed.data;
  const requiredText = [
    ...Object.values(draft.retainedStructure), draft.changedParts.dimension, draft.changedParts.from, draft.changedParts.to,
    draft.normalization.sourceMin, draft.normalization.sourceMax, draft.normalization.sourceUnit,
    draft.normalization.targetMin, draft.normalization.targetMax, draft.normalization.targetUnit, draft.normalization.relationship,
    draft.culturalImpact.audienceType, draft.culturalImpact.behaviorBefore, draft.culturalImpact.behaviorAfter,
    draft.culturalImpact.intentAnchorId, draft.culturalImpact.mechanism,
  ];
  if (requiredText.some((value) => value.trim() === "")) return null;
  const sourceMin = Number(draft.normalization.sourceMin);
  const sourceMax = Number(draft.normalization.sourceMax);
  const targetMin = Number(draft.normalization.targetMin);
  const targetMax = Number(draft.normalization.targetMax);
  if (![sourceMin, sourceMax, targetMin, targetMax].every(Number.isFinite)) return null;
  const answer = TransferAnswerSchema.safeParse({
    retainedStructure: draft.retainedStructure,
    changedParts: {
      dimension: draft.changedParts.dimension, from: draft.changedParts.from, to: draft.changedParts.to,
      ...(draft.changedParts.rationale.trim() ? { rationale: draft.changedParts.rationale } : {}),
    },
    normalization: {
      sourceMin, sourceMax, sourceUnit: draft.normalization.sourceUnit,
      targetMin, targetMax, targetUnit: draft.normalization.targetUnit, relationship: draft.normalization.relationship,
    },
    culturalImpact: draft.culturalImpact,
  });
  return answer.success ? answer.data : null;
}

export const SignalLayerSchema = z.enum(["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"]);
export const TransferEvidenceCodeSchema = z.enum(["INPUT_OK", "MAPPING_OK", "TRANSPORT_OK", "BINDING_OK", "OUTPUT_OK"]);
export const VerifiedTransferEvidenceSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  layer: SignalLayerSchema,
  code: TransferEvidenceCodeSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const REQUIRED_EVIDENCE = {
  INPUT: "INPUT_OK", MAPPING: "MAPPING_OK", TRANSPORT: "TRANSPORT_OK", BINDING: "BINDING_OK", OUTPUT: "OUTPUT_OK",
} as const;
export const VerifiedEvidenceSnapshotSchema = z.array(VerifiedTransferEvidenceSchema).length(5).superRefine((items, context) => {
  const layers = new Set(items.map(({ layer }) => layer));
  if (layers.size !== 5) context.addIssue({ code: "custom", message: "证据快照必须覆盖五层" });
  for (const item of items) {
    if (item.code !== REQUIRED_EVIDENCE[item.layer]) context.addIssue({ code: "custom", message: "证据层与代码不一致" });
  }
});

export const TransferUnitRangeSchema = z.object({
  unit: TransferSourceUnitSchema,
  minInclusive: FiniteNumber,
  maxInclusive: FiniteNumber,
}).strict().refine((value) => value.minInclusive < value.maxInclusive);

export const TransferUnitPolicySchema = z.object({
  sourceKind: z.enum(["SOUND", "DISTANCE", "NORMALIZED", "GENERIC"]),
  sourceUnit: TransferSourceUnitSchema,
  sourceRanges: z.array(TransferUnitRangeSchema).min(1).max(4),
  targetMin: z.literal(0),
  targetMax: z.literal(1),
  targetUnit: TransferTargetUnitSchema,
  allowedRelationships: z.array(TransferRelationshipSchema).min(1).max(4),
}).strict().superRefine((value, context) => {
  if (!value.sourceRanges.some(({ unit }) => unit === value.sourceUnit)) {
    context.addIssue({ code: "custom", message: "默认单位不在允许范围" });
  }
});

export const CulturalTransitionSchema = z.object({
  before: CulturalBehaviorSchema,
  after: CulturalBehaviorSchema,
}).strict().refine((value) => value.before !== value.after);

export const TransferCulturalPolicySchema = z.object({
  intentAnchor: z.object({ id: z.string().regex(/^intent_[a-f0-9]{16}$/), label: SafeText(2, 500) }).strict(),
  allowedAudienceTypes: z.array(CulturalAudienceTypeSchema).min(1).max(4),
  allowedTransitions: z.array(CulturalTransitionSchema).min(1).max(9),
  allowedMechanisms: z.array(CulturalMechanismSchema).min(1).max(3),
}).strict();

const CandidateSchema = z.object({ id: z.string().trim().min(1).max(64), label: SafeText(2, 200) }).strict();
export const TransferCandidateCatalogSchema = z.object({
  input: z.array(CandidateSchema).min(1).max(10).optional(),
  mapping: z.array(CandidateSchema).min(1).max(10).optional(),
  output: z.array(CandidateSchema).min(1).max(10).optional(),
}).strict();

export const TransferChallengeSourceSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  challengeRevision: z.number().int().positive(),
  logicCard: LogicCardSchema,
  path: ToolPathSchema,
  verifiedEvidence: VerifiedEvidenceSnapshotSchema,
  forceDimension: TransferDimensionSchema.optional(),
  candidateCatalog: TransferCandidateCatalogSchema.optional(),
}).strict();

export const TransferChallengeSnapshotSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  challengeRevision: z.number().int().positive(),
  changedDimension: TransferDimensionSchema,
  prompt: SafeText(10, 1_000),
  mustRetain: z.object({
    culturalIntent: SafeText(2, 500),
    structure: SafeText(2, 1_000),
    input: SafeText(2, 500), mapping: SafeText(2, 500), output: SafeText(2, 500),
  }).strict(),
  change: z.object({
    candidateId: z.string().trim().min(1).max(64),
    dimension: TransferDimensionSchema,
    from: SafeText(2, 500),
    to: SafeText(2, 500),
  }).strict(),
  unitPolicy: TransferUnitPolicySchema,
  culturalPolicy: TransferCulturalPolicySchema,
  path: ToolPathSchema,
  verifiedEvidenceSnapshot: VerifiedEvidenceSnapshotSchema,
  verifiedEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((value, context) => {
  const normalize = (text: string) => text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
  if (normalize(value.change.from) === normalize(value.change.to)) {
    context.addIssue({ code: "custom", message: "挑战改变前后不能相同" });
  }
  if (value.change.dimension !== value.changedDimension) context.addIssue({ code: "custom", message: "改变维度不一致" });
});
export type TransferChallengeSnapshot = z.infer<typeof TransferChallengeSnapshotSchema>;

const RetainedCriterionSchema = z.discriminatedUnion("passed", [
  z.object({ passed: z.literal(true), reasonCode: z.literal("RETAINED_MATCH") }).strict(),
  z.object({ passed: z.literal(false), reasonCode: z.literal("RETAINED_MISMATCH") }).strict(),
]);
const ChangedCriterionSchema = z.discriminatedUnion("passed", [
  z.object({ passed: z.literal(true), reasonCode: z.literal("CHANGE_TARGETED") }).strict(),
  z.object({ passed: z.literal(false), reasonCode: z.literal("CHANGE_MISMATCH") }).strict(),
]);
const NormalizationCriterionSchema = z.discriminatedUnion("passed", [
  z.object({ passed: z.literal(true), reasonCode: z.literal("NORMALIZATION_VALID") }).strict(),
  z.object({ passed: z.literal(false), reasonCode: z.enum(["NORMALIZATION_INVALID_UNIT", "NORMALIZATION_INVALID_RANGE", "NORMALIZATION_INVALID_RELATIONSHIP"]) }).strict(),
]);
const CulturalCriterionSchema = z.discriminatedUnion("passed", [
  z.object({ passed: z.literal(true), reasonCode: z.literal("CULTURAL_CONCRETE") }).strict(),
  z.object({ passed: z.literal(false), reasonCode: z.enum(["CULTURAL_INVALID_ANCHOR", "CULTURAL_INVALID_TRANSITION", "CULTURAL_INVALID_MECHANISM"]) }).strict(),
]);
export const TransferAiCodeSchema = z.enum(["COHERENCE_NOTE", "CLARITY_NOTE"]);
export const TransferFeedbackSchema = z.object({
  retained: z.boolean(), changed: z.boolean(), normalization: z.boolean(), cultural: z.boolean(),
  teacherReview: z.boolean(), aiCode: TransferAiCodeSchema.nullable(),
}).strict();
export const TransferRubricSchema = z.object({
  criteria: z.object({
    retainedStructure: RetainedCriterionSchema,
    changedParts: ChangedCriterionSchema,
    normalization: NormalizationCriterionSchema,
    culturalImpact: CulturalCriterionSchema,
  }).strict(),
  score: z.number().int().min(0).max(4),
  passed: z.boolean(),
  outcome: z.enum(["RETRY", "PASSED", "LOCKED"]),
  feedback: TransferFeedbackSchema,
}).strict().superRefine((value, context) => {
  const count = Object.values(value.criteria).filter(({ passed }) => passed).length;
  const expected = count === 4;
  const feedbackMatches = value.feedback.retained === !value.criteria.retainedStructure.passed &&
    value.feedback.changed === !value.criteria.changedParts.passed &&
    value.feedback.normalization === !value.criteria.normalization.passed &&
    value.feedback.cultural === !value.criteria.culturalImpact.passed;
  const outcomeMatches = value.passed ? value.outcome === "PASSED" : value.outcome !== "PASSED";
  if (
    count !== value.score || expected !== value.passed || !feedbackMatches || !outcomeMatches ||
    value.feedback.teacherReview !== (value.outcome === "LOCKED") ||
    (value.passed && Object.values(value.feedback).some((item) => item === true))
  ) context.addIssue({ code: "custom", message: "量规汇总或反馈状态不一致" });
});
export type TransferRubric = z.infer<typeof TransferRubricSchema>;

export const TransferStatusSchema = z.enum(["OPEN", "PASSED", "LOCKED"]);
export const TransferPublicChallengeSchema = z.object({
  projectId: TransferChallengeSnapshotSchema.shape.projectId,
  challengeRevision: TransferChallengeSnapshotSchema.shape.challengeRevision,
  changedDimension: TransferChallengeSnapshotSchema.shape.changedDimension,
  prompt: TransferChallengeSnapshotSchema.shape.prompt,
  mustRetain: TransferChallengeSnapshotSchema.shape.mustRetain,
  change: TransferChallengeSnapshotSchema.shape.change,
  unitPolicy: TransferChallengeSnapshotSchema.shape.unitPolicy,
  culturalPolicy: TransferChallengeSnapshotSchema.shape.culturalPolicy,
  path: TransferChallengeSnapshotSchema.shape.path,
}).strict();
export const TransferPublicStateSchema = z.object({
  challenge: TransferPublicChallengeSchema,
  status: TransferStatusSchema,
  attemptsUsed: z.number().int().min(0).max(2),
  attemptsRemaining: z.number().int().min(0).max(2),
  locked: z.boolean(),
  latestRubric: TransferRubricSchema.nullable(),
}).strict().superRefine((value, context) => {
  const openMatches = value.status === "OPEN" && value.attemptsUsed <= 1 &&
    value.attemptsRemaining === 2 - value.attemptsUsed &&
    (value.attemptsUsed === 0 ? value.latestRubric === null : value.latestRubric?.outcome === "RETRY");
  const closedMatches = value.status !== "OPEN" && value.attemptsRemaining === 0 && value.latestRubric !== null &&
    value.latestRubric.outcome === value.status &&
    (value.status === "PASSED"
      ? value.latestRubric.passed && value.attemptsUsed >= 1 && value.attemptsUsed <= 2
      : !value.latestRubric.passed && value.attemptsUsed === 2);
  if ((!openMatches && !closedMatches) || value.locked !== (value.status === "LOCKED")) {
    context.addIssue({ code: "custom", message: "挑战状态不一致" });
  }
});
export type TransferPublicState = z.infer<typeof TransferPublicStateSchema>;

export const TransferRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START") }).strict(),
  z.object({ action: z.literal("SUBMIT"), challengeRevision: z.number().int().positive(), expectedAttempt: z.number().int().min(0).max(2), answer: TransferAnswerSchema }).strict(),
]);
export const TransferSubmitSchema = z.object({
  challengeRevision: z.number().int().positive(), expectedAttempt: z.number().int().min(0).max(2), answer: TransferAnswerSchema,
}).strict();
