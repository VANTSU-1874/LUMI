import type { LogicCard, ToolPath } from "@/lib/domain/schemas";
import type { ToolPathMilestone, ToolPathRequirements } from "@/lib/domain/tool-path";
import type { EvidenceCode, SignalLayer } from "@/lib/services/troubleshooting";
import { DataTypeSchema } from "@/lib/domain/data-provenance";
import { EvidenceProbeDraftSchema, type EvidenceProbeDraft } from "@/lib/domain/evidence-probe";

const DEMONSTRATION_DATA = "DEMONSTRATION_DATA" as const;
DataTypeSchema.parse(DEMONSTRATION_DATA);

type DemoEvidence = EvidenceProbeDraft & {
  id: string;
  dataType: "DEMONSTRATION_DATA";
  code: EvidenceCode;
};

export type DemonstrationCase = {
  dataType: "DEMONSTRATION_DATA";
  id: "a" | "b" | "c";
  studentId: string;
  projectId: string;
  identityCode: string;
  alias: string;
  title: string;
  weakInitialIdea: string;
  approvedLogicCard: LogicCard;
  path: ToolPath;
  requirements: ToolPathRequirements;
  reasons: string[];
  milestones: ToolPathMilestone[];
  evidence: DemoEvidence[];
  injectedFault: {
    dataType: "DEMONSTRATION_DATA";
    symptom: string;
    expectedLayer: SignalLayer;
    deterministicNextAction: string;
  };
  transfer: {
    dataType: "DEMONSTRATION_DATA";
    status: "PASSED";
    attempt: { dataType: "DEMONSTRATION_DATA"; rationale: string };
  };
};

export type DemonstrationProfile = {
  dataType: "DEMONSTRATION_DATA";
  studentId: string;
  identityCode: string;
  alias: string;
  level: "L1" | "L2" | "L3" | "L4";
  decomposition: 1 | 2 | 3 | 4;
  signalUnderstanding: 1 | 2 | 3 | 4;
  mappingDesign: 1 | 2 | 3 | 4;
  troubleshooting: 1 | 2 | 3 | 4;
  transfer: 1 | 2 | 3 | 4;
};

const milestone = (prefix: string): ToolPathMilestone[] => [
  { id: `${prefix}-input`, title: "验证输入变化", requiredEvidenceLabel: "输入层数值证据" },
  { id: `${prefix}-mapping`, title: "验证映射关系", requiredEvidenceLabel: "映射层范围证据" },
  { id: `${prefix}-output`, title: "验证输出反馈", requiredEvidenceLabel: "输出层结果证据" },
];

const LAYER_CODE = {
  INPUT: "INPUT_OK", MAPPING: "MAPPING_OK", TRANSPORT: "TRANSPORT_OK",
  BINDING: "BINDING_OK", OUTPUT: "OUTPUT_OK",
} as const satisfies Record<SignalLayer, EvidenceCode>;

function evidence(caseId: "a" | "b" | "c", index: number, draft: EvidenceProbeDraft): DemoEvidence {
  const parsed = EvidenceProbeDraftSchema.parse(draft);
  return {
    ...parsed,
    id: `10000000-0000-4000-800${caseId === "a" ? "1" : caseId === "b" ? "2" : "3"}-${String(index).padStart(12, "0")}`,
    dataType: DEMONSTRATION_DATA,
    code: LAYER_CODE[parsed.signalLayer],
  };
}

export const DEMO_CASES: readonly DemonstrationCase[] = [
  {
    dataType: "DEMONSTRATION_DATA",
    id: "a",
    studentId: "demo-student-a",
    projectId: "demo-project-a",
    identityCode: "7K9M-2Q4R-P8TX",
    alias: "演示学习者A",
    title: "DigiShow距离输入到三档灯光",
    weakInitialIdea: "演示弱想法：人走过来时让灯光变好看。",
    approvedLogicCard: {
      culturalIntent: "用明暗层次表达社区夜间共享与陪伴",
      participantAction: "参与者靠近、停留或离开灯光装置",
      inputSignal: "距离传感器输出10至80厘米",
      mappingRule: "10至30厘米高亮，30至55厘米中亮，55至80厘米低亮",
      outputMedium: "DigiShow控制的三档灯光亮度",
      experienceFeedback: "靠近后灯光分档变亮并在离开后恢复低亮",
    },
    path: "DIGISHOW",
    requirements: { needsRealtimeVisuals: false, needsPhysicalControl: true, hasOsc: false },
    reasons: ["演示路径：三档阈值与灯光可在DigiShow内完成"],
    milestones: milestone("demo-a"),
    evidence: [
      evidence("a", 1, { kind: "PROBE", label: "近远距离输入对照", signalLayer: "INPUT", probe: { type: "INPUT_MEASUREMENT", firstCondition: "参与者靠近", firstValue: 18, secondCondition: "参与者远离", secondValue: 72, unit: "cm" } }),
      evidence("a", 2, { kind: "PROBE", label: "DigiShow本地通道回执", signalLayer: "TRANSPORT", probe: { type: "LOCAL_CHANNEL_RECEIPT", sourceChannel: "距离输入通道", targetChannel: "映射接收通道", receivedValue: 28 } }),
      evidence("a", 3, { kind: "PROBE", label: "三档距离阈值范围", signalLayer: "MAPPING", probe: { type: "MAPPING_RANGE", inputMin: 10, inputMax: 80, outputMin: 1, outputMax: 3, relationship: "THRESHOLD" } }),
      evidence("a", 4, { kind: "PROBE", label: "距离值绑定灯光通道", signalLayer: "BINDING", probe: { type: "BINDING_OBSERVATION", source: "DigiShow距离值", target: "灯光亮度通道", observedBefore: 1, observedAfter: 3 } }),
      evidence("a", 5, { kind: "PROBE", label: "灯光亮度前后对照", signalLayer: "OUTPUT", probe: { type: "OUTPUT_COMPARISON", parameter: "灯光亮度档位", before: 1, after: 3 } }),
    ],
    injectedFault: { dataType: DEMONSTRATION_DATA, symptom: "演示注入故障：距离值变化但灯光始终高亮", expectedLayer: "MAPPING", deterministicNextAction: "请记录映射前后的数值范围" },
    transfer: { dataType: DEMONSTRATION_DATA, status: "PASSED", attempt: { dataType: DEMONSTRATION_DATA, rationale: "演示迁移作答：只改变指定维度并保留文化意图与因果链。" } },
  },
  {
    dataType: "DEMONSTRATION_DATA",
    id: "b",
    studentId: "demo-student-b",
    projectId: "demo-project-b",
    identityCode: "8L2N-3R5T-Q9WY",
    alias: "演示学习者B",
    title: "TouchDesigner声音振幅到粒子密度",
    weakInitialIdea: "演示弱想法：现场有声音时粒子跟着动。",
    approvedLogicCard: {
      culturalIntent: "让多人声音共同构成社区节奏的可视化记忆",
      participantAction: "参与者拍手、说话或合唱改变现场声压",
      inputSignal: "麦克风声音振幅与分贝值",
      mappingRule: "40至90分贝线性归一化到0至1并映射粒子密度",
      outputMedium: "TouchDesigner实时粒子密度视觉",
      experienceFeedback: "声音增强时粒子变密并在安静后逐渐疏散",
    },
    path: "TOUCHDESIGNER",
    requirements: { needsRealtimeVisuals: true, needsPhysicalControl: false, hasOsc: false },
    reasons: ["演示路径：音频分析与粒子视觉都在TouchDesigner内完成"],
    milestones: milestone("demo-b"),
    evidence: [
      evidence("b", 1, { kind: "PROBE", label: "安静拍手振幅对照", signalLayer: "INPUT", probe: { type: "INPUT_MEASUREMENT", firstCondition: "现场安静", firstValue: 42, secondCondition: "参与者拍手", secondValue: 78, unit: "dB" } }),
      evidence("b", 2, { kind: "PROBE", label: "TouchDesigner本地通道回执", signalLayer: "TRANSPORT", probe: { type: "LOCAL_CHANNEL_RECEIPT", sourceChannel: "Audio Analysis CHOP", targetChannel: "粒子控制通道", receivedValue: 0.72 } }),
      evidence("b", 3, { kind: "PROBE", label: "分贝归一化范围", signalLayer: "MAPPING", probe: { type: "MAPPING_RANGE", inputMin: 40, inputMax: 90, outputMin: 0, outputMax: 1, relationship: "DIRECT" } }),
      evidence("b", 4, { kind: "PROBE", label: "振幅绑定粒子数量", signalLayer: "BINDING", probe: { type: "BINDING_OBSERVATION", source: "Audio Analysis振幅", target: "粒子数量参数", observedBefore: 200, observedAfter: 1200 } }),
      evidence("b", 5, { kind: "PROBE", label: "粒子密度前后对照", signalLayer: "OUTPUT", probe: { type: "OUTPUT_COMPARISON", parameter: "粒子数量", before: 200, after: 1200 } }),
    ],
    injectedFault: { dataType: DEMONSTRATION_DATA, symptom: "演示注入故障：分贝值正常但粒子密度不变", expectedLayer: "BINDING", deterministicNextAction: "请确认接收值已绑定到粒子密度参数" },
    transfer: { dataType: DEMONSTRATION_DATA, status: "PASSED", attempt: { dataType: DEMONSTRATION_DATA, rationale: "演示迁移作答：保留群体节奏意图并严格替换挑战指定维度。" } },
  },
  {
    dataType: "DEMONSTRATION_DATA",
    id: "c",
    studentId: "demo-student-c",
    projectId: "demo-project-c",
    identityCode: "9M3P-4S6V-R2XZ",
    alias: "D-017 · 预置",
    title: "DigiShow距离归一化经OSC驱动安岳石刻视觉",
    weakInitialIdea: "演示弱想法：人靠近就让安岳石刻画面出现。",
    approvedLogicCard: {
      culturalIntent: "通过靠近观察让参与者发现安岳石刻纹样的层次与守护价值",
      participantAction: "参与者靠近投影并在不同距离停留观察",
      inputSignal: "DigiShow读取10至100厘米的距离值",
      mappingRule: "DigiShow将距离反向归一化到0至1并通过OSC发送",
      outputMedium: "TouchDesigner渐显的安岳石刻纹样投影",
      experienceFeedback: "距离越近纹样细节越清晰并显示守护提示",
    },
    path: "COLLABORATIVE",
    requirements: { needsRealtimeVisuals: true, needsPhysicalControl: true, hasOsc: true },
    reasons: ["演示路径：DigiShow处理传感与归一化，OSC将数值传给TouchDesigner视觉"],
    milestones: [...milestone("demo-c"), { id: "demo-c-osc", title: "验证OSC传输", requiredEvidenceLabel: "OSC地址、端口与接收值" }],
    evidence: [
      evidence("c", 1, { kind: "PROBE", label: "近远距离输入对照", signalLayer: "INPUT", probe: { type: "INPUT_MEASUREMENT", firstCondition: "靠近石刻投影", firstValue: 15, secondCondition: "远离石刻投影", secondValue: 95, unit: "cm" } }),
      evidence("c", 2, { kind: "PROBE", label: "距离反向归一化范围", signalLayer: "MAPPING", probe: { type: "MAPPING_RANGE", inputMin: 10, inputMax: 100, outputMin: 0, outputMax: 1, relationship: "INVERSE" } }),
      evidence("c", 3, { kind: "PROBE", label: "OSC接收回执", signalLayer: "TRANSPORT", probe: { type: "TRANSPORT_RECEIPT", protocol: "OSC", host: "127.0.0.1", port: 7000, receivedValue: 0.82 } }),
      evidence("c", 4, { kind: "PROBE", label: "OSC值绑定纹样透明度", signalLayer: "BINDING", probe: { type: "BINDING_OBSERVATION", source: "OSC /anyue/distance", target: "纹样透明度", observedBefore: 0.15, observedAfter: 0.82 } }),
      evidence("c", 5, { kind: "PROBE", label: "石刻纹样显隐对照", signalLayer: "OUTPUT", probe: { type: "OUTPUT_COMPARISON", parameter: "纹样透明度", before: 0.15, after: 0.82 } }),
    ],
    injectedFault: { dataType: DEMONSTRATION_DATA, symptom: "演示注入故障：DigiShow值正常但TouchDesigner收不到数值", expectedLayer: "TRANSPORT", deterministicNextAction: "请核对OSC地址、端口和接收值" },
    transfer: { dataType: DEMONSTRATION_DATA, status: "PASSED", attempt: { dataType: DEMONSTRATION_DATA, rationale: "演示迁移作答：保留安岳石刻守护意图与OSC链路，只改变挑战维度。" } },
  },
] as const;

export const DEMO_PROFILES: readonly DemonstrationProfile[] = [
  { dataType: DEMONSTRATION_DATA, studentId: "demo-student-a", identityCode: "7K9M-2Q4R-P8TX", alias: "演示学习者A", level: "L1", decomposition: 1, signalUnderstanding: 1, mappingDesign: 1, troubleshooting: 1, transfer: 1 },
  { dataType: DEMONSTRATION_DATA, studentId: "demo-student-b", identityCode: "8L2N-3R5T-Q9WY", alias: "演示学习者B", level: "L2", decomposition: 2, signalUnderstanding: 2, mappingDesign: 2, troubleshooting: 2, transfer: 2 },
  { dataType: DEMONSTRATION_DATA, studentId: "demo-student-c", identityCode: "9M3P-4S6V-R2XZ", alias: "D-017 · 预置", level: "L3", decomposition: 3, signalUnderstanding: 3, mappingDesign: 3, troubleshooting: 3, transfer: 3 },
  { dataType: DEMONSTRATION_DATA, studentId: "demo-student-d", identityCode: "2N4Q-5T7W-X3ZA", alias: "演示学习者D", level: "L4", decomposition: 4, signalUnderstanding: 4, mappingDesign: 4, troubleshooting: 4, transfer: 4 },
] as const;
