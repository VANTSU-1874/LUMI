import type { LogicCard } from "./schemas";

export type CardField = keyof LogicCard;
export type LogicCardDraft = LogicCard;

export const GUIDANCE_STEPS: Array<{
  key: CardField;
  chainLabel: string;
  directLabel: string;
  question: string;
  helper: string;
  suggestions: string[];
}> = [
  {
    key: "culturalIntent",
    chainLabel: "想表达",
    directLabel: "文化意图",
    question: "你希望参与者最后感受到什么？",
    helper: "先不想软件，只说你希望这件作品给人留下什么感受。",
    suggestions: ["发现社区里的真实故事", "感受传统文化的生命力", "愿意主动加入校园活动"],
  },
  {
    key: "participantAction",
    chainLabel: "怎么参与",
    directLabel: "参与行为",
    question: "参与者要做一个什么动作？",
    helper: "选一个现场能看见的动作。动作越具体，后面越容易做。",
    suggestions: ["靠近或远离作品", "对着麦克风说话", "触摸或点击某个区域"],
  },
  {
    key: "inputSignal",
    chainLabel: "系统怎么知道",
    directLabel: "输入信号",
    question: "电脑怎么知道他做了这个动作？",
    helper: "把动作变成电脑能读到的信息，例如距离、音量、位置或一次点击。",
    suggestions: ["读取人与作品之间的距离数值", "采集麦克风音量的大小", "读取触摸位置或点击事件"],
  },
  {
    key: "mappingRule",
    chainLabel: "如何跟着变",
    directLabel: "判断与映射",
    question: "这个信息变化时，你希望结果怎么跟着变？",
    helper: "说清一个“如果……就……”或“越……越……”的关系，不需要写参数。",
    suggestions: ["数值越大，画面越亮或越大", "进入不同区域，就切换不同内容", "达到某个程度后，触发声音或动画"],
  },
  {
    key: "outputMedium",
    chainLabel: "看到或听到",
    directLabel: "输出媒介",
    question: "参与者最后在哪里看到或听到变化？",
    helper: "说出发生变化的东西，不需要知道它由哪些节点实现。",
    suggestions: ["投影画面的亮度、大小或位置", "扬声器里的声音或节奏", "屏幕中的图形、文字或粒子"],
  },
  {
    key: "experienceFeedback",
    chainLabel: "怎么知道成功",
    directLabel: "体验反馈",
    question: "参与者怎么马上知道自己的动作生效了？",
    helper: "描述他当场能感受到的反馈，最好能和刚才的动作直接对应。",
    suggestions: ["动作发生后，画面立即跟着变化", "说话时声音或图形同步响应", "触摸后对应内容马上出现"],
  },
];

export function guidanceStep(field: CardField) {
  const step = GUIDANCE_STEPS.find((candidate) => candidate.key === field);
  if (!step) throw new Error("LOGIC_CARD_GUIDANCE_STEP_MISSING");
  return step;
}

export function emptyLogicCard(): LogicCardDraft {
  return Object.fromEntries(GUIDANCE_STEPS.map(({ key }) => [key, ""])) as LogicCardDraft;
}

export function firstIncompleteStep(card: LogicCardDraft) {
  const index = GUIDANCE_STEPS.findIndex(({ key }) => card[key].trim().length === 0);
  return index === -1 ? GUIDANCE_STEPS.length - 1 : index;
}

export function stepForReviewIssues(issues: string[], card: LogicCardDraft) {
  for (const issue of issues) {
    const normalized = issue.normalize("NFKC").toLowerCase();
    const index = GUIDANCE_STEPS.findIndex(({ key, directLabel }) =>
      normalized.includes(key.toLowerCase()) || normalized.includes(directLabel),
    );
    if (index !== -1) return index;
  }
  const focusTokens: Partial<Record<CardField, string[]>> = {
    culturalIntent: ["文化意图"],
    participantAction: ["参与行为"],
    inputSignal: ["输入信号"],
    mappingRule: ["映射"],
    outputMedium: ["输出媒介"],
    experienceFeedback: ["体验反馈", "感知结果"],
  };
  for (const issue of issues) {
    const normalized = issue.normalize("NFKC").toLowerCase();
    const index = GUIDANCE_STEPS.findIndex(({ key }) =>
      focusTokens[key]?.some((token) => normalized.includes(token.toLowerCase())),
    );
    if (index !== -1) return index;
  }
  return firstIncompleteStep(card);
}

export function humanizeReviewIssue(issue: string) {
  return GUIDANCE_STEPS.reduce(
    (message, { key, chainLabel }) => message.replace(new RegExp(key, "gi"), `“${chainLabel}”`),
    issue,
  ).replace(/\s*(?:字段|field)\s*/gi, "这一步");
}
