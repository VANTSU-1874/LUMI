import type { ModelMessage } from "./client";
import type { KnowledgeItem, KnowledgeTopic } from "../knowledge/retrieve";
import { redactSensitiveText, studentNumberPolicyFromEnvironment } from "../security/redaction";

type PromptRequest = {
  question: string;
  confirmedFacts: string[];
  hypotheses: string[];
  evidence: Array<{ kind: string; description: string }>;
};

export const DECISION_CODES_BY_TOPIC = {
  DESIGN_FOUNDATIONS: {
    focusCodes: ["DESIGN_GOAL", "DESIGN_EVIDENCE"],
    actionCodes: ["DESIGN_CLARIFY_GOAL", "DESIGN_TEST_ASSUMPTION"],
    hypothesisCodes: ["DESIGN_GOAL_UNCLEAR", "DESIGN_EVIDENCE_MISSING"],
  },
  COURSE_PRINCIPLES: {
    focusCodes: ["COURSE_CULTURAL_INTENT", "COURSE_SIX_ELEMENTS"],
    actionCodes: ["COURSE_CLARIFY_INTENT", "COURSE_COMPLETE_ELEMENTS"],
    hypothesisCodes: ["COURSE_INTENT_UNCLEAR", "COURSE_ELEMENT_MISSING"],
  },
  DIGISHOW_SIGNALS: {
    focusCodes: ["DIGISHOW_SIGNAL_TYPE", "DIGISHOW_MAPPING"],
    actionCodes: ["DIGISHOW_IDENTIFY_SIGNAL", "DIGISHOW_TEST_MAPPING"],
    hypothesisCodes: ["DIGISHOW_SIGNAL_UNKNOWN", "DIGISHOW_MAPPING_UNVERIFIED"],
  },
  TOUCHDESIGNER_FOUNDATIONS: {
    focusCodes: ["TD_SIGNAL_FLOW", "TD_MINIMAL_VALIDATION"],
    actionCodes: ["TD_TRACE_FLOW", "TD_TEST_MINIMAL_CHAIN"],
    hypothesisCodes: ["TD_INPUT_UNVERIFIED", "TD_BINDING_UNVERIFIED"],
  },
  OSC_TROUBLESHOOTING: {
    focusCodes: ["OSC_SEND_RECEIVE", "OSC_ADDRESS_PORT"],
    actionCodes: ["OSC_CHECK_RECEIVER", "OSC_COMPARE_PORTS"],
    hypothesisCodes: ["OSC_RECEIVER_INACTIVE", "OSC_PORT_MISMATCH"],
  },
  BOOK_DESIGN_PRINCIPLES: {
    focusCodes: ["BOOK_AUDIENCE", "BOOK_READING_GOAL"],
    actionCodes: ["BOOK_CLARIFY_AUDIENCE", "BOOK_DEFINE_READING_GOAL"],
    hypothesisCodes: ["BOOK_AUDIENCE_UNCLEAR", "BOOK_GOAL_UNCLEAR"],
  },
  INFORMATION_HIERARCHY: {
    focusCodes: ["BOOK_HIERARCHY", "BOOK_SEQUENCE"],
    actionCodes: ["BOOK_SORT_CONTENT", "BOOK_TEST_SEQUENCE"],
    hypothesisCodes: ["BOOK_HIERARCHY_FLAT", "BOOK_SEQUENCE_UNVERIFIED"],
  },
  LAYOUT_EVIDENCE: {
    focusCodes: ["BOOK_GRID", "BOOK_READING_PATH"],
    actionCodes: ["BOOK_COMPARE_GRID", "BOOK_COMPARE_READING_PATH"],
    hypothesisCodes: ["BOOK_GRID_INCONSISTENT", "BOOK_READING_PATH_UNVERIFIED"],
  },
} as const satisfies Record<
  KnowledgeTopic,
  { focusCodes: readonly string[]; actionCodes: readonly string[]; hypothesisCodes: readonly string[] }
>;

export function buildHintMessages(input: {
  request: PromptRequest;
  hintLevel: 1 | 2 | 3;
  knowledge: readonly KnowledgeItem[];
}): ModelMessage[] {
  if (input.knowledge.length !== 1) {
    throw new Error("controlled hint decisions require exactly one knowledge item");
  }
  const item = input.knowledge[0];
  const codes = DECISION_CODES_BY_TOPIC[item.topic];
  const studentNumber = studentNumberPolicyFromEnvironment();
  const protect = (value: string) => redactSensitiveText(value, { studentNumber });
  return [
    {
      role: "system",
      content: [
        "你是触映课程智能体的受控决策器，不直接撰写给学生的回答。",
        "只返回一个JSON对象，不要代码围栏、解释、建议、句子或额外字段。",
        "所有代码和ID只能从用户消息中的白名单逐项选择。",
        `hintLevel必须等于${input.hintLevel}，不得自行升级。`,
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        learnerContext: {
          question: protect(input.request.question),
          observations: [
            ...input.request.confirmedFacts.map(protect),
            ...input.request.evidence.map(({ kind, description }) => ({ kind, description: protect(description) })),
          ],
          learnerHypotheses: input.request.hypotheses.map(protect),
        },
        sourceContext: {
          id: item.id,
          topic: item.topic,
          title: item.title,
          authority: item.source.authority,
          scope: item.source.scope,
          facts: item.facts,
        },
        allowed: {
          hintLevel: input.hintLevel,
          focusCodes: codes.focusCodes,
          actionCodes: codes.actionCodes,
          hypothesisCodes: codes.hypothesisCodes,
          sourceItemIds: [item.id],
          factIds: item.facts.map(({ id }) => id),
        },
        responseShape: {
          hintLevel: input.hintLevel,
          focusCode: "one allowed focusCode",
          actionCode: "one allowed actionCode",
          hypothesisCode: "one allowed hypothesisCode",
          sourceItemIds: [item.id],
          factIds: ["one or two allowed fact IDs"],
        },
      }),
    },
  ];
}
