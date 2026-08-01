import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { DatabaseConnection } from "@/lib/db/client";
import { classes, evidence, hintRecords, learnerProfiles, logicCards, projects, teacherDecisions, toolPathPlans, transferAttempts, transferChallenges, troubleshootingRuns, users } from "@/lib/db/schema";
import { PROJECT_STAGES } from "@/lib/domain/stages";
import type { ProjectStage } from "@/lib/domain/stages";
import { ClassAnalyticsSchema, LearnerDetailSchema, TeacherOriginalSnapshotSchema, type TeacherOriginalSnapshot } from "@/lib/domain/teacher";
import { TransferRubricSchema } from "@/lib/domain/transfer";
import { publicTeacherDecision } from "./teacher-decisions";
import type { AiMode } from "@/lib/domain/data-provenance";
import {
  mapTeacherAgentTimeline,
  type TeacherAgentStepRow,
  type TeacherAgentToolCallRow,
  type TeacherAgentTurnRow,
} from "./teacher-agent-timeline";
import { bookLayoutReviewTarget, parseBookLayoutEvidenceAuditRow, type BookLayoutEvidenceAuditRow } from "./book-layout-review";
import { readStudentMemoryCollection } from "@/lib/agent/student-memory";

type CourseDatabase = DatabaseConnection["db"];
const iso = (date: Date) => date.toISOString();
export class TeacherAnalyticsNotFoundError extends Error {
  constructor() { super("NOT_FOUND"); this.name = "TeacherAnalyticsNotFoundError"; }
}

export function listTeacherClasses(db: CourseDatabase, options: { includeDemo?: boolean; classId?: string } = {}) {
  return db.transaction((transaction) => {
    const rows = transaction.select({
      id: classes.id,
      name: classes.name,
      realStudents: sql<number>`sum(case when ${users.role}='STUDENT' and ${users.dataType}='REAL' then 1 else 0 end)`,
      demoStudents: sql<number>`sum(case when ${users.role}='STUDENT' and ${users.dataType}='DEMONSTRATION_DATA' then 1 else 0 end)`,
    })
      .from(classes).leftJoin(users, and(eq(users.classId, classes.id), eq(users.role, "STUDENT")))
      .where(options.classId ? eq(classes.id, options.classId) : undefined)
      .groupBy(classes.id, classes.name).orderBy(asc(classes.name), asc(classes.id)).all()
      .map((row) => ({ ...row, realStudents: Number(row.realStudents), demoStudents: Number(row.demoStudents) }))
      .filter((row) => options.includeDemo || row.realStudents > 0 || (row.demoStudents === 0 && !row.id.startsWith("demo-class-")));
    const total = rows.length;
    const classList = rows.slice(0, 100).map((courseClass) => options.includeDemo ? ({
      ...courseClass, students: courseClass.realStudents + courseClass.demoStudents, dataType: "REAL" as const,
    }) : ({ id: courseClass.id, name: courseClass.name, students: courseClass.realStudents, dataType: "REAL" as const }));
    return { classes: classList, classesMeta: { total, returned: classList.length, truncated: classList.length < total } };
  });
}

function sortedCounts(rows: { key: string | null; count: number }[]) {
  return rows.filter((row): row is { key: string; count: number } => row.key !== null)
    .map((row) => ({ key: row.key, count: Number(row.count) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function issuesFrom(value: unknown) {
  if (!value || typeof value !== "object" || !("issues" in value) || !Array.isArray(value.issues)) return [];
  return value.issues.filter((issue): issue is string => typeof issue === "string").slice(0, 10);
}

function authorityCounts(verification: { key: string; count: number }[]) {
  const merged = new Map<string, number>();
  for (const row of verification) {
    const key = row.key === "TEACHER_VERIFIED" ? "TEACHER" : row.key === "RULE_VERIFIED" ? "RULE" : "STUDENT";
    merged.set(key, (merged.get(key) ?? 0) + row.count);
  }
  return [...merged].map(([key, value]) => ({ key, count: value })).sort((a, b) => a.key.localeCompare(b.key));
}

export function readClassAnalytics(db: CourseDatabase, classId: string, options: { includeDemo?: boolean; aiMode?: AiMode } = {}) {
  return db.transaction((transaction) => {
    const courseClass = transaction.select({ id: classes.id, name: classes.name }).from(classes).where(eq(classes.id, classId)).get();
    if (!courseClass) throw new TeacherAnalyticsNotFoundError();
    const counts = transaction.select({ dataType: users.dataType, value: count() }).from(users)
      .where(and(eq(users.classId, classId), eq(users.role, "STUDENT"))).groupBy(users.dataType).all();
    const realStudents = Number(counts.find((row) => row.dataType === "REAL")?.value ?? 0);
    const demoStudents = Number(counts.find((row) => row.dataType === "DEMONSTRATION_DATA")?.value ?? 0);
    const totalStudents = options.includeDemo ? realStudents + demoStudents : realStudents;
    const students = transaction.select({ id: users.id, alias: users.alias, createdAt: users.createdAt, dataType: users.dataType }).from(users)
      .where(and(eq(users.classId, classId), eq(users.role, "STUDENT"), options.includeDemo ? undefined : eq(users.dataType, "REAL"))).orderBy(asc(users.alias), asc(users.id)).limit(1000).all();
    const metricsFor = (dataType: "REAL" | "DEMONSTRATION_DATA") => {
      const rawCurrentProjects = transaction.all(sql`WITH ranked_projects AS (
        SELECT id, student_id, stage, created_at, updated_at,
          row_number() OVER (PARTITION BY student_id ORDER BY updated_at DESC, created_at DESC, id DESC) AS project_rank
        FROM projects WHERE class_id = ${classId} AND data_type = ${dataType}
      ) SELECT id, student_id AS studentId, stage, created_at AS createdAt, updated_at AS updatedAt
        FROM ranked_projects WHERE project_rank = 1 ORDER BY student_id ASC`) as unknown as Array<{ id: string; studentId: string; stage: ProjectStage; createdAt: number; updatedAt: number }>;
      const projectRows = rawCurrentProjects.map((row) => ({ ...row, createdAt: new Date(row.createdAt * 1000), updatedAt: new Date(row.updatedAt * 1000) }));
      const currentProjectIds = projectRows.map((row) => row.id);
      const currentProjectPredicate = currentProjectIds.length ? inArray(projects.id, currentProjectIds) : sql`0`;
      const currentEvidencePredicate = currentProjectIds.length ? inArray(evidence.projectId, currentProjectIds) : sql`0`;
      const currentHintPredicate = currentProjectIds.length ? inArray(hintRecords.projectId, currentProjectIds) : sql`0`;
      const currentTransferPredicate = currentProjectIds.length ? inArray(transferChallenges.projectId, currentProjectIds) : sql`0`;
      const stageMap = new Map<string, number>();
      for (const row of projectRows) stageMap.set(row.stage, (stageMap.get(row.stage) ?? 0) + 1);
      const profileRows = transaction.select({
        userId: learnerProfiles.userId, level: learnerProfiles.level,
        decomposition: learnerProfiles.decomposition, signalUnderstanding: learnerProfiles.signalUnderstanding,
        mappingDesign: learnerProfiles.mappingDesign, troubleshooting: learnerProfiles.troubleshooting,
        transfer: learnerProfiles.transfer, updatedAt: learnerProfiles.updatedAt,
      }).from(learnerProfiles).innerJoin(users, and(eq(users.id, learnerProfiles.userId), eq(users.classId, classId)))
        .where(and(eq(users.role, "STUDENT"), eq(users.dataType, dataType))).all();
      const levelMap = new Map<string, number>();
      for (const profile of profileRows) levelMap.set(profile.level, (levelMap.get(profile.level) ?? 0) + 1);
      const dimensions = ["decomposition", "signalUnderstanding", "mappingDesign", "troubleshooting", "transfer"] as const;
      const profileDimensions = dimensions.map((dimension) => {
        const values = new Map<string, number>();
        for (const row of profileRows) values.set(String(row[dimension]), (values.get(String(row[dimension])) ?? 0) + 1);
        return { dimension, scores: [...values].map(([key, value]) => ({ key, count: value })).sort((a, b) => a.key.localeCompare(b.key)), support: profileRows.filter((row) => row[dimension] <= 1).length };
      });
      const logicRows = transaction.select({ review: logicCards.semanticReviewJson }).from(logicCards)
        .innerJoin(projects, and(eq(projects.id, logicCards.projectId), eq(projects.classId, classId), currentProjectPredicate)).all();
      const issueMap = new Map<string, number>();
      for (const row of logicRows) for (const issue of issuesFrom(row.review)) issueMap.set(issue, (issueMap.get(issue) ?? 0) + 1);
      const allTroubleRows = transaction.select({ projectId: troubleshootingRuns.projectId, layer: troubleshootingRuns.currentLayer, status: troubleshootingRuns.status, studentId: projects.studentId, updatedAt: troubleshootingRuns.updatedAt })
        .from(troubleshootingRuns).innerJoin(projects, and(eq(projects.id, troubleshootingRuns.projectId), eq(projects.classId, classId), currentProjectPredicate))
        .orderBy(desc(troubleshootingRuns.updatedAt), desc(troubleshootingRuns.id)).all();
      const latestTrouble = new Map<string, typeof allTroubleRows[number]>();
      for (const row of allTroubleRows) if (!latestTrouble.has(row.projectId)) latestTrouble.set(row.projectId, row);
      const troubleRows = [...latestTrouble.values()];
      const troubleLayerMap = new Map<string, number>();
      for (const row of troubleRows) troubleLayerMap.set(row.layer, (troubleLayerMap.get(row.layer) ?? 0) + 1);
      const hintRows = transaction.select({ studentId: hintRecords.studentId, level: hintRecords.hintLevel, sequence: hintRecords.hintSequence })
        .from(hintRecords).where(and(eq(hintRecords.classId, classId), currentHintPredicate)).orderBy(asc(hintRecords.studentId), desc(hintRecords.hintSequence)).all();
      const hintTotal = transaction.select({ value: count() }).from(hintRecords).where(and(eq(hintRecords.classId, classId), currentHintPredicate)).get()?.value ?? 0;
      const hintStudent = new Map<string, { latest: number; max: number; count: number }>();
      for (const row of hintRows) {
        const value = hintStudent.get(row.studentId);
        if (!value) hintStudent.set(row.studentId, { latest: row.level, max: row.level, count: 1 });
        else { value.max = Math.max(value.max, row.level); value.count += 1; }
      }
      const transferGroups = transaction.select({ key: transferChallenges.status, count: count() }).from(transferChallenges)
        .where(and(eq(transferChallenges.classId, classId), currentTransferPredicate)).groupBy(transferChallenges.status).all();
      const transferMap = new Map(transferGroups.map((row) => [row.key, Number(row.count)]));
      const evidenceVerification = sortedCounts(transaction.select({ key: evidence.verificationStatus, count: count() }).from(evidence)
        .where(and(eq(evidence.classId, classId), eq(evidence.storageStatus, "READY"), currentEvidencePredicate)).groupBy(evidence.verificationStatus).all());
      const supportIds = new Set(profileRows.filter((row) => dimensions.some((dimension) => row[dimension] <= 1)).map((row) => row.userId));
      for (const row of troubleRows) if (row.status === "ESCALATED") supportIds.add(row.studentId);
      for (const [studentId, row] of hintStudent) if (row.max === 3) supportIds.add(studentId);
      const evidenceDate = transaction.select({ value: sql<number | null>`max(${evidence.createdAt})` }).from(evidence).where(and(eq(evidence.classId, classId), currentEvidencePredicate)).get()?.value;
      const hintDate = transaction.select({ value: sql<number | null>`max(${hintRecords.createdAt})` }).from(hintRecords).where(and(eq(hintRecords.classId, classId), currentHintPredicate)).get()?.value;
      const transferDate = transaction.select({ value: sql<number | null>`max(${transferChallenges.updatedAt})` }).from(transferChallenges).where(and(eq(transferChallenges.classId, classId), currentTransferPredicate)).get()?.value;
      const decisionScope = currentProjectIds.length ? or(inArray(teacherDecisions.projectId, currentProjectIds), isNull(teacherDecisions.projectId))
        : isNull(teacherDecisions.projectId);
      const decisionDate = transaction.select({ value: sql<number | null>`max(${teacherDecisions.createdAt})` }).from(teacherDecisions)
        .where(and(eq(teacherDecisions.classId, classId), eq(teacherDecisions.dataType, dataType), decisionScope)).get()?.value;
      const dates = [...profileRows.map((row) => row.updatedAt), ...projectRows.map((row) => row.updatedAt), ...troubleRows.map((row) => row.updatedAt),
        ...[evidenceDate, hintDate, transferDate, decisionDate].filter((value): value is number => typeof value === "number").map((value) => new Date(value * 1000))];
      return {
        projectRows, supportIds, dates,
        metrics: {
          stages: PROJECT_STAGES.map((stage) => ({ stage, count: stageMap.get(stage) ?? 0 })),
          supportNeeded: supportIds.size,
          profiles: { levels: [...levelMap].map(([key, value]) => ({ key, count: value })).sort((a, b) => a.key.localeCompare(b.key)), dimensions: profileDimensions },
          logicIssues: [...issueMap].map(([key, value]) => ({ key, count: value })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
          troubleshooting: { byLayer: [...troubleLayerMap].map(([layer, value]) => ({ layer, count: value })).sort((a, b) => a.layer.localeCompare(b.layer)), escalated: troubleRows.filter((row) => row.status === "ESCALATED").length },
          hints: { students: hintStudent.size, total: Number(hintTotal), latestL3: [...hintStudent.values()].filter((row) => row.latest === 3).length, maxL3: [...hintStudent.values()].filter((row) => row.max === 3).length },
          transfer: { active: transferMap.get("OPEN") ?? 0, passed: transferMap.get("PASSED") ?? 0, locked: transferMap.get("LOCKED") ?? 0 },
          evidence: { byVerification: evidenceVerification, byAuthority: authorityCounts(evidenceVerification) },
        },
      };
    };
    const real = metricsFor("REAL");
    const demo = options.includeDemo ? metricsFor("DEMONSTRATION_DATA") : { projectRows: [], supportIds: new Set<string>(), dates: [], metrics: {
      stages: PROJECT_STAGES.map((stage) => ({ stage, count: 0 })), supportNeeded: 0,
      profiles: { levels: [], dimensions: ["decomposition", "signalUnderstanding", "mappingDesign", "troubleshooting", "transfer"].map((dimension) => ({ dimension, scores: [], support: 0 })) },
      logicIssues: [], troubleshooting: { byLayer: [], escalated: 0 }, hints: { students: 0, total: 0, latestL3: 0, maxL3: 0 },
      transfer: { active: 0, passed: 0, locked: 0 }, evidence: { byVerification: [], byAuthority: [] },
    } };
    const latestProject = new Map([...real.projectRows, ...demo.projectRows].map((row) => [row.studentId, row]));
    const supportIds = new Set([...real.supportIds, ...demo.supportIds]);
    const dates = [...students.map((row) => row.createdAt), ...real.dates, ...demo.dates];
    const updatedAt = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : new Date(0);
    return ClassAnalyticsSchema.parse({
      class: { ...courseClass, dataType: "REAL" }, aiMode: options.aiMode ?? "DETERMINISTIC_FALLBACK",
      dataCounts: { real: realStudents, demonstration: demoStudents, included: totalStudents }, updatedAt: iso(updatedAt),
      ...real.metrics,
      metricsByDataType: { REAL: real.metrics, DEMONSTRATION_DATA: demo.metrics },
      students: students.map((student) => ({ id: student.id, alias: student.alias, dataType: student.dataType, stage: latestProject.get(student.id)?.stage ?? null, needsSupport: supportIds.has(student.id), updatedAt: iso(latestProject.get(student.id)?.updatedAt ?? student.createdAt) })),
      studentsMeta: { total: totalStudents, returned: students.length, truncated: students.length < totalStudents, aggregateScope: "ALL_CLASS_STUDENTS" },
    });
  });
}

export function readLearnerDetail(db: CourseDatabase, classId: string, studentId: string, options: { decisionLimit?: number; includeDemo?: boolean; aiMode?: AiMode } = {}) {
  return db.transaction((transaction) => {
    const student = transaction.select({ id: users.id, alias: users.alias, dataType: users.dataType }).from(users).where(and(eq(users.id, studentId), eq(users.classId, classId), eq(users.role, "STUDENT"), options.includeDemo ? undefined : eq(users.dataType, "REAL"))).get();
    if (!student) throw new TeacherAnalyticsNotFoundError();
    const profile = transaction.select().from(learnerProfiles).where(eq(learnerProfiles.userId, studentId)).get();
    const project = transaction.select().from(projects).where(and(eq(projects.classId, classId), eq(projects.studentId, studentId))).orderBy(desc(projects.updatedAt), desc(projects.createdAt), desc(projects.id)).limit(1).get();
    const logic = project ? transaction.select().from(logicCards).where(eq(logicCards.projectId, project.id)).get() : undefined;
    const plan = project ? transaction.select().from(toolPathPlans).where(eq(toolPathPlans.projectId, project.id)).get() : undefined;
    const verification = project ? sortedCounts(transaction.select({ key: evidence.verificationStatus, count: count() }).from(evidence).where(and(eq(evidence.projectId, project.id), eq(evidence.classId, classId), eq(evidence.studentId, studentId), eq(evidence.storageStatus, "READY"))).groupBy(evidence.verificationStatus).all()) : [];
    const evidenceRows = project ? transaction.select({ id: evidence.id, kind: evidence.kind, layer: evidence.signalLayer, verification: evidence.verificationStatus, code: evidence.confirmedCode, sequence: evidence.evidenceSequence }).from(evidence)
      .where(and(eq(evidence.projectId, project.id), eq(evidence.classId, classId), eq(evidence.studentId, studentId), eq(evidence.storageStatus, "READY")))
      .orderBy(desc(evidence.evidenceSequence)).limit(20).all() : [];
    const evidenceTotal = verification.reduce((sum, row) => sum + row.count, 0);
    const authority = authorityCounts(verification);
    const trouble = project ? transaction.select().from(troubleshootingRuns).where(eq(troubleshootingRuns.projectId, project.id)).orderBy(desc(troubleshootingRuns.updatedAt), desc(troubleshootingRuns.id)).limit(1).get() : undefined;
    const hints = project ? transaction.select({ level: hintRecords.hintLevel, sequence: hintRecords.hintSequence }).from(hintRecords).where(and(eq(hintRecords.projectId, project.id), eq(hintRecords.classId, classId), eq(hintRecords.studentId, studentId))).orderBy(desc(hintRecords.hintSequence)).limit(500).all() : [];
    const challenge = project ? transaction.select().from(transferChallenges).where(and(eq(transferChallenges.projectId, project.id), eq(transferChallenges.classId, classId), eq(transferChallenges.studentId, studentId))).get() : undefined;
    const attempt = challenge ? transaction.select({ rubric: transferAttempts.rubricJson, createdAt: transferAttempts.createdAt }).from(transferAttempts).where(eq(transferAttempts.challengeId, challenge.id)).orderBy(desc(transferAttempts.attemptNumber)).limit(1).get() : undefined;
    const rawBookEvidence = transaction.all(sql`SELECT id, payload_json AS payloadJson, created_at AS createdAt, data_type AS dataType
      FROM audit_events WHERE user_id=${studentId} AND type='BOOK_LAYOUT_EVIDENCE_SUBMITTED'
      ORDER BY created_at DESC, id DESC LIMIT 1`) as unknown as BookLayoutEvidenceAuditRow[];
    const bookLayoutEvidence = rawBookEvidence[0] ? parseBookLayoutEvidenceAuditRow(rawBookEvidence[0]) : null;
    const decisionScope = project
      ? or(isNull(teacherDecisions.projectId), eq(teacherDecisions.projectId, project.id))
      : isNull(teacherDecisions.projectId);
    const decisions = transaction.select().from(teacherDecisions).where(and(
      eq(teacherDecisions.classId, classId), eq(teacherDecisions.studentId, studentId), decisionScope,
    )).orderBy(desc(teacherDecisions.timelineSequence)).limit(Math.min(Math.max(options.decisionLimit ?? 20, 1), 50)).all();
    const review = logic?.semanticReviewJson as Record<string, unknown> | undefined;
    const rubric = attempt ? TransferRubricSchema.parse(attempt.rubric) : null;
    const reviewTargets: Array<{ targetId: string; snapshot: TeacherOriginalSnapshot }> = [];
    if (logic && project) reviewTargets.push({ targetId: project.id, snapshot: TeacherOriginalSnapshotSchema.parse({ targetType: "LOGIC_REVIEW", revision: logic.revision, status: typeof review?.status === "string" ? review.status : "PENDING", ruleReady: logic.ruleReady, semanticReady: logic.semanticReady, source: typeof review?.source === "string" ? review.source : "UNKNOWN", issues: issuesFrom(review) }) });
    reviewTargets.push(...evidenceRows.map((row) => ({ targetId: row.id, snapshot: TeacherOriginalSnapshotSchema.parse({ targetType: "EVIDENCE", ...row, revision: Math.max(1, project?.evidenceRevision ?? 0) }) })));
    if (challenge) reviewTargets.push({ targetId: challenge.id, snapshot: TeacherOriginalSnapshotSchema.parse({ targetType: "TRANSFER", revision: challenge.revision, status: challenge.status, attemptCount: challenge.attemptCount, latestRubric: rubric, latestOutcome: rubric?.outcome ?? null }) });
    if (bookLayoutEvidence) reviewTargets.push(bookLayoutReviewTarget(bookLayoutEvidence));
    const rankedIds = transaction.all(sql`WITH ranked_target_decisions AS (
      SELECT id, row_number() OVER (PARTITION BY target_type, target_id ORDER BY timeline_sequence DESC) AS target_rank
      FROM teacher_decisions WHERE class_id=${classId} AND student_id=${studentId}
        AND (project_id IS NULL OR project_id=${project?.id ?? null})
    ) SELECT id FROM ranked_target_decisions WHERE target_rank=1`) as unknown as Array<{ id: string }>;
    const latestRows = rankedIds.length ? transaction.select().from(teacherDecisions).where(inArray(teacherDecisions.id, rankedIds.map((row) => row.id))).all() : [];
    const currentTargetKeys = new Set(reviewTargets.map((target) => `${target.snapshot.targetType}:${target.targetId}`));
    const latestDecisionByTarget = Object.fromEntries(latestRows.map(publicTeacherDecision)
      .filter((decision) => currentTargetKeys.has(`${decision.targetType}:${decision.targetId}`))
      .sort((a, b) => a.targetType.localeCompare(b.targetType) || a.targetId.localeCompare(b.targetId))
      .map((decision) => [`${decision.targetType}:${decision.targetId}`, decision]));
    const agentRows = transaction.all(sql`SELECT
      t.id AS turnId, c.id AS conversationId,
      c.course_pack_id AS coursePackId, c.course_pack_version AS coursePackVersion,
      t.student_message AS studentMessage, t.episode AS episode,
      t.decision_code AS decisionCode, t.response_strategy AS responseStrategy,
      t.response_latency_ms AS responseLatencyMs, t.ai_mode AS aiMode,
      t.policy_trace_json AS policyTraceJson,
      t.source_ids_json AS sourceIdsJson, t.reply_json AS replyJson,
      t.created_at AS createdAt, t.data_type AS dataType,
      r.id AS reviewId, r.teacher_id AS reviewTeacherId, r.decision AS reviewDecision,
      r.notes AS reviewNotes, r.created_at AS reviewCreatedAt, r.data_type AS reviewDataType
    FROM agent_turns t
    JOIN agent_conversations c ON c.id=t.conversation_id
    LEFT JOIN agent_decision_reviews r ON r.id=(
      SELECT ar.id FROM agent_decision_reviews ar WHERE ar.turn_id=t.id
      ORDER BY ar.created_at DESC, ar.id DESC LIMIT 1
    )
    WHERE c.class_id=${classId} AND c.student_id=${studentId}
    ORDER BY t.created_at DESC, t.turn_sequence DESC LIMIT 30`) as unknown as TeacherAgentTurnRow[];
    const agentSteps = transaction.all(sql`SELECT
      s.turn_id AS turnId, s.id, s.step_sequence AS sequence,
      s.kind, s.status, s.label, s.summary,
      s.tool_call_id AS toolCallId, s.tool_id AS toolId, s.latency_ms AS latencyMs
    FROM agent_steps s
    JOIN agent_turns t ON t.id=s.turn_id
    JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE c.class_id=${classId} AND c.student_id=${studentId}
      AND s.turn_id IN (
        SELECT recent.id FROM agent_turns recent
        JOIN agent_conversations recent_conversation ON recent_conversation.id=recent.conversation_id
        WHERE recent_conversation.class_id=${classId} AND recent_conversation.student_id=${studentId}
        ORDER BY recent.created_at DESC, recent.turn_sequence DESC LIMIT 30
      )
    ORDER BY s.turn_id, s.step_sequence`) as unknown as TeacherAgentStepRow[];
    const agentTools = transaction.all(sql`SELECT
      tc.turn_id AS turnId, tc.id, tc.call_sequence AS sequence,
      tc.tool_id AS toolId, tc.tool_version AS toolVersion, tc.adapter_id AS adapterId,
      tc.input_json AS inputJson, tc.status, tc.error_code AS errorCode,
      tc.latency_ms AS latencyMs, tc.created_at AS createdAt, tc.data_type AS dataType
    FROM agent_tool_calls tc
    JOIN agent_turns t ON t.id=tc.turn_id
    JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE c.class_id=${classId} AND c.student_id=${studentId}
      AND tc.turn_id IN (
        SELECT recent.id FROM agent_turns recent
        JOIN agent_conversations recent_conversation ON recent_conversation.id=recent.conversation_id
        WHERE recent_conversation.class_id=${classId} AND recent_conversation.student_id=${studentId}
        ORDER BY recent.created_at DESC, recent.turn_sequence DESC LIMIT 30
      )
    ORDER BY tc.turn_id, tc.call_sequence`) as unknown as TeacherAgentToolCallRow[];
    const agentTimeline = mapTeacherAgentTimeline(agentRows, agentSteps, agentTools);
    const memories = readStudentMemoryCollection(transaction, classId, studentId, {
      includeDemo: options.includeDemo,
      limit: 100,
    });
    return LearnerDetailSchema.parse({
      aiMode: options.aiMode ?? "DETERMINISTIC_FALLBACK",
      student,
      profile: profile ? { level: profile.level, decomposition: profile.decomposition, signalUnderstanding: profile.signalUnderstanding, mappingDesign: profile.mappingDesign, troubleshooting: profile.troubleshooting, transfer: profile.transfer, updatedAt: iso(profile.updatedAt), dataType: profile.dataType } : null,
      project: project ? { id: project.id, stage: project.stage, updatedAt: iso(project.updatedAt), dataType: project.dataType } : null,
      logic: logic ? { status: typeof review?.status === "string" ? review.status : "PENDING", source: typeof review?.source === "string" ? review.source : "UNKNOWN", issues: issuesFrom(review), revision: logic.revision, ruleReady: logic.ruleReady, semanticReady: logic.semanticReady, dataType: logic.dataType } : null,
      path: plan ? { value: plan.path, updatedAt: iso(plan.updatedAt), dataType: plan.dataType } : null,
      evidence: { total: evidenceTotal, dataType: student.dataType, byVerification: verification, byAuthority: authority },
      troubleshooting: trouble ? { layer: trouble.currentLayer, status: trouble.status, revision: trouble.revision, updatedAt: iso(trouble.updatedAt), dataType: trouble.dataType } : null,
      hints: { latestLevel: hints[0]?.level ?? null, maxLevel: hints.length ? Math.max(...hints.map((row) => row.level)) : null, count: hints.length },
      transfer: challenge ? { status: challenge.status, revision: challenge.revision, attemptCount: challenge.attemptCount, latestOutcome: rubric?.outcome ?? null, latestRubric: rubric, updatedAt: iso(challenge.updatedAt), dataType: challenge.dataType } : null,
      reviewTargets,
      decisions: decisions.map(publicTeacherDecision),
      latestDecisionByTarget,
      agentTimeline,
      memories,
      bookLayoutEvidence: bookLayoutEvidence ? {
        id: bookLayoutEvidence.id, audience: bookLayoutEvidence.audience,
        score: bookLayoutEvidence.score, passed: bookLayoutEvidence.passed,
        createdAt: bookLayoutEvidence.createdAt, dataType: bookLayoutEvidence.dataType,
      } : null,
    });
  });
}
