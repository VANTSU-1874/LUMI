import type { StrictReviewPack } from "@/lib/domain/inspiration-wiki/review-pack-contracts";

type ReviewPackLocalization = {
  title: string;
  workSourceEvidence: string[];
  sourceCopy: Record<string, { label: string; evidenceStatement: string }>;
  mediaAlt: Record<string, string>;
  rightsSummary: Record<string, string>;
  classification: { primary: string; secondary: string[]; sourceTerms: string[] };
  visualSummary: string;
  observations: Record<string, string>;
  duplicateExplanation: string;
  curationRationale: string;
  teachingRationale: string;
  teachingPrompts: string[];
  teachingCautions: string[];
  safetyEvidence: string[];
};

const containsChinese = (value: string) => /[\u3400-\u9fff]/u.test(value);

export function containsUnlocalizedEnglishProse(value: string) {
  const words = value.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  return !containsChinese(value) && words.length >= 4;
}

const taxonomyTerms: Record<string, string> = {
  "art book": "艺术书籍",
  "architectural signage": "建筑标识",
  "black and white": "黑白配色",
  branding: "品牌视觉识别",
  "brand identity": "品牌视觉识别",
  "brand strategy": "品牌策略",
  "book design": "书籍设计",
  "book publishing": "书籍出版",
  collage: "拼贴构成",
  "colour system": "色彩系统",
  "corporate identity": "企业视觉识别",
  "custom typography": "定制字体",
  "custom type": "定制字体",
  digital: "数字媒介",
  "digital print": "数字印刷",
  "display numerals": "展示数字字体",
  "display typography": "展示字体",
  duotone: "双色系统",
  editorial: "编辑设计",
  "editorial design": "编辑设计",
  "environmental graphics": "环境图形",
  exhibition: "展览视觉",
  "exhibition design": "展览设计",
  "exhibition visuals": "展览视觉",
  "geometric typography": "几何字体",
  illustration: "插画",
  "identity system": "视觉识别系统",
  "information design": "信息设计",
  "latin alphabet": "拉丁字母系统",
  "line illustration": "线描插画",
  logo: "标志设计",
  logotype: "文字标志",
  "motion identity": "动态识别",
  museum: "博物馆视觉",
  "museum visual identity": "博物馆视觉识别",
  music: "音乐视觉",
  packaging: "包装设计",
  "packaging design": "包装设计",
  photography: "摄影表达",
  poster: "海报设计",
  posters: "海报设计",
  "poster design": "海报设计",
  print: "印刷设计",
  "print system": "印刷应用系统",
  publication: "出版物设计",
  publishing: "出版设计",
  sans: "无衬线字体",
  signage: "导视设计",
  silkscreen: "丝网印刷",
  spatial: "空间设计",
  "spatial identity": "空间视觉识别",
  typography: "字体与排版",
  "type design": "字体设计",
  "variable wordmark": "可变文字标志",
  "visual identity": "视觉识别",
  "wayfinding": "导视系统",
  "web design": "网页设计",
  wordmark: "文字标志",
};

const sourcePlatforms: Record<string, string> = {
  PINTEREST: "Pinterest 发现入口",
  BEHANCE: "Behance 作者作品页",
  NOTEFOLIO: "Notefolio 作者作品页",
  RECENT_DESIGN: "Recent.design 策展索引",
  BPANDO: "BP&O 设计评论",
  HESIGN: "Hesign 官方设计档案",
  TYPOGRAPHIC_POSTERS: "字体海报策展档案",
  ORIGINAL_PUBLISHER: "原始发布方记录",
  OTHER_PUBLIC_WEB: "其他公开来源",
};

const sourceRoles: Record<string, string> = {
  DISCOVERY_POINTER: "发现入口",
  CREATOR_WORK_PAGE: "创作者作品页",
  CURATORIAL_INDEX: "策展索引",
  ORIGINAL_PUBLISHER_RECORD: "原始发布记录",
  UNVERIFIED: "未知",
};

export const reviewRequirementLabels: Record<string, string> = {
  CONTROLLED_MEDIA_GROUP: "受控图组",
  WORK_SOURCE_MATCH: "作品与原始来源匹配",
  SOURCE_ROLE: "来源角色",
  RIGHTS_EVIDENCE: "权利证据",
  NORMALIZED_CLASSIFICATION: "规范化分类",
  VISUAL_DESCRIPTION: "视觉描述",
  DUPLICATE_RELATIONSHIP: "重复关系",
  CURATION_RECOMMENDATION: "策展建议",
  TEACHING_RECOMMENDATION: "教学建议",
};

export function localizedReviewSourceLabel(platform: string, role: string) {
  return `${sourcePlatforms[platform] ?? "公开来源"} · ${sourceRoles[role] ?? "来源角色未知"}`;
}

const relationshipLabels: Record<string, string> = {
  DISCOVERY_ONLY: "仅用于发现线索",
  DIRECT_CREATOR_PAGE: "创作者直接发布",
  CURATED_CREATOR_RECORD: "策展收录记录",
  ORIGINAL_PUBLISHER_RECORD: "原始发布方记录",
};

const mediaRoleLabels: Record<StrictReviewPack["mediaGroup"][number]["role"], string> = {
  COVER: "主图",
  DETAIL: "细节图",
  PROCESS: "过程图",
  CONTEXT: "情境图",
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function localizeTaxonomyTerm(value: string, fallback = "其他设计要素") {
  if (containsChinese(value)) return value;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (taxonomyTerms[normalized]) return taxonomyTerms[normalized];
  const matched = Object.entries(taxonomyTerms)
    .sort(([left], [right]) => right.length - left.length)
    .find(([term]) => normalized.includes(term));
  return matched?.[1] ?? fallback;
}

function chineseProse(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return containsUnlocalizedEnglishProse(value) ? fallback : value;
}

function localizedGenericTitle(title: string, primary: string) {
  if (containsChinese(title)) return title;
  const byMatch = title.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) return `${byMatch[1]}｜${primary}（设计：${byMatch[2]}）`;
  return `${title}｜${primary}`;
}

function sourceLabel(platform: string, role: string) {
  return localizedReviewSourceLabel(platform, role);
}

function sourceEvidence(pack: StrictReviewPack, source: StrictReviewPack["sources"][number], primary: string) {
  const creator = source.creatorName ?? pack.work.creators.join("、");
  const relation = relationshipLabels[source.creatorRelationship] ?? "作品关系记录";
  return `该来源以“${relation}”记录${creator}与本${primary}项目的关系；来源页署名、策展角色和设计职责已分开保存。`;
}

function rightsSummary(evidence: StrictReviewPack["rightsEvidence"][number]) {
  if (evidence.privateTeacherReviewDecision === "DENY") {
    return "现有材料不允许该素材进入教师私有审核或正式再发布，权利状态保持阻断。";
  }
  if (evidence.privateTeacherReviewDecision === "ALLOW") {
    return "来源条款允许在其限制条件下用于教师私有审核；正式再发布许可仍须独立确认。";
  }
  return "公开来源可用于核验项目与署名关系，但未提供允许复制或正式再发布的独立许可；本地媒体仅限教师私有审核。";
}

function duplicateExplanation(pack: StrictReviewPack) {
  if (pack.duplicateRelationship.status === "VARIANT_OF") return "该候选与已记录项目属于相关变体，具体关联候选已保留；受控图片未被当作独立作品重复入队。";
  if (pack.duplicateRelationship.status === "DUPLICATE_OF") return "该候选与已记录项目构成重复关系，关联候选与媒体指纹已保留供教师复核。";
  return "候选地址、去重指纹与所选媒体哈希未发现跨候选重复；同一作品内的尺寸衍生图已从受控图组中隔离。";
}

function localizeGenericPack(pack: StrictReviewPack): StrictReviewPack {
  const primary = localizeTaxonomyTerm(pack.normalizedClassification.primary, "视觉设计");
  const secondary = unique(pack.normalizedClassification.secondary.map((term) => localizeTaxonomyTerm(term))).slice(0, 8);
  const sourceTerms = unique(pack.normalizedClassification.sourceTerms.map((term) => localizeTaxonomyTerm(term, ""))).filter(Boolean);
  const focus = secondary.length ? secondary.slice(0, 4).join("、") : "构图、层级、色彩与载体应用";
  const creator = pack.work.creators.join("、");
  const title = localizedGenericTitle(pack.work.title, primary);
  const visualFallback = `受控图组呈现该${primary}项目，重点展示${focus}之间的组织关系及其在不同载体中的应用。`;

  return {
    ...pack,
    work: {
      ...pack.work,
      title,
      workSourceMatch: {
        ...pack.work.workSourceMatch,
        evidence: [
          `来源记录将本${primary}项目归于${creator}，作品署名与文章作者或策展角色已分开记录。`,
          "受控图组来自同一项目来源，并以一致的项目名称、视觉元素与应用系统支持作品匹配。",
        ],
      },
    },
    sources: pack.sources.map((source) => ({
      ...source,
      label: chineseProse(source.label, sourceLabel(source.platform, source.role)),
      evidenceStatement: chineseProse(source.evidenceStatement, sourceEvidence(pack, source, primary)),
    })),
    mediaGroup: pack.mediaGroup.map((media, index) => ({
      ...media,
      alt: chineseProse(media.alt, `受控图 ${index + 1}：${primary}${mediaRoleLabels[media.role]}，用于核验${focus}`),
    })),
    rightsEvidence: pack.rightsEvidence.map((evidence) => ({
      ...evidence,
      summary: chineseProse(evidence.summary, rightsSummary(evidence)),
    })),
    normalizedClassification: {
      primary,
      secondary: secondary.length ? secondary : ["其他设计要素"],
      sourceTerms,
    },
    visualDescription: {
      summary: chineseProse(pack.visualDescription.summary, visualFallback),
      observations: pack.visualDescription.observations.map((observation, index) => ({
        ...observation,
        observation: chineseProse(observation.observation, `受控图显示${secondary[index % Math.max(secondary.length, 1)] ?? primary}的视觉特征，可用于核验构图层级与载体应用。`),
      })),
    },
    duplicateRelationship: {
      ...pack.duplicateRelationship,
      explanation: chineseProse(pack.duplicateRelationship.explanation, duplicateExplanation(pack)),
    },
    curationRecommendation: {
      ...pack.curationRecommendation,
      rationale: chineseProse(pack.curationRecommendation.rationale, pack.curationRecommendation.recommendation === "RECOMMEND"
        ? `该案例能够清楚呈现${primary}中的${focus}，适合纳入教师私有策展判断。`
        : `该案例与当前策展目标的关联有限，建议教师结合受控图组决定是否纳入。`),
    },
    teachingRecommendation: {
      ...pack.teachingRecommendation,
      rationale: chineseProse(pack.teachingRecommendation.rationale, `适合用于分析${primary}如何组织${focus}，并比较视觉规则在不同应用场景中的变化。`),
      prompts: pack.teachingRecommendation.prompts.map((prompt, index) => chineseProse(prompt, index === 0
        ? `画面中的哪些${focus}建立了统一识别？`
        : `当载体或观看距离变化时，这套${primary}系统应保留哪些核心规则？`)),
      cautions: pack.teachingRecommendation.cautions.map((caution) => chineseProse(caution, "只依据受控图陈述可见设计事实，不推断实际成效、人物身份或正式授权。")),
    },
    safetyAssessment: {
      ...pack.safetyAssessment,
      evidence: pack.safetyAssessment.evidence.map((evidence) => chineseProse(evidence, "受控媒体已限制在教师私有审核范围；学生展示、正式发布与 Lumi 引用继续关闭。")),
    },
  };
}

const localizations: Record<string, ReviewPackLocalization> = {
  "review-pack:bpando-kanal-base-design-001": {
    title: "Kanal｜布鲁塞尔博物馆视觉识别（设计：Base Design）",
    workSourceEvidence: [
      "BP&O 的项目文章将 Kanal 布鲁塞尔博物馆视觉识别明确归于 Base Design；文章作者与设计团队已分开记录。",
      "所选受控图来自同一文章，并同时呈现 Kanal 文字标志、压缩展示字体、层叠数字与紫绿虹彩处理，能够闭合同一识别系统。",
    ],
    sourceCopy: {
      "bpando-kanal-base-design": {
        label: "BP&O 编辑评述页",
        evidenceStatement: "文章标题将 Kanal 博物馆品牌设计署名给 Base Design；文章作者署名与设计团队已分开保留。",
      },
    },
    mediaAlt: {
      "media-type-system": "Kanal 字体系统对照图：左侧为虹彩压缩字标，右侧为层叠黑色数字与延展字体",
    },
    rightsSummary: {
      "rights-bpando-kanal-source-boundary": "公开文章可以支持项目署名与编辑语境，但现有材料中没有 BP&O、Base Design、Kanal 或图像权利人授予复制及再发布许可；该图仅限教师私有审核。",
    },
    classification: {
      primary: "博物馆视觉识别",
      secondary: ["定制字体", "可变文字标志", "展示数字字体", "印刷应用系统"],
      sourceTerms: ["品牌视觉识别", "字体与排版", "印刷设计", "空间设计"],
    },
    visualSummary: "Kanal 以压缩黑色字标、横向拉伸字形、密集层叠数字和紫绿虹彩色域形成对比，展示同一字体系统如何通过形变与尺度变化保持关联。",
    observations: {
      "media-type-system": "左侧面板把纵向压缩的白色字标置于紫绿反光表面；右侧以粗黑数字叠加细长字体和大号 Kanal 字样，通过字重、字宽与遮挡建立对照。",
    },
    duplicateExplanation: "该候选及其项目地址未与既有审核包重复；所选图片归属于本候选，并已排除重复海报拼图、站内广告和含人物场景。",
    curationRationale: "单张对照图能够集中呈现文化机构识别中压缩、延展和层叠三种字体处理，不依赖装饰性标志也能形成系统。",
    teachingRationale: "适合讨论受控形变、遮挡和字宽对比如何建立字体家族，同时保留机构名称的识别度。",
    teachingPrompts: [
      "两块画面配色不同，哪些重复比例与字形行为仍让它们属于同一系统？",
      "实验性字体处理与 Kanal 名称的可辨识度之间如何取得平衡？",
    ],
    teachingCautions: [
      "当前只选取一张受控静态图，不能据此证明动态表现、导视行为或完整传播范围。",
      "公开文章与图像不构成正式再发布许可。",
    ],
    safetyEvidence: [
      "受控媒体仅包含字体与印刷画面，已排除站内广告、可识别人物和含肖像的海报拼图。",
      "权利状态保持未知，学生展示、正式发布、页面生成、对象存储、向量索引与 Lumi 引用继续关闭。",
    ],
  },
  "review-pack:bpando-hotdog-smlxl-001": {
    title: "HotDog 宠物护理品牌视觉识别｜SMLXL",
    workSourceEvidence: [
      "BP&O 的项目文章将 HotDog 宠物护理品牌识别明确归于 SMLXL；文章作者与设计团队已分开记录。",
      "所选 4 张文章图片均出现同一套粗黑 HotDog 字标、松散线描插画、圆形侧面符号和品牌封箱胶带；未使用生活方式摄影。",
    ],
    sourceCopy: {
      "bpando-hotdog-smlxl": {
        label: "BP&O 编辑评述页",
        evidenceStatement: "文章标题明确将 HotDog 宠物护理品牌设计署名给 SMLXL；文章作者署名与设计团队已分开保留。",
      },
    },
    mediaAlt: {
      "media-wordmark": "超大黑色 HotDog 字标覆盖在密集、松散的黑色线描插画上",
      "media-illustration": "浅色背景上的黄色斑点站立形象，以断续的蜡笔式笔触绘制",
      "media-symbol": "由宽阔曲面和一个眼睛圆点构成的黑色圆形侧面轮廓符号",
      "media-packaging": "纸箱使用 HotDog 插画胶带封装，旁边堆叠红、白、黄三色产品碗",
    },
    rightsSummary: {
      "rights-bpando-hotdog-source-boundary": "公开文章能够支持项目与创作者署名关系，但现有记录中没有品牌方、设计团队或图像权利人授予复制及再发布许可。本批素材仅限教师私有审核。",
    },
    classification: {
      primary: "宠物护理品牌视觉识别",
      secondary: ["粗重字标", "松散线描插画", "侧面轮廓符号", "运输包装"],
      sourceTerms: ["品牌设计", "字体设计", "包装设计", "插画"],
    },
    visualSummary: "HotDog 将粗重的黑色字标、带刮擦感且刻意稚拙的线描插画，与简洁的圆形侧面轮廓符号组合；同一套非正式视觉语言延展到文具、封箱胶带和产品图像。",
    observations: {
      "media-wordmark": "封面把超大黑色 HotDog 字标叠加在密集黑色线描上，并利用字母内部的负形露出部分插画。",
      "media-illustration": "黄色斑点站立形象以断续的蜡笔式笔触绘制在浅色背景上，呈现该识别系统刻意保留的不均匀插画肌理。",
      "media-symbol": "圆形黑色侧面轮廓符号把形象压缩为两块大曲面和一个眼睛圆点，置于灰白背景上。",
      "media-packaging": "棕色纸箱使用窄白色胶带封装，胶带重复黑色字标与微型线描；相邻产品碗以高饱和红、白、黄圆环形成对比。",
    },
    duplicateExplanation: "既有审核包与策展包中没有相同候选或相同项目地址；所选图片哈希均唯一，并已排除含人物、社交媒体界面及站内广告的图片。",
    curationRationale: "该项目清楚展示了看似随性的插画语言，如何通过粗重字标、受限色板和可重复包装图案形成稳定系统。",
    teachingRationale: "适合讨论视觉上的“松散”如何仍通过笔触特征、尺度、重复与应用规则被系统化。",
    teachingPrompts: [
      "即使插画主题与颜色发生变化，哪些反复出现的特征仍让它们看起来属于同一系列？",
      "粗重字标如何稳定更不规则的插画语言？",
    ],
    teachingCautions: [
      "所选图形只作为可见的设计证据审核，不能证明产品质量或宠物护理功效。",
      "生活方式与社交媒体图片已排除；公开访问文章不等于获得再发布许可。",
    ],
    safetyEvidence: [
      "受控媒体只包含品牌图形、插画、纸箱和产品碗，已排除人物、站内广告与社交界面。",
      "权利状态仍为未知，学生展示、发布和检索能力均保持关闭。",
    ],
  },
};

export function localizedReviewPackTitle(reviewPackId: string, fallback: string) {
  const exact = localizations[reviewPackId]?.title;
  if (exact) return exact;
  if (containsChinese(fallback)) return fallback;
  const byMatch = fallback.match(/^(.+?)\s+by\s+(.+)$/i);
  return byMatch ? `${byMatch[1]}｜设计：${byMatch[2]}` : fallback;
}

export function localizedSourceSummary(summary: string | null | undefined) {
  if (!summary) return "来源摘要未知";
  if (containsChinese(summary)) return summary;
  const [platform = "", role = ""] = summary.split(/\s*[·/]\s*/);
  const platformLabel = Object.entries(sourcePlatforms).find(([key]) => platform.toUpperCase().replace(/[^A-Z]/g, "").includes(key.replace(/_/g, "")))?.[1]
    ?? (platform.trim() || "公开来源");
  const roleLabel = sourceRoles[role.trim()] ?? relationshipLabels[role.trim()] ?? "来源关系已记录";
  return `${platformLabel} · ${roleLabel}`;
}

export function localizeReviewPackForTeacher(pack: StrictReviewPack): StrictReviewPack {
  const generic = localizeGenericPack(pack);
  const copy = localizations[pack.reviewPackId];
  if (!copy) return generic;
  return {
    ...generic,
    work: {
      ...generic.work,
      title: copy.title,
      workSourceMatch: { ...generic.work.workSourceMatch, evidence: copy.workSourceEvidence },
    },
    sources: generic.sources.map((source) => ({ ...source, ...(copy.sourceCopy[source.sourceId] ?? {}) })),
    mediaGroup: generic.mediaGroup.map((media) => ({ ...media, alt: copy.mediaAlt[media.mediaId] ?? media.alt })),
    rightsEvidence: generic.rightsEvidence.map((evidence) => ({
      ...evidence,
      summary: copy.rightsSummary[evidence.evidenceId] ?? evidence.summary,
    })),
    normalizedClassification: copy.classification,
    visualDescription: {
      summary: copy.visualSummary,
      observations: generic.visualDescription.observations.map((observation) => ({
        ...observation,
        observation: observation.mediaIds.map((mediaId) => copy.observations[mediaId]).find(Boolean) ?? observation.observation,
      })),
    },
    duplicateRelationship: { ...generic.duplicateRelationship, explanation: copy.duplicateExplanation },
    curationRecommendation: { ...generic.curationRecommendation, rationale: copy.curationRationale },
    teachingRecommendation: {
      ...generic.teachingRecommendation,
      rationale: copy.teachingRationale,
      prompts: copy.teachingPrompts,
      cautions: copy.teachingCautions,
    },
    safetyAssessment: { ...generic.safetyAssessment, evidence: copy.safetyEvidence },
  };
}

export function localizedMediaRole(role: StrictReviewPack["mediaGroup"][number]["role"]) {
  return mediaRoleLabels[role];
}

export function localizedSourceRole(role: string) {
  return sourceRoles[role] ?? "来源角色未知";
}
