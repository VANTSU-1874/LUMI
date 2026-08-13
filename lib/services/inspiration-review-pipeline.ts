import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  InspirationCasePrivateAnalysisSchema,
  InspirationCasePrivateCandidateSchema,
  InspirationCaseTeacherReviewPackageSchema,
} from "@/lib/agent/inspiration-case-intake";
import { InspirationSourceRegistrySchema } from "@/lib/agent/inspiration-source-registry";
import { FormalWikiStudentPublicationInputSchema, studentDisplayAllowed, type FormalWikiStudentPublicationInput } from "@/lib/domain/inspiration-eligibility";
import { inspirationPublicId } from "@/lib/domain/inspiration-public-id";
import { projectApprovedPublicSource, reviewedPublicHostsFromSourceConfiguration } from "@/lib/domain/inspiration-public-source";
import { controlledPreviewUrl } from "@/lib/services/inspiration-preview";
import {
  assertTeacherInspirationReviewAccess,
  isTeacherReviewableInspirationCandidate,
  teacherReviewableInspirationCandidateCondition,
  type InspirationReviewActor,
} from "@/lib/services/inspiration-review-access";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  inspirationAdmissions,
  inspirationCandidateAuditEvents,
  inspirationCandidateAnalyses,
  inspirationCandidates,
  inspirationReviewDecisions,
  inspirationSources,
  type JsonRecord,
} from "@/lib/db/schema";

type CourseDb = DatabaseConnection["db"];
type DatabaseExecutor = CourseDb | Parameters<Parameters<CourseDb["transaction"]>[0]>[0];
type TeacherActor = InspirationReviewActor;

const stateOrder = [
  "DISCOVERED", "DOWNLOADED/IMPORTED", "NORMALIZED/DEDUPED", "VISUALLY_ANALYZED", "READY_FOR_TEACHER_REVIEW",
] as const;
type AutomatedState = (typeof stateOrder)[number];

export const InspirationReviewDecisionInputObjectSchema = z.object({
  candidateId: z.string().regex(/^inspiration-intake:[a-z0-9][a-z0-9-]{0,63}$/).max(88),
  expectedRevision: z.number().int().positive(),
  decision: z.enum(["APPROVE", "REJECT", "DEFER"]),
  courseTags: z.array(z.string().trim().min(1).max(80)).max(20),
  notes: z.string().trim().max(1_000),
  idempotencyKey: z.string().trim().min(8).max(128),
  studentPublication: FormalWikiStudentPublicationInputSchema.optional(),
}).strict();

export const InspirationReviewDecisionInputSchema = InspirationReviewDecisionInputObjectSchema.superRefine((input, context) => {
  if (input.studentPublication && input.decision !== "APPROVE") {
    context.addIssue({ code: "custom", path: ["studentPublication"], message: "Only an approval can carry a student-publication decision." });
  }
});
export type InspirationReviewDecisionInput = z.infer<typeof InspirationReviewDecisionInputSchema>;

export class InspirationCandidateNotFoundError extends Error { constructor() { super("NOT_FOUND"); this.name = "InspirationCandidateNotFoundError"; } }
export class InspirationCandidateRevisionConflictError extends Error { constructor() { super("REVISION_CONFLICT"); this.name = "InspirationCandidateRevisionConflictError"; } }
export class InspirationCandidateStateError extends Error { constructor() { super("INVALID_STATE"); this.name = "InspirationCandidateStateError"; } }
export class InspirationCandidateRequestConflictError extends Error { constructor() { super("REQUEST_CONFLICT"); this.name = "InspirationCandidateRequestConflictError"; } }
export class InspirationCandidatePublicationGateError extends Error { constructor() { super("PUBLICATION_GATE_FAILED"); this.name = "InspirationCandidatePublicationGateError"; } }

function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }
function asJson(value: unknown) { return value as JsonRecord; }
function audit(db: DatabaseExecutor, candidateId: string, eventType: string, actorId: string | null, payload: JsonRecord, at: Date) {
  db.insert(inspirationCandidateAuditEvents).values({ id: randomUUID(), candidateId, eventType, actorId, payloadJson: payload, createdAt: at }).run();
}
function activeReadModel(
  row: typeof inspirationCandidates.$inferSelect,
  courseTags: readonly string[],
  publication: FormalWikiStudentPublicationInput | undefined,
  sourceConfiguration: JsonRecord,
) {
  const curation = row.curationJson as Record<string, unknown>;
  const analysis = row.analysisJson as Record<string, unknown>;
  const styles = Array.isArray(curation.styles) ? curation.styles.filter((value): value is string => typeof value === "string") : [];
  const category = typeof curation.category === "string" ? curation.category : null;
  const source = projectApprovedPublicSource({
    publicLabel: publication?.publicSource.label ?? null,
    publicUrl: publication?.publicSource.url ?? null,
    allowedPublicHosts: reviewedPublicHostsFromSourceConfiguration(sourceConfiguration),
  });
  return {
    id: row.id,
    title: typeof curation.title === "string" ? curation.title : "未命名灵感案例",
    description: typeof curation.description === "string" ? curation.description : null,
    source,
    tags: [...new Set([...(category ? [category] : []), ...styles, ...courseTags])],
    courseAssociations: Array.isArray(analysis.courseAssociations) ? analysis.courseAssociations : [],
    attributionNotice: "来源与可得署名按记录披露；Lumi 不主张创作或所有权。",
  } satisfies JsonRecord;
}

function publicationValues(publication: FormalWikiStudentPublicationInput | undefined, actorId: string, now: Date) {
  if (!publication) {
    return {
      publicationScope: "INTERNAL_CATALOG_ONLY" as const,
      studentVisible: false,
      studentDisplayDecision: "PENDING" as const,
      sourceDisclosureDecision: "PENDING" as const,
      teachingDecision: "PENDING" as const,
      safetyDecision: "PENDING" as const,
      qualityDecision: "PENDING" as const,
      withdrawalReadiness: "PENDING" as const,
      browserChannel: "DISABLED" as const,
      bridgeChannel: "DISABLED" as const,
      publicationRevision: 0,
      publishedBy: null,
      publishedAt: null,
      formalWikiActivationRecorded: false,
    };
  }
  return {
    publicationScope: publication.publicationScope,
    studentVisible: publication.studentVisible,
    studentDisplayDecision: publication.studentDisplayDecision,
    sourceDisclosureDecision: publication.sourceDisclosureDecision,
    teachingDecision: publication.teachingDecision,
    safetyDecision: publication.safetyDecision,
    qualityDecision: publication.qualityDecision,
    withdrawalReadiness: publication.withdrawalReadiness,
    browserChannel: publication.browserChannel,
    bridgeChannel: publication.bridgeChannel,
    publicationRevision: 1,
    publishedBy: actorId,
    publishedAt: now,
    formalWikiActivationRecorded: true,
  };
}
export function registerInspirationSource(db: CourseDb, rawSource: unknown) {
  const source = InspirationSourceRegistrySchema.parse(rawSource);
  const now = new Date();
  db.insert(inspirationSources).values({
    id: source.id, label: source.displayName, adapterId: source.adapterId,
    configurationJson: asJson(source), enabled: false, createdAt: now, updatedAt: now,
  }).onConflictDoNothing().run();
  return source;
}

export function ingestPrivateInspirationCandidate(db: CourseDb, input: {
  sourceId: string; candidate: unknown; analysis: unknown; reviewPackage: unknown;
}) {
  const candidate = InspirationCasePrivateCandidateSchema.parse(input.candidate);
  const analysis = InspirationCasePrivateAnalysisSchema.parse(input.analysis);
  const reviewPackage = InspirationCaseTeacherReviewPackageSchema.parse(input.reviewPackage);
  if (analysis.candidateId !== candidate.id || reviewPackage.candidateId !== candidate.id) throw new InspirationCandidateStateError();
  const now = new Date();
  db.insert(inspirationCandidates).values({
    id: candidate.id, sourceId: input.sourceId, state: "DISCOVERED", revision: 1,
    curationJson: asJson(candidate.curation), assetJson: asJson(candidate.asset), rightsJson: asJson(candidate.rights),
    analysisJson: asJson(analysis), reviewPackageJson: asJson(reviewPackage), withdrawalStatus: candidate.withdrawal.status,
    contentHash: candidate.asset.contentHash, createdAt: now, updatedAt: now,
  }).run();
  db.insert(inspirationCandidateAnalyses).values({
    candidateId: candidate.id, candidateRevision: 1, analysisJson: asJson(analysis),
    actualChannel: analysis.processing.actualChannel, createdAt: now, updatedAt: now,
  }).run();
  audit(db, candidate.id, "DISCOVERED", null, { sourceId: input.sourceId, revision: 1 }, now);
}

export function advanceAutomatedInspirationCandidate(db: CourseDb, candidateId: string, expectedRevision: number, targetState: AutomatedState) {
  const row = db.select().from(inspirationCandidates).where(eq(inspirationCandidates.id, candidateId)).get();
  if (!row) throw new InspirationCandidateNotFoundError();
  if (row.revision !== expectedRevision) throw new InspirationCandidateRevisionConflictError();
  const currentIndex = stateOrder.indexOf(row.state as AutomatedState);
  const targetIndex = stateOrder.indexOf(targetState);
  if (currentIndex < 0 || targetIndex !== currentIndex + 1) throw new InspirationCandidateStateError();
  if (targetState === "READY_FOR_TEACHER_REVIEW" && row.withdrawalStatus !== "READY") throw new InspirationCandidateStateError();
  const now = new Date();
  const result = db.update(inspirationCandidates).set({ state: targetState, revision: row.revision + 1, updatedAt: now })
    .where(and(eq(inspirationCandidates.id, candidateId), eq(inspirationCandidates.revision, expectedRevision), eq(inspirationCandidates.state, row.state))).run();
  if (result.changes !== 1) throw new InspirationCandidateRevisionConflictError();
  audit(db, candidateId, targetState, null, { automated: true, revision: row.revision + 1 }, now);
  return { state: targetState, revision: row.revision + 1 };
}

export function readTeacherReviewQueue(db: CourseDb, actor: TeacherActor, limit = 30) {
  assertTeacherInspirationReviewAccess(db, actor);
  return db.select().from(inspirationCandidates)
    .where(teacherReviewableInspirationCandidateCondition())
    .orderBy(asc(inspirationCandidates.updatedAt)).limit(Math.min(Math.max(limit, 1), 100)).all()
    .map((row) => {
      const review = row.reviewPackageJson as Record<string, unknown>;
      const analysis = row.analysisJson as Record<string, unknown>;
      const previewUrl = controlledPreviewUrl(row.id, row.assetJson, row.contentHash);
      const reviewSource = review.source && typeof review.source === "object" ? review.source : {};
      const duplicateRisk = review.duplicateRisk && typeof review.duplicateRisk === "object" ? review.duplicateRisk as Record<string, unknown> : {};
      const designSignals = review.designSignals && typeof review.designSignals === "object" ? review.designSignals : {};
      const aiRecommendation = review.aiRecommendation && typeof review.aiRecommendation === "object" ? review.aiRecommendation : {};
      const processingLog = review.processingLog && typeof review.processingLog === "object" ? review.processingLog : {};
      return {
        id: inspirationPublicId(row.id), revision: row.revision, state: row.state, withdrawalStatus: row.withdrawalStatus,
        curation: row.curationJson,
        asset: { mode: (row.assetJson as Record<string, unknown>).mode ?? "METADATA_ONLY" },
        analysis: { courseAssociations: analysis.courseAssociations ?? [] },
        reviewPackage: {
          preview: { mode: previewUrl ? "CONTROLLED" : "METADATA_ONLY", previewUrl }, source: reviewSource,
          extractedTags: review.extractedTags ?? [], courseAssociations: review.courseAssociations ?? [],
          duplicateRisk: { signal: duplicateRisk.signal ?? "NOT_RUN", explanation: duplicateRisk.explanation ?? "未提供重复风险说明。" },
          designSignals, aiRecommendation, processingLog,
        },
      };
    });
}

export function readPrivateInspirationCandidate(db: CourseDb, actor: TeacherActor, candidateId: string) {
  assertTeacherInspirationReviewAccess(db, actor);
  const row = db.select().from(inspirationCandidates).where(eq(inspirationCandidates.id, candidateId)).get();
  if (!row) throw new InspirationCandidateNotFoundError();
  return row;
}

export function decideInspirationCandidate(db: CourseDb, actor: TeacherActor, rawInput: unknown) {
  assertTeacherInspirationReviewAccess(db, actor);
  const input = InspirationReviewDecisionInputSchema.parse(rawInput);
  const requestHash = digest(input);
  return db.transaction((transaction) => {
    const replay = transaction.select().from(inspirationReviewDecisions).where(and(
      eq(inspirationReviewDecisions.teacherId, actor.userId), eq(inspirationReviewDecisions.idempotencyKey, input.idempotencyKey),
    )).get();
    if (replay) {
      if (replay.requestHash !== requestHash) throw new InspirationCandidateRequestConflictError();
      const candidate = transaction.select({ state: inspirationCandidates.state, revision: inspirationCandidates.revision })
        .from(inspirationCandidates).where(eq(inspirationCandidates.id, replay.candidateId)).get();
      const admission = transaction.select({ publicationScope: inspirationAdmissions.publicationScope })
        .from(inspirationAdmissions).where(eq(inspirationAdmissions.candidateId, replay.candidateId)).get();
      return {
        candidateId: replay.candidateId,
        decision: replay.decision,
        revision: candidate?.revision ?? replay.candidateRevision,
        state: candidate?.state ?? "READY_FOR_TEACHER_REVIEW",
        publicationScope: admission?.publicationScope ?? "INTERNAL_CATALOG_ONLY",
        replayed: true,
      };
    }
    const row = transaction.select().from(inspirationCandidates).where(eq(inspirationCandidates.id, input.candidateId)).get();
    if (!row) throw new InspirationCandidateNotFoundError();
    if (row.revision !== input.expectedRevision) throw new InspirationCandidateRevisionConflictError();
    if (!isTeacherReviewableInspirationCandidate(row)) throw new InspirationCandidateStateError();
    if (input.studentPublication && (!studentDisplayAllowed(row.rightsJson) || row.withdrawalStatus !== "READY")) {
      throw new InspirationCandidatePublicationGateError();
    }
    const now = new Date();
    const nextState = input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "READY_FOR_TEACHER_REVIEW";
    const nextRevision = input.decision === "DEFER" ? row.revision : row.revision + 1;
    if (input.decision !== "DEFER") {
      const updated = transaction.update(inspirationCandidates).set({ state: nextState, revision: nextRevision, updatedAt: now })
        .where(and(eq(inspirationCandidates.id, row.id), eq(inspirationCandidates.revision, row.revision), eq(inspirationCandidates.state, "READY_FOR_TEACHER_REVIEW"))).run();
      if (updated.changes !== 1) throw new InspirationCandidateRevisionConflictError();
    }
    const decisionId = randomUUID();
    transaction.insert(inspirationReviewDecisions).values({
      id: decisionId, candidateId: row.id, candidateRevision: row.revision, teacherId: actor.userId,
      decision: input.decision, courseTagsJson: input.courseTags, notes: input.notes,
      idempotencyKey: input.idempotencyKey, requestHash, createdAt: now,
    }).run();
    audit(transaction, row.id, input.decision === "APPROVE" ? "APPROVED" : input.decision, actor.userId, { expectedRevision: row.revision, courseTags: input.courseTags }, now);
    if (input.decision === "APPROVE") {
      const source = transaction.select({ configuration: inspirationSources.configurationJson })
        .from(inspirationSources).where(eq(inspirationSources.id, row.sourceId)).get();
      if (!source) throw new InspirationCandidateStateError();
      const readModel = activeReadModel(row, input.courseTags, input.studentPublication, source.configuration);
      const formalPublication = publicationValues(input.studentPublication, actor.userId, now);
      transaction.insert(inspirationAdmissions).values({
        candidateId: row.id, candidateRevision: nextRevision + 1, status: "AUTO_ADMITTED/INDEXED", readModelJson: readModel,
        ...formalPublication, indexedAt: now, activatedAt: now,
      }).run();
      transaction.update(inspirationCandidates).set({ state: "AUTO_ADMITTED/INDEXED", revision: nextRevision + 1, updatedAt: now })
        .where(and(eq(inspirationCandidates.id, row.id), eq(inspirationCandidates.revision, nextRevision), eq(inspirationCandidates.state, "APPROVED"))).run();
      audit(transaction, row.id, "AUTO_ADMITTED/INDEXED", null, { decisionId, revision: nextRevision + 1 }, now);
      transaction.update(inspirationAdmissions).set({ status: "ACTIVE", activatedAt: now }).where(eq(inspirationAdmissions.candidateId, row.id)).run();
      transaction.update(inspirationCandidates).set({ state: "ACTIVE", revision: nextRevision + 2, updatedAt: now }).where(and(eq(inspirationCandidates.id, row.id), eq(inspirationCandidates.revision, nextRevision + 1), eq(inspirationCandidates.state, "AUTO_ADMITTED/INDEXED"))).run();
      audit(transaction, row.id, "ACTIVE", null, { admission: "internal-catalog", revision: nextRevision + 2 }, now);
      if (input.studentPublication) {
        audit(transaction, row.id, "FORMAL_STUDENT_PUBLICATION_RECORDED", actor.userId, {
          publicationRevision: 1,
          publicationScope: input.studentPublication.publicationScope,
          studentDisplayDecision: input.studentPublication.studentDisplayDecision,
          sourceDisclosureDecision: input.studentPublication.sourceDisclosureDecision,
          teachingDecision: input.studentPublication.teachingDecision,
          safetyDecision: input.studentPublication.safetyDecision,
          qualityDecision: input.studentPublication.qualityDecision,
          withdrawalReadiness: input.studentPublication.withdrawalReadiness,
          browserChannel: input.studentPublication.browserChannel,
          bridgeChannel: input.studentPublication.bridgeChannel,
          publicSource: readModel.source,
        }, now);
      }
      return {
        candidateId: row.id,
        decision: input.decision,
        revision: nextRevision + 2,
        state: "ACTIVE",
        publicationScope: formalPublication.publicationScope,
        replayed: false,
      };
    }
    return { candidateId: row.id, decision: input.decision, revision: nextRevision, state: nextState, publicationScope: "INTERNAL_CATALOG_ONLY" as const, replayed: false };
  }, { behavior: "immediate" });
}
export function withdrawInspirationCandidate(db: CourseDb, actor: TeacherActor, candidateId: string, expectedRevision: number) {
  assertTeacherInspirationReviewAccess(db, actor);
  return db.transaction((transaction) => {
    const row = transaction.select().from(inspirationCandidates).where(eq(inspirationCandidates.id, candidateId)).get();
    if (!row) throw new InspirationCandidateNotFoundError();
    if (row.revision !== expectedRevision) throw new InspirationCandidateRevisionConflictError();
    if (row.state === "WITHDRAWN") return { state: "WITHDRAWN", revision: row.revision };
    const now = new Date();
    transaction.update(inspirationCandidates).set({ state: "WITHDRAWN", revision: row.revision + 1, withdrawalStatus: "WITHDRAWN", updatedAt: now })
      .where(and(eq(inspirationCandidates.id, candidateId), eq(inspirationCandidates.revision, expectedRevision))).run();
    transaction.delete(inspirationAdmissions).where(eq(inspirationAdmissions.candidateId, candidateId)).run();
    audit(transaction, candidateId, "WITHDRAWN", actor.userId, { revision: row.revision + 1 }, now);
    return { state: "WITHDRAWN", revision: row.revision + 1 };
  }, { behavior: "immediate" });
}
