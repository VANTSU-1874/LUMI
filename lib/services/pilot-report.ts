import type { DatabaseConnection } from "@/lib/db/client";
import { PilotReportSchema, type PilotReport } from "@/lib/domain/pilot-report";

export class PilotReportNotFoundError extends Error {
  constructor() { super("PILOT_REPORT_NOT_FOUND"); this.name = "PilotReportNotFoundError"; }
}

type NumericRow = Record<string, string | number | null>;
const numeric = (value: string | number | null | undefined) => Number(value ?? 0);
const nullableRate = (numerator: number, denominator: number) => denominator > 0
  ? Number((numerator / denominator).toFixed(3))
  : null;

function reviewSummary(row: NumericRow | undefined) {
  const confirmed = numeric(row?.confirmed);
  const corrected = numeric(row?.corrected);
  const needsReview = numeric(row?.needsReview);
  const reviewed = confirmed + corrected + needsReview;
  return { reviewed, confirmed, corrected, needsReview, correctionRate: nullableRate(corrected, reviewed) };
}

export function readPilotReport(connection: DatabaseConnection, classId: string, now = new Date()): PilotReport {
  const courseClass = connection.sqlite.prepare("SELECT name FROM classes WHERE id=?").get(classId) as { name: string } | undefined;
  if (!courseClass) throw new PilotReportNotFoundError();

  const participantCount = numeric((connection.sqlite.prepare(`
    SELECT count(*) value FROM users
    WHERE class_id=? AND role='STUDENT' AND data_type='REAL'
  `).get(classId) as NumericRow | undefined)?.value);

  const projectRows = connection.sqlite.prepare(`
    WITH ranked AS (
      SELECT stage, course_pack_id coursePackId, course_pack_version coursePackVersion,
        row_number() OVER (PARTITION BY student_id ORDER BY updated_at DESC, created_at DESC, id DESC) projectRank
      FROM projects WHERE class_id=? AND data_type='REAL'
    )
    SELECT stage, coursePackId, coursePackVersion, count(*) count
    FROM ranked WHERE projectRank=1
    GROUP BY stage, coursePackId, coursePackVersion
    ORDER BY stage, coursePackId, coursePackVersion
  `).all(classId) as Array<{ stage: string; coursePackId: string; coursePackVersion: string; count: number }>;
  const stageMap = new Map<string, number>();
  const coursePackMap = new Map<string, { coursePackId: string; coursePackVersion: string; count: number }>();
  for (const row of projectRows) {
    const count = numeric(row.count);
    stageMap.set(row.stage, (stageMap.get(row.stage) ?? 0) + count);
    const key = `${row.coursePackId}@${row.coursePackVersion}`;
    const current = coursePackMap.get(key);
    if (current) current.count += count;
    else coursePackMap.set(key, { coursePackId: row.coursePackId, coursePackVersion: row.coursePackVersion, count });
  }
  const currentProjects = [...stageMap.values()].reduce((sum, count) => sum + count, 0);

  const agent = connection.sqlite.prepare(`
    SELECT count(*) turns,
      sum(CASE WHEN t.ai_mode='MODEL_ASSISTED' THEN 1 ELSE 0 END) modelAssisted,
      sum(CASE WHEN t.ai_mode='DETERMINISTIC_FALLBACK' THEN 1 ELSE 0 END) deterministicFallback,
      sum(CASE WHEN json_array_length(t.source_ids_json)>0 THEN 1 ELSE 0 END) sourceGrounded,
      round(avg(t.response_latency_ms)) averageResponseLatencyMs
    FROM agent_turns t
    JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE c.class_id=? AND t.data_type='REAL' AND c.data_type='REAL'
  `).get(classId) as NumericRow | undefined;
  const turns = numeric(agent?.turns);
  const sourceGrounded = numeric(agent?.sourceGrounded);
  const action = connection.sqlite.prepare(`
    SELECT
      sum(CASE WHEN a.status='PROPOSED' THEN 1 ELSE 0 END) proposed,
      sum(CASE WHEN a.status='EXECUTED' THEN 1 ELSE 0 END) executed,
      sum(CASE WHEN a.status='EXPIRED' THEN 1 ELSE 0 END) expired
    FROM agent_actions a
    JOIN agent_turns t ON t.id=a.turn_id
    JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE c.class_id=? AND a.data_type='REAL' AND t.data_type='REAL' AND c.data_type='REAL'
  `).get(classId) as NumericRow | undefined;
  const agentByCoursePack = connection.sqlite.prepare(`
    SELECT c.course_pack_id coursePackId, c.course_pack_version coursePackVersion, count(*) turns
    FROM agent_turns t JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE c.class_id=? AND t.data_type='REAL' AND c.data_type='REAL'
    GROUP BY c.course_pack_id, c.course_pack_version
    ORDER BY c.course_pack_id, c.course_pack_version
  `).all(classId) as Array<{ coursePackId: string; coursePackVersion: string; turns: number }>;
  const agentReviews = connection.sqlite.prepare(`
    WITH ranked AS (
      SELECT r.decision,
        row_number() OVER (PARTITION BY r.turn_id ORDER BY r.created_at DESC, r.id DESC) reviewRank
      FROM agent_decision_reviews r
      JOIN agent_turns t ON t.id=r.turn_id
      JOIN agent_conversations c ON c.id=t.conversation_id
      WHERE c.class_id=? AND r.data_type='REAL' AND t.data_type='REAL' AND c.data_type='REAL'
    )
    SELECT
      sum(CASE WHEN decision='CONFIRMED' THEN 1 ELSE 0 END) confirmed,
      sum(CASE WHEN decision='CORRECTED' THEN 1 ELSE 0 END) corrected,
      sum(CASE WHEN decision='NEEDS_REVIEW' THEN 1 ELSE 0 END) needsReview
    FROM ranked WHERE reviewRank=1
  `).get(classId) as NumericRow | undefined;

  const evidenceRows = connection.sqlite.prepare(`
    SELECT verification_status key, count(*) count
    FROM evidence
    WHERE class_id=? AND data_type='REAL' AND storage_status='READY'
    GROUP BY verification_status ORDER BY verification_status
  `).all(classId) as Array<{ key: string; count: number }>;
  const evidenceByVerification = evidenceRows.map((row) => ({ key: row.key, count: numeric(row.count) }));
  const transferRows = connection.sqlite.prepare(`
    SELECT status key, count(*) count FROM transfer_challenges
    WHERE class_id=? AND data_type='REAL'
    GROUP BY status ORDER BY status
  `).all(classId) as Array<{ key: string; count: number }>;
  const transferMap = new Map(transferRows.map((row) => [row.key, numeric(row.count)]));
  const book = connection.sqlite.prepare(`
    WITH submissions AS (
      SELECT e.user_id, e.id, e.created_at,
        CASE WHEN json_extract(e.payload_json,'$.passed')=1 THEN 1 ELSE 0 END passed,
        row_number() OVER (PARTITION BY e.user_id ORDER BY e.created_at DESC, e.id DESC) submissionRank
      FROM audit_events e
      JOIN users u ON u.id=e.user_id
      WHERE u.class_id=? AND u.role='STUDENT' AND u.data_type='REAL'
        AND e.type='BOOK_LAYOUT_EVIDENCE_SUBMITTED' AND e.data_type='REAL'
    )
    SELECT count(*) submissions, sum(passed) passedSubmissions,
      count(DISTINCT user_id) participants,
      sum(CASE WHEN submissionRank=1 AND passed=1 THEN 1 ELSE 0 END) latestPassedParticipants
    FROM submissions
  `).get(classId) as NumericRow | undefined;
  const learningReviews = connection.sqlite.prepare(`
    WITH ranked AS (
      SELECT decision,
        row_number() OVER (PARTITION BY target_type, target_id ORDER BY timeline_sequence DESC, id DESC) reviewRank
      FROM teacher_decisions WHERE class_id=? AND data_type='REAL'
    )
    SELECT
      sum(CASE WHEN decision='CONFIRMED' THEN 1 ELSE 0 END) confirmed,
      sum(CASE WHEN decision='CORRECTED' THEN 1 ELSE 0 END) corrected,
      sum(CASE WHEN decision='NEEDS_REVIEW' THEN 1 ELSE 0 END) needsReview
    FROM ranked WHERE reviewRank=1
  `).get(classId) as NumericRow | undefined;

  return PilotReportSchema.parse({
    schemaVersion: "1",
    generatedAt: now.toISOString(),
    scope: { className: courseClass.name, dataBoundary: "REAL_ONLY", participantCount },
    automatic: {
      agent: {
        turns,
        modelAssisted: numeric(agent?.modelAssisted),
        deterministicFallback: numeric(agent?.deterministicFallback),
        sourceGrounded,
        sourceGroundingRate: nullableRate(sourceGrounded, turns),
        averageResponseLatencyMs: agent?.averageResponseLatencyMs === null || agent?.averageResponseLatencyMs === undefined
          ? null
          : numeric(agent.averageResponseLatencyMs),
        actions: { proposed: numeric(action?.proposed), executed: numeric(action?.executed), expired: numeric(action?.expired) },
        byCoursePack: agentByCoursePack.map((row) => ({ ...row, turns: numeric(row.turns) })),
        teacherReviews: reviewSummary(agentReviews),
      },
      learning: {
        currentProjects,
        completedProjects: stageMap.get("COMPLETE") ?? 0,
        projectsByStage: [...stageMap].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key)),
        projectsByCoursePack: [...coursePackMap.values()].sort((a, b) => a.coursePackId.localeCompare(b.coursePackId) || a.coursePackVersion.localeCompare(b.coursePackVersion)),
        evidence: { total: evidenceByVerification.reduce((sum, row) => sum + row.count, 0), byVerification: evidenceByVerification },
        transfer: { open: transferMap.get("OPEN") ?? 0, passed: transferMap.get("PASSED") ?? 0, locked: transferMap.get("LOCKED") ?? 0 },
        bookDesign: {
          submissions: numeric(book?.submissions), passedSubmissions: numeric(book?.passedSubmissions),
          participants: numeric(book?.participants), latestPassedParticipants: numeric(book?.latestPassedParticipants),
        },
        teacherReviews: reviewSummary(learningReviews),
      },
    },
    manualRequired: [
      { id: "TASK_COMPLETION", label: "任务是否真实完成", status: "PENDING_MANUAL_OBSERVATION", instruction: "由教师按任务标准记录完成、部分完成或未完成；不能用打开页面或项目阶段替代。" },
      { id: "FIRST_NEXT_STEP", label: "首次下一步是否正确", status: "PENDING_MANUAL_OBSERVATION", instruction: "试用前写下可接受的下一步与依据，再与学生第一个实际行动比较。" },
      { id: "COGNITIVE_ENGAGEMENT", label: "学生认知参与", status: "PENDING_MANUAL_OBSERVATION", instruction: "观察学生是否提出假设、比较证据并解释节点或版面关系；不能用停留时长替代。" },
      { id: "SUBJECTIVE_FEEDBACK", label: "学生主观体验", status: "PENDING_MANUAL_OBSERVATION", instruction: "结束后记录哪里有帮助、哪里误导、下一次是否愿意使用；引用原话前先脱敏。" },
    ],
    interpretationBoundary: [
      "本报告仅汇总该班 REAL 数据，演示账号、自动化测试和教师代操作不得计入真实试用。",
      "自动日志只能证明系统内发生过相应操作，不能单独证明学生已经理解或形成高阶思维。",
      "小样本结果应表述为“本轮试用中观察到”，不得据此声称显著提升或普遍有效。",
      "人工观察项完成前，本报告不能作为完整教学成效结论。",
    ],
  });
}

function percent(rate: number | null) {
  return rate === null ? "暂无可计算样本" : `${(rate * 100).toFixed(1)}%`;
}

export function renderPilotReportMarkdown(report: PilotReport) {
  const { agent, learning } = report.automatic;
  const lines = [
    "# 触映教育 Agent 真实试用汇总",
    "",
    `- 班级：${report.scope.className}`,
    `- 生成时间：${report.generatedAt}`,
    `- 数据边界：仅 REAL（真实试用）`,
    `- 匿名参与人数：${report.scope.participantCount}`,
    "",
    "## 系统自动汇总（只说明系统内可验证行为）",
    "",
    `- Agent 回合：${agent.turns}（模型辅助 ${agent.modelAssisted}，确定性降级 ${agent.deterministicFallback}）`,
    `- 有来源回合：${agent.sourceGrounded}，来源覆盖率：${percent(agent.sourceGroundingRate)}`,
    `- 平均响应时间：${agent.averageResponseLatencyMs === null ? "暂无" : `${agent.averageResponseLatencyMs} ms`}`,
    `- 行动卡：待确认 ${agent.actions.proposed}，已执行 ${agent.actions.executed}，已过期 ${agent.actions.expired}`,
    `- Agent 教师复核：${agent.teacherReviews.reviewed}（确认 ${agent.teacherReviews.confirmed}，纠正 ${agent.teacherReviews.corrected}，待复核 ${agent.teacherReviews.needsReview}；纠正率 ${percent(agent.teacherReviews.correctionRate)}）`,
    `- 当前数字交互项目：${learning.currentProjects}，已到完成阶段：${learning.completedProjects}`,
    `- 学习证据：${learning.evidence.total}`,
    `- 迁移任务：开放 ${learning.transfer.open}，通过 ${learning.transfer.passed}，锁定 ${learning.transfer.locked}`,
    `- 书籍设计：${learning.bookDesign.participants} 人提交 ${learning.bookDesign.submissions} 次；当前最新提交通过 ${learning.bookDesign.latestPassedParticipants} 人`,
    `- 学习证据/迁移教师复核：${learning.teacherReviews.reviewed}（确认 ${learning.teacherReviews.confirmed}，纠正 ${learning.teacherReviews.corrected}，待复核 ${learning.teacherReviews.needsReview}）`,
    "",
    "### 按课程包统计 Agent 回合",
    "",
    "| 课程包 | 版本 | 回合数 |",
    "| --- | --- | ---: |",
    ...(agent.byCoursePack.length ? agent.byCoursePack.map((row) => `| ${row.coursePackId} | ${row.coursePackVersion} | ${row.turns} |`) : ["| 暂无 | — | 0 |"]),
    "",
    "## 必须由教师补填的观察项",
    "",
    "| 观察项 | 状态 | 填写依据 |",
    "| --- | --- | --- |",
    ...report.manualRequired.map((item) => `| ${item.label} | 待人工观察 | ${item.instruction} |`),
    "",
    "## 解释边界",
    "",
    ...report.interpretationBoundary.map((item) => `- ${item}`),
    "",
  ];
  return lines.join("\n");
}
