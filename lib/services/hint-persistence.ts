import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { DataTypeSchema } from "@/lib/domain/data-provenance";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { evidence, hintEvidenceConsumptions, hintRecords, troubleshootingRuns } from "@/lib/db/schema";

import { assertEvidenceOwnership, EvidenceRecordSchema } from "./evidence";
import {
  HintRequestSchema,
  HintResponseSchema,
  allowedHintLevel,
  createHintPolicyContext,
  type HintResponse,
} from "./hints";
import { TroubleshootingRunSnapshotSchema, TroubleshootingStateSchema } from "./troubleshooting";
import { StudentHintPublicResponseSchema } from "@/lib/domain/student-dashboard";

type CourseDatabase = DatabaseConnection["db"];
type CourseTransaction = Parameters<Parameters<CourseDatabase["transaction"]>[0]>[0];
type Executor = CourseDatabase | CourseTransaction;

export const HintRouteInputSchema = z.object({ question: z.string().trim().min(1).max(1_200) }).strict();
export type HintRouteInput = z.infer<typeof HintRouteInputSchema>;

const PersistedHintRecordSchema = z.object({
  id: z.uuid(),
  projectId: z.string().min(1),
  classId: z.string().min(1),
  studentId: z.string().min(1),
  hintSequence: z.number().int().positive(),
  evidenceSequenceWatermark: z.number().int().nonnegative(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  responseJson: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
  dataType: DataTypeSchema,
}).strict();

export class HintPersistenceConflictError extends Error {
  constructor() {
    super("提示上下文已更新，请重试");
    this.name = "HintPersistenceConflictError";
  }
}

type GenerateHint = (
  request: z.infer<typeof HintRequestSchema>,
  policy: ReturnType<typeof createHintPolicyContext>,
) => Promise<HintResponse>;

function iso(value: Date) {
  return value.toISOString();
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function buildContextSnapshot(db: Executor, actor: SessionPayload, projectId: string) {
  const records = db.select().from(hintRecords)
    .where(and(eq(hintRecords.projectId, projectId), eq(hintRecords.studentId, actor.userId)))
    .orderBy(desc(hintRecords.hintSequence)).limit(100).all()
    .map((row) => PersistedHintRecordSchema.parse(row))
    .sort((left, right) => left.hintSequence - right.hintSequence);
  const consumptions = db.select().from(hintEvidenceConsumptions)
    .where(and(eq(hintEvidenceConsumptions.projectId, projectId), eq(hintEvidenceConsumptions.studentId, actor.userId)))
    .orderBy(desc(hintEvidenceConsumptions.consumedAt)).limit(100).all();
  const verifiedEvidence = db.select().from(evidence).where(and(
    eq(evidence.projectId, projectId),
    eq(evidence.studentId, actor.userId),
    eq(evidence.storageStatus, "READY"),
    inArray(evidence.verificationStatus, ["RULE_VERIFIED", "TEACHER_VERIFIED"]),
  )).orderBy(asc(evidence.evidenceSequence)).all().map((row) => EvidenceRecordSchema.parse(row));
  const run = db.select().from(troubleshootingRuns)
    .where(eq(troubleshootingRuns.projectId, projectId))
    .orderBy(desc(troubleshootingRuns.revision), desc(troubleshootingRuns.id)).limit(1).get();
  const runSnapshot = run
    ? {
        id: run.id,
        revision: run.revision,
        currentLayer: run.currentLayer,
        status: run.status,
        state: TroubleshootingRunSnapshotSchema.parse({
          currentLayer: run.currentLayer,
          status: run.status,
          stateJson: run.stateJson,
        }).stateJson,
      }
    : null;
  const latest = records.at(-1);
  const evidenceSet = verifiedEvidence.map((row) => ({
    id: row.id,
    digest: row.contentDigest,
    sequence: row.evidenceSequence,
    verificationStatus: row.verificationStatus,
    confirmedCode: row.confirmedCode,
  }));
  const latestHintSequence = latest?.hintSequence ?? 0;
  const contextHash = sha256({
    run: runSnapshot
      ? { id: runSnapshot.id, revision: runSnapshot.revision, currentLayer: runSnapshot.currentLayer, status: runSnapshot.status }
      : null,
    evidenceSet,
    latestHintSequence,
  });
  const usedIds = new Set(consumptions.map(({ evidenceId }) => evidenceId));
  const usedDigests = new Set(consumptions.map(({ contentDigest }) => contentDigest));
  const seenDigests = new Set<string>();
  const policyEvidence = verifiedEvidence.filter((row) => {
    if (seenDigests.has(row.contentDigest)) return false;
    seenDigests.add(row.contentDigest);
    return true;
  });
  const policy = createHintPolicyContext({
    previousHintRecords: records.map((row) => ({
      recordId: row.id,
      hintSequence: row.hintSequence,
      evidenceSequenceWatermark: row.evidenceSequenceWatermark,
      createdAt: iso(row.createdAt),
    })),
    currentEvidenceRecords: policyEvidence.map((row) => ({
      evidenceRecordId: row.id,
      evidenceSequence: row.evidenceSequence,
      contentDigest: row.contentDigest,
      createdAt: iso(row.createdAt),
    })),
    priorUsedEvidenceRecordIds: Array.from(usedIds),
    priorUsedEvidenceDigests: Array.from(usedDigests),
  });
  return {
    records,
    verifiedEvidence,
    runSnapshot,
    latestHintSequence,
    latestEvidenceWatermark: latest?.evidenceSequenceWatermark ?? 0,
    evidenceSequenceWatermark: Math.max(0, ...verifiedEvidence.map(({ evidenceSequence }) => evidenceSequence)),
    contextHash,
    policy,
  };
}

function buildServerRequest(snapshot: ReturnType<typeof buildContextSnapshot>) {
  const state = snapshot.runSnapshot?.state ?? TroubleshootingStateSchema.parse({});
  const rows = snapshot.verifiedEvidence.slice(-6);
  const kind = {
    TEXT: "STUDENT_OBSERVATION",
    IMAGE: "SCREENSHOT_DESCRIPTION",
    VALUE: "MEASUREMENT",
    VIDEO_LINK: "STUDENT_OBSERVATION",
    PROBE: "MEASUREMENT",
  } as const;
  const layerRequest = {
    INPUT: {
      question: "TouchDesigner输入信号观察与最小验证",
      topicScope: ["TOUCHDESIGNER_FOUNDATIONS"],
    },
    MAPPING: {
      question: "DigiShow输入输出范围与数值映射",
      topicScope: ["DIGISHOW_SIGNALS", "TOUCHDESIGNER_FOUNDATIONS"],
    },
    TRANSPORT: {
      question: "OSC发送接收地址端口与Active状态",
      topicScope: ["OSC_TROUBLESHOOTING"],
    },
    BINDING: {
      question: "TouchDesigner接收值与目标参数绑定",
      topicScope: ["TOUCHDESIGNER_FOUNDATIONS"],
    },
    OUTPUT: {
      question: "TouchDesigner输出参数与节点状态观察",
      topicScope: ["TOUCHDESIGNER_FOUNDATIONS"],
    },
  } as const;
  return HintRequestSchema.parse({
    ...layerRequest[state.currentLayer],
    confirmedFacts: state.confirmedFacts,
    hypotheses: state.unconfirmedHypotheses,
    evidence: rows.map((row) => ({ kind: kind[row.kind], description: `已验证证据：${row.label}` })),
  });
}

export async function requestPersistedHint(
  db: CourseDatabase,
  actor: SessionPayload,
  projectId: string,
  rawInput: HintRouteInput,
  generate: GenerateHint,
) {
  HintRouteInputSchema.parse(rawInput);
  const project = assertEvidenceOwnership(db, actor, projectId);
  const snapshot = buildContextSnapshot(db, actor, projectId);
  const serverRequest = buildServerRequest(snapshot);
  const generated = HintResponseSchema.parse(await generate(serverRequest, snapshot.policy));
  if (generated.hintLevel !== allowedHintLevel(snapshot.policy)) throw new HintPersistenceConflictError();

  const id = randomUUID();
  db.transaction((transaction) => {
    assertEvidenceOwnership(transaction, actor, projectId);
    const current = buildContextSnapshot(transaction, actor, projectId);
    if (
      current.contextHash !== snapshot.contextHash ||
      current.latestHintSequence !== snapshot.latestHintSequence ||
      allowedHintLevel(current.policy) !== generated.hintLevel
    ) {
      throw new HintPersistenceConflictError();
    }

    const candidate = generated.evidenceToConsume;
    if (generated.hintLevel === 3) {
      if (!candidate) throw new HintPersistenceConflictError();
      const snapshotCandidate = snapshot.verifiedEvidence.find(({ id: evidenceId }) => evidenceId === candidate.evidenceRecordId);
      const currentCandidate = current.verifiedEvidence.find(({ id: evidenceId }) => evidenceId === candidate.evidenceRecordId);
      if (
        !snapshotCandidate || !currentCandidate ||
        candidate.evidenceSequence !== snapshotCandidate.evidenceSequence ||
        candidate.evidenceSequence !== currentCandidate.evidenceSequence ||
        candidate.evidenceSequence <= snapshot.latestEvidenceWatermark ||
        candidate.contentDigest !== snapshotCandidate.contentDigest ||
        candidate.contentDigest !== currentCandidate.contentDigest ||
        candidate.createdAt !== iso(snapshotCandidate.createdAt) ||
        candidate.createdAt !== iso(currentCandidate.createdAt)
      ) {
        throw new HintPersistenceConflictError();
      }
      const consumed = transaction.select().from(hintEvidenceConsumptions)
        .where(eq(hintEvidenceConsumptions.evidenceId, candidate.evidenceRecordId)).get();
      if (consumed) throw new HintPersistenceConflictError();
    }

    const now = new Date();
    transaction.insert(hintRecords).values({
      id,
      projectId,
      classId: project.classId,
      studentId: actor.userId,
      hintSequence: snapshot.latestHintSequence + 1,
      evidenceSequenceWatermark: snapshot.evidenceSequenceWatermark,
      contextHash: snapshot.contextHash,
      hintLevel: generated.hintLevel,
      responseJson: generated,
      createdAt: now,
    }).run();
    if (candidate) {
      transaction.insert(hintEvidenceConsumptions).values({
        evidenceId: candidate.evidenceRecordId,
        hintRecordId: id,
        projectId,
        studentId: actor.userId,
        classId: project.classId,
        evidenceSequence: candidate.evidenceSequence,
        contentDigest: candidate.contentDigest,
        consumedAt: now,
      }).run();
    }
  }, { behavior: "immediate" });

  return StudentHintPublicResponseSchema.parse(Object.fromEntries(
    Object.entries(generated).filter(([key]) => key !== "evidenceToConsume"),
  ));
}
