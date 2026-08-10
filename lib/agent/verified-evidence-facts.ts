import { z } from "zod";

import { EvidenceProbeSchema } from "@/lib/domain/evidence-probe";

const SignalLayerSchema = z.enum(["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"]);
const EvidenceKindSchema = z.enum(["TEXT", "IMAGE", "VALUE", "VIDEO_LINK", "PROBE"]);
const VerificationSchema = z.enum(["RULE_VERIFIED", "TEACHER_VERIFIED"]);

export const VerifiedEvidenceFactSchema = z.object({
  sourceId: z.string().min(1).max(80),
  evidenceId: z.string().min(1).max(128),
  label: z.string().min(1).max(80),
  kind: EvidenceKindSchema,
  signalLayer: SignalLayerSchema,
  verificationStatus: VerificationSchema,
  statement: z.string().min(1).max(300),
  boundary: z.string().min(1).max(240).nullable(),
  evidenceSequence: z.number().int().positive(),
}).strict();

export type VerifiedEvidenceFact = z.infer<typeof VerifiedEvidenceFactSchema>;

export type EvidenceFactInput = {
  id: string;
  evidenceSequence: number;
  kind: "TEXT" | "IMAGE" | "VALUE" | "VIDEO_LINK" | "PROBE";
  signalLayer: "INPUT" | "MAPPING" | "TRANSPORT" | "BINDING" | "OUTPUT";
  verificationStatus: "SUBMITTED" | "RULE_VERIFIED" | "TEACHER_VERIFIED" | "REJECTED";
  label: string;
  content: string;
  probeJson: unknown;
};

const LAYER_LABEL = {
  INPUT: "输入层",
  MAPPING: "映射层",
  TRANSPORT: "传输层",
  BINDING: "绑定层",
  OUTPUT: "输出层",
} as const;

const LAYER_HINTS: Record<VerifiedEvidenceFact["signalLayer"], readonly string[]> = {
  INPUT: ["输入", "声音", "音频", "传感器", "麦克风", "数值"],
  MAPPING: ["映射", "范围", "区间", "阈值", "反向", "math"],
  TRANSPORT: ["传输", "通道", "接收", "osc", "端口", "digishow"],
  BINDING: ["绑定", "引用", "参数", "驱动", "export", "bind"],
  OUTPUT: ["输出", "画面", "效果", "渲染", "不动", "变化"],
};

export function sanitizeEvidenceFragment(value: string, max = 180) {
  return value
    .normalize("NFC")
    .replace(/https?:\/\/\S+/giu, "[已隐藏链接]")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s，。；、]+/gu, "[已隐藏本地路径]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function relationshipLabel(value: "DIRECT" | "INVERSE" | "THRESHOLD") {
  return value === "DIRECT" ? "正向关系" : value === "INVERSE" ? "反向关系" : "阈值关系";
}

function probeStatement(rawProbe: unknown) {
  const probe = EvidenceProbeSchema.parse(rawProbe);
  switch (probe.type) {
    case "INPUT_MEASUREMENT":
      return `${sanitizeEvidenceFragment(probe.firstCondition)}时为${probe.firstValue}${sanitizeEvidenceFragment(probe.unit, 24)}，${sanitizeEvidenceFragment(probe.secondCondition)}时为${probe.secondValue}${sanitizeEvidenceFragment(probe.unit, 24)}，输入随条件发生变化。`;
    case "MAPPING_RANGE":
      return `输入范围${probe.inputMin}–${probe.inputMax}被映射到输出范围${probe.outputMin}–${probe.outputMax}，关系为${relationshipLabel(probe.relationship)}。`;
    case "TRANSPORT_RECEIPT":
      return `OSC接收端已记录数值${probe.receivedValue}；主机地址与端口未提供给模型。`;
    case "LOCAL_CHANNEL_RECEIPT":
      return `本地通道从“${sanitizeEvidenceFragment(probe.sourceChannel, 80)}”传到“${sanitizeEvidenceFragment(probe.targetChannel, 80)}”，接收值为${probe.receivedValue}。`;
    case "BINDING_OBSERVATION":
      return `“${sanitizeEvidenceFragment(probe.source, 80)}”驱动“${sanitizeEvidenceFragment(probe.target, 80)}”后，观察值从${probe.observedBefore}变为${probe.observedAfter}。`;
    case "OUTPUT_COMPARISON":
      return `输出参数“${sanitizeEvidenceFragment(probe.parameter, 80)}”在对照前后从${probe.before}变为${probe.after}。`;
  }
}

export function deriveVerifiedEvidenceFact(input: EvidenceFactInput): VerifiedEvidenceFact | null {
  if (!VerificationSchema.safeParse(input.verificationStatus).success) return null;
  if (input.verificationStatus === "RULE_VERIFIED" && input.kind !== "PROBE") return null;
  const label = sanitizeEvidenceFragment(input.label, 80) || "未命名证据";
  const layer = LAYER_LABEL[input.signalLayer];
  let statement: string;
  let boundary: string | null = null;

  if (input.kind === "PROBE") {
    const parsed = EvidenceProbeSchema.safeParse(input.probeJson);
    if (!parsed.success) return null;
    statement = `${layer}已验证：${probeStatement(parsed.data)}`;
  } else if (input.kind === "TEXT") {
    const content = sanitizeEvidenceFragment(input.content, 220);
    if (!content || input.verificationStatus !== "TEACHER_VERIFIED") return null;
    statement = `${layer}的教师确认记录“${label}”：${content}`;
  } else if (input.kind === "VALUE") {
    const value = Number(input.content);
    if (!Number.isFinite(value) || input.verificationStatus !== "TEACHER_VERIFIED") return null;
    statement = `${layer}的教师确认数值“${label}”为${value}。`;
  } else if (input.kind === "IMAGE") {
    if (input.verificationStatus !== "TEACHER_VERIFIED") return null;
    statement = `教师已确认${layer}图片证据“${label}”存在。`;
    boundary = "智能体没有读取或推断图片具体内容，不能据此描述画面。";
  } else {
    if (input.verificationStatus !== "TEACHER_VERIFIED") return null;
    statement = `教师已确认${layer}视频证据“${label}”存在。`;
    boundary = "智能体没有打开链接或理解视频具体内容，不能据此描述作品效果。";
  }

  return VerifiedEvidenceFactSchema.parse({
    sourceId: `evidence:${input.id}`,
    evidenceId: input.id,
    label,
    kind: input.kind,
    signalLayer: input.signalLayer,
    verificationStatus: input.verificationStatus,
    statement: sanitizeEvidenceFragment(statement, 300),
    boundary,
    evidenceSequence: input.evidenceSequence,
  });
}

function relevanceScore(question: string, fact: VerifiedEvidenceFact) {
  const normalized = question.normalize("NFKC").toLowerCase();
  let score = fact.verificationStatus === "TEACHER_VERIFIED" ? 1 : 0;
  if (normalized.includes(fact.label.toLowerCase())) score += 8;
  score += LAYER_HINTS[fact.signalLayer].filter((hint) => normalized.includes(hint)).length * 4;
  const statementTokens = fact.statement.toLowerCase().match(/[a-z][a-z0-9._+-]{2,}|[\p{Script=Han}]{2,6}/gu) ?? [];
  score += statementTokens.filter((token) => normalized.includes(token)).slice(0, 3).length;
  return score;
}

export function selectRelevantVerifiedEvidenceFacts(
  facts: readonly VerifiedEvidenceFact[],
  question: string,
  limit = 5,
) {
  const ranked = facts.map((fact) => ({ fact, score: relevanceScore(question, fact) }))
    .sort((left, right) => right.score - left.score || right.fact.evidenceSequence - left.fact.evidenceSequence);
  const directMatches = ranked.filter(({ score }) => score >= 4);
  const debugQuestion = /(不动|没反应|没有变化|未变化|故障|排查)/u.test(question.normalize("NFKC").toLowerCase());
  return (directMatches.length > 0 ? directMatches : debugQuestion ? ranked : [])
    .slice(0, Math.max(0, limit))
    .map(({ fact }) => fact);
}
