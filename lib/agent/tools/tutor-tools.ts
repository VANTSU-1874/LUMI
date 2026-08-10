import { z } from "zod";

import type { ConceptFieldDefinitionSchema } from "@/lib/course-packs/contract";

import type { AgentToolDefinition, AgentToolContext } from "../tool-contract";
import { getCapability } from "../capability-registry";

type ConceptField = z.infer<typeof ConceptFieldDefinitionSchema>;

const MAX_QUESTIONS = 2;

const EmptyInputSchema = z.object({}).strict();

const AskClarifyingOutputSchema = z.object({
  conceptLabel: z.string(),
  questions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    prompt: z.string(),
  }).strict()).max(MAX_QUESTIONS),
  addressed: z.array(z.string()).max(12),
  holdAnswer: z.boolean(),
}).strict();

/**
 * 判断学生这句话是否已经交代了某个概念字段。
 * 只用可观察的字面证据：字段标签本身，或标签拆出的双字词。
 * 不做语义猜测——宁可多问一句，也不假装学生已经说过。
 */
export function addressesField(question: string, field: ConceptField): boolean {
  const normalized = question.normalize("NFKC").toLowerCase();
  if (normalized.includes(field.label.toLowerCase())) return true;
  // 「信息层级」→「信息」「层级」：中文标签常以双字词组合，拆开可捕捉"我的层级乱了"这类表达。
  for (let index = 0; index + 2 <= field.label.length; index += 2) {
    const bigram = field.label.slice(index, index + 2);
    if (bigram.length === 2 && normalized.includes(bigram.toLowerCase())) return true;
  }
  return false;
}

/**
 * 按课程包给出的顺序取最靠前的未澄清字段。
 * 字段顺序即教学顺序（受众 → 阅读目标 → 信息层级 …），
 * 因此"最靠前的未澄清项"就是当下最该先问的东西。
 */
export function selectClarifyingFields(question: string, fields: readonly ConceptField[]) {
  const addressed: string[] = [];
  const pending: ConceptField[] = [];
  for (const field of fields) {
    if (addressesField(question, field)) addressed.push(field.id);
    else if (pending.length < MAX_QUESTIONS) pending.push(field);
  }
  return { addressed, pending };
}

export const tutorAskClarifyingTool = {
  descriptor: {
    id: "tutor.ask-clarifying",
    version: "1",
    adapterId: "tutor-clarify",
    owner: getCapability("tutor-clarify"),
    label: "取回本轮应先追问的问题",
    description: "按当前课程的概念顺序，取出学生尚未交代、且应当先追问的 1–2 个问题。",
    inputHint: "不需要参数，arguments 必须是空对象。",
    effect: "READ_CONTEXT",
    access: "READ_ONLY",
    timeoutMs: 2_000,
    recommendedByCoursePacks: [
      { id: "general-design", version: "1" },
      { id: "book-design", version: "1" },
      { id: "digital-interaction", version: "1" },
      { id: "layout-design", version: "1" },
      { id: "brand-vi-design", version: "1" },
    ],
  },
  inputSchema: EmptyInputSchema,
  outputSchema: AskClarifyingOutputSchema,
  execute(context: AgentToolContext) {
    const fields = context.pack.conceptModel.fields;
    const { addressed, pending } = selectClarifyingFields(context.question, fields);
    return {
      conceptLabel: context.pack.conceptModel.label,
      questions: pending.map(({ id, label, prompt }) => ({ id, label, prompt })),
      addressed,
      holdAnswer: pending.length > 0,
    };
  },
  summarize(rawOutput: unknown) {
    const output = AskClarifyingOutputSchema.parse(rawOutput);
    if (output.questions.length === 0) {
      return {
        summary: `学生已交代${output.conceptLabel}的各项前提，可以直接进入提示与局部示范。`,
        facts: ["无待澄清项；仍应在给出示范前复述一次你对其意图的理解。"],
        empty: true,
      };
    }
    return {
      summary: `先追问这 ${output.questions.length} 个问题，学生回答前不要给出完整做法。`,
      facts: [
        ...output.questions.map(({ label, prompt }) => `${label}：${prompt}`),
        "把问题用你自己的话问出来，一次问完，不要逐条盘问。",
      ],
      empty: false,
    };
  },
} satisfies AgentToolDefinition;
