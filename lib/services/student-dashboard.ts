import { createHash } from "node:crypto";

import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { assignments, courseModules, evidence, hintRecords, learnerProfiles, logicCards, projects, toolPathPlans, transferChallenges, troubleshootingRuns, users } from "@/lib/db/schema";
import { LogicCardSchema } from "@/lib/domain/schemas";
import { StudentDashboardSchema, StudentHintPublicResponseSchema } from "@/lib/domain/student-dashboard";
import { AllowedToolPathsSchema, ToolPathMilestoneArraySchema, ToolPathPlanRecordSchema, ToolPathReasonArraySchema, ToolPathRequirementsSchema } from "@/lib/domain/tool-path";
import { HintResponseSchema } from "./hints";
import { SemanticLogicReviewSchema } from "./semantic-logic-review";
import { publicTroubleshootingState, TroubleshootingRunSnapshotSchema } from "./troubleshooting";
import { publicTransferState } from "./transfer";
import type { AiMode } from "@/lib/domain/data-provenance";

type CourseDatabase = DatabaseConnection["db"];

export class StudentDashboardNotFoundError extends Error {
  constructor() { super("学生工作台不存在"); this.name = "StudentDashboardNotFoundError"; }
}

const iso = (date: Date) => date.toISOString();

export function readStudentDashboard(
  db: CourseDatabase,
  actor: SessionPayload,
  options: { aiMode?: AiMode } = {},
) {
  if (actor.role !== "STUDENT") throw new StudentDashboardNotFoundError();
  return db.transaction((transaction) => {
    const student = transaction.select().from(users).where(and(eq(users.id, actor.userId), eq(users.role, "STUDENT"))).get();
    if (!student?.classId) throw new StudentDashboardNotFoundError();

    const modules = transaction.select().from(courseModules)
      .where(eq(courseModules.classId, student.classId)).orderBy(asc(courseModules.sequence)).all();
    const project = transaction.select().from(projects)
      .where(and(eq(projects.studentId, student.id), eq(projects.classId, student.classId)))
      .orderBy(desc(projects.updatedAt), desc(projects.createdAt), desc(projects.id)).limit(1).get();
    const assignment = project
      ? transaction.select().from(assignments).where(and(eq(assignments.id, project.assignmentId), eq(assignments.classId, student.classId))).get()
      : transaction.select().from(assignments).where(eq(assignments.classId, student.classId)).orderBy(desc(assignments.createdAt), desc(assignments.id)).limit(1).get();
    const profile = transaction.select().from(learnerProfiles).where(eq(learnerProfiles.userId, student.id)).get();

    const card = project ? transaction.select({
      payloadJson: logicCards.payloadJson, ruleReady: logicCards.ruleReady, semanticReady: logicCards.semanticReady,
      semanticReviewJson: logicCards.semanticReviewJson, revision: logicCards.revision, dataType: logicCards.dataType,
    }).from(logicCards).where(eq(logicCards.projectId, project.id)).get() : undefined;
    let logicCard = null;
    if (card) {
      const payload = LogicCardSchema.parse(card.payloadJson);
      const review = SemanticLogicReviewSchema.parse(card.semanticReviewJson);
      logicCard = { payload, revision: card.revision, ruleReady: card.ruleReady, semanticReady: card.semanticReady, status: review.status, source: review.source, issues: review.issues, dataType: card.dataType };
    }

    const rawPlan = project ? transaction.select().from(toolPathPlans).where(eq(toolPathPlans.projectId, project.id)).get() : undefined;
    let toolPath = null;
    if (rawPlan) {
      const parsed = ToolPathPlanRecordSchema.parse(rawPlan);
      toolPath = {
        path: parsed.path,
        requirements: ToolPathRequirementsSchema.parse(parsed.requirementsJson),
        reasons: ToolPathReasonArraySchema.parse(parsed.reasonsJson),
        milestones: ToolPathMilestoneArraySchema.parse(parsed.milestonesJson),
        updatedAt: iso(parsed.updatedAt),
        dataType: parsed.dataType,
      };
    }

    const evidenceWhere = project ? and(eq(evidence.projectId, project.id), eq(evidence.studentId, student.id), eq(evidence.classId, student.classId), eq(evidence.storageStatus, "READY")) : undefined;
    const evidenceTotal = evidenceWhere ? transaction.select({ value: count() }).from(evidence).where(evidenceWhere).get()!.value : 0;
    const evidenceVerified = evidenceWhere ? transaction.select({ value: count() }).from(evidence).where(and(evidenceWhere, inArray(evidence.verificationStatus, ["RULE_VERIFIED", "TEACHER_VERIFIED"]))).get()!.value : 0;
    const rawEvidence = evidenceWhere ? transaction.select({
      id: evidence.id, kind: evidence.kind, layer: evidence.signalLayer,
      verification: evidence.verificationStatus, createdAt: evidence.createdAt, dataType: evidence.dataType,
    }).from(evidence).where(evidenceWhere).orderBy(desc(evidence.evidenceSequence)).limit(50).all() : [];
    const publicEvidence = { total: evidenceTotal, verified: evidenceVerified, recent: rawEvidence.map((row) => ({ id: row.id, kind: row.kind, layer: row.layer, verification: row.verification, dataType: row.dataType, timestamp: iso(row.createdAt) })) };

    const rawRun = project ? transaction.select().from(troubleshootingRuns).where(and(
      eq(troubleshootingRuns.projectId, project.id),
    )).orderBy(desc(troubleshootingRuns.updatedAt), desc(troubleshootingRuns.id)).limit(1).get() : undefined;
    const troubleshooting = rawRun ? (() => {
      const snapshot = TroubleshootingRunSnapshotSchema.parse({ currentLayer: rawRun.currentLayer, status: rawRun.status, stateJson: rawRun.stateJson });
      return { id: rawRun.id, revision: rawRun.revision, updatedAt: iso(rawRun.updatedAt), state: publicTroubleshootingState(snapshot.stateJson), dataType: rawRun.dataType };
    })() : null;

    const hintWhere = project ? and(eq(hintRecords.projectId, project.id), eq(hintRecords.studentId, student.id), eq(hintRecords.classId, student.classId)) : undefined;
    const hintCount = hintWhere ? transaction.select({ value: count() }).from(hintRecords).where(hintWhere).get()!.value : 0;
    const latestHint = hintWhere ? transaction.select({ responseJson: hintRecords.responseJson, hintSequence: hintRecords.hintSequence, hintLevel: hintRecords.hintLevel, createdAt: hintRecords.createdAt })
      .from(hintRecords).where(hintWhere).orderBy(desc(hintRecords.hintSequence)).limit(1).get() : undefined;
    const latestHintResponse = latestHint ? HintResponseSchema.parse(latestHint.responseJson) : undefined;
    const publicLatestHint = latestHintResponse ? StudentHintPublicResponseSchema.parse({
      hintLevel: latestHintResponse.hintLevel,
      groundingStatus: latestHintResponse.groundingStatus,
      confirmedFacts: latestHintResponse.confirmedFacts,
      hypotheses: latestHintResponse.hypotheses,
      questions: latestHintResponse.questions,
      guidance: latestHintResponse.guidance,
      nextSteps: latestHintResponse.nextSteps,
      localExample: latestHintResponse.localExample,
      sourceTitles: latestHintResponse.sourceTitles,
      sources: latestHintResponse.sources,
      uncertainty: latestHintResponse.uncertainty,
      fallback: latestHintResponse.fallback,
    }) : null;

    const rawTransfer = project ? transaction.select().from(transferChallenges).where(and(
      eq(transferChallenges.projectId, project.id), eq(transferChallenges.studentId, student.id), eq(transferChallenges.classId, student.classId),
    )).get() : undefined;
    const transfer = rawTransfer ? { ...publicTransferState(transaction, rawTransfer), dataType: rawTransfer.dataType } : null;

    if (assignment) AllowedToolPathsSchema.parse(assignment.allowedTools);
    const dates = [student.createdAt, profile?.updatedAt, project?.updatedAt, rawPlan?.updatedAt, rawRun?.updatedAt, latestHint?.createdAt, rawTransfer?.updatedAt, ...rawEvidence.map((item) => item.createdAt)].filter((value): value is Date => value instanceof Date);
    const updatedAt = new Date(Math.max(...dates.map((date) => date.getTime())));
    const snapshotVersion = createHash("sha256").update(JSON.stringify({
      student: [student.id, student.nickname, iso(student.createdAt)], profile: profile ? [profile.level, profile.decomposition, profile.signalUnderstanding, profile.mappingDesign, profile.troubleshooting, profile.transfer, profile.dataType, iso(profile.updatedAt)] : null,
      modules: modules.map((item) => [item.id, item.sequence, item.title, item.hours, item.focus]), assignment: assignment ? [assignment.id, assignment.moduleId, assignment.title, assignment.brief, assignment.allowedTools, iso(assignment.createdAt)] : null,
      project: project ? [project.id, project.stage, project.evidenceRevision, iso(project.updatedAt)] : null,
      logic: logicCard ? [logicCard.revision, logicCard.status, logicCard.ruleReady, logicCard.semanticReady] : null,
      plan: rawPlan ? [rawPlan.path, iso(rawPlan.updatedAt)] : null,
      evidence: [evidenceTotal, evidenceVerified, rawEvidence[0] ? iso(rawEvidence[0].createdAt) : null],
      troubleshooting: rawRun ? [rawRun.id, rawRun.revision, rawRun.status, iso(rawRun.updatedAt)] : null,
      hints: [hintCount, latestHint?.hintSequence ?? 0, latestHint ? iso(latestHint.createdAt) : null],
      transfer: rawTransfer ? [rawTransfer.revision, rawTransfer.status, rawTransfer.attemptCount, rawTransfer.dataType, iso(rawTransfer.updatedAt)] : null,
      provenance: [student.dataType, options.aiMode ?? "DETERMINISTIC_FALLBACK"],
    }), "utf8").digest("hex");

    return StudentDashboardSchema.parse({
      snapshotVersion, updatedAt: iso(updatedAt), aiMode: options.aiMode ?? "DETERMINISTIC_FALLBACK", dataType: student.dataType,
      student: { alias: student.nickname ?? student.alias, dataType: student.dataType },
      profile: profile ? { level: profile.level, decomposition: profile.decomposition, signalUnderstanding: profile.signalUnderstanding, mappingDesign: profile.mappingDesign, troubleshooting: profile.troubleshooting, transfer: profile.transfer, updatedAt: iso(profile.updatedAt), dataType: profile.dataType } : null,
      course: { totalHours: modules.reduce((sum, module) => sum + module.hours, 0), modules: modules.map(({ id, sequence, title, hours, focus }) => ({ id, sequence, title, hours, focus })) },
      assignment: assignment ? { id: assignment.id, moduleId: assignment.moduleId, title: assignment.title, brief: assignment.brief, allowedTools: assignment.allowedTools } : null,
      project: project ? { id: project.id, stage: project.stage, updatedAt: iso(project.updatedAt), dataType: project.dataType } : null,
      logicCard, toolPath, evidence: publicEvidence, troubleshooting,
      hints: { count: hintCount, latestLevel: latestHint?.hintLevel ?? null, latestAt: latestHint ? iso(latestHint.createdAt) : null },
      latestHint: publicLatestHint,
      transfer,
    });
  });
}
