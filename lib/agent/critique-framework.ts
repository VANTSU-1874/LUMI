import {
  CRITIQUE_DIMENSION_IDS,
  CRITIQUE_FRAMEWORK_ID,
  CRITIQUE_FRAMEWORK_VERSION,
  type CritiqueDimensionId,
} from "./critique-contract";

export type CritiqueGuidanceExamples = {
  question: string;
  hint: string;
  demonstration: string;
};

export type CritiqueDimensionConfiguration = {
  id: CritiqueDimensionId;
  label: string;
  displayOrder: 1 | 2 | 3 | 4 | 5;
  checks: readonly string[];
  evidenceRequirements: readonly string[];
  examples: CritiqueGuidanceExamples;
};

export type CritiqueFrameworkConfiguration = {
  frameworkId: typeof CRITIQUE_FRAMEWORK_ID;
  frameworkVersion: typeof CRITIQUE_FRAMEWORK_VERSION;
  courseId: string;
  courseLabel: string;
  dimensions: readonly CritiqueDimensionConfiguration[];
  closure: {
    required: true;
    established: string;
    nextStep: string;
    historyReference: string;
  };
};

const labels: Record<CritiqueDimensionId, string> = {
  goal: "目标",
  translation: "创意转译",
  structure_hierarchy: "构成与层级",
  formal_language: "形式语言",
  craft_standards: "工艺与规范",
};

const sharedEvidence = [
  "判断只能来自作品中静态可见的事实、学生本轮明确自述的意图，或服务端提供的可核对历史记录。",
  "证据不足时明确写 NEEDS_EVIDENCE，不从静态图推断动态、材质、交互效果或实际尺寸可读性。",
] as const;

const genericExamples: Record<CritiqueDimensionId, CritiqueGuidanceExamples> = {
  goal: {
    question: "这件作品最希望谁在什么场景先理解什么？这个条件会改变后面的判断。",
    hint: "先把目标压成‘谁在什么场景，需要先理解什么’，再核对作品入口是否支持它。",
    demonstration: "可以先写一个只包含受众、场景和首要信息的目标句；请换成你的项目，并指出哪一项还缺证据。",
  },
  translation: {
    question: "你最想转译的抽象意思是什么，当前哪一个形式关系在承担它？",
    hint: "先选一个主策略承载核心意思，其他形式手段暂时为它让位。",
    demonstration: "可以用一个可观察的形式变化对应一个抽象关系；请迁移到自己的方案，并解释为什么贴切。",
  },
  structure_hierarchy: {
    question: "你预设观众先看哪里、再看哪里？请只说前三步。",
    hint: "先只调整视觉重量、对齐或距离中的一种，检查主次是否更清楚。",
    demonstration: "可以先用灰块排出第一、第二、第三层；请缩小作品后复述阅读顺序是否仍成立。",
  },
  formal_language: {
    question: "你希望第一感受是什么？当前哪一种形式选择最能承担它？",
    hint: "先保留一种主强调方式，让字体、色彩、图形和质感服务同一气质。",
    demonstration: "可以让一个形式规则承担表达、其他元素负责配合；请指出这条规则为何服务目标。",
  },
  craft_standards: {
    question: "最终媒介、尺寸和观看条件是什么？缺少这些条件时只能判断相对关系。",
    hint: "先把交付条件列成可核对项，只检查当前最影响呈现的一项。",
    demonstration: "可以按尺寸、清晰度、安全区和输出方式逐项记录证据；请解释哪一项必须先解决。",
  },
};

function genericDimensions(): CritiqueDimensionConfiguration[] {
  return CRITIQUE_DIMENSION_IDS.map((id, index) => ({
    id,
    label: labels[id],
    displayOrder: (index + 1) as 1 | 2 | 3 | 4 | 5,
    checks: [`检查“${labels[id]}”是否成立、是否服务于学生明确的设计目标。`],
    evidenceRequirements: sharedEvidence,
    examples: genericExamples[id],
  }));
}

const digitalInteractionDimensions: CritiqueDimensionConfiguration[] = [
  {
    id: "goal", label: labels.goal, displayOrder: 1,
    checks: [
      "学生能否说清想让谁、在什么场景，通过互动理解或感受什么。",
      "文化内容是否是核心信息，而非贴在视觉效果表层的符号。",
      "单人或多人、驻足或经过、展厅或走廊等条件是否支持预期体验。",
    ],
    evidenceRequirements: [...sharedEvidence, "至少需要方案说明和关键状态图；仅有视觉效果图时不推断互动含义。"],
    examples: {
      question: "观众结束互动后，你最希望他带走哪一层信息？作品放在哪里、观众大约停留多久会改变后面的判断。",
      hint: "先写成一句‘谁在什么场景，通过什么动作感到什么’，再找当前作品中支持这句话的证据。",
      demonstration: "可暂写为‘让经过走廊的人因靠近而看见被忽略的纹样’；请换成自己的方案，并指出哪一项还没有证据。",
    },
  },
  {
    id: "translation", label: labels.translation, displayOrder: 2,
    checks: [
      "参与行为、输入信号、判断与映射、输出媒介、体验反馈能否形成可解释的链。",
      "观众动作是否成为意义载体，而不只是触发炫技效果。",
      "文化意图是否由整条互动链承载，而非只靠说明文字补充。",
    ],
    evidenceRequirements: [...sharedEvidence, "需要连续状态、短视频或学生明确说明才能判断输入到输出的映射关系。"],
    examples: {
      question: "你选这个动作，是因为它能表达主题，还是只是最方便的输入？动作意义会决定后面的映射。",
      hint: "先写出‘输入→判断与映射→输出’，再补一句观众怎样知道自己的动作产生了结果。",
      demonstration: "可暂写为‘距离缩短→纹样连续变清晰→观众意识到靠近让细节被看见’；请换成自己的文化意图并解释为何贴切。",
    },
  },
  {
    id: "structure_hierarchy", label: labels.structure_hierarchy, displayOrder: 3,
    checks: [
      "待机、发现、触发、反馈和回到待机等状态是否可区分。",
      "每个状态先看哪里、再看哪里，主题信息是否被动效或装饰抢走。",
      "时间顺序是否帮助组织信息，关键变化是否同时发生过多。",
    ],
    evidenceRequirements: [...sharedEvidence, "静态截图不足以判断时序时，需要连续状态图或短视频。"],
    examples: {
      question: "你希望观众进入后的前三秒按什么顺序看到内容？请先说第一眼、第二眼和互动后。",
      hint: "先关掉一组效果，只保留一个视觉入口和一个互动提示，观察动线是否稳定。",
      demonstration: "可拆成待机主视觉与轻提示、触发后主视觉先变化、稳定后再出现说明；请排三张状态图并指出核心信息。",
    },
  },
  {
    id: "formal_language", label: labels.formal_language, displayOrder: 4,
    checks: [
      "构图、色彩、字体、图形、动效与声音是否共同服务目标气质。",
      "运动方式是否有语义，而非所有元素都使用同一种随机变化。",
      "文化视觉资源是否经过转译，避免符号堆叠。",
    ],
    evidenceRequirements: [...sharedEvidence, "缺少声音或运动证据时，不从静态图臆测。"],
    examples: {
      question: "你希望它更庄重、亲近还是有实验感？先选最重要的一个词，再核对形式是否朝同一方向用力。",
      hint: "先只调整运动节奏，看看不换素材能否让纹样、字体与技术表现的气质统一。",
      demonstration: "若目标是克制而有仪式感，可让纹样缓慢显影、标题只在关键节点出现；请说明谁承载目标、谁只是配合。",
    },
  },
  {
    id: "craft_standards", label: labels.craft_standards, displayOrder: 5,
    checks: [
      "屏幕比例、分辨率、帧率和文字尺寸是否适配现场设备。",
      "传感范围、反馈延迟、多人干扰和回到待机条件是否验证。",
      "布线、声音、光照与设备摆位是否可实现且安全。",
    ],
    evidenceRequirements: [...sharedEvidence, "具体节点、参数或报错原因必须转交证据式排错，不在五维里猜测。"],
    examples: {
      question: "最终使用什么屏幕和输入设备，观众离它多远？没有这些条件不能判断字号和触发范围。",
      hint: "先把首次反馈多久可感知、无人时怎样复位写成可测试现象。",
      demonstration: "可先测范围内可触发、首次反馈可感知、连续触发不丢失、无人后回待机；请按设备实测并解释最影响体验的一项。",
    },
  },
];

const bookDesignDimensions: CritiqueDimensionConfiguration[] = [
  {
    id: "goal", label: labels.goal, displayOrder: 1,
    checks: ["核心信息、阅读目的和语气是否明确。", "读者是谁，在纸面、展板或屏幕的什么场景阅读。", "标题、正文、图像和行动信息是否服务同一阅读任务。"],
    evidenceRequirements: [...sharedEvidence, "没有成品尺寸或展示情境时，只评价相对关系，不断言实际可读性。"],
    examples: {
      question: "读者在这个场景里只有多久？他最先必须明白哪一句，随后要继续读什么或做什么？",
      hint: "先写下‘谁在什么场景需要先读到什么’，再判断标题、图片和说明有没有抢错注意力。",
      demonstration: "若是走廊活动海报，可先定‘两米看主题，一米看时间地点，靠近读说明’；请用自己的场景改写并指出哪层不成立。",
    },
  },
  {
    id: "translation", label: labels.translation, displayOrder: 2,
    checks: ["内容逻辑是否转成可见版面结构，而非表面装饰。", "对比、网格、图文关系与留白节奏中，哪一种策略承担核心意思。", "版面策略是否贴合内容语气并能在不同页面或尺寸延续。"],
    evidenceRequirements: [...sharedEvidence, "形式变化要有内容依据，学生应能说明为何使用这一策略。"],
    examples: {
      question: "内容最关键的关系是冲突、并列、递进还是节奏变化？你准备用什么版面办法让它可见？",
      hint: "先选一个主策略承载内容逻辑，例如网格表现秩序或强对比表现冲突，其他手段先为它让位。",
      demonstration: "若内容是传统与当代并置，可用同一网格容纳两类材料，再用图文比例制造差异；请画灰块草图并区分内容关系与装饰。",
    },
  },
  {
    id: "structure_hierarchy", label: labels.structure_hierarchy, displayOrder: 3,
    checks: ["标题、副标题、正文、注释等层级能否稳定区分。", "对齐、间距、分栏与网格是否建立清楚关系。", "图片与文字先后是否有意安排，留白是否帮助分组与停顿。"],
    evidenceRequirements: [...sharedEvidence, "层级判断需要完整页面；局部截图不能代替整页动线。"],
    examples: {
      question: "你预设的阅读顺序是什么？请只说前三步，再按顺序检查对齐、距离和视觉重量。",
      hint: "先只调整组间距，不改字体，看看标题、主图、正文和时间的分组是否清楚。",
      demonstration: "可建立标题/正文左边线、主图边界线和时间信息起点线，再用组内小间距、组间大间距；请缩小页面复述前三步。",
    },
  },
  {
    id: "formal_language", label: labels.formal_language, displayOrder: 4,
    checks: ["字体、字重、字号、行距、色彩和图像风格是否支持同一目标气质。", "字体种类与强调手段是否克制，重复规则是否形成统一性。", "留白、比例、节奏与对比是否有目的。"],
    evidenceRequirements: [...sharedEvidence, "涉及字体授权时不作无证据判断，只提示核对来源。"],
    examples: {
      question: "你希望第一感受是理性秩序、轻松亲近还是强烈实验？现在什么形式选择最能承担它？",
      hint: "先保留一种主强调，让颜色、描边、倾斜和字体变化中的其余手段回到基础状态。",
      demonstration: "若目标是理性秩序，可让网格和字号对比承担表现、色彩只负责一个重点；请指出哪条规则会在下一页重复及其理由。",
    },
  },
  {
    id: "craft_standards", label: labels.craft_standards, displayOrder: 5,
    checks: ["成品尺寸、出血、安全区、折页或装订位置是否明确。", "图片分辨率、色彩模式、字体与链接资源是否按输出方式检查。", "数字发布是否检查目标像素尺寸、屏幕比例与压缩清晰度。"],
    evidenceRequirements: [...sharedEvidence, "具体软件故障必须转入证据式排错。"],
    examples: {
      question: "最终要印刷、屏幕发布还是两者都要？先确认交付方式，才能判断哪些规范必须检查。",
      hint: "先显示成品线、出血线和安全区，只检查关键信息是否越界。",
      demonstration: "印刷稿可先查尺寸出血、图片有效分辨率、色彩模式、字体与链接；请逐项写已确认/待确认及证据，并解释先解决哪项。",
    },
  },
];

function framework(courseId: string, courseLabel: string, dimensions: CritiqueDimensionConfiguration[]): CritiqueFrameworkConfiguration {
  return Object.freeze({
    frameworkId: CRITIQUE_FRAMEWORK_ID,
    frameworkVersion: CRITIQUE_FRAMEWORK_VERSION,
    courseId,
    courseLabel,
    dimensions: Object.freeze(dimensions),
    closure: Object.freeze({
      required: true as const,
      established: "只指出一项有画面、学生自述或已绑定历史记录支持的有效选择。",
      nextStep: "只选当前最影响目标的一处，形成可比较的小改动。",
      historyReference: "仅在服务端找到同一学生、班级、课程与数据类型的真实上一条会诊时填写。",
    }),
  });
}

const frameworks = new Map<string, CritiqueFrameworkConfiguration>([
  ["general-design", framework("general-design", "通用设计", genericDimensions())],
  ["digital-interaction", framework("digital-interaction", "数字交互文创设计", digitalInteractionDimensions)],
  ["book-design", framework("book-design", "书籍设计", bookDesignDimensions)],
]);

export function getCritiqueFramework(courseId: string) {
  return frameworks.get(courseId) ?? null;
}

export function listCritiqueFrameworks() {
  return Object.freeze([...frameworks.values()]);
}

