import { LogicCardSchema, type LogicCard } from "./schemas";

const fieldLabels: Record<keyof LogicCard, string> = {
  culturalIntent: "文化意图",
  participantAction: "参与行为",
  inputSignal: "输入信号",
  mappingRule: "判断与映射",
  outputMedium: "输出媒介",
  experienceFeedback: "体验反馈",
};

export function validateLogicCard(input: unknown) {
  const card = LogicCardSchema.parse(input);
  const issues = (Object.entries(fieldLabels) as [keyof LogicCard, string][])
    .filter(([field]) => card[field].trim().length === 0)
    .map(([, label]) => `${label}不能为空`);

  return { ready: issues.length === 0, issues };
}
