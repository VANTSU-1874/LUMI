function isVagueDesignIntent(message: string) {
  return /((我|自己|但).{0,3}不知道|没想好|差不多|酷一点|更有感觉|有感觉)/.test(message);
}

function isCharacterDesignRequest(message: string) {
  return /(IP|角色形象|人物形象|角色设计|设计.{0,4}角色)/i.test(message);
}

function isAudioValueWithoutVisualMotion(message: string) {
  return /声音.{0,12}数值/.test(message)
    && /(画面|视觉)/.test(message)
    && /(不动|没动|没有动|没反应|无反应)/.test(message);
}

export function modelTurnRequirements(message: string) {
  const normalized = message.normalize("NFKC");
  return [
    isVagueDesignIntent(normalized)
      ? "先给2到3个具体、互相可区分的暂时假设或选项，再只追问一个最关键的选择。"
      : null,
    isCharacterDesignRequest(normalized)
      ? "IP或角色起步回答必须同时提出受众或使用场景、性格、视觉母题和可立即执行的第一步，再只追问一个关键选择。"
      : null,
    /(如何|怎么|怎样|第一步|从哪里开始)/.test(normalized)
      ? "直接给出一项可以立即执行并观察结果的最小步骤，不只解释原则。"
      : null,
    isAudioValueWithoutVisualMotion(normalized)
      ? "声音已有数值但视觉不动时，排障必须明确检查处理后数值范围或Math映射，再检查Null与视觉参数引用；先给最小可观察步骤。"
      : null,
  ].filter((item): item is string => item !== null);
}

export function limitLearnerQuestions(message: string) {
  let questionIndex = 0;
  return message.replace(/[？?]/g, (mark) => {
    questionIndex += 1;
    return questionIndex === 1 ? mark : "（先作为暂时假设，后续再确认）。";
  }).trim();
}

export function limitLearnerQuestionsAcross(values: readonly string[]) {
  let questionIndex = 0;
  return values.map((value) => value.replace(/[？?]/g, (mark) => {
    questionIndex += 1;
    return questionIndex === 1 ? mark : "（先作为暂时假设，后续再确认）。";
  }).trim());
}

export function assertAtMostOneLearnerQuestion(message: string) {
  if ((message.match(/[？?]/g)?.length ?? 0) > 1) {
    throw new Error("MODEL_TOO_MANY_QUESTIONS");
  }
}

function includesOneOf(text: string, terms: readonly string[]) {
  return terms.some((term) => text.includes(term));
}

export function assertTurnRequirementCoverage(question: string, answer: string) {
  const normalizedQuestion = question.normalize("NFKC");
  const normalizedAnswer = answer.normalize("NFKC");
  const missing: string[] = [];
  if (isVagueDesignIntent(normalizedQuestion)) {
    if (!includesOneOf(normalizedAnswer, ["选择", "可选", "方向", "假设", "更接近", "两个", "三个", "两种", "三种"])) {
      missing.push("可选择假设");
    }
  }
  if (/(第一步|从哪里开始)/.test(normalizedQuestion)) {
    if (!includesOneOf(normalizedAnswer, ["第一步", "先做", "立即", "草图", "小实验", "试作", "测试", "开始制作"])) {
      missing.push("可执行第一步");
    }
  }
  if (isCharacterDesignRequest(normalizedQuestion)) {
    if (!includesOneOf(normalizedAnswer, ["受众", "使用场景", "用途", "给谁", "哪一类人", "面向"])) missing.push("受众与场景");
    if (!includesOneOf(normalizedAnswer, ["性格", "脾气", "行为反应", "角色特征"])) missing.push("性格");
    if (!includesOneOf(normalizedAnswer, ["视觉母题", "造型母题", "母题", "轮廓", "形态元素", "象征元素"])) missing.push("视觉母题");
    if (!includesOneOf(normalizedAnswer, ["第一步", "立即执行", "先画", "草图", "先写"])) missing.push("第一步");
  }
  if (/信息.{0,8}(一样大|同样大|平均)/.test(normalizedQuestion)) {
    if (!includesOneOf(normalizedAnswer, ["阅读", "读者", "优先", "路径", "重点", "必读"])) missing.push("阅读优先关系");
  }
  if (/(证据|证明)/.test(normalizedQuestion) && !includesOneOf(normalizedAnswer, ["证据", "记录", "测试结果", "前后对比"])) {
    missing.push("证据链");
  }
  if (isAudioValueWithoutVisualMotion(normalizedQuestion)) {
    if (!includesOneOf(normalizedAnswer, ["Math", "数值范围", "范围", "映射"])) missing.push("数值范围或映射");
    if (!includesOneOf(normalizedAnswer, ["Null", "视觉参数", "参数引用", "引用路径", "参数绑定"])) missing.push("视觉参数引用");
  }
  if (missing.length > 0) {
    throw new Error(`MODEL_TURN_REQUIREMENT_MISSING:${missing.join(",")}`);
  }
}
