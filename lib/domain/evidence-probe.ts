import { z } from "zod";

import { EvidenceNumericValueSchema } from "./evidence";
import { ToolPathSchema } from "./schemas";
import { ToolPathRequirementsSchema } from "./tool-path";

const NameSchema = z.string().trim().min(1).max(120);
const UnitSchema = z.string().trim().min(1).max(24);

const InputMeasurementSchema = z.object({
  type: z.literal("INPUT_MEASUREMENT"),
  firstCondition: NameSchema,
  firstValue: EvidenceNumericValueSchema,
  secondCondition: NameSchema,
  secondValue: EvidenceNumericValueSchema,
  unit: UnitSchema,
}).strict().refine(
  (probe) => probe.firstCondition !== probe.secondCondition && probe.firstValue !== probe.secondValue,
  "输入测量需要两个不同条件与不同数值",
);

const MappingRangeSchema = z.object({
  type: z.literal("MAPPING_RANGE"),
  inputMin: EvidenceNumericValueSchema,
  inputMax: EvidenceNumericValueSchema,
  outputMin: EvidenceNumericValueSchema,
  outputMax: EvidenceNumericValueSchema,
  relationship: z.enum(["DIRECT", "INVERSE", "THRESHOLD"]),
}).strict().refine(
  (probe) => probe.inputMin < probe.inputMax && probe.outputMin < probe.outputMax,
  "映射范围的最小值必须小于最大值",
);

const TransportReceiptSchema = z.object({
  type: z.literal("TRANSPORT_RECEIPT"),
  protocol: z.literal("OSC"),
  host: z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.:-]+$/),
  port: z.number().int().min(1).max(65_535),
  receivedValue: EvidenceNumericValueSchema,
}).strict();

const LocalChannelReceiptSchema = z.object({
  type: z.literal("LOCAL_CHANNEL_RECEIPT"),
  sourceChannel: NameSchema,
  targetChannel: NameSchema,
  receivedValue: EvidenceNumericValueSchema,
}).strict().refine(
  (probe) => probe.sourceChannel !== probe.targetChannel,
  "本地通道回执需要不同的发送与接收通道",
);

const BindingObservationSchema = z.object({
  type: z.literal("BINDING_OBSERVATION"),
  source: NameSchema,
  target: NameSchema,
  observedBefore: EvidenceNumericValueSchema,
  observedAfter: EvidenceNumericValueSchema,
}).strict().refine(
  (probe) => probe.source !== probe.target && probe.observedBefore !== probe.observedAfter,
  "绑定验证需要不同的源、目标与变化前后数值",
);

const OutputComparisonSchema = z.object({
  type: z.literal("OUTPUT_COMPARISON"),
  parameter: NameSchema,
  before: EvidenceNumericValueSchema,
  after: EvidenceNumericValueSchema,
}).strict().refine((probe) => probe.before !== probe.after, "输出验证需要变化前后对照");

export const EvidenceProbeSchema = z.discriminatedUnion("type", [
  InputMeasurementSchema,
  MappingRangeSchema,
  TransportReceiptSchema,
  LocalChannelReceiptSchema,
  BindingObservationSchema,
  OutputComparisonSchema,
]);

const PROBE_LAYER = {
  INPUT_MEASUREMENT: "INPUT",
  MAPPING_RANGE: "MAPPING",
  TRANSPORT_RECEIPT: "TRANSPORT",
  LOCAL_CHANNEL_RECEIPT: "TRANSPORT",
  BINDING_OBSERVATION: "BINDING",
  OUTPUT_COMPARISON: "OUTPUT",
} as const;

const LAYER_CODE = {
  INPUT: "INPUT_OK",
  MAPPING: "MAPPING_OK",
  TRANSPORT: "TRANSPORT_OK",
  BINDING: "BINDING_OK",
  OUTPUT: "OUTPUT_OK",
} as const;

export const EvidenceProbeDraftSchema = z.object({
  kind: z.literal("PROBE"),
  label: z.string().trim().min(1).max(80),
  signalLayer: z.enum(["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"]),
  probe: EvidenceProbeSchema,
}).strict().refine(
  (draft) => PROBE_LAYER[draft.probe.type] === draft.signalLayer,
  "结构化验证类型必须与当前信号层一致",
);

export type EvidenceProbeDraft = z.infer<typeof EvidenceProbeDraftSchema>;

export class EvidenceProbePathMismatchError extends Error {
  constructor() {
    super("结构化传输回执与可信工具路径不一致：协同OSC路径必须使用OSC回执，本地回执仅适用于无OSC的单工具路径");
    this.name = "EvidenceProbePathMismatchError";
  }
}

export function validateEvidenceProbe(rawDraft: EvidenceProbeDraft) {
  const draft = EvidenceProbeDraftSchema.parse(rawDraft);
  return {
    verificationStatus: "RULE_VERIFIED" as const,
    confirmedCode: LAYER_CODE[draft.signalLayer],
  };
}

export function validateEvidenceProbeForToolPath(
  rawDraft: EvidenceProbeDraft,
  rawPath: unknown,
  rawRequirements: unknown,
) {
  const draft = EvidenceProbeDraftSchema.parse(rawDraft);
  const validation = validateEvidenceProbe(draft);
  if (draft.signalLayer !== "TRANSPORT") return validation;
  const path = ToolPathSchema.parse(rawPath);
  const requirements = ToolPathRequirementsSchema.parse(rawRequirements);
  const isOscReceipt = draft.probe.type === "TRANSPORT_RECEIPT" && draft.probe.protocol === "OSC";
  const isLocalReceipt = draft.probe.type === "LOCAL_CHANNEL_RECEIPT";
  if (path === "COLLABORATIVE" && requirements.hasOsc && isOscReceipt) return validation;
  if ((path === "DIGISHOW" || path === "TOUCHDESIGNER") && !requirements.hasOsc && isLocalReceipt) return validation;
  throw new EvidenceProbePathMismatchError();
}
