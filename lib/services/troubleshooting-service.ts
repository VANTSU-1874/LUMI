import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { evidence, projects, troubleshootingRuns } from "@/lib/db/schema";

import { assertEvidenceOwnership, EvidenceRecordSchema } from "./evidence";
import {
  TroubleshootingRunSnapshotSchema,
  TroubleshootingStateSchema,
  recordTroubleshootingRound,
} from "./troubleshooting";

type CourseDatabase = DatabaseConnection["db"];

export const TroubleshootingInputSchema = z.object({
  evidenceRecordId: z.uuid().optional(),
  symptom: z.string().trim().min(1).max(500).optional(),
}).strict();

export class TroubleshootingEvidenceError extends Error {
  constructor() {
    super("证据不存在或不属于当前项目");
    this.name = "TroubleshootingEvidenceError";
  }
}

export class TroubleshootingStageError extends Error {
  constructor() {
    super("当前项目阶段不能开始排障");
    this.name = "TroubleshootingStageError";
  }
}

export function advanceTroubleshooting(
  db: CourseDatabase,
  actor: SessionPayload,
  projectId: string,
  rawInput: z.input<typeof TroubleshootingInputSchema>,
) {
  const input = TroubleshootingInputSchema.parse(rawInput);
  const project = assertEvidenceOwnership(db, actor, projectId);
  if (!["BUILD", "TROUBLESHOOT"].includes(project.stage)) throw new TroubleshootingStageError();
  const now = new Date();

  return db.transaction((transaction) => {
    const currentProject = assertEvidenceOwnership(transaction, actor, projectId);
    if (!["BUILD", "TROUBLESHOOT"].includes(currentProject.stage)) throw new TroubleshootingStageError();
    const active = transaction.select().from(troubleshootingRuns)
      .where(eq(troubleshootingRuns.projectId, projectId))
      .orderBy(desc(troubleshootingRuns.updatedAt), desc(troubleshootingRuns.id)).limit(1).get();
    const state = active
      ? TroubleshootingRunSnapshotSchema.parse({
          currentLayer: active.currentLayer,
          status: active.status,
          stateJson: active.stateJson,
        }).stateJson
      : TroubleshootingStateSchema.parse({});
    let candidate: Parameters<typeof recordTroubleshootingRound>[1] = null;
    if (input.evidenceRecordId) {
      const rawEvidence = transaction.select().from(evidence).where(and(
        eq(evidence.id, input.evidenceRecordId),
        eq(evidence.projectId, projectId),
        eq(evidence.studentId, actor.userId),
        eq(evidence.classId, currentProject.classId),
      )).get();
      if (!rawEvidence) throw new TroubleshootingEvidenceError();
      const row = EvidenceRecordSchema.parse(rawEvidence);
      if (
        row.storageStatus === "READY" &&
        ["RULE_VERIFIED", "TEACHER_VERIFIED"].includes(row.verificationStatus) &&
        row.confirmedCode
      ) {
        candidate = { recordId: row.id, digest: row.contentDigest, code: row.confirmedCode };
      }
    }
    const next = recordTroubleshootingRound(state, candidate);
    if (active) {
      transaction.update(troubleshootingRuns).set({
        currentLayer: next.currentLayer,
        stateJson: next,
        status: next.status,
        revision: active.revision + 1,
        updatedAt: now,
      }).where(eq(troubleshootingRuns.id, active.id)).run();
    } else {
      transaction.insert(troubleshootingRuns).values({
        id: randomUUID(),
        projectId,
        symptom: input.symptom ?? "学生请求信号链排障",
        currentLayer: next.currentLayer,
        stateJson: next,
        status: next.status,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
    transaction.update(projects).set({ stage: "TROUBLESHOOT", updatedAt: now })
      .where(eq(projects.id, projectId)).run();
    return TroubleshootingStateSchema.parse(next);
  }, { behavior: "immediate" });
}
