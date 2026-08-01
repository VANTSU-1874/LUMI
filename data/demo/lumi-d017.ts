import {
  CRITIQUE_FRAMEWORK_ID,
  CRITIQUE_FRAMEWORK_VERSION,
  CRITIQUE_DIMENSION_IDS,
  CritiqueResultSchema,
  type CritiqueDimension,
  type CritiqueDimensionId,
  type CritiqueEvidence,
} from "@/lib/agent/critique-contract";
import { getCritiqueFramework } from "@/lib/agent/critique-framework";

const DEMONSTRATION_DATA = "DEMONSTRATION_DATA" as const;
const STUDENT_ID = "demo-student-c";
const STUDENT_ALIAS = "D-017 · 预置";
const CLASS_ID = "demo-class-digi2026";
const COURSE_ID = "digital-interaction";
const PROJECT_ID = "demo-project-c";

const TASK_IDS = [
  "d0170001-0000-4000-8000-000000000001",
  "d0170001-0000-4000-8000-000000000002",
] as const;
const CONVERSATION_IDS = [
  "d0171001-0000-4000-8000-000000000001",
  "d0171001-0000-4000-8000-000000000002",
] as const;
const TURN_IDS = [
  "d0172001-0000-4000-8000-000000000001",
  "d0172001-0000-4000-8000-000000000002",
  "d0172001-0000-4000-8000-000000000003",
] as const;
const ARTWORK_IDS = [
  "d0173001-0000-4000-8000-000000000001",
  "d0173001-0000-4000-8000-000000000002",
] as const;
const CRITIQUE_IDS = [
  "d0174001-0000-4000-8000-000000000001",
  "d0174001-0000-4000-8000-000000000002",
] as const;

const framework = getCritiqueFramework(COURSE_ID);
if (!framework) throw new Error("D-017 critique framework is unavailable");
const frameworkDimensions = framework.dimensions;

const initialObservations = {
  goal: "预置方案已经说明靠近观察的参与动作，但停留后希望观众理解什么仍需说清。",
  translation: "预置方案用纹样显隐承接发现细节的意图，动作与文化表达已有可核对的对应。",
  structure_hierarchy: "预置方案板的主视觉入口明确，三种交互状态的阅读顺序还没有展开。",
  formal_language: "预置画面使用克制的明暗变化，状态差异目前主要依靠透明度。",
  craft_standards: "预置方案标出了输入与输出，但尚未给出状态切换阈值和现场校验方式。",
} satisfies Record<CritiqueDimensionId, string>;

const revisionObservations = {
  goal: "修订预置稿把停留后的发现目标写成观察纹样层次，目标比上一版更可核对。",
  translation: "修订预置稿把靠近、停留和反馈分成三种状态，动作到表达的对应更完整。",
  structure_hierarchy: "三状态预置图按待机、靠近、反馈排列，阅读方向和反馈位置已经可见。",
  formal_language: "修订预置稿增加亮度和局部边界变化，但现场投影中的辨识度仍待验证。",
  craft_standards: "预置稿列出距离阈值与 OSC 链路，设备现场的接收值仍需另行核对。",
} satisfies Record<CritiqueDimensionId, string>;

function dimensions(input: {
  observations: Record<CritiqueDimensionId, string>;
  artworkReference: string;
  deepDives: readonly CritiqueDimensionId[];
  historyRecordId?: string;
}): CritiqueDimension[] {
  return CRITIQUE_DIMENSION_IDS.map((id, index) => {
    const evidence: CritiqueEvidence[] = [{
      kind: "ARTWORK_REGION",
      label: `预置作品中的${frameworkDimensions[index]!.label}`,
      reference: input.artworkReference,
    }];
    if (id === "translation" && input.historyRecordId) {
      evidence.push({
        kind: "HISTORY_RECORD",
        label: "前一版预置会诊记录",
        reference: input.historyRecordId,
      });
    }
    const isDeepDive = input.deepDives.includes(id);
    const guidance: CritiqueDimension["guidance"] = isDeepDive
      ? {
          level: "DEMONSTRATION",
          message: "只改这一处并保留其余条件，再用前后两张预置图核对变化。",
          understandingCheck: "请说明这处修改怎样服务于预置方案的体验目标。",
        }
      : {
          level: "HINT",
          message: "先保留当前选择，等下一轮有对应证据时再判断。",
        };
    return {
      id,
      label: frameworkDimensions[index]!.label,
      displayOrder: (index + 1) as CritiqueDimension["displayOrder"],
      status: id === "goal" && input.historyRecordId ? "ESTABLISHED" : "DEVELOPING",
      observation: input.observations[id],
      evidence,
      guidance,
      isDeepDive,
    };
  });
}

const firstCritique = CritiqueResultSchema.parse({
  id: CRITIQUE_IDS[0],
  frameworkId: CRITIQUE_FRAMEWORK_ID,
  frameworkVersion: CRITIQUE_FRAMEWORK_VERSION,
  courseId: COURSE_ID,
  artworkId: ARTWORK_IDS[0],
  createdAt: "2026-07-19T01:20:05.000Z",
  dimensions: dimensions({
    observations: initialObservations,
    artworkReference: "/demo/digital-interaction-proposal-board-preset.svg",
    deepDives: ["goal", "translation"],
  }),
  closure: {
    established: "预置方案已经建立靠近动作与纹样显隐之间的关系。",
    nextStep: "下一步只补待机、靠近、反馈三种状态，并说明停留后的反馈。",
  },
});

const secondCritique = CritiqueResultSchema.parse({
  id: CRITIQUE_IDS[1],
  frameworkId: CRITIQUE_FRAMEWORK_ID,
  frameworkVersion: CRITIQUE_FRAMEWORK_VERSION,
  courseId: COURSE_ID,
  artworkId: ARTWORK_IDS[1],
  createdAt: "2026-07-19T02:11:05.000Z",
  dimensions: dimensions({
    observations: revisionObservations,
    artworkReference: "/demo/digital-interaction-three-states-preset.svg",
    deepDives: ["translation", "structure_hierarchy"],
    historyRecordId: CRITIQUE_IDS[0],
  }),
  closure: {
    established: "修订预置稿已经把靠近、停留与反馈拆成可比较的三种状态。",
    nextStep: "下一步只核对投影现场的状态辨识度与 OSC 接收值，不扩大修改范围。",
    historyReference: {
      recordId: CRITIQUE_IDS[0],
      label: "上一版会诊 · 预置",
      comparison: "相较前一版预置方案，修订稿补齐了三状态阅读顺序与停留反馈。",
    },
  },
});

type InsightSupportRecord = {
  dataType: typeof DEMONSTRATION_DATA;
  recordId: string;
  learnerId: string;
  evidenceId: string;
};

function classInsight(input: {
  id: string;
  kind: "COMMON_DIFFICULTY" | "RETEACH_SUGGESTION";
  title: string;
  summary: string;
  supportingRecords: readonly InsightSupportRecord[];
}) {
  return {
    dataType: DEMONSTRATION_DATA,
    id: input.id,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    confidence: "LOW" as const,
    supportingRecords: input.supportingRecords,
    supportingRecordIds: input.supportingRecords.map(({ recordId }) => recordId),
    evidenceCount: input.supportingRecords.length,
    affectedLearners: new Set(input.supportingRecords.map(({ learnerId }) => learnerId)).size,
  };
}

const insightSupport: readonly InsightSupportRecord[] = [
  {
    dataType: DEMONSTRATION_DATA,
    recordId: CRITIQUE_IDS[0],
    learnerId: STUDENT_ID,
    evidenceId: ARTWORK_IDS[0],
  },
  {
    dataType: DEMONSTRATION_DATA,
    recordId: CRITIQUE_IDS[1],
    learnerId: STUDENT_ID,
    evidenceId: ARTWORK_IDS[1],
  },
];

/**
 * Canonical, deterministic presentation fixture for the D-017 demo identity.
 * It is a UI and data-flow example only; it is not a classroom outcome claim.
 */
export const LUMI_D017_STORYLINE = {
  dataType: DEMONSTRATION_DATA,
  identity: {
    dataType: DEMONSTRATION_DATA,
    studentId: STUDENT_ID,
    alias: STUDENT_ALIAS,
    classId: CLASS_ID,
    courseId: COURSE_ID,
    projectId: PROJECT_ID,
  },
  tasks: [
    {
      dataType: DEMONSTRATION_DATA,
      id: TASK_IDS[0],
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      title: "D-017 · 预置 · 互动目标初稿",
      status: "ARCHIVED" as const,
      mode: "conversation" as const,
      pinned: false,
      createdAt: "2026-07-19T01:00:00.000Z",
      updatedAt: "2026-07-19T01:25:00.000Z",
    },
    {
      dataType: DEMONSTRATION_DATA,
      id: TASK_IDS[1],
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      title: "D-017 · 预置 · 三状态修订",
      status: "ACTIVE" as const,
      mode: "conversation" as const,
      pinned: false,
      createdAt: "2026-07-19T02:00:00.000Z",
      updatedAt: "2026-07-19T02:15:00.000Z",
    },
  ],
  conversations: [
    {
      dataType: DEMONSTRATION_DATA,
      id: CONVERSATION_IDS[0],
      taskId: TASK_IDS[0],
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      projectId: PROJECT_ID,
      courseId: COURSE_ID,
      createdAt: "2026-07-19T01:02:00.000Z",
      updatedAt: "2026-07-19T01:25:00.000Z",
    },
    {
      dataType: DEMONSTRATION_DATA,
      id: CONVERSATION_IDS[1],
      taskId: TASK_IDS[1],
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      projectId: PROJECT_ID,
      courseId: COURSE_ID,
      createdAt: "2026-07-19T02:02:00.000Z",
      updatedAt: "2026-07-19T02:15:00.000Z",
    },
  ],
  turns: [
    {
      dataType: DEMONSTRATION_DATA,
      id: TURN_IDS[0],
      taskId: TASK_IDS[0],
      conversationId: CONVERSATION_IDS[0],
      sequence: 1,
      studentMessage: "我想做一个靠近后纹样出现的互动作品，但还没想清楚体验目标。",
      assistantMessage: "先只补一句：参与者停留后，希望从预置纹样变化中发现什么？",
      episode: "EXPLORE" as const,
      aiMode: "DETERMINISTIC_FALLBACK" as const,
      createdAt: "2026-07-19T01:05:00.000Z",
    },
    {
      dataType: DEMONSTRATION_DATA,
      id: TURN_IDS[1],
      taskId: TASK_IDS[0],
      conversationId: CONVERSATION_IDS[0],
      sequence: 2,
      studentMessage: "这是预置方案板，请先判断目标和动作是否对应。",
      assistantMessage: "先按画面可见关系给出五维会诊，再收束到三状态反馈这一处。",
      episode: "REFLECT" as const,
      aiMode: "DETERMINISTIC_FALLBACK" as const,
      createdAt: "2026-07-19T01:20:00.000Z",
    },
    {
      dataType: DEMONSTRATION_DATA,
      id: TURN_IDS[2],
      taskId: TASK_IDS[1],
      conversationId: CONVERSATION_IDS[1],
      sequence: 1,
      studentMessage: "这是按前一版预置会诊修订的三状态图，请比较变化。",
      assistantMessage: "三状态顺序已经可见；本轮只继续核对现场辨识度与接收值。",
      episode: "REFLECT" as const,
      aiMode: "DETERMINISTIC_FALLBACK" as const,
      createdAt: "2026-07-19T02:11:00.000Z",
    },
  ],
  artworks: [
    {
      dataType: DEMONSTRATION_DATA,
      id: ARTWORK_IDS[0],
      turnId: TURN_IDS[1],
      taskId: TASK_IDS[0],
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      mimeType: "image/svg+xml" as const,
      byteSize: 6_422,
      width: 1600,
      height: 1000,
      previewUrl: "/demo/digital-interaction-proposal-board-preset.svg" as const,
      seedAttachment: {
        dataType: DEMONSTRATION_DATA,
        sourcePath: "public/demo/d017-proposal-before-preset.png" as const,
        mimeType: "image/png" as const,
        sha256: "46c37393c9b616dae099762f5597f5c18c46381af6f0351d6bdf27632c13460a",
        byteSize: 42_386,
        width: 1600,
        height: 1000,
        privatePreviewUrl: `/api/agent/artworks/${ARTWORK_IDS[0]}` as const,
      },
      createdAt: "2026-07-19T01:19:00.000Z",
    },
    {
      dataType: DEMONSTRATION_DATA,
      id: ARTWORK_IDS[1],
      turnId: TURN_IDS[2],
      taskId: TASK_IDS[1],
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      mimeType: "image/svg+xml" as const,
      byteSize: 4_679,
      width: 1600,
      height: 900,
      previewUrl: "/demo/digital-interaction-three-states-preset.svg" as const,
      seedAttachment: {
        dataType: DEMONSTRATION_DATA,
        sourcePath: "public/demo/d017-three-states-after-preset.png" as const,
        mimeType: "image/png" as const,
        sha256: "47a3238ce76fa0432f81577c4f7c830b4cb4e3e4e9780214853e88f178e71ec5",
        byteSize: 30_238,
        width: 1600,
        height: 900,
        privatePreviewUrl: `/api/agent/artworks/${ARTWORK_IDS[1]}` as const,
      },
      createdAt: "2026-07-19T02:10:00.000Z",
    },
  ],
  critiques: [
    {
      ...firstCritique,
      dataType: DEMONSTRATION_DATA,
      turnId: TURN_IDS[1],
      studentId: STUDENT_ID,
      classId: CLASS_ID,
    },
    {
      ...secondCritique,
      dataType: DEMONSTRATION_DATA,
      turnId: TURN_IDS[2],
      studentId: STUDENT_ID,
      classId: CLASS_ID,
    },
  ],
  sessionSummaries: [
    {
      dataType: DEMONSTRATION_DATA,
      taskId: TASK_IDS[0],
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      summary: "D-017 · 预置第一段会话从靠近显隐的初步想法出发，收束到补齐待机、靠近、反馈三种状态。",
      throughTurnId: TURN_IDS[1],
      throughCreatedAt: "2026-07-19T01:20:00.000Z",
      coveredTurnCount: 2,
      revision: 1,
      createdAt: "2026-07-19T01:24:00.000Z",
      updatedAt: "2026-07-19T01:24:00.000Z",
    },
    {
      dataType: DEMONSTRATION_DATA,
      taskId: TASK_IDS[1],
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      summary: "D-017 · 预置第二段会话比较三状态修订稿，并把下一步限定为现场辨识度与 OSC 接收值核对。",
      throughTurnId: TURN_IDS[2],
      throughCreatedAt: "2026-07-19T02:11:00.000Z",
      coveredTurnCount: 1,
      revision: 1,
      createdAt: "2026-07-19T02:14:00.000Z",
      updatedAt: "2026-07-19T02:14:00.000Z",
    },
  ],
  growthMemories: [
    {
      dataType: DEMONSTRATION_DATA,
      id: "d0175001-0000-4000-8000-000000000001",
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      kind: "PROJECT_FACT" as const,
      content: "D-017 · 预置方案以靠近和停留控制纹样的三种反馈状态。",
      salience: 6,
      sourceTurnId: TURN_IDS[0],
      createdAt: "2026-07-19T01:21:00.000Z",
    },
    {
      dataType: DEMONSTRATION_DATA,
      id: "d0175001-0000-4000-8000-000000000002",
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      kind: "LEARNED_CONCEPT" as const,
      content: "D-017 · 预置记录把目标、参与动作和体验反馈写成可逐项核对的关系。",
      salience: 7,
      sourceTurnId: TURN_IDS[1],
      createdAt: "2026-07-19T01:22:00.000Z",
    },
    {
      dataType: DEMONSTRATION_DATA,
      id: "d0175001-0000-4000-8000-000000000003",
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      kind: "MISCONCEPTION_CORRECTED" as const,
      content: "D-017 · 预置修订不再只用显隐代表全部反馈，而是区分待机、靠近和停留。",
      salience: 7,
      sourceTurnId: TURN_IDS[2],
      createdAt: "2026-07-19T02:12:00.000Z",
    },
  ],
  classInsights: [
    classInsight({
      id: "d0176001-0000-4000-8000-000000000001",
      kind: "COMMON_DIFFICULTY",
      title: "预置轨迹仍需核对现场反馈",
      summary: "两条预置会诊都把状态辨识或接收值列为待核对项；此项只展示记录聚合。",
      supportingRecords: insightSupport,
    }),
    classInsight({
      id: "d0176001-0000-4000-8000-000000000002",
      kind: "RETEACH_SUGGESTION",
      title: "用三状态卡演示目标—动作—反馈",
      summary: "可依据上述预置记录展示一次三状态对照，不把演示记录写成课堂结论。",
      supportingRecords: insightSupport,
    }),
  ],
} as const;
