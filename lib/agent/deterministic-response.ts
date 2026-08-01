import type { LearningEpisode } from "@/lib/course-packs/contract";
import type { KnowledgeItem, RankedKnowledgeItem } from "@/lib/knowledge/retrieve";
import type { ProjectBriefPatch } from "./project-brief-memory";

type GroundedKnowledge = KnowledgeItem | RankedKnowledgeItem;

const EPISODE_RETRIEVAL_HINTS: Record<LearningEpisode, string> = {
  EXPLORE: "",
  UNDERSTAND: "概念 关系 原理 任务 路径 层级 优先",
  BUILD: "步骤 顺序 搭建 页序 映射",
  DEBUG: "排障 证据 测试 观察 记录",
  TRANSFER: "迁移 保留 改变 受众 输入 输出",
  REFLECT: "证据 解释 复盘 测试 记录",
};

const TITLES: Record<LearningEpisode, string> = {
  EXPLORE: "先判断目标，不急着选工具",
  UNDERSTAND: "把概念放回关系里理解",
  BUILD: "先搭一条最小可验证结构",
  DEBUG: "沿证据链定位断点",
  TRANSFER: "先分清什么保留、什么改变",
  REFLECT: "用证据解释自己的选择",
};

export type DeterministicResponse = {
  title: string;
  message: string;
  whyThisStep: string;
  uncertainty: string;
  sourceIds: string[];
  briefPatch: ProjectBriefPatch;
};

export function buildKnowledgeQuery(
  message: string,
  episode: LearningEpisode,
  focus: string | null | undefined,
) {
  return [message.normalize("NFKC").trim(), EPISODE_RETRIEVAL_HINTS[episode], focus?.trim().slice(0, 160)]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function compactQuestion(message: string) {
  const singleLine = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  return singleLine.length <= 96 ? singleLine : `${singleLine.slice(0, 95)}…`;
}

function joinStatements(statements: readonly string[]) {
  return statements
    .map((statement) => statement.replace(/[。；;\s]+$/g, "").trim())
    .filter(Boolean)
    .join("；");
}

function firstContentSentence(content: string) {
  const sentence = content.normalize("NFKC").replace(/\s+/g, " ").trim().split(/[。！？]/, 1)[0] ?? "";
  return sentence.length <= 180 ? sentence : `${sentence.slice(0, 179)}…`;
}

function generalDesignResponse(message: string): DeterministicResponse {
  const question = compactQuestion(message);
  if (/(海报|poster)/i.test(message)) {
    return {
      title: "先把“酷”变成可选择的视觉方向",
      message: "我暂时理解：你不是只想多加装饰，而是希望海报更有态度、让人一眼停住。你可能更接近：①高对比和大字的冲击感；②倾斜、切割与运动模糊的速度感；③暗色、冷光与精密网格的科技感。第一步先选一个方向，用同一组文字做三张小草图。这张海报首先要让谁在什么场景下停下来？",
      whyThisStep: "先把模糊感觉拆成可比较的方向，学生只需确认或排除，不必凭空填写完整视觉规范。",
      uncertainty: "通用设计建议：尚未看到海报内容、尺寸、投放场景和已有草图。",
      sourceIds: [],
      briefPatch: {
        designGoal: { value: "设计一张具有鲜明视觉态度和停留吸引力的海报", status: "CONFIRMED" },
        visualExperienceDirection: { value: "暂时在高对比冲击、速度感或暗色科技感之间选择", status: "INFERRED" },
        nextStep: { value: "先确认主要受众和观看场景，再选择一个视觉方向做首版草图", status: "INFERRED" },
      },
    };
  }
  if (/(IP|ip|形象|角色)/.test(message)) {
    return {
      title: "先定角色为什么存在，再画长什么样",
      message: "我暂时理解：你需要的不是立刻画完整设定，而是先找到一个能持续延展的角色核心。可以从三条线选一条起步：①为某类人解决一个小问题；②把一种鲜明性格变成角色；③从品牌、地域或故事里提取一个视觉母题。第一步先写三条角色在不同情境下的性格反应，再各画一个轮廓草图。这个IP最希望先被哪一类人喜欢？",
      whyThisStep: "受众会直接改变性格强度、比例、表情和使用场景，先确认它比先选软件更能减少返工。",
      uncertainty: "通用设计建议：尚未确认IP的受众、品牌关系、使用场景和已有素材。",
      sourceIds: [],
      briefPatch: {
        designGoal: { value: "创建一个可持续延展的IP形象", status: "CONFIRMED" },
        coreContent: { value: "暂时从功能角色、鲜明性格或文化视觉母题中选择角色核心", status: "INFERRED" },
        nextStep: { value: "先确认首要受众，再写出三条角色性格反应或画三种轮廓", status: "INFERRED" },
      },
    };
  }
  return {
    title: "先把模糊想法变成一个可验证方向",
    message: `我先按“${question}”理解为一个还在形成中的设计目标。你可以先从三种角度选更接近的一种：要传达一条信息、要塑造一种感受，或要帮助某类人完成一个任务。现在最希望谁在什么情境下看到或使用它？`,
    whyThisStep: "先给出可选择假设，再确认最关键变量，比要求学生从零填写专业简报更容易推进。",
    uncertainty: "通用设计建议：当前只有初步意图，尚未看到作品、内容和媒介条件。",
    sourceIds: [],
    briefPatch: {
      designGoal: { value: question, status: "INFERRED" },
      nextStep: { value: "确认首要受众与使用情境", status: "INFERRED" },
    },
  };
}

function groundedMessage(
  episode: LearningEpisode,
  question: string,
  sourceTitle: string,
  facts: readonly string[],
  actions: readonly string[],
) {
  const factText = joinStatements(facts);
  const actionText = joinStatements(actions);
  const basis = factText ? `课程依据“${sourceTitle}”指出：${factText}。` : "";
  const next = actionText ? `接着按顺序验证：${actionText}。` : "";

  switch (episode) {
    case "EXPLORE":
      return `先围绕“${question}”明确目标、对象和要完成的任务。${basis}${next}`;
    case "UNDERSTAND":
      return `围绕“${question}”，先看清概念之间的因果关系。${basis}${next}`;
    case "BUILD":
      return `围绕“${question}”，不要一次完成全部结果，先按可验证顺序推进。${basis}${next}`;
    case "DEBUG":
      return `先不要整体重做。围绕“${question}”建立可观察证据，记录最先出现异常的位置。${basis}${next}`;
    case "TRANSFER":
      return `围绕“${question}”，先保留已经验证有效的结构和验证方法，再改变问题中的受众、输入或输出。${basis}${next}`;
    case "REFLECT":
      return `要回答“${question}”，请把设计选择、读者或系统的实际观察和你的结论连成证据链。${basis}${next}`;
  }
}

export function buildDeterministicResponse(input: {
  packLabel: string;
  episode: LearningEpisode;
  message: string;
  knowledge: readonly GroundedKnowledge[];
}): DeterministicResponse {
  if (input.packLabel === "通用设计") return generalDesignResponse(input.message);
  const primary = input.knowledge[0];
  if (!primary) {
    const question = compactQuestion(input.message);
    const isBook = input.packLabel.includes("书籍");
    const isAccordionCraft = isBook && /(经折装|裁纸|折页|上胶)/.test(input.message);
    const message = isAccordionCraft
      ? "这类工艺没有一套适用于所有纸张的固定尺寸。先按试作流程推进：①确定闭合成品尺寸、页数和展开方向，用废纸做一比一纸样并标出折线与粘接搭口；②确认纸纹方向后先压痕，再从中间向两侧逐折校正；③用同材质边角料测试胶量和干燥后的翘曲，再薄涂、加压定型。第一步请先告诉我闭合尺寸和计划页数。"
      : input.episode === "DEBUG"
      ? isBook
        ? "先做一次最小阅读测试：让一位目标读者只完成一个找信息任务，记录他先看哪里、停在哪里、是否找错。你现在最想验证的是信息找不到，还是阅读顺序不清楚？"
        : "先沿输入、处理、映射、输出逐段看数值是否变化，一次只断开或替换一段。你目前能确认最后一个仍在变化的环节是哪一段？"
      : input.episode === "BUILD"
        ? isBook
          ? "先做不带精细装饰的纸样或低保真页序：只验证尺寸关系、展开方式、阅读顺序和连接位置，再决定材料与精确工艺。你现在已有成品尺寸或页数限制吗？"
          : "先做一条只有输入、处理和输出的最小结构，确认变化可见后再增加风格和复杂控制。你现在已经有可观察的输入，还是还在选择输入方式？"
        : `我暂时把“${question}”理解为一个${input.packLabel}方向。可以先从目标体验、核心内容或媒介条件三条线中选一条收窄。哪一条最接近你现在卡住的地方？`;
    return {
      title: TITLES[input.episode],
      message,
      whyThisStep: isAccordionCraft
        ? "经折装的尺寸与胶量会随纸张克重、纸纹和结构变化，先做一比一纸样和边角料测试，比套用固定数值更可靠。"
        : input.episode === "DEBUG"
        ? "排障必须先建立可观察证据，避免凭节点名称猜原因。"
        : "先做低成本结构验证，可以让你继续推进，又不把未经核对的课程或软件细节当成事实。",
      uncertainty: "通用设计建议：当前专业资料尚未命中；没有读取学生作品或软件现场。",
      sourceIds: [],
      briefPatch: {},
    };
  }

  return {
    title: TITLES[input.episode],
    message: groundedMessage(
      input.episode,
      compactQuestion(input.message),
      primary.title,
      [firstContentSentence(primary.content), ...primary.facts.slice(0, 2).map(({ text }) => text)],
      primary.actions.slice(0, 2).map(({ text }) => text),
    ),
    whyThisStep: input.episode === "DEBUG"
      ? "排障必须先建立可观察证据，避免凭节点名称猜原因。"
      : "这一步只帮助你形成判断，不替你完成正式作品，也不会改变评价结果。",
    uncertainty: "这条建议基于当前课程包资料和已保存的学习状态；尚未看到你现场工具中的全部参数。",
    sourceIds: [primary.id],
    briefPatch: {},
  };
}
