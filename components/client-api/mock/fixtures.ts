import type {
  AgentTurnRequest,
  AgentTurnResult,
  CourseRegistryResponse,
  CritiqueResult,
  DesignTask,
  TeacherInsightsResponse,
  TeacherResourceListResponse,
} from "../contracts";
import { LUMI_D017_STORYLINE } from "@/data/demo/lumi-d017";

const activeStoryTask = LUMI_D017_STORYLINE.tasks.find((task) => task.status === "ACTIVE");
if (!activeStoryTask) throw new Error("D-017 active task is unavailable");

export const MOCK_NOW = activeStoryTask.updatedAt;
export const MOCK_TASK_ID = activeStoryTask.id;
export const MOCK_RUN_ID = "20000000-0000-4000-8000-000000000001";
export const MOCK_TURN_ID = "30000000-0000-4000-8000-000000000001";
export const MOCK_ARTWORK_ID = "50000000-0000-4000-8000-000000000001";

const mockArtworkPresets = {
  "digital-interaction": {
    mimeType: "image/svg+xml" as const,
    byteSize: 6_422,
    width: 1_600,
    height: 1_000,
    previewUrl: "/demo/digital-interaction-proposal-board-preset.svg" as const,
  },
  "book-design": {
    mimeType: "image/svg+xml" as const,
    byteSize: 3_273,
    width: 1_000,
    height: 1_400,
    previewUrl: "/demo/layout-poster-after-preset.svg" as const,
  },
  "general-design": {
    mimeType: "image/svg+xml" as const,
    byteSize: 6_422,
    width: 1_600,
    height: 1_000,
    previewUrl: "/demo/digital-interaction-proposal-board-preset.svg" as const,
  },
};

export const mockCourses: CourseRegistryResponse = {
  currentCourseId: "digital-interaction",
  courses: [
    {
      id: "digital-interaction",
      label: "数字交互文创设计",
      description: "把文化意图转成可感知、可验证的互动体验。",
      version: "1",
      status: "READY",
      capabilities: ["DIALOGUE", "ARTWORK_CRITIQUE", "SOFTWARE_TROUBLESHOOTING"],
    },
    {
      id: "book-design",
      label: "版式设计",
      description: "围绕阅读目标梳理信息、层级与输出规范。",
      version: "1",
      status: "READY",
      capabilities: ["DIALOGUE", "ARTWORK_CRITIQUE", "SOFTWARE_TROUBLESHOOTING"],
    },
    {
      id: "general-design",
      label: "通用设计基础",
      description: "从目标、受众与设计关系出发，推进尚未归入专项课程的设计问题。",
      version: "1",
      status: "READY",
      capabilities: ["DIALOGUE", "ARTWORK_CRITIQUE"],
    },
  ],
};

export const mockTasks: DesignTask[] = LUMI_D017_STORYLINE.tasks.map((task) => ({
  id: task.id,
  title: task.title,
  status: task.status,
  mode: "conversation",
  pinned: false,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
}));

export const mockCritique: CritiqueResult = {
  id: "40000000-0000-4000-8000-000000000001",
  frameworkId: "critique-framework-five-plus-closure",
  frameworkVersion: "1.0",
  courseId: "digital-interaction",
  artworkId: MOCK_ARTWORK_ID,
  createdAt: MOCK_NOW,
  dimensions: [
    {
      id: "goal",
      label: "目标",
      displayOrder: 1,
      status: "DEVELOPING",
      observation: "画面把纹样放在视觉中心，但还缺少使用场景与观众停留时间的证据。",
      evidence: [{ kind: "ARTWORK_REGION", label: "主画面中央纹样与靠近提示" }],
      guidance: {
        level: "QUESTION",
        message: "观众离开后，你最希望他记住纹样本身，还是记住‘靠近才看见’这个动作？",
      },
      isDeepDive: true,
    },
    {
      id: "translation",
      label: "创意转译",
      displayOrder: 2,
      status: "ESTABLISHED",
      observation: "靠近与纹样由模糊到清晰形成了可见联系，动作不只是开关。",
      evidence: [{ kind: "STUDENT_STATEMENT", label: "学生说明：距离越近，纹样细节越清楚" }],
      guidance: {
        level: "HINT",
        message: "保留连续变化，再用一次无讲解测试确认观众能否自己发现关系。",
      },
      isDeepDive: true,
    },
    {
      id: "structure_hierarchy",
      label: "构成与层级",
      displayOrder: 3,
      status: "DEVELOPING",
      observation: "标题、主纹样与反馈光效同时较强，第一眼入口还不够稳定。",
      evidence: [{ kind: "ARTWORK_REGION", label: "标题、主体和光效的视觉重量接近" }],
      guidance: {
        level: "HINT",
        message: "先关掉一组光效，只保留一个视觉入口和一个互动提示。",
      },
      isDeepDive: false,
    },
    {
      id: "formal_language",
      label: "形式语言",
      displayOrder: 4,
      status: "NEEDS_EVIDENCE",
      observation: "静态图能看到配色与图形，不能证明运动节奏和声音是否服务目标。",
      evidence: [{ kind: "ARTWORK_REGION", label: "当前仅有静态方案图" }],
      guidance: {
        level: "QUESTION",
        message: "请补一段 5 秒状态录屏，保留从待机到触发的完整变化。",
      },
      isDeepDive: false,
    },
    {
      id: "craft_standards",
      label: "工艺与规范",
      displayOrder: 5,
      status: "NEEDS_EVIDENCE",
      observation: "当前没有屏幕尺寸、观看距离和复位条件，暂不能判断现场可读性与稳定性。",
      evidence: [{ kind: "ARTWORK_REGION", label: "当前方案图未标注设备尺寸与观看距离" }],
      guidance: {
        level: "QUESTION",
        message: "最终使用什么屏幕和传感设备？观众通常离它多远？",
      },
      isDeepDive: false,
    },
  ],
  closure: {
    established: "已经成立的是，靠近与纹样显影形成了可见联系。",
    nextStep: "下一步只做一次无讲解测试，确认观众是否知道该靠近。",
  },
};

export function createMockTurn(
  request: AgentTurnRequest,
  turnId = MOCK_TURN_ID,
  options: { hasArtwork?: boolean; courseId?: string; artworkId?: string } = {},
): AgentTurnResult {
  const hasArtwork = options.hasArtwork ?? (request.message.includes("作品") || request.message.includes("方案"));
  const courseId = options.courseId ?? mockCourses.currentCourseId;
  const course = mockCourses.courses.find((item) => item.id === courseId) ?? mockCourses.courses[0]!;
  const artworkId = options.artworkId ?? MOCK_ARTWORK_ID;
  const artworkPreset = mockArtworkPresets[course.id as keyof typeof mockArtworkPresets]
    ?? mockArtworkPresets["digital-interaction"];
  return {
    taskId: request.taskId ?? MOCK_TASK_ID,
    conversationId: "60000000-0000-4000-8000-000000000001",
    turnId,
    studentMessage: request.message,
    coursePack: {
      id: course.id,
      version: course.version,
      label: course.label,
    },
    episode: hasArtwork ? "REFLECT" : "EXPLORE",
    decisionCode: hasArtwork ? "CRITIQUE_ARTWORK" : "CLARIFY_DESIGN_GOAL",
    aiMode: "MODEL_ASSISTED",
    policy: {
      policyId: "lumi-student",
      policyVersion: "1",
      budgets: {
        modelDecisions: 1,
        maxModelDecisions: 2,
        modelRetries: 0,
        toolCalls: 0,
        maxToolCalls: 4,
        turnTimeoutMs: 180_000,
      },
      autonomy: {
        readOnlyTools: "AUTOMATIC",
        studentMutations: "STUDENT_CONFIRMATION",
        formalAuthority: "FORBIDDEN",
      },
      appliedRules: ["EVIDENCE_BOUNDARY", "STUDENT_CONTROL"],
    },
    executionSteps: [],
    runtime: { id: "lumi-mock-runtime", version: "1.0.0" },
    runtimeEvents: [],
    createdAt: MOCK_NOW,
    artworkAttachment: hasArtwork ? {
      id: artworkId,
      ...artworkPreset,
    } : undefined,
    reply: {
      eyebrow: "Lumi 设计导师 · 演示数据",
      title: hasArtwork ? "先确认最影响目标的一处" : "先把想法说具体一点",
      message: hasArtwork
        ? "我先按画面可见事实做五维总览，再和你深谈最影响目标的两维。"
        : "你希望谁在什么场景里，通过这次互动感受到什么？先给我一句不必完美的话。",
      whyThisStep: "目标会改变后面对互动、层级与形式的判断。",
      uncertainty: hasArtwork ? "静态图不能证明交互时序与现场稳定性。" : "还没有作品或场景证据。",
      graph: {
        nodes: [
          { id: "student-intent", label: "学生意图", kind: "CONTEXT" },
          { id: "next-evidence", label: "下一项证据", kind: "ACTION" },
        ],
        links: [["student-intent", "next-evidence"]],
      },
      sources: hasArtwork
        ? [{
          id: "mock-artwork",
          title: "本轮学生作品（演示数据）",
          authority: "STUDENT_ARTWORK",
          scope: "仅用于当前画面的可见事实判断",
        }]
        : [],
      actions: [],
    },
    critique: hasArtwork ? { ...mockCritique, courseId: course.id, artworkId } : undefined,
  };
}

export const mockConversationTurns: AgentTurnResult[] = LUMI_D017_STORYLINE.turns.map((storyTurn) => {
  const artwork = LUMI_D017_STORYLINE.artworks.find((item) => item.turnId === storyTurn.id);
  const result = createMockTurn({
    taskId: storyTurn.taskId,
    message: storyTurn.studentMessage,
    context: { view: "AGENT" },
  }, storyTurn.id, {
    hasArtwork: Boolean(artwork),
    courseId: LUMI_D017_STORYLINE.identity.courseId,
    artworkId: artwork?.id,
  });
  delete result.critique;
  return {
    ...result,
    conversationId: storyTurn.conversationId,
    studentMessage: storyTurn.studentMessage,
    episode: storyTurn.episode,
    aiMode: storyTurn.aiMode,
    createdAt: storyTurn.createdAt,
    artworkAttachment: artwork ? {
      id: artwork.id,
      mimeType: artwork.mimeType,
      byteSize: artwork.byteSize,
      width: artwork.width,
      height: artwork.height,
      previewUrl: artwork.previewUrl,
    } : undefined,
    reply: {
      ...result.reply,
      eyebrow: "Lumi 设计导师 · 预置演示",
      message: storyTurn.assistantMessage,
    },
  };
});

export const mockCritiquesByTurn: Array<{ turnId: string; critique: CritiqueResult }> =
  LUMI_D017_STORYLINE.critiques.map((storyCritique) => ({
    turnId: storyCritique.turnId,
    critique: {
      id: storyCritique.id,
      frameworkId: storyCritique.frameworkId,
      frameworkVersion: storyCritique.frameworkVersion,
      courseId: storyCritique.courseId,
      artworkId: storyCritique.artworkId,
      createdAt: storyCritique.createdAt,
      dimensions: storyCritique.dimensions,
      closure: storyCritique.closure,
    },
  }));

export const mockTeacherResources: TeacherResourceListResponse = {
  resources: [
    {
      id: "70000000-0000-4000-8000-000000000001",
      courseId: "digital-interaction",
      title: "课程设计说明（演示数据）",
      fileName: "course-guide-demo.pdf",
      mimeType: "application/pdf",
      byteSize: 428_000,
      status: "READY",
      createdAt: MOCK_NOW,
    },
  ],
};

export const mockTeacherInsights: TeacherInsightsResponse = {
  courseId: LUMI_D017_STORYLINE.identity.courseId,
  classId: LUMI_D017_STORYLINE.identity.classId,
  generatedAt: MOCK_NOW,
  dataScope: "DEMONSTRATION_ONLY",
  insights: LUMI_D017_STORYLINE.classInsights.map((insight) => ({
    id: insight.id,
    kind: insight.kind,
    title: insight.title,
    summary: `预置学习记录：${insight.summary}`,
    evidenceCount: insight.evidenceCount,
    affectedLearners: insight.affectedLearners,
    confidence: insight.confidence,
  })),
};
