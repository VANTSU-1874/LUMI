import { z } from "zod";

export const SIGNAL_LAYERS = ["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"] as const;
export const SignalLayerSchema = z.enum(SIGNAL_LAYERS);
export type SignalLayer = z.infer<typeof SignalLayerSchema>;

export const EvidenceCodeSchema = z.enum([
  "INPUT_OK",
  "MAPPING_OK",
  "TRANSPORT_OK",
  "BINDING_OK",
  "OUTPUT_OK",
]);
export type EvidenceCode = z.infer<typeof EvidenceCodeSchema>;

const EvidenceSignatureSchema = z.object({
  recordId: z.uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const ACTIONS: Record<SignalLayer, string> = {
  INPUT: "请提供靠近与远离时的输入值或截图",
  MAPPING: "请记录映射前后的数值范围",
  TRANSPORT: "请核对OSC地址、端口和接收值",
  BINDING: "请确认接收值已绑定到目标参数",
  OUTPUT: "请检查目标参数是否被其他节点或状态覆盖",
};

const HYPOTHESES: Record<SignalLayer, string> = {
  INPUT: "待验证假设：输入端尚未产生可观察变化",
  MAPPING: "待验证假设：映射范围或变化关系不正确",
  TRANSPORT: "待验证假设：OSC地址或端口不一致",
  BINDING: "待验证假设：接收值尚未绑定到目标参数",
  OUTPUT: "待验证假设：输出被其他节点或状态覆盖",
};

const FACTS: Record<EvidenceCode, string> = {
  INPUT_OK: "输入层已有服务端确认证据",
  MAPPING_OK: "映射层已有服务端确认证据",
  TRANSPORT_OK: "传输层已有服务端确认证据",
  BINDING_OK: "绑定层已有服务端确认证据",
  OUTPUT_OK: "输出层已有服务端确认证据",
};

export const TroubleshootingStateSchema = z.object({
  confirmedCodes: z.array(EvidenceCodeSchema).max(5).default([]),
  usedEvidence: z.array(EvidenceSignatureSchema).max(100).default([]),
  noNewEvidenceRounds: z.number().int().min(0).max(3).default(0),
  status: z.enum(["ACTIVE", "RESOLVED", "ESCALATED"]).default("ACTIVE"),
  currentLayer: SignalLayerSchema.default("INPUT"),
  confirmedFacts: z.array(z.string().max(160)).max(5).default([]),
  unconfirmedHypotheses: z.array(z.string().max(240)).max(1).default([HYPOTHESES.INPUT]),
  nextActions: z.array(z.string().max(240)).max(1).default([ACTIONS.INPUT]),
}).strict();
export type TroubleshootingState = z.infer<typeof TroubleshootingStateSchema>;
export const TroubleshootingPublicStateSchema = TroubleshootingStateSchema.omit({ usedEvidence: true });

const PersistedTroubleshootingStateSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const candidate = { ...(raw as Record<string, unknown>) };
  if (candidate.currentLayer === undefined && candidate.current_layer !== undefined) {
    candidate.currentLayer = candidate.current_layer;
  }
  delete candidate.current_layer;
  return candidate;
}, TroubleshootingStateSchema);

export const TroubleshootingRunSnapshotSchema = z.object({
  currentLayer: SignalLayerSchema,
  status: z.enum(["ACTIVE", "RESOLVED", "ESCALATED"]),
  stateJson: PersistedTroubleshootingStateSchema,
}).strict().superRefine((run, context) => {
  if (run.stateJson.currentLayer !== run.currentLayer) {
    context.addIssue({ code: "custom", path: ["stateJson", "currentLayer"], message: "排障层级与状态JSON不一致" });
  }
  if (run.stateJson.status !== run.status) {
    context.addIssue({ code: "custom", path: ["stateJson", "status"], message: "排障状态与状态JSON不一致" });
  }
});

export function publicTroubleshootingState(state: TroubleshootingState) {
  const parsed = TroubleshootingStateSchema.parse(state);
  return TroubleshootingPublicStateSchema.parse({
    confirmedCodes: parsed.confirmedCodes,
    noNewEvidenceRounds: parsed.noNewEvidenceRounds,
    status: parsed.status,
    currentLayer: parsed.currentLayer,
    confirmedFacts: parsed.confirmedFacts,
    unconfirmedHypotheses: parsed.unconfirmedHypotheses,
    nextActions: parsed.nextActions,
  });
}

function orderedCodes(codes: readonly EvidenceCode[]) {
  const present = new Set(codes);
  return SIGNAL_LAYERS.map((layer) => `${layer}_OK` as EvidenceCode).filter((code) => present.has(code));
}

export function nextTroubleshootingStep(input: { evidence: EvidenceCode[] }) {
  const confirmed = orderedCodes(input.evidence);
  const missingIndex = SIGNAL_LAYERS.findIndex((layer) => !confirmed.includes(`${layer}_OK` as EvidenceCode));
  const layer = SIGNAL_LAYERS[Math.max(0, missingIndex)] ?? "OUTPUT";
  const resolved = missingIndex === -1;
  return {
    layer,
    confirmedFacts: confirmed.map((code) => FACTS[code]),
    unconfirmedHypotheses: resolved ? [] : [HYPOTHESES[layer]],
    nextActions: resolved ? [] : [ACTIONS[layer]],
    status: resolved ? ("RESOLVED" as const) : ("ACTIVE" as const),
  };
}

export function recordTroubleshootingRound(
  rawState: TroubleshootingState,
  candidate: { recordId: string; digest: string; code: EvidenceCode } | null,
): TroubleshootingState {
  const state = TroubleshootingStateSchema.parse(rawState);
  if (state.status !== "ACTIVE") return state;
  const usedIds = new Set(state.usedEvidence.map(({ recordId }) => recordId));
  const usedDigests = new Set(state.usedEvidence.map(({ digest }) => digest));
  const expected = `${state.currentLayer}_OK` as EvidenceCode;
  const validNew = candidate &&
    candidate.code === expected &&
    !usedIds.has(candidate.recordId) &&
    !usedDigests.has(candidate.digest);
  const usedEvidence = validNew
    ? [...state.usedEvidence, { recordId: candidate.recordId, digest: candidate.digest }]
    : state.usedEvidence;
  const confirmedCodes = validNew
    ? orderedCodes([...state.confirmedCodes, candidate.code])
    : state.confirmedCodes;
  const noNewEvidenceRounds = validNew ? 0 : Math.min(3, state.noNewEvidenceRounds + 1);
  if (noNewEvidenceRounds >= 3) {
    return TroubleshootingStateSchema.parse({
      ...state,
      usedEvidence,
      confirmedCodes,
      noNewEvidenceRounds,
      status: "ESCALATED",
      nextActions: ["请求教师查看当前层证据"],
    });
  }
  const next = nextTroubleshootingStep({ evidence: confirmedCodes });
  return TroubleshootingStateSchema.parse({
    ...state,
    usedEvidence,
    confirmedCodes,
    noNewEvidenceRounds,
    status: next.status,
    currentLayer: next.layer,
    confirmedFacts: next.confirmedFacts,
    unconfirmedHypotheses: next.unconfirmedHypotheses,
    nextActions: next.nextActions,
  });
}
