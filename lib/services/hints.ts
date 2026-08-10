import { z } from "zod";

import type { ModelClient } from "../ai/client";
import { buildHintMessages, DECISION_CODES_BY_TOPIC } from "../ai/prompts";
import { completeJson } from "../ai/structured";
import {
  KnowledgeItemSchema,
  KnowledgeTopicSchema,
  MAX_KNOWLEDGE_STATEMENT_LENGTH,
  rankKnowledge,
  type KnowledgeItem,
  type KnowledgeAuthority,
  type KnowledgeTopic,
} from "../knowledge/retrieve";

const BoundedText = z.string().trim().min(1).max(300);
export const AUTHORITY_LABELS = {
  OFFICIAL: "官方资料：",
  COURSE_DESIGN: "课程设计：",
  TEACHER_EXPERIENCE: "教师经验：",
  ANONYMIZED_CASE: "匿名案例：",
} as const satisfies Record<KnowledgeAuthority, string>;
const MAX_AUTHORITY_LABEL_LENGTH = Math.max(
  ...Object.values(AUTHORITY_LABELS).map((label) => label.length),
);
export const MAX_RENDERED_FACT_LENGTH =
  MAX_KNOWLEDGE_STATEMENT_LENGTH + MAX_AUTHORITY_LABEL_LENGTH;
const RenderedFactSchema = z.string().trim().min(1).max(MAX_RENDERED_FACT_LENGTH);
const RecordIdSchema = z.uuid();
const ContentDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const CreatedAtSchema = z.iso.datetime({ offset: true });
const KnowledgeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

function uniqueValues(values: readonly unknown[]) {
  return new Set(values).size === values.length;
}

export const HintEvidenceSchema = z
  .object({
    kind: z.enum([
      "STUDENT_OBSERVATION",
      "SCREENSHOT_DESCRIPTION",
      "MEASUREMENT",
      "ERROR_MESSAGE",
    ]),
    description: z.string().trim().min(1).max(500),
  })
  .strict();

export const HintRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(1_200),
    confirmedFacts: z.array(BoundedText).max(8).default([]),
    hypotheses: z.array(BoundedText).max(5).default([]),
    evidence: z.array(HintEvidenceSchema).max(6).default([]),
    topicScope: z.array(KnowledgeTopicSchema).min(1).max(3).optional(),
  })
  .strict();

const PreviousHintRecordSchema = z
  .object({
    recordId: RecordIdSchema,
    hintSequence: z.number().int().positive(),
    evidenceSequenceWatermark: z.number().int().nonnegative(),
    createdAt: CreatedAtSchema,
  })
  .strict();
const CurrentEvidenceRecordSchema = z
  .object({
    evidenceRecordId: RecordIdSchema,
    evidenceSequence: z.number().int().positive(),
    contentDigest: ContentDigestSchema,
    createdAt: CreatedAtSchema,
  })
  .strict();

export const HintPolicyContextSchema = z
  .object({
    previousHintRecords: z.array(PreviousHintRecordSchema).max(100),
    currentEvidenceRecords: z.array(CurrentEvidenceRecordSchema).max(100),
    priorUsedEvidenceRecordIds: z.array(RecordIdSchema).max(100),
    priorUsedEvidenceDigests: z.array(ContentDigestSchema).max(100),
  })
  .strict()
  .superRefine((policy, context) => {
    const checks = [
      [policy.previousHintRecords.map(({ recordId }) => recordId), "previousHintRecords"],
      [policy.previousHintRecords.map(({ hintSequence }) => hintSequence), "previousHintRecords"],
      [
        policy.currentEvidenceRecords.map(({ evidenceRecordId }) => evidenceRecordId),
        "currentEvidenceRecords",
      ],
      [
        policy.currentEvidenceRecords.map(({ contentDigest }) => contentDigest),
        "currentEvidenceRecords",
      ],
      [
        policy.currentEvidenceRecords.map(({ evidenceSequence }) => evidenceSequence),
        "currentEvidenceRecords",
      ],
      [policy.priorUsedEvidenceRecordIds, "priorUsedEvidenceRecordIds"],
      [policy.priorUsedEvidenceDigests, "priorUsedEvidenceDigests"],
    ] as const;
    for (const [values, path] of checks) {
      if (!uniqueValues(values)) {
        context.addIssue({ code: "custom", path: [path], message: `${path} must be unique` });
      }
    }
  });

const policyContextBrand = Symbol("server-hint-policy-context");
type PolicyPayload = z.infer<typeof HintPolicyContextSchema>;
export type HintPolicyContext = PolicyPayload & { readonly [policyContextBrand]: true };

function freezePolicy(payload: PolicyPayload) {
  payload.previousHintRecords.forEach(Object.freeze);
  payload.currentEvidenceRecords.forEach(Object.freeze);
  Object.freeze(payload.previousHintRecords);
  Object.freeze(payload.currentEvidenceRecords);
  Object.freeze(payload.priorUsedEvidenceRecordIds);
  Object.freeze(payload.priorUsedEvidenceDigests);
  Object.defineProperty(payload, policyContextBrand, { value: true, enumerable: false });
  return Object.freeze(payload) as HintPolicyContext;
}

/** Task 7 must assemble this value from persisted server records, never request JSON. */
export function createHintPolicyContext(rawPolicy: unknown): HintPolicyContext {
  const payload = HintPolicyContextSchema.parse(rawPolicy);
  const latestReasonableTime = Date.now() + 24 * 60 * 60 * 1000;
  const timestamps = [
    ...payload.previousHintRecords.map(({ createdAt }) => createdAt),
    ...payload.currentEvidenceRecords.map(({ createdAt }) => createdAt),
  ];
  if (timestamps.some((createdAt) => Date.parse(createdAt) > latestReasonableTime)) {
    throw new Error("hint policy timestamp is unreasonably far in the future");
  }
  return freezePolicy(payload);
}

function requireServerPolicyContext(rawPolicy: unknown): HintPolicyContext {
  if (
    !rawPolicy ||
    typeof rawPolicy !== "object" ||
    !(policyContextBrand in rawPolicy) ||
    (rawPolicy as Record<PropertyKey, unknown>)[policyContextBrand] !== true
  ) {
    throw new Error("缺少服务端提示策略上下文");
  }
  return rawPolicy as HintPolicyContext;
}

export const HintResponseSchema = z
  .object({
    hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    groundingStatus: z.enum(["GROUNDED", "NO_GROUNDING"]),
    confirmedFacts: z.array(RenderedFactSchema).max(8),
    hypotheses: z.array(BoundedText).max(5),
    questions: z.array(BoundedText).max(5),
    guidance: z.array(BoundedText).max(5),
    nextSteps: z.array(BoundedText).max(5),
    localExample: z.string().trim().min(1).max(600).nullable(),
    sourceTitles: z.array(z.string().trim().min(1).max(160)).max(5),
    sources: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(160),
            authority: z.enum([
              "OFFICIAL",
              "COURSE_DESIGN",
              "TEACHER_EXPERIENCE",
              "ANONYMIZED_CASE",
            ]),
          })
          .strict(),
      )
      .max(5),
    evidenceToConsume: z
      .object({
        evidenceRecordId: RecordIdSchema,
        evidenceSequence: z.number().int().positive(),
        contentDigest: ContentDigestSchema,
        createdAt: CreatedAtSchema,
      })
      .strict()
      .nullable(),
    uncertainty: z.string().trim().min(1).max(300),
    fallback: z.boolean(),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.groundingStatus === "NO_GROUNDING") {
      if (
        !response.fallback ||
        response.sourceTitles.length > 0 ||
        response.sources.length > 0 ||
        response.evidenceToConsume !== null ||
        response.questions.length === 0 ||
        response.confirmedFacts.length > 0 ||
        response.hypotheses.length > 0 ||
        response.guidance.length > 0 ||
        response.nextSteps.length > 0 ||
        response.localExample !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "NO_GROUNDING may only request more specific evidence",
        });
      }
      return;
    }
    if (response.sourceTitles.length !== 1) {
      context.addIssue({ code: "custom", message: "grounded hints require one used source" });
    }
    if (
      response.sources.length !== 1 ||
      response.sources[0]?.title !== response.sourceTitles[0]
    ) {
      context.addIssue({
        code: "custom",
        message: "grounded hints require matching structured source authority",
      });
    }
    if (
      (response.hintLevel === 3 && response.evidenceToConsume === null) ||
      (response.hintLevel !== 3 && response.evidenceToConsume !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "only a grounded level-three hint may select evidence for consumption",
      });
    }
    if (
      response.hintLevel === 1 &&
      (response.questions.length === 0 ||
        response.confirmedFacts.length > 0 ||
        response.hypotheses.length > 0 ||
        response.guidance.length > 0 ||
        response.nextSteps.length > 0 ||
        response.localExample !== null)
    ) {
      context.addIssue({ code: "custom", message: "level one may only ask questions" });
    }
    if (
      response.hintLevel === 2 &&
      (response.guidance.length !== 1 ||
        response.nextSteps.length !== 1 ||
        response.localExample !== null)
    ) {
      context.addIssue({ code: "custom", message: "level two requires one principle and action" });
    }
    if (
      response.hintLevel === 3 &&
      (response.guidance.length !== 1 ||
        response.nextSteps.length !== 1 ||
        response.localExample === null)
    ) {
      context.addIssue({ code: "custom", message: "level three requires one bounded example" });
    }
  });

export type HintRequest = z.infer<typeof HintRequestSchema>;
export type HintResponse = z.infer<typeof HintResponseSchema>;

export const ModelHintDecisionSchema = z
  .object({
    hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    focusCode: z.enum([
      "DESIGN_GOAL",
      "DESIGN_EVIDENCE",
      "COURSE_CULTURAL_INTENT",
      "COURSE_SIX_ELEMENTS",
      "DIGISHOW_SIGNAL_TYPE",
      "DIGISHOW_MAPPING",
      "TD_SIGNAL_FLOW",
      "TD_MINIMAL_VALIDATION",
      "OSC_SEND_RECEIVE",
      "OSC_ADDRESS_PORT",
      "BOOK_AUDIENCE",
      "BOOK_READING_GOAL",
      "BOOK_HIERARCHY",
      "BOOK_SEQUENCE",
      "BOOK_GRID",
      "BOOK_READING_PATH",
      "LAYOUT_READING_TASK",
      "LAYOUT_STRUCTURE",
      "TYPE_TEXT_ROLE",
      "TYPE_READABILITY",
      "BRAND_IDENTITY_TASK",
      "BRAND_RECOGNITION_CONTEXT",
    ]),
    actionCode: z.enum([
      "DESIGN_CLARIFY_GOAL",
      "DESIGN_TEST_ASSUMPTION",
      "COURSE_CLARIFY_INTENT",
      "COURSE_COMPLETE_ELEMENTS",
      "DIGISHOW_IDENTIFY_SIGNAL",
      "DIGISHOW_TEST_MAPPING",
      "TD_TRACE_FLOW",
      "TD_TEST_MINIMAL_CHAIN",
      "OSC_CHECK_RECEIVER",
      "OSC_COMPARE_PORTS",
      "BOOK_CLARIFY_AUDIENCE",
      "BOOK_DEFINE_READING_GOAL",
      "BOOK_SORT_CONTENT",
      "BOOK_TEST_SEQUENCE",
      "BOOK_COMPARE_GRID",
      "BOOK_COMPARE_READING_PATH",
      "LAYOUT_CLARIFY_READING_TASK",
      "LAYOUT_TEST_STRUCTURE",
      "TYPE_CLARIFY_TEXT_ROLE",
      "TYPE_TEST_READABILITY",
      "BRAND_CLARIFY_IDENTITY_TASK",
      "BRAND_TEST_RECOGNITION",
    ]),
    hypothesisCode: z.enum([
      "DESIGN_GOAL_UNCLEAR",
      "DESIGN_EVIDENCE_MISSING",
      "COURSE_INTENT_UNCLEAR",
      "COURSE_ELEMENT_MISSING",
      "DIGISHOW_SIGNAL_UNKNOWN",
      "DIGISHOW_MAPPING_UNVERIFIED",
      "TD_INPUT_UNVERIFIED",
      "TD_BINDING_UNVERIFIED",
      "OSC_RECEIVER_INACTIVE",
      "OSC_PORT_MISMATCH",
      "BOOK_AUDIENCE_UNCLEAR",
      "BOOK_GOAL_UNCLEAR",
      "BOOK_HIERARCHY_FLAT",
      "BOOK_SEQUENCE_UNVERIFIED",
      "BOOK_GRID_INCONSISTENT",
      "BOOK_READING_PATH_UNVERIFIED",
      "LAYOUT_READING_TASK_UNCLEAR",
      "LAYOUT_STRUCTURE_UNVERIFIED",
      "TYPE_TEXT_ROLE_UNCLEAR",
      "TYPE_READABILITY_UNVERIFIED",
      "BRAND_IDENTITY_TASK_UNCLEAR",
      "BRAND_RECOGNITION_UNVERIFIED",
    ]),
    sourceItemIds: z.array(KnowledgeIdSchema).length(1),
    factIds: z
      .array(KnowledgeIdSchema)
      .min(1)
      .max(2)
      .refine(uniqueValues, "fact IDs must be unique"),
  })
  .strict();

type ModelHintDecision = z.infer<typeof ModelHintDecisionSchema>;
type FocusCode = ModelHintDecision["focusCode"];
type ActionCode = ModelHintDecision["actionCode"];
type HypothesisCode = ModelHintDecision["hypothesisCode"];

function hasNewPersistedEvidence(policy: HintPolicyContext) {
  return selectLevelThreeEvidence(policy) !== undefined;
}

function selectLevelThreeEvidence(policy: HintPolicyContext) {
  if (policy.previousHintRecords.length < 2) return undefined;
  const priorIds = new Set(policy.priorUsedEvidenceRecordIds);
  const priorDigests = new Set(policy.priorUsedEvidenceDigests);
  const latestHint = [...policy.previousHintRecords]
    .sort((left, right) => right.hintSequence - left.hintSequence)[0];
  return [...policy.currentEvidenceRecords]
    .filter(
    ({ evidenceRecordId, contentDigest }) =>
        !priorIds.has(evidenceRecordId) && !priorDigests.has(contentDigest),
    )
    .filter(({ evidenceSequence }) => evidenceSequence > latestHint.evidenceSequenceWatermark)
    .sort((left, right) => left.evidenceSequence - right.evidenceSequence)[0];
}

export function allowedHintLevel(rawPolicy: unknown): 1 | 2 | 3 {
  const policy = requireServerPolicyContext(rawPolicy);
  const count = policy.previousHintRecords.length;
  if (count === 0) return 1;
  if (count >= 2 && hasNewPersistedEvidence(policy)) return 3;
  return 2;
}

const TOPIC_QUESTIONS: Record<KnowledgeTopic, [string, string]> = {
  DESIGN_FOUNDATIONS: [
    "这个设计首先要帮助谁完成什么任务或产生什么感受？",
    "你准备观察哪一条证据来判断当前方案是否有效？",
  ],
  COURSE_PRINCIPLES: [
    "你希望参与者最终理解哪一个文化意图？",
    "参与行为、输入信号和体验反馈分别是什么？",
  ],
  DIGISHOW_SIGNALS: [
    "当前输入属于连续值、开关状态还是音符事件？",
    "映射前后的可观察数值分别是什么？",
  ],
  TOUCHDESIGNER_FOUNDATIONS: [
    "输入、处理和输出分别由哪个operator承担？",
    "最靠近输入端的哪个节点已经出现可观察变化？",
  ],
  OSC_TROUBLESHOOTING: [
    "发送端是否出现持续变化的测试值？",
    "接收端的地址、监听端口和Active状态分别是什么？",
  ],
  BOOK_DESIGN_PRINCIPLES: [
    "这本导览册的首要读者是谁？",
    "读者翻完后最应该知道或做什么？",
  ],
  INFORMATION_HIERARCHY: [
    "哪三条信息必须最先被看到？",
    "如果只有30秒，读者的阅读顺序应是什么？",
  ],
  LAYOUT_EVIDENCE: [
    "不看正文时，标题层级是否仍然可以区分？",
    "找一项活动时，读者在哪一页停顿最久？",
  ],
  LAYOUT_DESIGN_PRINCIPLES: [
    "读者在什么场景下，三秒内必须先看到哪条信息？",
    "哪些内容共享对齐关系，哪些关系还没有经过比较？",
  ],
  TYPOGRAPHY_BASICS: [
    "标题、导语、正文和注释分别承担什么阅读角色？",
    "在实际输出尺寸下，哪一段最难连续阅读？",
  ],
  BRAND_IDENTITY: [
    "品牌需要谁在什么接触场景下识别、记住或区分什么？",
    "你准备怎样用同一尺寸和应用位置比较字标、图形标或组合标？",
  ],
};

const FOCUS_GUIDANCE: Record<FocusCode, string> = {
  DESIGN_GOAL: "先把模糊风格要求连接到具体受众、情境和设计目标。",
  DESIGN_EVIDENCE: "把偏好判断改写为可观察、可比较的小规模测试。",
  COURSE_CULTURAL_INTENT: "文化意图先说明作品希望参与者理解什么，再选择技术表现。",
  COURSE_SIX_ELEMENTS: "六要素需要形成文化意图、参与行为、输入、映射、输出和反馈的闭环。",
  DIGISHOW_SIGNAL_TYPE: "先确认信号类型属于连续值、开关状态还是音符事件，再选择对应映射。",
  DIGISHOW_MAPPING: "信号映射要同时写清输入范围、输出范围和变化关系。",
  TD_SIGNAL_FLOW: "TouchDesigner最小逻辑可按输入、处理、输出三段观察数据流。",
  TD_MINIMAL_VALIDATION: "先让一条最短信号链产生可观察结果，再逐步增加节点。",
  OSC_SEND_RECEIVE: "OSC链路要分别确认发送端有值和接收端出现通道。",
  OSC_ADDRESS_PORT: "OSC发送端目标与接收端监听的地址、端口需要逐项对应。",
  BOOK_AUDIENCE: "编排决策先服务具体受众，不先从字体和装饰开始。",
  BOOK_READING_GOAL: "阅读目标需要写成读者能完成的信息任务。",
  BOOK_HIERARCHY: "用必读、选读和延伸三层先组织内容，再进入页面。",
  BOOK_SEQUENCE: "页序应跟随读者任务，而不是原始素材的提供顺序。",
  BOOK_GRID: "网格用来稳定层级与对齐，改变前后应保留可比较版本。",
  BOOK_READING_PATH: "阅读路径要用找信息的时间、停顿页或指向错误验证。",
  LAYOUT_READING_TASK: "版式决策先服务读者在具体场景中的首要信息任务。",
  LAYOUT_STRUCTURE: "用栅格、分组和留白建立可比较的对齐与层级关系。",
  TYPE_TEXT_ROLE: "先说明每组文字的阅读角色，再决定字号、字重和间距。",
  TYPE_READABILITY: "字体关系要在实际输出尺寸下用连续阅读表现验证。",
  BRAND_IDENTITY_TASK: "先把品牌定位连接到具体受众、识别任务与真实接触点。",
  BRAND_RECOGNITION_CONTEXT: "在相同名称、尺寸和应用位置下比较字标与图形关系，记录可读、区分和适配证据。",
};

const HYPOTHESIS_TEXT: Record<HypothesisCode, string> = {
  DESIGN_GOAL_UNCLEAR: "待验证假设：当前描述仍是风格形容词，没有明确服务对象与目标。",
  DESIGN_EVIDENCE_MISSING: "待验证假设：方案差异尚未通过可观察的使用或阅读证据比较。",
  COURSE_INTENT_UNCLEAR: "待验证假设：文化意图仍过于宽泛。",
  COURSE_ELEMENT_MISSING: "待验证假设：六要素之间还没有形成闭环。",
  DIGISHOW_SIGNAL_UNKNOWN: "待验证假设：输入信号类型尚未确认。",
  DIGISHOW_MAPPING_UNVERIFIED: "待验证假设：映射前后数值尚未被观察。",
  TD_INPUT_UNVERIFIED: "待验证假设：最上游输入尚未产生可观察变化。",
  TD_BINDING_UNVERIFIED: "待验证假设：数据尚未绑定到目标输出参数。",
  OSC_RECEIVER_INACTIVE: "待验证假设：接收端尚未处于有效接收状态。",
  OSC_PORT_MISMATCH: "待验证假设：发送目标与接收监听端口不一致。",
  BOOK_AUDIENCE_UNCLEAR: "待验证假设：受众仍然过于宽泛。",
  BOOK_GOAL_UNCLEAR: "待验证假设：阅读目标还不能转化为具体任务。",
  BOOK_HIERARCHY_FLAT: "待验证假设：所有内容被设置为同等重要。",
  BOOK_SEQUENCE_UNVERIFIED: "待验证假设：页序尚未通过阅读任务验证。",
  BOOK_GRID_INCONSISTENT: "待验证假设：网格与层级关系不稳定。",
  BOOK_READING_PATH_UNVERIFIED: "待验证假设：读者是否能找到关键信息尚未被观察。",
  LAYOUT_READING_TASK_UNCLEAR: "待验证假设：首要读者与首要信息仍不明确。",
  LAYOUT_STRUCTURE_UNVERIFIED: "待验证假设：栅格、分组或层级关系尚未通过对照验证。",
  TYPE_TEXT_ROLE_UNCLEAR: "待验证假设：文字角色尚未区分，字体变化缺少信息依据。",
  TYPE_READABILITY_UNVERIFIED: "待验证假设：字体层级尚未在实际输出尺寸下检查。",
  BRAND_IDENTITY_TASK_UNCLEAR: "待验证假设：当前方案还没有明确要服务的受众、识别任务与接触场景。",
  BRAND_RECOGNITION_UNVERIFIED: "待验证假设：字标或图形关系尚未在相同应用条件下进行识别对照。",
};

const LOCAL_EXAMPLE: Record<KnowledgeTopic, string> = {
  DESIGN_FOUNDATIONS: "局部示例：只把‘更高级’改写为一个具体受众在一个使用情境中应先注意到的信息。",
  COURSE_PRINCIPLES: "局部示例：只把‘展示传统文化’改写成一句可被参与者感知的文化意图。",
  DIGISHOW_SIGNALS: "局部示例：只选一个输入值，记录映射前后各一次数值变化。",
  TOUCHDESIGNER_FOUNDATIONS: "局部示例：只保留一个输入、一个处理和一个输出观察数据是否流动。",
  OSC_TROUBLESHOOTING: "局部示例：只发送一个固定测试值，观察接收端是否出现对应通道。",
  BOOK_DESIGN_PRINCIPLES: "局部示例：先把‘新生’改写为‘入学第一周想找到社区活动的新生’。",
  INFORMATION_HIERARCHY: "局部示例：把报名方式标为必读，活动背景标为选读。",
  LAYOUT_EVIDENCE: "局部示例：对比同一跨页的两栏和三栏版本，只记录找到报名方式的时间。",
  LAYOUT_DESIGN_PRINCIPLES: "局部示例：只给主标题和活动时间共用一条左对齐线，对比三秒阅读顺序。",
  TYPOGRAPHY_BASICS: "局部示例：只统一正文角色的字号与行距，再按实际尺寸比较一段连续阅读。",
  BRAND_IDENTITY: "局部示例：用同一品牌名称做黑白字标版与图文组合版，各放进同一个小尺寸应用框比较识别结果。",
};

const DEFAULT_CODES: Record<
  KnowledgeTopic,
  Pick<ModelHintDecision, "focusCode" | "actionCode" | "hypothesisCode">
> = {
  DESIGN_FOUNDATIONS: {
    focusCode: "DESIGN_GOAL",
    actionCode: "DESIGN_CLARIFY_GOAL",
    hypothesisCode: "DESIGN_GOAL_UNCLEAR",
  },
  COURSE_PRINCIPLES: {
    focusCode: "COURSE_CULTURAL_INTENT",
    actionCode: "COURSE_CLARIFY_INTENT",
    hypothesisCode: "COURSE_INTENT_UNCLEAR",
  },
  DIGISHOW_SIGNALS: {
    focusCode: "DIGISHOW_SIGNAL_TYPE",
    actionCode: "DIGISHOW_IDENTIFY_SIGNAL",
    hypothesisCode: "DIGISHOW_SIGNAL_UNKNOWN",
  },
  TOUCHDESIGNER_FOUNDATIONS: {
    focusCode: "TD_SIGNAL_FLOW",
    actionCode: "TD_TRACE_FLOW",
    hypothesisCode: "TD_INPUT_UNVERIFIED",
  },
  OSC_TROUBLESHOOTING: {
    focusCode: "OSC_ADDRESS_PORT",
    actionCode: "OSC_CHECK_RECEIVER",
    hypothesisCode: "OSC_RECEIVER_INACTIVE",
  },
  BOOK_DESIGN_PRINCIPLES: {
    focusCode: "BOOK_AUDIENCE",
    actionCode: "BOOK_CLARIFY_AUDIENCE",
    hypothesisCode: "BOOK_AUDIENCE_UNCLEAR",
  },
  INFORMATION_HIERARCHY: {
    focusCode: "BOOK_HIERARCHY",
    actionCode: "BOOK_SORT_CONTENT",
    hypothesisCode: "BOOK_HIERARCHY_FLAT",
  },
  LAYOUT_EVIDENCE: {
    focusCode: "BOOK_READING_PATH",
    actionCode: "BOOK_COMPARE_READING_PATH",
    hypothesisCode: "BOOK_READING_PATH_UNVERIFIED",
  },
  LAYOUT_DESIGN_PRINCIPLES: {
    focusCode: "LAYOUT_READING_TASK",
    actionCode: "LAYOUT_CLARIFY_READING_TASK",
    hypothesisCode: "LAYOUT_READING_TASK_UNCLEAR",
  },
  TYPOGRAPHY_BASICS: {
    focusCode: "TYPE_TEXT_ROLE",
    actionCode: "TYPE_CLARIFY_TEXT_ROLE",
    hypothesisCode: "TYPE_TEXT_ROLE_UNCLEAR",
  },
  BRAND_IDENTITY: {
    focusCode: "BRAND_IDENTITY_TASK",
    actionCode: "BRAND_CLARIFY_IDENTITY_TASK",
    hypothesisCode: "BRAND_IDENTITY_TASK_UNCLEAR",
  },
};

const ACTION_ID_BY_CODE: Record<ActionCode, string> = {
  DESIGN_CLARIFY_GOAL: "design-clarify-goal",
  DESIGN_TEST_ASSUMPTION: "design-test-assumption",
  COURSE_CLARIFY_INTENT: "course-clarify-intent",
  COURSE_COMPLETE_ELEMENTS: "course-complete-elements",
  DIGISHOW_IDENTIFY_SIGNAL: "digishow-identify-signal",
  DIGISHOW_TEST_MAPPING: "digishow-test-mapping",
  TD_TRACE_FLOW: "td-observe-upstream",
  TD_TEST_MINIMAL_CHAIN: "td-minimal-check",
  OSC_CHECK_RECEIVER: "osc-check-receiver",
  OSC_COMPARE_PORTS: "osc-compare-ports",
  BOOK_CLARIFY_AUDIENCE: "book-clarify-audience",
  BOOK_DEFINE_READING_GOAL: "book-define-reading-goal",
  BOOK_SORT_CONTENT: "hierarchy-sort-content",
  BOOK_TEST_SEQUENCE: "hierarchy-test-sequence",
  BOOK_COMPARE_GRID: "layout-compare-grid",
  BOOK_COMPARE_READING_PATH: "layout-compare-reading-path",
  LAYOUT_CLARIFY_READING_TASK: "layoutprin-clarify-reading-task",
  LAYOUT_TEST_STRUCTURE: "layoutprin-test-structure",
  TYPE_CLARIFY_TEXT_ROLE: "type-clarify-text-role",
  TYPE_TEST_READABILITY: "type-test-readability",
  BRAND_CLARIFY_IDENTITY_TASK: "brand-clarify-identity-task",
  BRAND_TEST_RECOGNITION: "brand-test-recognition",
};

function selectTopKnowledge(
  query: string,
  items: readonly KnowledgeItem[],
  topicScope?: readonly KnowledgeTopic[],
) {
  const allowedTopics = topicScope ? new Set(topicScope) : null;
  const candidates = allowedTopics
    ? items.filter(({ topic }) => allowedTopics.has(topic))
    : items;
  const ranked = rankKnowledge(query, candidates);
  if (ranked.length === 0) return undefined;
  const { id, title, topic, tags, content, facts, actions, source } = ranked[0];
  return { id, title, topic, tags, content, facts, actions, source };
}

function noGroundingHint(hintLevel: 1 | 2 | 3): HintResponse {
  return HintResponseSchema.parse({
    hintLevel,
    groundingStatus: "NO_GROUNDING",
    confirmedFacts: [],
    hypotheses: [],
    questions: [
      "请说明具体使用的软件、信号类型和观察到的现象。",
      "请补充一个可观察的数值、状态、错误信息或截图描述作为证据。",
    ],
    guidance: [],
    nextSteps: [],
    localExample: null,
    sourceTitles: [],
    sources: [],
    evidenceToConsume: null,
    uncertainty: "未检索到与当前问题匹配的课程依据。",
    fallback: true,
  });
}

function fallbackDecision(item: KnowledgeItem, hintLevel: 1 | 2 | 3): ModelHintDecision {
  return ModelHintDecisionSchema.parse({
    hintLevel,
    ...DEFAULT_CODES[item.topic],
    sourceItemIds: [item.id],
    factIds: [item.facts[0].id],
  });
}

function selectedAction(item: KnowledgeItem, actionCode: ActionCode) {
  return item.actions.find(({ id }) => id === ACTION_ID_BY_CODE[actionCode]);
}

function decisionAllowed(
  decision: ModelHintDecision,
  item: KnowledgeItem,
  hintLevel: 1 | 2 | 3,
) {
  const allowed = DECISION_CODES_BY_TOPIC[item.topic];
  const factIds = new Set(item.facts.map(({ id }) => id));
  return (
    decision.hintLevel === hintLevel &&
    decision.sourceItemIds.length === 1 &&
    decision.sourceItemIds[0] === item.id &&
    (allowed.focusCodes as readonly string[]).includes(decision.focusCode) &&
    (allowed.actionCodes as readonly string[]).includes(decision.actionCode) &&
    (allowed.hypothesisCodes as readonly string[]).includes(decision.hypothesisCode) &&
    Boolean(selectedAction(item, decision.actionCode)) &&
    decision.factIds.every((id) => factIds.has(id))
  );
}

function renderDecision(
  decision: ModelHintDecision,
  item: KnowledgeItem,
  fallback: boolean,
  evidenceToConsume: {
    evidenceRecordId: string;
    evidenceSequence: number;
    contentDigest: string;
    createdAt: string;
  } | null,
): HintResponse {
  const sources = [{ title: item.title, authority: item.source.authority }];
  if (decision.hintLevel === 1) {
    return HintResponseSchema.parse({
      hintLevel: 1,
      groundingStatus: "GROUNDED",
      confirmedFacts: [],
      hypotheses: [],
      questions: TOPIC_QUESTIONS[item.topic],
      guidance: [],
      nextSteps: [],
      localExample: null,
      sourceTitles: [item.title],
      sources,
      evidenceToConsume: null,
      uncertainty: "需要学习者补充可观察证据后再判断。",
      fallback,
    });
  }
  const facts = new Map(item.facts.map((fact) => [fact.id, fact.text]));
  const selectedFacts = decision.factIds.flatMap((id) => {
    const fact = facts.get(id);
    return fact ? [fact] : [];
  });
  const nextAction = selectedAction(item, decision.actionCode);
  if (!nextAction) throw new Error("controlled action is not registered in the source item");
  return HintResponseSchema.parse({
    hintLevel: decision.hintLevel,
    groundingStatus: "GROUNDED",
    confirmedFacts: selectedFacts.map(
      (fact) => `${AUTHORITY_LABELS[item.source.authority]}${fact}`,
    ),
    hypotheses: [HYPOTHESIS_TEXT[decision.hypothesisCode]],
    questions: TOPIC_QUESTIONS[item.topic],
    guidance: [FOCUS_GUIDANCE[decision.focusCode]],
    nextSteps: [nextAction.text],
    localExample: decision.hintLevel === 3 ? LOCAL_EXAMPLE[item.topic] : null,
    sourceTitles: [item.title],
    sources,
    evidenceToConsume,
    uncertainty: "以上假设仍需下一步证据确认。",
    fallback,
  });
}

async function modelDecision(
  client: ModelClient,
  messages: ReturnType<typeof buildHintMessages>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort(new Error("hint timeout"));
      reject(new Error("hint timeout"));
    }, timeoutMs);
  });
  let rejectExternalAbort: ((reason?: unknown) => void) | undefined;
  const externalAbortPromise = new Promise<never>((_resolve, reject) => {
    rejectExternalAbort = reject;
  });
  const abortFromCaller = () => {
    const reason = externalSignal?.reason ?? new Error("hint cancelled");
    controller.abort(reason);
    rejectExternalAbort?.(reason);
  };
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  if (externalSignal?.aborted) abortFromCaller();
  try {
    return await Promise.race([
      completeJson(client, messages, ModelHintDecisionSchema, { signal: controller.signal }),
      timeoutPromise,
      externalAbortPromise,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export function createGroundedHintService(input: {
  knowledge: readonly KnowledgeItem[];
  client?: ModelClient;
  timeoutMs?: number;
}) {
  const knowledge = z.array(KnowledgeItemSchema).min(1, "知识库不能为空").parse(input.knowledge);
  const timeoutMs = z.number().int().positive().max(30_000).parse(input.timeoutMs ?? 8_000);

  return {
    async generate(
      rawRequest: unknown,
      rawPolicy: unknown,
      options: { signal?: AbortSignal } = {},
    ): Promise<HintResponse> {
      if (options.signal?.aborted) throw new Error("提示请求已取消");
      const request = HintRequestSchema.parse(rawRequest);
      const policy = requireServerPolicyContext(rawPolicy);
      const hintLevel = allowedHintLevel(policy);
      const selectedEvidence = selectLevelThreeEvidence(policy);
      const evidenceToConsume =
        hintLevel === 3 && selectedEvidence
          ? {
              evidenceRecordId: selectedEvidence.evidenceRecordId,
              evidenceSequence: selectedEvidence.evidenceSequence,
              contentDigest: selectedEvidence.contentDigest,
              createdAt: selectedEvidence.createdAt,
            }
          : null;
      const item = selectTopKnowledge(request.question, knowledge, request.topicScope);
      if (!item) return noGroundingHint(hintLevel);

      // Read-only selection only. Task 7 must atomically re-check and consume this
      // exact recordId+digest while persisting the level-three hint.
      const fallback = () =>
        renderDecision(fallbackDecision(item, hintLevel), item, true, evidenceToConsume);
      if (!input.client) return fallback();
      try {
        const decision = await modelDecision(
          input.client,
          buildHintMessages({ request, hintLevel, knowledge: [item] }),
          timeoutMs,
          options.signal,
        );
        return decisionAllowed(decision, item, hintLevel)
          ? renderDecision(decision, item, false, evidenceToConsume)
          : fallback();
      } catch {
        if (options.signal?.aborted) throw new Error("提示请求已取消");
        return fallback();
      }
    },
  };
}
