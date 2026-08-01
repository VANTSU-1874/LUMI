import {
  PROJECT_BRIEF_FIELD_IDS,
  ProjectBriefPatchSchema,
  type ProjectBrief,
  type ProjectBriefFieldId,
  type ProjectBriefPatch,
} from "./project-brief-memory";

const FIELD_SIGNALS: Record<ProjectBriefFieldId, RegExp> = {
  designGoal: /(我要.{0,16}(做|建立|设计)|我想.{0,16}(做|建立|设计)|^(?:为|给).{0,30}(?:做|设计|制作|建立)|项目目标|设计目标|目标是)/,
  audienceAndContext: /(主要给|面向|受众|给.{0,12}(看|使用|体验)|使用场景|应用场景|情境)/,
  coreContent: /(核心内容|核心信息|核心主题|要传达|希望.{0,16}(愿意|理解|记住)|主题是)/,
  visualExperienceDirection: /(视觉|颜色|色彩|字体|风格|手工痕迹|标题层级|构图|活泼|轮廓|气质|氛围|方向)/,
  mediumConstraints: /(媒介|使用场景|海报|导视|封面|预算|印刷|工艺|尺寸|材料|设备|技术条件|限制)/,
  processPlan: /(制作顺序|制作流程|工作流程|第一轮|准备先|先做|顺序.{0,8}(排|安排)|保持.{0,8}(系统|一致)|先只)/,
  successCriteria: /(指标|判断.{0,16}(看懂|有效|成功)|测试|验证|反馈|是否有效)/,
  nextStep: /(下一步|现在最适合|立即|第一轮|准备先|先做|先只|只调整)/,
};

const FIRST_PERSON_DECISION = /^(?:(?:那|现在|这次|所以|于是)我|我)(?:确认|确定|决定|选择|采用|就用)|^(?:(?:那|现在|这次|所以|于是)我|我)(?:要|想)?(?:把|将).{0,24}(?:改成|改为|调整为)/;
const STUDENT_STATEMENT_SIGNAL = /^(?:我(?:要|想|准备|打算|会|先|希望|把|将)|(?:为|给).{0,30}(?:做|设计|制作|建立)|(?:这个|本)(?:项目|作品)|项目目标|设计目标|目标是|主要给|面向|受众|使用场景|应用场景|核心内容|核心信息|核心主题|主题是|视觉方向|颜色|色彩|字体|风格|构图|气质|氛围|媒介|预算|尺寸|材料|设备|技术条件|限制|制作顺序|制作流程|工作流程|第一轮|先做|先只|指标|判断标准|成功标准|下一步|现在先|立即|只调整)/;
const REPORTED_SIGNAL = /(说|觉得|认为|反馈|建议|要求|提到)/;
const UNCERTAIN_SIGNAL = /(看起来|似乎|好像|可能|也许|不确定|差不多)/;

type MessageClause = { text: string; inferred: boolean; reported: boolean };

function messageClauses(value: string): MessageClause[] {
  const chunks = value.match(/[^，,。；;！？!?]+[，,。；;！？!?]?/g) ?? [value];
  let reportedContext = false;
  return chunks.flatMap((raw) => {
    const delimiter = raw.match(/[，,。；;！？!?]$/)?.[0] ?? "";
    const text = raw.replace(/[，,。；;！？!?]$/, "").trim();
    if (!text) return [];
    const directReported = REPORTED_SIGNAL.test(text);
    const reported = directReported || (reportedContext && !FIRST_PERSON_DECISION.test(text));
    const inferred = reported || UNCERTAIN_SIGNAL.test(text)
      || /^(帮我|怎样|怎么|如何|什么|哪些|现在最适合)/.test(text)
      || /[？?]/.test(delimiter)
      || !(FIRST_PERSON_DECISION.test(text) || STUDENT_STATEMENT_SIGNAL.test(text));
    reportedContext = /[，,]/.test(delimiter) ? reported : false;
    return [{ text, inferred, reported }];
  });
}

function updateForField(clauses: MessageClause[], fieldId: ProjectBriefFieldId) {
  const relevant = clauses.filter(({ text }) => FIELD_SIGNALS[fieldId].test(text));
  if (relevant.length === 0) return undefined;
  const confirmed = relevant.filter(({ inferred }) => !inferred);
  const selected = confirmed.length > 0 ? confirmed : relevant;
  return {
    value: selected.map(({ text }) => text).join(";").slice(0, 500),
    status: confirmed.length === 0 ? "INFERRED" as const : "CONFIRMED" as const,
  };
}

function explicitlyRevisesConfirmedField(value: string, fieldId: ProjectBriefFieldId) {
  return messageClauses(value).some(({ text, reported }) =>
    !reported && FIRST_PERSON_DECISION.test(text) && FIELD_SIGNALS[fieldId].test(text));
}

export function deriveProjectBriefPatch(message: string): ProjectBriefPatch {
  const value = message.normalize("NFKC").trim();
  if (!value || /(前面|之前|已经).{0,12}(确认|说过).{0,12}(是什么|哪些)|总结.{0,12}(当前|前面|项目)|回顾.{0,12}(当前|前面)/.test(value)) {
    return {};
  }
  const clauses = messageClauses(value);
  const patch: ProjectBriefPatch = {};
  for (const fieldId of PROJECT_BRIEF_FIELD_IDS) {
    if (fieldId === "designGoal" && /不要.{0,8}(改变|修改).{0,8}(目标|方向)/.test(value)) continue;
    const fieldUpdate = updateForField(clauses, fieldId);
    if (fieldUpdate) patch[fieldId] = fieldUpdate;
  }
  return ProjectBriefPatchSchema.parse(patch);
}

export function enrichProjectBriefPatch(message: string, modelPatch: ProjectBriefPatch, currentBrief?: ProjectBrief) {
  const explicitPatch = deriveProjectBriefPatch(message);
  const protectedPatch = Object.fromEntries(PROJECT_BRIEF_FIELD_IDS.flatMap((fieldId) => {
    const explicitUpdate = explicitPatch[fieldId];
    const modelUpdate = modelPatch[fieldId];
    const update = explicitUpdate ?? modelUpdate;
    if (!update) return [];
    if (currentBrief?.fields[fieldId]?.status !== "CONFIRMED") return [[fieldId, update]];
    if (!explicitUpdate) return [];
    if (!explicitlyRevisesConfirmedField(message, fieldId)) {
      return [[fieldId, { ...explicitUpdate, status: "INFERRED" as const }]];
    }
    return [[fieldId, explicitUpdate]];
  }));
  return ProjectBriefPatchSchema.parse(protectedPatch);
}
