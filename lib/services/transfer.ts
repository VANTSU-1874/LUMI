import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  TransferAnswerSchema,
  TransferChallengeSnapshotSchema,
  TransferChallengeSourceSchema,
  TransferRubricSchema,
  TransferPublicStateSchema,
  TransferSubmitSchema,
  TransferAiCodeSchema,
  VerifiedEvidenceSnapshotSchema,
  type TransferAnswer,
  type TransferChallengeSnapshot,
  type TransferDimension,
} from "@/lib/domain/transfer";
import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  auditEvents,
  evidence,
  learnerProfiles,
  logicCards,
  projects,
  toolPathPlans,
  transferAttempts,
  transferChallengeRevisions,
  transferChallenges,
  users,
} from "@/lib/db/schema";
import { LogicCardSchema } from "@/lib/domain/schemas";
import { ToolPathPlanRecordSchema } from "@/lib/domain/tool-path";

export { TransferAnswerSchema } from "@/lib/domain/transfer";

type CourseDatabase = DatabaseConnection["db"];
type CourseTransaction = Parameters<Parameters<CourseDatabase["transaction"]>[0]>[0];
type Executor = CourseDatabase | CourseTransaction;

export class TransferNotFoundError extends Error {
  constructor() { super("项目不存在"); this.name = "TransferNotFoundError"; }
}
export class TransferForbiddenError extends Error {
  constructor() { super("仅学生可以完成迁移挑战"); this.name = "TransferForbiddenError"; }
}
export class TransferStageError extends Error {
  constructor() { super("当前项目阶段不能进行迁移挑战"); this.name = "TransferStageError"; }
}
export class TransferPrerequisiteError extends Error {
  constructor() { super("迁移挑战所需的逻辑、路径或已验证证据不完整"); this.name = "TransferPrerequisiteError"; }
}
export class TransferAttemptConflictError extends Error {
  constructor() { super("迁移挑战已更新，请刷新后重试"); this.name = "TransferAttemptConflictError"; }
}
export class TransferLockedError extends Error {
  constructor() { super("两次作答均未通过，已请求教师介入"); this.name = "TransferLockedError"; }
}
export class InvalidStoredTransferError extends Error {
  constructor() { super("迁移挑战记录无效"); this.name = "InvalidStoredTransferError"; }
}
export class TransferChallengeGenerationError extends Error {
  constructor() { super("没有可用且不同于原结构的迁移候选"); this.name = "TransferChallengeGenerationError"; }
}
export class TransferEvidenceStaleError extends Error {
  constructor() { super("迁移挑战所依据的五层证据已变化，请重新生成挑战"); this.name = "TransferEvidenceStaleError"; }
}
export class TransferEvidenceUnavailableError extends Error {
  readonly code = "TRANSFER_EVIDENCE_UNAVAILABLE";
  constructor() { super("TRANSFER_EVIDENCE_UNAVAILABLE"); this.name = "TransferEvidenceUnavailableError"; }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const layerOrder = ["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"] as const;
const defaultCandidates = {
  input: [
    { id: "sound-db", label: "声音强度输入" },
    { id: "distance", label: "距离传感器输入" },
  ],
  mapping: [
    { id: "three-state", label: "三个离散状态阈值映射" },
    { id: "linear-normalized", label: "连续线性归一化映射" },
  ],
  output: [
    { id: "lamp-brightness", label: "灯光亮度输出" },
    { id: "projection-visual", label: "投影视觉输出" },
    { id: "sound-volume", label: "声音音量输出" },
  ],
} as const;

function normalizedExact(value: string) {
  return value.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

function sourcePolicy(input: string, dimension: TransferDimension, candidateLabel: string) {
  const description = dimension === "input" ? candidateLabel : input;
  if (/声音|分贝|dB/iu.test(description)) return {
    sourceKind: "SOUND" as const, sourceUnit: "dB" as const,
    sourceRanges: [{ unit: "dB" as const, minInclusive: 20, maxInclusive: 130 }],
    targetMin: 0 as const, targetMax: 1 as const, targetUnit: "normalized" as const,
    allowedRelationships: ["LINEAR", "DIRECT", "INVERSE", "THRESHOLD"] as const,
  };
  if (/距离|厘米|毫米|\bcm\b|\bmm\b|米/iu.test(description)) return {
    sourceKind: "DISTANCE" as const, sourceUnit: "cm" as const,
    sourceRanges: [
      { unit: "mm" as const, minInclusive: 0, maxInclusive: 10_000 },
      { unit: "cm" as const, minInclusive: 0, maxInclusive: 1_000 },
      { unit: "m" as const, minInclusive: 0, maxInclusive: 100 },
    ],
    targetMin: 0 as const, targetMax: 1 as const, targetUnit: "normalized" as const,
    allowedRelationships: ["LINEAR", "DIRECT", "INVERSE", "THRESHOLD"] as const,
  };
  if (/归一化|0.{0,3}1/iu.test(description)) return {
    sourceKind: "NORMALIZED" as const, sourceUnit: "normalized" as const,
    sourceRanges: [{ unit: "normalized" as const, minInclusive: 0, maxInclusive: 1 }],
    targetMin: 0 as const, targetMax: 1 as const, targetUnit: "normalized" as const,
    allowedRelationships: ["LINEAR", "DIRECT", "INVERSE", "THRESHOLD"] as const,
  };
  return {
    sourceKind: "GENERIC" as const, sourceUnit: "raw" as const,
    sourceRanges: [{ unit: "raw" as const, minInclusive: -1_000_000, maxInclusive: 1_000_000 }],
    targetMin: 0 as const, targetMax: 1 as const, targetUnit: "normalized" as const,
    allowedRelationships: ["LINEAR", "DIRECT", "INVERSE", "THRESHOLD"] as const,
  };
}

function culturalPolicy(intent: string, dimension: TransferDimension, sourceKind: string) {
  const mechanisms = dimension === "input"
    ? sourceKind === "SOUND"
      ? ["COLLECTIVE_RESPONSE", "PARTICIPATORY_TRIGGER"] as const
      : ["PARTICIPATORY_TRIGGER", "COLLECTIVE_RESPONSE"] as const
    : dimension === "mapping"
      ? ["NARRATIVE_MAPPING", "COLLECTIVE_RESPONSE"] as const
      : ["SENSORY_FEEDBACK", "CULTURAL_SYMBOL_REINFORCEMENT"] as const;
  return {
    intentAnchor: {
      id: `intent_${createHash("sha256").update(intent.normalize("NFKC"), "utf8").digest("hex").slice(0, 16)}`,
      label: intent,
    },
    allowedAudienceTypes: ["GENERAL_VISITORS", "YOUNG_LEARNERS", "COMMUNITY_MEMBERS", "CULTURAL_HERITAGE_AUDIENCE"] as const,
    allowedTransitions: [
      { before: "PASSIVE_VIEWING", after: "ACTIVE_EXPLORATION" },
      { before: "FOLLOWING_INSTRUCTIONS", after: "COLLABORATIVE_CREATION" },
      { before: "INDIVIDUAL_INTERACTION", after: "REFLECTIVE_SHARING" },
    ] as const,
    allowedMechanisms: mechanisms,
  };
}

function buildChallenge(raw: unknown): TransferChallengeSnapshot {
  const source = TransferChallengeSourceSchema.parse(raw);
  const verifiedEvidence = [...source.verifiedEvidence].sort((a, b) =>
    layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer));
  const sourceHash = createHash("sha256").update(stableJson({
    ...source, forceDimension: undefined, candidateCatalog: undefined, verifiedEvidence,
  }), "utf8").digest("hex");
  const dimensions: TransferDimension[] = ["input", "mapping", "output"];
  const changedDimension = source.forceDimension ?? dimensions[Number.parseInt(sourceHash.slice(0, 8), 16) % dimensions.length];
  const original = {
    input: source.logicCard.inputSignal,
    mapping: source.logicCard.mappingRule,
    output: source.logicCard.outputMedium,
  } as const;
  const candidates = source.candidateCatalog?.[changedDimension] ?? defaultCandidates[changedDimension];
  const start = Number.parseInt(sourceHash.slice(8, 16), 16) % candidates.length;
  let candidate: { id: string; label: string } | undefined;
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const current = candidates[(start + offset) % candidates.length];
    if (normalizedExact(current.label) !== normalizedExact(original[changedDimension])) { candidate = current; break; }
  }
  if (!candidate) throw new TransferChallengeGenerationError();
  const evidenceHash = createHash("sha256").update(stableJson(verifiedEvidence), "utf8").digest("hex");
  const structure = `参与行为“${source.logicCard.participantAction}”通过输入、映射和输出形成反馈“${source.logicCard.experienceFeedback}”`;
  const prompt = `保留文化意图及未指定维度，只改变${changedDimension === "input" ? "输入" : changedDimension === "mapping" ? "映射" : "输出"}：把“${original[changedDimension]}”改为“${candidate.label}”。`;
  const unitPolicy = sourcePolicy(source.logicCard.inputSignal, changedDimension, candidate.label);
  const snapshotBase = {
    projectId: source.projectId, challengeRevision: source.challengeRevision, changedDimension, prompt,
    mustRetain: {
      culturalIntent: source.logicCard.culturalIntent, structure,
      input: source.logicCard.inputSignal, mapping: source.logicCard.mappingRule, output: source.logicCard.outputMedium,
    },
    change: { candidateId: candidate.id, dimension: changedDimension, from: original[changedDimension], to: candidate.label },
    unitPolicy,
    culturalPolicy: culturalPolicy(source.logicCard.culturalIntent, changedDimension, unitPolicy.sourceKind),
    path: source.path,
    verifiedEvidenceSnapshot: verifiedEvidence,
    verifiedEvidenceHash: evidenceHash,
  };
  return TransferChallengeSnapshotSchema.parse({
    ...snapshotBase,
    snapshotHash: createHash("sha256").update(stableJson(snapshotBase), "utf8").digest("hex"),
  });
}

export function createDeterministicChallenge(input: unknown) { return buildChallenge(input); }

function scoreAgainstChallenge(challenge: TransferChallengeSnapshot, rawAnswer: TransferAnswer) {
  const answer = TransferAnswerSchema.parse(rawAnswer);
  const retained = answer.retainedStructure;
  const unchangedDimensions = (["input", "mapping", "output"] as const).filter((item) => item !== challenge.changedDimension);
  const retainedPass = normalizedExact(retained.culturalIntent) === normalizedExact(challenge.mustRetain.culturalIntent) &&
    unchangedDimensions.every((dimension) => normalizedExact(retained[dimension]) === normalizedExact(challenge.mustRetain[dimension]));
  const changedPass = answer.changedParts.dimension === challenge.changedDimension &&
    normalizedExact(answer.changedParts.from) === normalizedExact(challenge.change.from) &&
    normalizedExact(answer.changedParts.to) === normalizedExact(challenge.change.to);
  const range = challenge.unitPolicy.sourceRanges.find(({ unit }) => unit === answer.normalization.sourceUnit);
  const unitPass = Boolean(range) && answer.normalization.targetUnit === challenge.unitPolicy.targetUnit;
  const rangePass = Boolean(range) && answer.normalization.sourceMin >= range!.minInclusive &&
    answer.normalization.sourceMax <= range!.maxInclusive &&
    answer.normalization.targetMin === challenge.unitPolicy.targetMin &&
    answer.normalization.targetMax === challenge.unitPolicy.targetMax;
  const relationshipPass = challenge.unitPolicy.allowedRelationships.includes(answer.normalization.relationship);
  const normalizationPass = unitPass && rangePass && relationshipPass;
  const anchorPass = answer.culturalImpact.intentAnchorId === challenge.culturalPolicy.intentAnchor.id;
  const audiencePass = challenge.culturalPolicy.allowedAudienceTypes.includes(answer.culturalImpact.audienceType);
  const transitionPass = challenge.culturalPolicy.allowedTransitions.some(({ before, after }) =>
    before === answer.culturalImpact.behaviorBefore && after === answer.culturalImpact.behaviorAfter);
  const mechanismPass = challenge.culturalPolicy.allowedMechanisms.includes(answer.culturalImpact.mechanism);
  const culturalPass = anchorPass && audiencePass && transitionPass && mechanismPass;
  const normalizationReason = !unitPass ? "NORMALIZATION_INVALID_UNIT" :
    !rangePass ? "NORMALIZATION_INVALID_RANGE" :
      !relationshipPass ? "NORMALIZATION_INVALID_RELATIONSHIP" : "NORMALIZATION_INVALID_RANGE";
  const criteria = {
    retainedStructure: { passed: retainedPass, reasonCode: retainedPass ? "RETAINED_MATCH" : "RETAINED_MISMATCH" },
    changedParts: { passed: changedPass, reasonCode: changedPass ? "CHANGE_TARGETED" : "CHANGE_MISMATCH" },
    normalization: { passed: normalizationPass, reasonCode: normalizationPass ? "NORMALIZATION_VALID" : normalizationReason },
    culturalImpact: {
      passed: culturalPass,
      reasonCode: culturalPass ? "CULTURAL_CONCRETE" :
        !anchorPass ? "CULTURAL_INVALID_ANCHOR" :
          !audiencePass || !transitionPass ? "CULTURAL_INVALID_TRANSITION" : "CULTURAL_INVALID_MECHANISM",
    },
  } as const;
  const score = Object.values(criteria).filter(({ passed }) => passed).length;
  const passed = score === 4;
  return TransferRubricSchema.parse({
    criteria, score, passed, outcome: passed ? "PASSED" : "RETRY",
    feedback: {
      retained: !retainedPass, changed: !changedPass, normalization: !normalizationPass,
      cultural: !culturalPass, teacherReview: false, aiCode: null,
    },
  });
}

export function scoreTransferResponse(challenge: TransferChallengeSnapshot, answer: TransferAnswer) {
  return scoreAgainstChallenge(TransferChallengeSnapshotSchema.parse(challenge), answer);
}

function assertTransferOwnership(db: Executor, actor: SessionPayload, projectId: string) {
  if (actor.role !== "STUDENT") throw new TransferForbiddenError();
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new TransferNotFoundError();
  const student = db.select({ id: users.id, classId: users.classId }).from(users)
    .where(and(eq(users.id, actor.userId), eq(users.role, "STUDENT"))).get();
  if (!student?.classId || project.studentId !== student.id || project.classId !== student.classId) {
    throw new TransferNotFoundError();
  }
  return project;
}

function parseStoredChallenge(row: typeof transferChallenges.$inferSelect | undefined) {
  if (!row) throw new InvalidStoredTransferError();
  const snapshot = TransferChallengeSnapshotSchema.safeParse(row.snapshotJson);
  if (!snapshot.success) throw new InvalidStoredTransferError();
  const { snapshotHash, ...snapshotBase } = snapshot.data;
  const computedSnapshotHash = createHash("sha256").update(stableJson(snapshotBase), "utf8").digest("hex");
  const computedEvidenceHash = createHash("sha256")
    .update(stableJson(snapshot.data.verifiedEvidenceSnapshot), "utf8").digest("hex");
  if (
    snapshotHash !== row.snapshotHash || computedSnapshotHash !== snapshotHash ||
    computedEvidenceHash !== snapshot.data.verifiedEvidenceHash ||
    snapshot.data.challengeRevision !== row.revision
  ) {
    throw new InvalidStoredTransferError();
  }
  return { row, snapshot: snapshot.data };
}

export function publicTransferState(db: Executor, row: typeof transferChallenges.$inferSelect) {
  const { snapshot } = parseStoredChallenge(row);
  const latest = db.select({ rubricJson: transferAttempts.rubricJson }).from(transferAttempts)
    .where(eq(transferAttempts.challengeId, row.id))
    .orderBy(desc(transferAttempts.attemptNumber)).limit(1).get();
  const latestRubric = latest ? TransferRubricSchema.parse(latest.rubricJson) : null;
  const challenge = {
    projectId: snapshot.projectId,
    challengeRevision: snapshot.challengeRevision,
    changedDimension: snapshot.changedDimension,
    prompt: snapshot.prompt,
    mustRetain: snapshot.mustRetain,
    change: snapshot.change,
    unitPolicy: snapshot.unitPolicy,
    culturalPolicy: snapshot.culturalPolicy,
    path: snapshot.path,
  };
  return TransferPublicStateSchema.parse({
    challenge,
    status: row.status,
    attemptsUsed: row.attemptCount,
    attemptsRemaining: row.status === "OPEN" ? 2 - row.attemptCount : 0,
    locked: row.status === "LOCKED",
    latestRubric,
  });
}

function currentVerifiedEvidence(
  db: Executor,
  projectId: string,
  studentId: string,
  classId: string,
) {
  const rows = db.select({
    id: evidence.id,
    sequence: evidence.evidenceSequence,
    layer: evidence.signalLayer,
    code: evidence.confirmedCode,
    digest: evidence.contentDigest,
  }).from(evidence).where(and(
    eq(evidence.projectId, projectId),
    eq(evidence.studentId, studentId),
    eq(evidence.classId, classId),
    eq(evidence.storageStatus, "READY"),
    inArray(evidence.verificationStatus, ["RULE_VERIFIED", "TEACHER_VERIFIED"]),
  )).orderBy(asc(evidence.evidenceSequence)).all();
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (row.code) latest.set(row.layer, row);
  const candidate = layerOrder.flatMap((layer) => {
    const row = latest.get(layer);
    return row?.code ? [{ ...row, code: row.code }] : [];
  });
  return VerifiedEvidenceSnapshotSchema.safeParse(candidate);
}

export function getOrCreateTransferChallenge(
  db: CourseDatabase,
  actor: SessionPayload,
  projectId: string,
) {
  return db.transaction((transaction) => {
    const project = assertTransferOwnership(transaction, actor, projectId);
    if (project.stage !== "TRANSFER") throw new TransferStageError();
    const existing = transaction.select().from(transferChallenges)
      .where(eq(transferChallenges.projectId, projectId)).get();
    if (existing && existing.status !== "OPEN") return publicTransferState(transaction, existing);

    const cardRow = transaction.select().from(logicCards).where(eq(logicCards.projectId, projectId)).get();
    const card = LogicCardSchema.safeParse(cardRow?.payloadJson);
    const planRow = transaction.select().from(toolPathPlans).where(eq(toolPathPlans.projectId, projectId)).get();
    const plan = ToolPathPlanRecordSchema.safeParse(planRow);
    const profile = transaction.select({ userId: learnerProfiles.userId }).from(learnerProfiles)
      .where(eq(learnerProfiles.userId, actor.userId)).get();
    const verified = currentVerifiedEvidence(transaction, projectId, actor.userId, project.classId);
    if (!verified.success) throw new TransferEvidenceUnavailableError();
    if (!card.success || !cardRow?.ruleReady || !cardRow.semanticReady || !plan.success || !profile) {
      throw new TransferPrerequisiteError();
    }

    if (existing) {
      const parsed = parseStoredChallenge(existing);
      if (stableJson(parsed.snapshot.verifiedEvidenceSnapshot) === stableJson(verified.data)) {
        return publicTransferState(transaction, existing);
      }
      const revision = existing.revision + 1;
      const snapshot = createDeterministicChallenge({
        projectId, challengeRevision: revision, logicCard: card.data, path: plan.data.path, verifiedEvidence: verified.data,
      });
      const now = new Date();
      transaction.insert(transferChallengeRevisions).values({
        challengeId: existing.id, projectId, classId: existing.classId, studentId: existing.studentId,
        revision: existing.revision, snapshotHash: existing.snapshotHash, snapshotJson: parsed.snapshot,
        status: existing.status, attemptCount: existing.attemptCount, archivedAt: now,
      }).run();
      const updated = transaction.update(transferChallenges).set({
        revision, snapshotHash: snapshot.snapshotHash, snapshotJson: snapshot, updatedAt: now,
      }).where(and(
        eq(transferChallenges.id, existing.id), eq(transferChallenges.revision, existing.revision),
        eq(transferChallenges.status, "OPEN"), eq(transferChallenges.attemptCount, existing.attemptCount),
      )).run();
      if (updated.changes !== 1) throw new TransferAttemptConflictError();
      transaction.insert(auditEvents).values({
        id: randomUUID(), userId: actor.userId, type: "TRANSFER_CHALLENGE_REGENERATED",
        payloadJson: { projectId, challengeId: existing.id, fromRevision: existing.revision, revision, snapshotHash: snapshot.snapshotHash },
        createdAt: now,
      }).run();
      return publicTransferState(transaction, transaction.select().from(transferChallenges)
        .where(eq(transferChallenges.id, existing.id)).get()!);
    }

    const revision = 1;
    const snapshot = createDeterministicChallenge({
      projectId,
      challengeRevision: revision,
      logicCard: card.data,
      path: plan.data.path,
      verifiedEvidence: verified.data,
    });
    const now = new Date();
    const id = randomUUID();
    transaction.insert(transferChallenges).values({
      id,
      projectId,
      classId: project.classId,
      studentId: actor.userId,
      revision,
      snapshotHash: snapshot.snapshotHash,
      snapshotJson: snapshot,
      status: "OPEN",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    }).run();
    transaction.insert(auditEvents).values({
      id: randomUUID(), userId: actor.userId, type: "TRANSFER_CHALLENGE_CREATED",
      payloadJson: { projectId, challengeId: id, revision, snapshotHash: snapshot.snapshotHash }, createdAt: now,
    }).run();
    return publicTransferState(transaction, transaction.select().from(transferChallenges)
      .where(eq(transferChallenges.id, id)).get()!);
  }, { behavior: "immediate" });
}

const AiFeedbackSchema = z.object({ aiCode: TransferAiCodeSchema.nullable() }).strict();
type TransferAiFeedback = (input: {
  challenge: TransferChallengeSnapshot;
  answer: TransferAnswer;
  signal: AbortSignal;
}) => unknown | Promise<unknown>;

async function neutralAiCode(
  feedback: TransferAiFeedback | undefined,
  challenge: TransferChallengeSnapshot,
  answer: TransferAnswer,
  timeoutMs: number,
) {
  if (!feedback) return null;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<null>((resolve) => {
    timeout = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
  });
  const feedbackResult = Promise.resolve()
    .then(() => feedback({
      challenge: structuredClone(challenge), answer: structuredClone(answer), signal: controller.signal,
    }))
    .then((value) => {
      const parsed = AiFeedbackSchema.safeParse(value);
      return parsed.success ? parsed.data.aiCode : null;
    })
    .catch(() => null);
  try {
    return await Promise.race([feedbackResult, timeoutResult]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function submitTransferChallenge(
  db: CourseDatabase,
  actor: SessionPayload,
  projectId: string,
  rawInput: z.input<typeof TransferSubmitSchema>,
  optionalAiFeedback?: TransferAiFeedback,
  options: { aiTimeoutMs?: number } = {},
) {
  const input = TransferSubmitSchema.parse(rawInput);
  const studentAnswer: TransferAnswer = {
    ...input.answer,
    culturalImpact: {
      audienceType: input.answer.culturalImpact.audienceType,
      behaviorBefore: input.answer.culturalImpact.behaviorBefore,
      behaviorAfter: input.answer.culturalImpact.behaviorAfter,
      intentAnchorId: input.answer.culturalImpact.intentAnchorId,
      mechanism: input.answer.culturalImpact.mechanism,
    },
  };
  const prepared = db.transaction((transaction) => {
    const project = assertTransferOwnership(transaction, actor, projectId);
    if (project.stage !== "TRANSFER") throw new TransferStageError();
    const challenge = transaction.select().from(transferChallenges)
      .where(eq(transferChallenges.projectId, projectId)).get();
    const parsed = parseStoredChallenge(challenge);
    if (parsed.row.status === "LOCKED") throw new TransferLockedError();
    if (parsed.row.status === "PASSED") throw new TransferAttemptConflictError();
    if (parsed.row.revision !== input.challengeRevision || parsed.row.attemptCount !== input.expectedAttempt) {
      throw new TransferAttemptConflictError();
    }
    const verified = currentVerifiedEvidence(transaction, projectId, actor.userId, project.classId);
    if (!verified.success || stableJson(verified.data) !== stableJson(parsed.snapshot.verifiedEvidenceSnapshot)) {
      throw new TransferEvidenceStaleError();
    }

    const deterministic = scoreAgainstChallenge(parsed.snapshot, studentAnswer);
    return { challengeId: parsed.row.id, snapshot: parsed.snapshot, deterministic };
  });

  const timeoutMs = Math.max(1, Math.min(options.aiTimeoutMs ?? 1_500, 10_000));
  const aiCode = await neutralAiCode(optionalAiFeedback, prepared.snapshot, studentAnswer, timeoutMs);

  return db.transaction((transaction) => {
    const project = assertTransferOwnership(transaction, actor, projectId);
    if (project.stage !== "TRANSFER") throw new TransferStageError();
    const challenge = transaction.select().from(transferChallenges)
      .where(eq(transferChallenges.projectId, projectId)).get();
    const parsed = parseStoredChallenge(challenge);
    if (parsed.row.status === "LOCKED") throw new TransferLockedError();
    if (parsed.row.status === "PASSED") throw new TransferAttemptConflictError();
    if (
      parsed.row.id !== prepared.challengeId || parsed.row.revision !== input.challengeRevision ||
      parsed.row.attemptCount !== input.expectedAttempt
    ) throw new TransferAttemptConflictError();
    const verified = currentVerifiedEvidence(transaction, projectId, actor.userId, project.classId);
    if (!verified.success || stableJson(verified.data) !== stableJson(parsed.snapshot.verifiedEvidenceSnapshot)) {
      throw new TransferEvidenceStaleError();
    }
    const deterministic = scoreAgainstChallenge(parsed.snapshot, studentAnswer);
    if (stableJson(deterministic) !== stableJson(prepared.deterministic)) throw new TransferAttemptConflictError();
    const attemptNumber = parsed.row.attemptCount + 1;
    const status = deterministic.passed ? "PASSED" : attemptNumber === 2 ? "LOCKED" : "OPEN";
    const rubric = TransferRubricSchema.parse({
      ...deterministic,
      outcome: status === "OPEN" ? "RETRY" : status,
      feedback: {
        ...deterministic.feedback,
        teacherReview: status === "LOCKED",
        aiCode,
      },
    });
    const now = new Date();
    transaction.insert(transferAttempts).values({
      id: randomUUID(), challengeId: parsed.row.id, projectId,
      classId: project.classId, studentId: actor.userId,
      challengeRevision: parsed.row.revision, attemptNumber,
      responseJson: studentAnswer, rubricJson: rubric, passed: rubric.passed, createdAt: now,
    }).run();
    const update = transaction.update(transferChallenges).set({
      status, attemptCount: attemptNumber, updatedAt: now,
    }).where(and(
      eq(transferChallenges.id, parsed.row.id),
      eq(transferChallenges.revision, input.challengeRevision),
      eq(transferChallenges.attemptCount, input.expectedAttempt),
      eq(transferChallenges.status, "OPEN"),
    )).run();
    if (update.changes !== 1) throw new TransferAttemptConflictError();

    if (rubric.passed) {
      transaction.update(projects).set({ stage: "COMPLETE", updatedAt: now })
        .where(and(eq(projects.id, projectId), eq(projects.stage, "TRANSFER"))).run();
      const profileUpdate = transaction.update(learnerProfiles).set({
        transfer: sql`min(4, ${learnerProfiles.transfer} + 1)`, updatedAt: now,
      }).where(eq(learnerProfiles.userId, actor.userId)).run();
      if (profileUpdate.changes !== 1) throw new TransferPrerequisiteError();
    }
    transaction.insert(auditEvents).values({
      id: randomUUID(), userId: actor.userId, type: "TRANSFER_ATTEMPT_SCORED",
      payloadJson: {
        projectId, challengeId: parsed.row.id, revision: parsed.row.revision,
        attemptNumber, score: rubric.score, passed: rubric.passed, status,
      }, createdAt: now,
    }).run();
    const persisted = transaction.select().from(transferChallenges)
      .where(eq(transferChallenges.id, parsed.row.id)).get();
    return publicTransferState(transaction, persisted!);
  }, { behavior: "immediate" });
}
