import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import type { ModelClient } from "@/lib/ai/client";
import {
  createOpenAICompatibleEmbeddingProvider,
  type EmbeddingProvider,
} from "@/lib/ai/embeddings";
import type { SessionPayload } from "@/lib/auth/session";
import { getCoursePack } from "@/lib/course-packs/registry";
import type { DatabaseConnection } from "@/lib/db/client";
import { evidence as evidenceTable } from "@/lib/db/schema";
import type { StudentOnboardingProfile } from "@/lib/domain/student-onboarding";
import type { KnowledgeItem, RankedKnowledgeItem } from "@/lib/knowledge/retrieve";
import { readStudentOnboarding } from "@/lib/services/student-onboarding";
import { readToolLearningState, type ToolLearningState } from "@/lib/tool-adapters/learning-state";
import { getToolAdapter } from "@/lib/tool-adapters/registry";

import type { AgentTurnResponse } from "./contracts";
import { resolveActiveDesignTask } from "./design-project-task";
import { retrieveAgentKnowledge, retrieveTutorKnowledge } from "./knowledge-retriever";
import type { ModelRetryContext } from "./model-call-retry";
import { AgentForbiddenError } from "./orchestrator-errors";
import type { AgentPolicy } from "./policy-contract";
import {
  createOpenAICompatibleModelProvider,
  modelClientAdapter,
  type ModelProviderAdapter,
} from "./model-provider-adapter";
import { readProjectBrief, type ProjectBrief } from "./project-brief-memory";
import { actionForType } from "./router";
import type { AgentToolExecutor } from "./tool-executor";
import {
  deriveVerifiedEvidenceFact,
  sanitizeEvidenceFragment,
  selectRelevantVerifiedEvidenceFacts,
  type VerifiedEvidenceFact,
} from "./verified-evidence-facts";

export type AgentOptions = {
  signal?: AbortSignal;
  cancellationRequested?: () => boolean;
  artworkRoot?: string;
  ai?: {
    enabled: boolean;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    embeddingBaseUrl?: string;
    embeddingApiKey?: string;
    embeddingModel?: string;
    maxOutputTokens?: number;
    vision?: boolean;
  };
  modelClient?: ModelClient;
  modelProviderAdapter?: ModelProviderAdapter;
  embeddingProvider?: EmbeddingProvider;
  policy?: AgentPolicy;
  now?: () => Date;
  onModelError?: (error: unknown, attempt: number) => void;
  modelRetryContext?: ModelRetryContext;
  onTextDelta?: (delta: string) => void;
  /** Stream liveness without exposing reasoning content to the learner. */
  onModelActivity?: () => void;
  allowRetryAfterTextDelta?: boolean;
  onToolProgress?: (event: {
    status: "RUNNING" | "SUCCEEDED" | "FAILED";
    toolId: string;
    label: string;
    summary: string;
  }) => void;
  toolExecutor?: AgentToolExecutor;
};

export type StudentContext = {
  taskId: string;
  studentId: string;
  classId: string;
  dataType: "REAL" | "DEMONSTRATION_DATA";
  project: null | { id: string; stage: string; coursePackId: string; coursePackVersion: string };
  profile: null | { level: string; dimensions: Record<string, number> };
  onboarding: StudentOnboardingProfile;
  evidenceCount: number;
  evidenceSummary: Array<{ kind: string; signalLayer: string; label: string; verificationStatus: string }>;
  verifiedEvidenceFacts: VerifiedEvidenceFact[];
  toolState: ToolLearningState | null;
  projectBrief: ProjectBrief;
};

export function readStudentContext(
  connection: DatabaseConnection,
  actor: SessionPayload,
  coursePackId: string,
  question = "",
  taskId?: string,
): StudentContext {
  if (actor.role !== "STUDENT") throw new AgentForbiddenError("仅学生可以使用学习智能体");
  const activeTask = resolveActiveDesignTask(connection, actor, taskId);
  const student = { id: activeTask.student.studentId, classId: activeTask.student.classId };
  const project = connection.sqlite.prepare(`
    SELECT id, stage, course_pack_id coursePackId, course_pack_version coursePackVersion
    FROM projects WHERE student_id=? AND class_id=? AND course_pack_id=?
    ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1
  `).get(actor.userId, student.classId, coursePackId) as StudentContext["project"] | undefined;
  const pack = getCoursePack(coursePackId, project?.coursePackVersion ?? "1");
  const profile = connection.sqlite.prepare(`
    SELECT level, dimensions_json dimensionsJson FROM course_pack_profiles
    WHERE user_id=? AND class_id=? AND course_pack_id=? AND course_pack_version=?
  `).get(actor.userId, student.classId, pack.id, pack.version) as { level: string; dimensionsJson: string } | undefined;
  const evidence = project ? connection.sqlite.prepare(
    "SELECT count(*) count FROM evidence WHERE project_id=? AND student_id=? AND class_id=?",
  ).get(project.id, actor.userId, student.classId) as { count: number } : { count: 0 };
  const rawEvidenceSummary = project ? connection.sqlite.prepare(`
    SELECT kind, signal_layer signalLayer, label, verification_status verificationStatus
    FROM evidence WHERE project_id=? AND student_id=? AND class_id=?
    ORDER BY evidence_sequence DESC LIMIT 5
  `).all(project.id, actor.userId, student.classId) as StudentContext["evidenceSummary"] : [];
  const evidenceSummary = rawEvidenceSummary.map((item) => ({
    ...item,
    label: sanitizeEvidenceFragment(item.label, 80),
  }));
  const verifiedRows = project ? connection.db.select({
    id: evidenceTable.id,
    evidenceSequence: evidenceTable.evidenceSequence,
    kind: evidenceTable.kind,
    signalLayer: evidenceTable.signalLayer,
    verificationStatus: evidenceTable.verificationStatus,
    label: evidenceTable.label,
    content: evidenceTable.content,
    probeJson: evidenceTable.probeJson,
  }).from(evidenceTable).where(and(
    eq(evidenceTable.projectId, project.id),
    eq(evidenceTable.studentId, actor.userId),
    eq(evidenceTable.classId, student.classId),
    eq(evidenceTable.storageStatus, "READY"),
    inArray(evidenceTable.verificationStatus, ["RULE_VERIFIED", "TEACHER_VERIFIED"]),
  )).orderBy(desc(evidenceTable.evidenceSequence)).limit(20).all() : [];
  const verifiedEvidenceFacts = selectRelevantVerifiedEvidenceFacts(
    verifiedRows.flatMap((row) => {
      const fact = deriveVerifiedEvidenceFact(row);
      return fact ? [fact] : [];
    }),
    question,
  );
  const toolState = pack.toolAdapterIds
    .map((adapterId) => readToolLearningState(connection, actor.userId, adapterId))
    .find((state): state is ToolLearningState => state !== null) ?? null;
  const onboarding = readStudentOnboarding(connection.db, actor);
  return {
    taskId: activeTask.task.id,
    studentId: actor.userId,
    classId: student.classId,
    dataType: actor.userId.startsWith("demo-student-") ? "DEMONSTRATION_DATA" : "REAL",
    project: project ?? null,
    profile: profile ? { level: profile.level, dimensions: JSON.parse(profile.dimensionsJson) as Record<string, number> } : null,
    onboarding,
    evidenceCount: evidence.count,
    evidenceSummary,
    verifiedEvidenceFacts,
    toolState,
    projectBrief: readProjectBrief(connection, actor.userId, student.classId, activeTask.task.id),
  };
}

export function selectKnowledge(
  connection: DatabaseConnection,
  packId: string,
  packVersion: string,
  message: string,
): Array<KnowledgeItem | RankedKnowledgeItem> {
  return retrieveAgentKnowledge(connection, packId, packVersion, message);
}

export function buildEmbeddingProvider(options: AgentOptions, policy: AgentPolicy) {
  if (options.embeddingProvider) return options.embeddingProvider;
  const ai = options.ai;
  const baseUrl = ai?.embeddingBaseUrl ?? ai?.baseUrl;
  const apiKey = ai?.embeddingApiKey ?? ai?.apiKey;
  if (
    !baseUrl
    || !apiKey
    || !ai?.embeddingModel
  ) return null;
  return createOpenAICompatibleEmbeddingProvider({
    baseUrl,
    apiKey,
    model: ai.embeddingModel,
    timeoutMs: Math.min(5_000, policy.budgets.modelTimeoutMs),
  });
}

export function selectTutorKnowledge(
  connection: DatabaseConnection,
  packId: string,
  packVersion: string,
  message: string,
  options: AgentOptions,
  policy: AgentPolicy,
  embeddingProvider?: EmbeddingProvider | null,
) {
  return retrieveTutorKnowledge(
    connection,
    packId,
    packVersion,
    message,
    embeddingProvider === undefined ? buildEmbeddingProvider(options, policy) : embeddingProvider,
    { signal: options.signal },
  );
}

export function retrievalMessage(message: string, recentTurns: readonly { studentMessage: string }[]) {
  const normalized = message.normalize("NFKC").trim();
  const isContextualFollowUp = normalized.length <= 24
    && /(那|然后|接着|继续|下一步|第[一二三四五六七八九十\d]+步|这个|这种|它)/.test(normalized);
  const previousQuestion = recentTurns.at(-1)?.studentMessage;
  return isContextualFollowUp && previousQuestion ? `${previousQuestion} ${normalized}` : normalized;
}

export function graphFor(
  packId: string,
  episode: AgentTurnResponse["episode"],
  knowledge: Array<KnowledgeItem | RankedKnowledgeItem>,
) {
  const contextLabel = episode === "DEBUG" ? "当前现象" : episode === "TRANSFER" ? "原有结构" : "你的目标";
  const conceptLabel = knowledge[0]?.title ?? (packId === "book-design"
    ? "受众与阅读任务"
    : packId === "general-design"
      ? "目标—受众—表达"
      : "输入—映射—输出");
  const actionLabel = episode === "DEBUG" ? "验证证据" : episode === "TRANSFER" ? "保留 / 改变" : "动手验证";
  return {
    nodes: [
      { id: "context", label: contextLabel, kind: "CONTEXT" as const },
      { id: "concept", label: conceptLabel.slice(0, 28), kind: "CONCEPT" as const },
      { id: "evidence", label: "可观察证据", kind: "EVIDENCE" as const },
      { id: "action", label: actionLabel, kind: "ACTION" as const },
    ],
    links: [["context", "concept"], ["concept", "evidence"], ["evidence", "action"]] as Array<[string, string]>,
  };
}

function hasDirectTagCoverage(message: string, item: KnowledgeItem | RankedKnowledgeItem) {
  const normalized = message.normalize("NFKC").toLowerCase();
  return item.tags.some((tag) => {
    const candidate = tag.normalize("NFKC").toLowerCase().trim();
    return candidate.length >= 2 && normalized.includes(candidate);
  });
}

export function knowledgeEnhancementsForQuestion(
  message: string,
  knowledge: Array<KnowledgeItem | RankedKnowledgeItem>,
  options: { preserveSemanticMatches?: boolean } = {},
) {
  const normalized = message.normalize("NFKC");
  const requestsFormalAuthority = /(替我|帮我|直接).{0,16}(提交|评分|打分|满分|设为通过|改成优秀|通过.{0,4}(阶段|评价|审核))/.test(
    normalized,
  );
  if (requestsFormalAuthority) return [];
  if (options.preserveSemanticMatches) return knowledge;
  if (/digishow/i.test(message)) {
    return knowledge.filter((item) => [item.title, item.content, ...item.tags].some((value) => /digishow/i.test(value)));
  }
  const asksForExactProcedure = /(具体.{0,10}(尺寸|参数|按钮|步骤|命令)|从.{1,16}(到|至).{0,12}(尺寸|步骤)|裁纸|折页|上胶)/.test(
    normalized,
  );
  if (!asksForExactProcedure) return knowledge;
  return knowledge.filter((item) => hasDirectTagCoverage(message, item));
}

export function buildModelClient(options: AgentOptions, policy: AgentPolicy) {
  if (options.modelProviderAdapter) return options.modelProviderAdapter;
  if (options.modelClient) return modelClientAdapter(options.modelClient);
  const ai = options.ai;
  if (!ai?.enabled || !ai.baseUrl || !ai.apiKey || !ai.model) return null;
  return createOpenAICompatibleModelProvider({
    baseUrl: ai.baseUrl,
    apiKey: ai.apiKey,
    model: ai.model,
    maxOutputTokens: ai.maxOutputTokens,
    idleTimeoutMs: policy.budgets.modelIdleTimeoutMs,
    totalTimeoutMs: policy.budgets.modelTimeoutMs,
    vision: ai.vision ?? false,
  });
}

export function actionCard(action: ReturnType<typeof actionForType>, id = randomUUID()) {
  const adapterId = action.target === "BOOK_LAYOUT_LAB" ? "book-layout-lab"
    : action.target === "NODE_CANVAS" ? "node-canvas"
      : action.target === "KNOWLEDGE_MAP" ? "knowledge-map"
        : "project-evidence";
  getToolAdapter(adapterId);
  return { id, ...action, focus: action.focus ?? null, status: "PROPOSED" as const };
}
