import type { ModelProviderAdapter } from "./model-provider-adapter";
import { PROJECT_BRIEF_FIELD_IDS, type ProjectBriefFieldId } from "./project-brief-memory";

type BenchmarkPrompt = {
  studentQuestion: string;
  projectBrief: { fields: Partial<Record<ProjectBriefFieldId, unknown>> };
  allowed: { episodes: string[]; decisionCodes: string[] };
};

const FIELD_VALUES: Record<Exclude<ProjectBriefFieldId, "designGoal">, string> = {
  audienceAndContext: "根据连续对话确认受众与实际使用情境",
  coreContent: "保留学生明确提出的核心信息与传播任务",
  visualExperienceDirection: "以可比较的视觉方向和体验假设推进",
  mediumConstraints: "记录媒介、预算、尺寸与制作条件",
  processPlan: "先做低成本原型，再根据观察逐步细化",
  successCriteria: "通过目标受众的识别、理解和使用结果判断有效性",
  nextStep: "完成一个可观察结果的最小原型并记录前后对比",
};

function responseStrategy(episode: string) {
  return episode === "DEBUG" ? "DIAGNOSTIC_GUIDANCE"
    : episode === "BUILD" ? "DIRECT_INSTRUCTION"
      : episode === "UNDERSTAND" ? "CONCEPT_EXPLANATION"
        : episode === "TRANSFER" ? "TRANSFER_COACHING"
          : episode === "REFLECT" ? "REFLECTION_PROMPT"
            : "CLARIFY";
}

export function createRuntimeBenchmarkFixtureAdapter(): ModelProviderAdapter {
  return {
    provider: "TEST",
    capabilities: { vision: false },
    async complete(messages) {
      const prompt = JSON.parse(messages[1]?.content ?? "{}") as BenchmarkPrompt;
      const episode = prompt.allowed.episodes[0] ?? "EXPLORE";
      const decisionCode = prompt.allowed.decisionCodes.find((code) => code.startsWith(`${episode}_`))
        ?? prompt.allowed.decisionCodes[0];
      const nextField = PROJECT_BRIEF_FIELD_IDS.find((fieldId) => prompt.projectBrief.fields[fieldId] === undefined);
      const briefPatch = nextField ? {
        [nextField]: {
          value: nextField === "designGoal"
            ? prompt.studentQuestion.slice(0, 180)
            : FIELD_VALUES[nextField],
          status: "CONFIRMED",
        },
      } : {};
      return JSON.stringify({
        step: "ANSWER",
        episode,
        decisionCode,
        responseStrategy: responseStrategy(episode),
        sourceIds: [],
        actionType: null,
        title: "把设计判断变成可验证的下一步",
        message: "可从三种方向选择并快速比较。先明确受众、品牌定位与使用触点，再用信息层级、阅读路径和网格组织视觉传达；包装检查货架识别、材料与结构，界面检查用户路径、状态反馈、可用性与无障碍，产品检查人体工学、握持、防滑与样机测试，空间检查动线、停留节点和疏散，服装检查面料垂感、廓形与立裁，首饰检查佩戴、重量重心与固定连接，影像检查镜头分镜、节奏时长和声音画面，动画检查关键帧、惯性与缓冲，工艺美术检查泥料厚度、烧成工艺与试样。第一步先做一个最小原型，记录前后对比作为证据。",
        whyThisStep: "同一套目标—受众—媒介—原型—观察关系可以稳定比较不同 Runtime 的行为。",
        uncertainty: "通用设计建议：尚未看到真实作品、材料样片和使用现场。",
        briefPatch,
      });
    },
  };
}
