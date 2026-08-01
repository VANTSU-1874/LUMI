import type { ToolPathMilestone, ToolPathRequirements } from "@/lib/domain/tool-path";
import type { LearnerLevel, ToolPath } from "@/lib/domain/schemas";

export type { ToolPathMilestone, ToolPathRequirements } from "@/lib/domain/tool-path";

export type ToolPathRecommendation = {
  path: ToolPath;
  reasons: string[];
  milestones: ToolPathMilestone[];
};

export class NoAllowedToolPathError extends Error {
  constructor() {
    super("教师允许的工具暂无法满足当前项目需求");
    this.name = "NoAllowedToolPathError";
  }
}

const milestones: Record<ToolPath, ToolPathMilestone[]> = {
  DIGISHOW: [
    { id: "digishow-input", title: "完成输入信号配置", requiredEvidenceLabel: "输入信号运行截图" },
    { id: "digishow-mapping", title: "实现六元映射规则", requiredEvidenceLabel: "规则节点与参数截图" },
    { id: "digishow-output", title: "联调展示输出", requiredEvidenceLabel: "完整交互演示视频" },
  ],
  TOUCHDESIGNER: [
    { id: "td-input", title: "建立实时数据输入", requiredEvidenceLabel: "输入通道数值截图" },
    { id: "td-network", title: "搭建视觉节点网络", requiredEvidenceLabel: "节点网络截图" },
    { id: "td-output", title: "调优实时视觉输出", requiredEvidenceLabel: "实时运行效果视频" },
  ],
  COLLABORATIVE: [
    { id: "collab-digi", title: "完成 DigiShow 物理控制", requiredEvidenceLabel: "物理输入信号截图" },
    { id: "collab-osc", title: "打通 OSC 通信", requiredEvidenceLabel: "OSC 地址与数值截图" },
    { id: "collab-td", title: "联调 TouchDesigner 实时画面", requiredEvidenceLabel: "双工具联调演示视频" },
  ],
};

const allPaths: ToolPath[] = ["DIGISHOW", "TOUCHDESIGNER", "COLLABORATIVE"];

function rankedCandidates(level: LearnerLevel, requirements: ToolPathRequirements): ToolPath[] {
  if (requirements.needsPhysicalControl && requirements.needsRealtimeVisuals) {
    return ["COLLABORATIVE"];
  }
  if (requirements.needsPhysicalControl) {
    return ["DIGISHOW", "COLLABORATIVE"];
  }
  if (requirements.needsRealtimeVisuals) {
    return level === "L1"
      ? ["DIGISHOW", "TOUCHDESIGNER", "COLLABORATIVE"]
      : ["TOUCHDESIGNER", "COLLABORATIVE", "DIGISHOW"];
  }
  return ["DIGISHOW", "TOUCHDESIGNER", "COLLABORATIVE"];
}

export function chooseToolPath(
  level: LearnerLevel,
  requirements: ToolPathRequirements,
  allowedPaths: readonly ToolPath[] = allPaths,
): ToolPathRecommendation {
  const candidates = rankedCandidates(level, requirements);
  const path = candidates.find((candidate) => allowedPaths.includes(candidate));
  if (!path) throw new NoAllowedToolPathError();

  const reasons: string[] = [];
  if (path === "COLLABORATIVE") {
    reasons.push("项目同时需要物理控制与实时视觉，适合双工具协同。");
    if (!requirements.hasOsc) reasons.push("开始联调前需先配置 OSC 通信。");
  } else if (path === "DIGISHOW") {
    reasons.push(requirements.needsPhysicalControl
      ? "项目需要物理控制，DigiShow 更适合快速完成信号映射与设备联调。"
      : "先用 DigiShow 完成清晰、可验证的信号映射原型。");
  } else {
    reasons.push("项目重点是实时视觉反馈，TouchDesigner 的节点网络更匹配该需求。");
  }
  if (path !== candidates[0]) {
    reasons.push("根据教师允许的工具集合选择此可行路径。");
  }
  if (level === "L1" && path !== "DIGISHOW") {
    reasons.push("该路径需配合分步模板和节点示例提供学习支撑。");
  }

  const selectedMilestones = milestones[path].map((item) => ({ ...item }));
  if (path === "COLLABORATIVE" && !requirements.hasOsc) {
    selectedMilestones.unshift({
      id: "collab-osc-setup",
      title: "配置 OSC 通信参数",
      requiredEvidenceLabel: "OSC 地址、端口与测试数值截图",
    });
  }
  return { path, reasons, milestones: selectedMilestones };
}
