import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";
import { z } from "zod";

import { createDb } from "../lib/db/client";
import { runMigrations } from "../lib/db/migrate";
import {
  EvidenceGapReviewPackSchema,
  evidenceGapRequirementKeys,
  evidenceGapVerifiedCount,
  type EvidenceGapReviewPack,
} from "../lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import {
  calculateEvidenceGapReviewMaterialHash,
  reviseEvidenceGapReviewPackAnalysis,
} from "../lib/services/inspiration-wiki-evidence-gap-reviews";

const ANALYSIS_ID = "remaining-102-style-defined-three-unknown-002";
const EXPECTED_GAP_COUNT = 102;
const ANALYZED_AT_DEFAULT = "2026-08-12T13:20:00.000Z";
const VISUAL_INPUT = path.resolve(
  "data/inspiration-wiki/evidence-gap-analysis/visual-observations.zh-CN.json",
);

const VisualInputSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-evidence-gap-visual-observations/v1"),
  reviewedAt: z.string().datetime(),
  method: z.string().min(1),
  items: z.array(z.object({
    candidateId: z.string().regex(/^hermes-candidate:[0-9a-f]{32}$/),
    visualSummary: z.string().trim().min(1).max(1_200),
    safetyCaution: z.string().trim().min(1).max(500),
  }).strict()).length(EXPECTED_GAP_COUNT),
}).strict();

type CandidateRow = {
  review_pack_id: string;
  candidate_id: string;
  revision: number;
  material_hash: string;
  pack_json: string;
  media_assets_json: string;
  stage: string;
  title: string | null;
  design_categories_json: string;
  screening_json: string;
  dedupe_fingerprint: string;
  page_url: string;
  canonical_url: string | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  BRANDING: "品牌视觉识别",
  TYPOGRAPHY: "字体与排版",
  PACKAGING: "包装设计",
  WEB_INTERFACE: "数字界面",
  PRINT: "印刷与海报",
  SPATIAL: "空间与环境图形",
  ILLUSTRATION: "插画",
  MOTION: "动态视觉",
  EDITORIAL: "书籍与编辑设计",
  PRODUCT: "产品设计",
  OTHER: "跨媒介设计",
};

const PLATFORM_LABELS: Record<string, string> = {
  PINTEREST: "Pinterest",
  BEHANCE: "Behance",
  NOTEFOLIO: "Notefolio",
  RECENT_DESIGN: "Recent.design",
  BPANDO: "BP&O",
  HESIGN: "Hesign",
  TYPOGRAPHIC_POSTERS: "Typographic Posters",
  OTHER_PUBLIC_WEB: "公开网络",
};

const ARTISTIC_STYLE_TAXONOMY = [
  { label: "极简主义", keywords: ["极少", "极简", "单一", "留白", "居中", "唯一焦点", "纯色底"], definition: "以有限元素、留白和集中焦点压低视觉噪声" },
  { label: "现代主义网格", keywords: ["网格", "模块", "分区", "信息系统", "时间轴", "条带", "理性"], definition: "依靠网格、模块和明确层级组织信息" },
  { label: "几何抽象", keywords: ["几何", "色块", "圆点", "线条", "抽象", "轴测", "散点", "折面", "星形", "涡旋"], definition: "用几何形、色块和节奏关系取代具象叙事" },
  { label: "实验字体", keywords: ["大字", "字标", "手写", "字形", "文字", "排版", "标题", "字纹"], definition: "把字形的拆分、尺度、遮挡或材质当作主要画面语法" },
  { label: "拼贴表现", keywords: ["拼贴", "叠置", "贴纸", "剪贴", "多张", "多格", "多件物料", "铺陈"], definition: "通过异质图像、文字和物件的并置建立层次" },
  { label: "摄影叙事", keywords: ["人物", "照片", "手部", "海面", "地貌", "雾林", "街头", "店面", "真实桌面", "户外"], definition: "以真实场景或人物影像承担情绪和语境" },
  { label: "手绘插画", keywords: ["插画", "线描", "卡通", "漫画", "涂鸦", "手绘"], definition: "以手绘线条、角色或装饰图形建立叙事与亲和力" },
  { label: "复古怀旧", keywords: ["旧纸", "复古", "古典", "棕色纸面", "灰黄配色", "纪念"], definition: "以旧化色调、历史字形或纸张质感建立时间语气" },
  { label: "传统东方意象", keywords: ["山水", "传统纹样", "印章", "红色圆形标记", "汉字书写", "东方"], definition: "从山水、书写、印章或传统纹样中提取文化意象" },
  { label: "未来科技", keywords: ["未来", "赛博", "霓虹", "发光", "金属", "像素", "虚拟", "电子", "气泡", "透明部件"], definition: "以发光、透明、金属或数字界面线索营造未来感" },
  { label: "波普高彩", keywords: ["高饱和", "荧光", "明亮色块", "彩色", "鲜明", "粉紫", "粉绿", "亮蓝"], definition: "以高饱和色彩、强对比和大尺度图形制造直接冲击" },
  { label: "有机自然", keywords: ["花叶", "山水", "植物", "水果", "海面", "地貌", "草地", "雾林", "自然"], definition: "借助植物、地貌和有机轮廓营造自然感知" },
  { label: "材质表现", keywords: ["材质", "透明", "半透明", "墨迹", "纹理", "压印", "倒影", "阴影", "纸面", "实体质感"], definition: "将纸张、透明度、光泽或表面纹理作为核心表现手段" },
  { label: "编辑理性", keywords: ["书封", "书册", "折页", "正文", "馆藏", "专辑册", "导览", "票卡", "手册", "信息系统"], definition: "以编辑层级、系列结构和阅读秩序组织内容" },
  { label: "符号图形", keywords: ["图标", "符号", "箭头", "标志", "徽章", "轮廓", "编号", "条码"], definition: "以可重复的图标、记号或简化轮廓建立识别系统" },
  { label: "商业静物表现", keywords: ["包装", "瓶", "盒装物", "产品", "物件", "装置", "耳饰", "台灯", "罐", "杯具", "礼盒"], definition: "通过受控布景、光影和物件陈列突出产品形态" },
  { label: "装饰主义", keywords: ["装饰", "帷幕", "金色", "花形", "曲线", "丝带"], definition: "以装饰线条、纹样和仪式性细节增强画面氛围" },
  { label: "超现实表现", keywords: ["夸张", "悬浮", "空间错觉", "拉伸", "模糊", "旋转装置"], definition: "通过夸张比例、悬浮或非日常组合制造超现实感" },
] as const;

function analyzeArtisticStyle(visualSummary: string, categories: string[]) {
  const categoryBoosts: Record<string, string[]> = {
    TYPOGRAPHY: ["实验字体"],
    PRINT: ["实验字体", "现代主义网格"],
    EDITORIAL: ["编辑理性"],
    ILLUSTRATION: ["手绘插画"],
    PACKAGING: ["商业静物表现", "材质表现"],
    PRODUCT: ["商业静物表现"],
    BRANDING: ["符号图形"],
  };
  const scores = ARTISTIC_STYLE_TAXONOMY.map((style, index) => ({
    ...style,
    index,
    score: style.keywords.filter((keyword) => visualSummary.includes(keyword)).length
      + categories.filter((category) => categoryBoosts[category]?.includes(style.label)).length,
  })).filter((style) => style.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 2);
  const selected = scores.length ? scores : [{
    label: "当代商业视觉",
    definition: "以当代平面设计语法建立清晰的传播焦点",
  }];
  return {
    labels: selected.map((style) => style.label),
    rationale: `风格依据：${selected.map((style) => style.definition).join("；")}。画面证据：${visualSummary}`,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function primaryClassification(categories: string[]) {
  if (categories.includes("EDITORIAL")) return "书籍与编辑设计";
  if (categories.includes("PACKAGING")) return "包装与产品设计";
  if (categories.includes("PRINT") && categories.includes("TYPOGRAPHY")) return "海报与字体设计";
  if (categories.includes("BRANDING")) return "品牌视觉识别";
  if (categories.includes("PRODUCT")) return "产品设计";
  if (categories.includes("PRINT")) return "印刷与海报设计";
  return "综合视觉设计";
}

function teachingPrompt(primary: string) {
  if (primary === "包装与产品设计") {
    return "包装形态、标签层级、材质表现与陈列方式如何共同传达产品定位？";
  }
  if (primary === "海报与字体设计" || primary === "印刷与海报设计") {
    return "字体、图像、色块与留白如何建立第一阅读顺序和远距离识别？";
  }
  if (primary === "书籍与编辑设计") {
    return "封面、页面结构、装订或展开方式如何组织阅读节奏？";
  }
  if (primary === "品牌视觉识别") {
    return "字标、色彩、图形和应用载体之间如何维持统一识别？";
  }
  return "造型、图像、字体和色彩如何共同说明这个设计对象？";
}

function sourceIdentity(pack: Pick<EvidenceGapReviewPack, "sources">) {
  return pack.sources.map(({ sourceId, platform, pageUrl }) => ({ sourceId, platform, pageUrl }));
}

function mediaIdentity(pack: Pick<EvidenceGapReviewPack, "mediaGroup">) {
  return pack.mediaGroup.map(({ mediaId, previewUrl, width, height, sha256: mediaSha }) => ({
    mediaId,
    previewUrl,
    width,
    height,
    sha256: mediaSha,
  }));
}

function buildRevisedPack(
  row: CandidateRow,
  visual: z.infer<typeof VisualInputSchema>["items"][number],
  analyzedAt: string,
): EvidenceGapReviewPack {
  const previous = EvidenceGapReviewPackSchema.parse(JSON.parse(row.pack_json));
  if (previous.stage !== "READY_FOR_TEACHER_TRIAGE"
    || previous.mediaGroup.length !== 1
    || row.stage !== "READY_FOR_TEACHER_TRIAGE") {
    throw new Error(`ANALYSIS_BASELINE_NOT_READY:${row.review_pack_id}`);
  }
  const categories = z.array(z.string().min(1)).min(1).parse(JSON.parse(row.design_categories_json));
  const secondary = [...new Set(categories.map((category) => CATEGORY_LABELS[category] ?? category))];
  const primary = primaryClassification(categories);
  const media = previous.mediaGroup[0]!;
  const title = row.title ?? previous.work.title ?? "未命名候选";
  const sourcePageRefs = sourceIdentity(previous);
  const mediaRefs = mediaIdentity(previous);
  const previousMaterial = structuredClone(previous) as Partial<EvidenceGapReviewPack>;
  delete previousMaterial.materialHash;
  const revisedMaterial = {
    ...(previousMaterial as Omit<EvidenceGapReviewPack, "materialHash">),
    revision: previous.revision + 1,
    preparedAt: analyzedAt,
    work: {
      title,
      creators: [],
      year: null,
      workSourceMatchEvidence: ["未知"],
    },
    sources: previous.sources.map((source) => ({
      ...source,
      role: "UNVERIFIED" as const,
      label: `${PLATFORM_LABELS[source.platform] ?? source.platform} 公开页面（来源角色未知）`,
      creatorName: null,
      curatorName: null,
      evidenceStatement: "未知",
    })),
    mediaGroup: previous.mediaGroup.map((item) => ({
      ...item,
      reviewStatus: "VERIFIED_FOR_PRIVATE_REVIEW" as const,
      role: "COVER" as const,
      alt: `《${title}》候选封面（教师私有审核）`,
    })),
    rightsEvidence: [{
      evidenceId: `rights-unknown-${previous.reviewPackId.replace(/^review-pack:/, "")}`,
      evidenceType: null,
      sourceUrl: null,
      capturedAt: null,
      summary: "未知",
      privateTeacherReviewDecision: "UNKNOWN" as const,
      republicationDecision: "UNKNOWN" as const,
      authorPageIsNotRepublishingPermission: null,
    }],
    normalizedClassification: {
      primary,
      secondary,
      sourceTerms: categories,
    },
    visualDescription: {
      summary: visual.visualSummary,
      artisticStyle: analyzeArtisticStyle(visual.visualSummary, categories),
      observations: [{
        observation: visual.visualSummary,
        mediaIds: [media.mediaId],
      }],
    },
    duplicateRelationship: {
      status: "DISTINCT" as const,
      relatedCandidateIds: [],
      explanation: "已对 200 条候选的页面 URL、canonical URL、去重指纹以及严格/缺证队列媒体 SHA-256 做全局比对，未发现相同项。",
    },
    curationRecommendation: {
      recommendation: "RECOMMEND" as const,
      rationale: `本地封面具备可辨识的视觉焦点，可作为“${primary}”候选交由教师比较；该建议只表示值得进入私有策展判断，不替代未知的来源与权利结论。`,
    },
    teachingRecommendation: {
      recommendation: "RECOMMEND" as const,
      rationale: `可用于观察“${primary}”中的构图、层级和媒介表达，并由教师决定是否适合具体教学情境。`,
      prompts: [
        teachingPrompt(primary),
        "如果只保留一个视觉元素，哪一项最能维持该项目的识别？",
      ],
      cautions: [
        "当前仅核验一张候选封面，不能据此证明完整项目过程、动态行为、产品效果或作者职责。",
        visual.safetyCaution,
      ],
    },
    safetyAssessment: {
      status: "READY_FOR_TEACHER_DECISION" as const,
      evidence: [
        visual.safetyCaution,
        "学生可见、正式发布、Current Page、R2、Embedding 与 Lumi 引用继续关闭。",
      ],
    },
    readiness: {
      controlledMediaGroup: {
        status: "VERIFIED" as const,
        note: "本地封面已通过解码、尺寸与 SHA-256 校验，并完成教师私有视觉复核。",
        evidenceRefs: [media.mediaId, `sha256:${media.sha256}`],
      },
      workSourceMatch: { status: "UNKNOWN" as const, note: "未知", evidenceRefs: [] },
      sourceRole: { status: "UNKNOWN" as const, note: "未知", evidenceRefs: [] },
      rightsEvidence: { status: "UNKNOWN" as const, note: "未知", evidenceRefs: [] },
      normalizedClassification: {
        status: "VERIFIED" as const,
        note: "已按 Hermes 原始分类信号完成中文规范化；不据此推断来源角色或权利。",
        evidenceRefs: categories.map((category) => `source-category:${category}`),
      },
      visualDescription: {
        status: "VERIFIED" as const,
        note: "已依据本地受控封面完成可见画面描述与艺术表现风格定义。",
        evidenceRefs: [media.mediaId, "codex-artistic-style-analysis"],
      },
      duplicateRelationship: {
        status: "VERIFIED" as const,
        note: "已完成候选 URL、去重指纹与队列媒体 SHA-256 的全局比对。",
        evidenceRefs: [`dedupe-fingerprint:${row.dedupe_fingerprint}`],
      },
      curationRecommendation: {
        status: "VERIFIED" as const,
        note: "已形成仅用于教师私有判断的策展建议。",
        evidenceRefs: ["codex-curation-analysis"],
      },
      teachingRecommendation: {
        status: "VERIFIED" as const,
        note: "已形成教学观察问题与使用限制。",
        evidenceRefs: ["codex-teaching-analysis"],
      },
    },
  };
  if (stableJson(sourcePageRefs) !== stableJson(sourceIdentity(revisedMaterial))
    || stableJson(mediaRefs) !== stableJson(mediaIdentity(revisedMaterial))) {
    throw new Error(`ANALYSIS_CHANGED_SOURCE_OR_MEDIA_IDENTITY:${row.review_pack_id}`);
  }
  const materialHash = calculateEvidenceGapReviewMaterialHash(
    revisedMaterial as Omit<EvidenceGapReviewPack, "materialHash">,
  );
  const revised = EvidenceGapReviewPackSchema.parse({ ...revisedMaterial, materialHash });
  if (evidenceGapVerifiedCount(revised.readiness) !== 6
    || evidenceGapRequirementKeys(revised.readiness).sort().join(",")
      !== ["RIGHTS_EVIDENCE", "SOURCE_ROLE", "WORK_SOURCE_MATCH"].sort().join(",")) {
    throw new Error(`ANALYSIS_GATE_CONTRACT:${row.review_pack_id}`);
  }
  return revised;
}

function assertGlobalDistinct(database: Database.Database, rows: CandidateRow[]) {
  for (const field of ["page_url", "canonical_url", "dedupe_fingerprint"] as const) {
    const duplicates = database.prepare(
      `SELECT ${field} value, count(*) count FROM inspiration_wiki_hermes_candidates
       WHERE ${field} IS NOT NULL GROUP BY ${field} HAVING count(*) > 1`,
    ).all();
    if (duplicates.length > 0) throw new Error(`ANALYSIS_DUPLICATE_${field.toUpperCase()}`);
  }
  const mediaHashes = new Map<string, string>();
  const strictRows = database.prepare("SELECT candidate_id, pack_json FROM inspiration_wiki_review_packs").all() as Array<{ candidate_id: string; pack_json: string }>;
  for (const source of [...strictRows, ...rows]) {
    const rawPack = JSON.parse(source.pack_json) as { mediaGroup?: Array<{ sha256: string }> };
    for (const media of rawPack.mediaGroup ?? []) {
      const previousCandidate = mediaHashes.get(media.sha256);
      if (previousCandidate && previousCandidate !== source.candidate_id) {
        throw new Error(`ANALYSIS_DUPLICATE_MEDIA_SHA:${media.sha256}`);
      }
      mediaHashes.set(media.sha256, source.candidate_id);
    }
  }
}

function readRows(database: Database.Database) {
  return database.prepare(
    `SELECT g.review_pack_id, g.candidate_id, g.revision, g.material_hash, g.pack_json,
      g.media_assets_json, g.stage, c.title, c.design_categories_json, c.screening_json,
      c.dedupe_fingerprint, c.page_url, c.canonical_url
     FROM inspiration_wiki_evidence_gap_review_packs g
     JOIN inspiration_wiki_hermes_candidates c ON c.id = g.candidate_id
     ORDER BY g.review_pack_id ASC`,
  ).all() as CandidateRow[];
}

function artisticStyleDistribution(items: Array<{ revisedPack: EvidenceGapReviewPack }>) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const label of item.revisedPack.visualDescription.artisticStyle?.labels ?? []) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right, "zh-CN")));
}

async function writeArtifact(
  outputDirectory: string,
  analyzedAt: string,
  sourceArtifactDigest: string,
  items: Array<{
    expectedRevision: number;
    expectedMaterialHash: string;
    idempotencyKey: string;
    revisedPack: EvidenceGapReviewPack;
  }>,
) {
  const parent = path.dirname(outputDirectory);
  const temporaryDirectory = path.join(parent, `.${path.basename(outputDirectory)}.tmp-${process.pid}`);
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true });
  const payload = {
    schemaVersion: "lumi-inspiration-evidence-gap-analysis-revisions/v1",
    analysisId: ANALYSIS_ID,
    analyzedAt,
    sourceArtifactDigest,
    policy: {
      unknownRequirements: ["WORK_SOURCE_MATCH", "SOURCE_ROLE", "RIGHTS_EVIDENCE"],
      confirmedUnknownRequiresTeacherNote: false,
      artisticStyleTaxonomy: ARTISTIC_STYLE_TAXONOMY.map(({ label, definition }) => ({ label, definition })),
      analyzedRequirements: [
        "CONTROLLED_MEDIA_GROUP",
        "NORMALIZED_CLASSIFICATION",
        "VISUAL_DESCRIPTION",
        "DUPLICATE_RELATIONSHIP",
        "CURATION_RECOMMENDATION",
        "TEACHING_RECOMMENDATION",
      ],
    },
    items,
  };
  const payloadBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
  const packageDigest = sha256(payloadBytes);
  await writeFile(path.join(temporaryDirectory, "analysis-revisions.json"), payloadBytes);
  await writeFile(path.join(temporaryDirectory, "report.md"), [
    "# Lumi Evidence Gap 六项分析 / 三项已确认未知",
    "",
    `- 分析批次：${ANALYSIS_ID}`,
    `- 候选：${items.length}`,
    "- 作品—原始来源匹配：已确认为未知",
    "- 来源角色：已确认为未知",
    "- 权利证据：已确认为未知",
    "- 受控图、规范化分类、视觉描述（含艺术表现风格）、重复关系、策展建议、教学建议：已分析",
    "- 进入私有草稿：已确认未知项无需勾选或填写说明",
    "- 教师状态：READY_FOR_TEACHER_TRIAGE",
    "- 学生可见、正式发布、Current Page、R2、Embedding、Lumi 引用：全部关闭",
    "",
  ].join("\n"));
  await writeFile(path.join(temporaryDirectory, "DONE.json"), `${JSON.stringify({
    schemaVersion: "lumi-inspiration-evidence-gap-analysis-done/v1",
    analysisId: ANALYSIS_ID,
    analyzedAt,
    itemCount: items.length,
    verifiedGateCountPerItem: 6,
    unknownGateCountPerItem: 3,
    sourceArtifactDigest,
    packageDigest,
  }, null, 2)}\n`);
  try {
    await rename(temporaryDirectory, outputDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  return packageDigest;
}

function parseArguments() {
  const args = process.argv.slice(2).filter((item) => item !== "--");
  const value = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    databasePath: path.resolve(value("--database") ?? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite"),
    outputDirectory: path.resolve(value("--output") ?? `data/inspiration-wiki/evidence-gap-analysis/${ANALYSIS_ID}`),
    analyzedAt: value("--analyzed-at") ?? ANALYZED_AT_DEFAULT,
    validateOnly: args.includes("--validate-only"),
  };
}

async function main() {
  const options = parseArguments();
  const analyzedAt = new Date(options.analyzedAt).toISOString();
  const visualBytes = await readFile(VISUAL_INPUT);
  const visualInput = VisualInputSchema.parse(JSON.parse(visualBytes.toString("utf8")));
  const sourceArtifactDigest = sha256(Buffer.concat([
    visualBytes,
    Buffer.from(stableJson(ARTISTIC_STYLE_TAXONOMY)),
  ]));
  const visualByCandidate = new Map(visualInput.items.map((item) => [item.candidateId, item]));
  if (visualByCandidate.size !== EXPECTED_GAP_COUNT) throw new Error("ANALYSIS_VISUAL_INPUT_DUPLICATE");

  const tableProbe = new Database(options.databasePath, { readonly: true, fileMustExist: true });
  try {
    const auditTableExists = tableProbe.prepare(
      "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='inspiration_wiki_evidence_gap_analysis_revisions'",
    ).pluck().get() as number;
    if (auditTableExists) {
      const completed = tableProbe.prepare(
        "SELECT count(*) FROM inspiration_wiki_evidence_gap_analysis_revisions WHERE source_artifact_digest = ?",
      ).pluck().get(sourceArtifactDigest) as number;
      if (completed === EXPECTED_GAP_COUNT) {
        const postRows = readRows(tableProbe);
        const invalid = postRows.filter((row) => {
          const pack = EvidenceGapReviewPackSchema.parse(JSON.parse(row.pack_json));
          return row.stage !== "READY_FOR_TEACHER_TRIAGE"
            || evidenceGapVerifiedCount(pack.readiness) !== 6
            || !pack.visualDescription.artisticStyle
            || evidenceGapRequirementKeys(pack.readiness).sort().join(",")
              !== ["RIGHTS_EVIDENCE", "SOURCE_ROLE", "WORK_SOURCE_MATCH"].sort().join(",");
        });
        if (postRows.length !== EXPECTED_GAP_COUNT || invalid.length > 0) {
          throw new Error("ANALYSIS_POST_IMPORT_STATE_MISMATCH");
        }
        console.log(JSON.stringify({
          ok: true,
          state: "POST_IMPORT_MATCHED",
          validateOnly: options.validateOnly,
          evidenceGapPacks: postRows.length,
          verifiedPerItem: 6,
          unknownPerItem: 3,
          databaseWrites: 0,
        }, null, 2));
        return;
      }
      if (completed !== 0) throw new Error(`ANALYSIS_PARTIAL_AUDIT:${completed}`);
    }
  } finally {
    tableProbe.close();
  }

  const database = new Database(options.databasePath, { readonly: true, fileMustExist: true });
  let rows: CandidateRow[];
  try {
    rows = readRows(database);
    if (rows.length !== EXPECTED_GAP_COUNT) throw new Error(`ANALYSIS_GAP_COUNT:${rows.length}`);
    const decisions = database.prepare("SELECT count(*) FROM inspiration_wiki_evidence_gap_review_decisions").pluck().get() as number;
    if (decisions !== 0 || rows.some((row) => row.stage !== "READY_FOR_TEACHER_TRIAGE")) {
      throw new Error(`ANALYSIS_REQUIRES_UNDECIDED_QUEUE:${decisions}`);
    }
    assertGlobalDistinct(database, rows);
  } finally {
    database.close();
  }

  const items = rows.map((row) => {
    const visual = visualByCandidate.get(row.candidate_id);
    if (!visual) throw new Error(`ANALYSIS_VISUAL_INPUT_MISSING:${row.candidate_id}`);
    const revisedPack = buildRevisedPack(row, visual, analyzedAt);
    return {
      expectedRevision: row.revision,
      expectedMaterialHash: row.material_hash,
      idempotencyKey: `${ANALYSIS_ID}-${row.candidate_id.replace("hermes-candidate:", "")}`,
      revisedPack,
    };
  });
  if (new Set(items.map((item) => item.revisedPack.candidateId)).size !== EXPECTED_GAP_COUNT
    || visualByCandidate.size !== items.length) {
    throw new Error("ANALYSIS_CANDIDATE_SET_MISMATCH");
  }

  if (options.validateOnly) {
    console.log(JSON.stringify({
      ok: true,
      state: "PRE_IMPORT_VALIDATED",
      validateOnly: true,
      evidenceGapPacks: items.length,
      media: items.reduce((count, item) => count + item.revisedPack.mediaGroup.length, 0),
      verifiedPerItem: 6,
      unknownPerItem: 3,
      artisticStyleDistribution: artisticStyleDistribution(items),
      sourceArtifactDigest,
      databaseWrites: 0,
    }, null, 2));
    return;
  }

  runMigrations(options.databasePath);
  await mkdir(path.dirname(options.outputDirectory), { recursive: true });
  const backupDirectory = path.resolve(".codex-runtime/evidence-gap-analysis-backups");
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, `pre-${ANALYSIS_ID}.sqlite`);
  const backupConnection = new Database(options.databasePath);
  try {
    if (!await stat(backupPath).then(() => true).catch(() => false)) {
      backupConnection.prepare("VACUUM INTO ?").run(backupPath);
    }
  } finally {
    backupConnection.close();
  }

  const connection = createDb(options.databasePath);
  try {
    connection.sqlite.transaction(() => {
      for (const item of items) {
        reviseEvidenceGapReviewPackAnalysis(connection, {
          expectedRevision: item.expectedRevision,
          expectedMaterialHash: item.expectedMaterialHash,
          idempotencyKey: item.idempotencyKey,
          sourceArtifactDigest,
          revisedPack: item.revisedPack,
        }, analyzedAt);
      }
    }).immediate();
    const audit = connection.sqlite.prepare(
      `SELECT
        (SELECT count(*) FROM inspiration_wiki_evidence_gap_review_packs) packs,
        (SELECT count(*) FROM inspiration_wiki_evidence_gap_analysis_revisions WHERE source_artifact_digest = '${sourceArtifactDigest}') revisions_for_source,
        (SELECT count(*) FROM inspiration_wiki_evidence_gap_review_packs WHERE stage='READY_FOR_TEACHER_TRIAGE' AND verified_gate_count=6) ready_six,
        (SELECT count(*) FROM inspiration_wiki_evidence_gap_review_packs WHERE json_extract(readiness_json,'$.workSourceMatch.status')='UNKNOWN' AND json_extract(readiness_json,'$.sourceRole.status')='UNKNOWN' AND json_extract(readiness_json,'$.rightsEvidence.status')='UNKNOWN') three_unknown,
        (SELECT count(*) FROM inspiration_wiki_evidence_gap_review_packs WHERE teacher_private<>1 OR student_visible<>0 OR current_page<>'DISABLED' OR r2<>'DISABLED' OR embedding<>'DISABLED' OR lumi_retrieval<>'DISABLED') violations`,
    ).get() as { packs: number; revisions_for_source: number; ready_six: number; three_unknown: number; violations: number };
    if (audit.packs !== EXPECTED_GAP_COUNT
      || audit.revisions_for_source !== EXPECTED_GAP_COUNT
      || audit.ready_six !== EXPECTED_GAP_COUNT
      || audit.three_unknown !== EXPECTED_GAP_COUNT
      || audit.violations !== 0) {
      throw new Error(`ANALYSIS_DATABASE_AUDIT:${JSON.stringify(audit)}`);
    }
  } finally {
    connection.sqlite.close();
  }

  const packageDigest = await writeArtifact(
    options.outputDirectory,
    analyzedAt,
    sourceArtifactDigest,
    items,
  );
  console.log(JSON.stringify({
    ok: true,
    state: "IMPORTED",
    evidenceGapPacks: items.length,
    verifiedPerItem: 6,
    unknownPerItem: 3,
    artisticStyleDistribution: artisticStyleDistribution(items),
    sourceArtifactDigest,
    packageDigest,
    databaseWrites: items.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "ANALYSIS_FAILED",
  }));
  process.exitCode = 1;
});
