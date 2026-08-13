import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

import { createDb } from "../lib/db/client";
import {
  EvidenceGapReviewPackSchema,
  type EvidenceGapReviewPack,
} from "../lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import {
  calculateEvidenceGapReviewMaterialHash,
  supplementReturnedEvidenceGapReviewPackAnalysis,
} from "../lib/services/inspiration-wiki-evidence-gap-reviews";

const SUPPLEMENT_ID = "teacher-returned-visual-corrections-001";
const SUPPLEMENTED_AT = "2026-08-12T14:45:00.000Z";
const OUTPUT_DIRECTORY = path.resolve(
  "data/inspiration-wiki/evidence-gap-review-supplements",
  SUPPLEMENT_ID,
);

const corrections = [
  {
    reviewPackId: "review-pack:gap-1ee263787c55f55a247fe781c75daa02",
    candidateId: "hermes-candidate:1ee263787c55f55a247fe781c75daa02",
    title: "200 years Bodoni",
    teacherNote: "曲线像艺术英文字体笔触风格",
    visualSummary: "黑白线描人物肖像位于竖幅中央，大量类似艺术英文字体笔触的粗细曲线围绕五官与版面边缘展开，强化 Bodoni 字体纪念主题。",
    styleLabels: ["实验字体", "装饰主义"],
    styleRationale: "粗细变化明显的卷曲线条模拟艺术英文字体的书写笔触，并与人物肖像和装饰性边框共同构成字体纪念画面。",
    curationRationale: "艺术英文字体笔触、人物肖像与纪念信息形成清晰关联，适合作为字体历史主题的私有策展候选。",
    teachingRationale: "可用于观察字体笔触如何从文字结构扩展为人物肖像和整幅海报的视觉语言。",
    prompts: [
      "哪些粗细变化和收笔方式使曲线具有艺术英文字体笔触感？",
      "肖像轮廓与字形笔触之间如何共享同一套曲线语言？",
    ],
  },
  {
    reviewPackId: "review-pack:gap-206c9ebd11532add7938240cd9abe3bd",
    candidateId: "hermes-candidate:206c9ebd11532add7938240cd9abe3bd",
    title: "곤충 선글라스 브랜드 <morphee 모르페> BX 브랜딩 프로젝트/ 선글라스 3D 모델링",
    teacherNote: "雾林中的人物未佩戴夸张昆虫翼形眼镜",
    visualSummary: "雾林前景中站立一名浅绿色长发人物，巨大的昆虫形品牌符号叠加在人物躯干前方，底部以分散的白色窄体文字组织产品与品牌信息。",
    styleLabels: ["摄影叙事", "符号图形"],
    styleRationale: "真实雾林与人物摄影承担场景叙事，独立叠加的昆虫形品牌符号作为主要识别图形；该符号位于人物前方，并非人物佩戴的眼镜。",
    curationRationale: "人物摄影、自然场景与昆虫形品牌符号形成清晰层次，可作为时尚品牌符号叠加方式的私有策展候选。",
    teachingRationale: "可用于区分人物实际佩戴物与后期叠加品牌符号，并分析摄影、标志和文字三层信息关系。",
    prompts: [
      "昆虫形符号与人物身体发生遮挡时，哪些线索说明它是叠加图形而非佩戴物？",
      "雾林、人物与分散文字如何共同建立品牌的第一阅读顺序？",
    ],
  },
  {
    reviewPackId: "review-pack:gap-3500ab09be92b411bbb629721d870ec4",
    candidateId: "hermes-candidate:3500ab09be92b411bbb629721d870ec4",
    title: "Studio Blackburn’s branding for Ellis Butchers is unflinchingly carcass-centric, yet somehow so full of warmth",
    teacherNote: "不像白色屠宰工具、肉品，像制肠机和香肠，形成符号化品牌语言。",
    visualSummary: "黑底下方以白色轮廓描绘一台制肠机，连续挤出的香肠逐渐转化为带腿行走的拟人化香肠，形成幽默而直接的符号化品牌语言。",
    styleLabels: ["符号图形", "手绘插画"],
    styleRationale: "制肠机、连续香肠与拟人化腿部被简化为统一的白色轮廓图形，以连续动作和手绘式造型建立品牌识别。",
    curationRationale: "制肠过程被压缩为连续的单色符号叙事，适合作为食品品牌如何用幽默插画表达行业特征的私有策展候选。",
    teachingRationale: "可用于分析制肠机、香肠形态和拟人动作如何组成连续叙事，并讨论行业图形的识别与亲和力。",
    prompts: [
      "制肠机到拟人化香肠的连续变化如何建立阅读方向？",
      "去掉腿部之后，这组图形的幽默感和品牌亲和力会怎样变化？",
    ],
  },
] as const;

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

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function materialWithoutHash(pack: EvidenceGapReviewPack) {
  const material = structuredClone(pack) as Partial<EvidenceGapReviewPack>;
  delete material.materialHash;
  return material as Omit<EvidenceGapReviewPack, "materialHash">;
}

function revisePack(
  previous: EvidenceGapReviewPack,
  currentRevision: number,
  correction: typeof corrections[number],
) {
  const mediaId = previous.mediaGroup[0]?.mediaId;
  if (!mediaId) throw new Error(`${correction.reviewPackId} 缺少受控媒体`);
  const material: Omit<EvidenceGapReviewPack, "materialHash"> = {
    ...materialWithoutHash(previous),
    revision: currentRevision + 1,
    preparedAt: SUPPLEMENTED_AT,
    visualDescription: {
      summary: correction.visualSummary,
      artisticStyle: {
        labels: [...correction.styleLabels],
        rationale: correction.styleRationale,
      },
      observations: [{
        observation: correction.visualSummary,
        mediaIds: [mediaId],
      }],
    },
    curationRecommendation: {
      recommendation: "RECOMMEND",
      rationale: correction.curationRationale,
    },
    teachingRecommendation: {
      ...previous.teachingRecommendation,
      recommendation: "RECOMMEND",
      rationale: correction.teachingRationale,
      prompts: [...correction.prompts],
    },
    readiness: {
      ...previous.readiness,
      visualDescription: {
        status: "VERIFIED",
        note: "已按教师退回意见重新核对受控图片并修正视觉描述与艺术表现风格。",
        evidenceRefs: [mediaId, "teacher-return-visual-correction"],
      },
      curationRecommendation: {
        status: "VERIFIED",
        note: "已按修正后的视觉事实更新策展建议。",
        evidenceRefs: ["teacher-return-curation-correction"],
      },
      teachingRecommendation: {
        status: "VERIFIED",
        note: "已按修正后的视觉事实更新教学建议。",
        evidenceRefs: ["teacher-return-teaching-correction"],
      },
    },
  };
  return EvidenceGapReviewPackSchema.parse({
    ...material,
    materialHash: calculateEvidenceGapReviewMaterialHash(material),
  });
}

async function writeArtifact(items: Array<Record<string, unknown>>, sourceArtifactDigest: string) {
  const payload = {
    schemaVersion: "lumi-inspiration-evidence-gap-return-supplements/v1",
    supplementId: SUPPLEMENT_ID,
    supplementedAt: SUPPLEMENTED_AT,
    sourceArtifactDigest,
    items,
    capabilityBoundary: {
      studentVisible: false,
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
    },
  };
  const packageDigest = sha256(stableJson(payload));
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await writeFile(path.join(OUTPUT_DIRECTORY, "supplements.json"), `${JSON.stringify({ ...payload, packageDigest }, null, 2)}\n`);
  await writeFile(path.join(OUTPUT_DIRECTORY, "report.md"), [
    "# 教师退回项补充报告",
    "",
    `- 补充批次：${SUPPLEMENT_ID}`,
    `- 补充数量：${items.length}`,
    "- 处理内容：按教师退回说明重新核对受控图片，修正视觉描述、艺术表现风格、策展与教学建议。",
    "- 重新送审：全部进入 READY_FOR_TEACHER_TRIAGE。",
    "- 审计：保留原教师决定与旧物料快照，追加新的分析 revision。",
    "- 边界：学生、正式发布、Current Page、R2、Embedding、Lumi 引用继续关闭。",
    `- Package digest：${packageDigest}`,
    "",
  ].join("\n"));
  await writeFile(path.join(OUTPUT_DIRECTORY, "DONE.json"), `${JSON.stringify({
    status: "COMPLETE",
    supplementId: SUPPLEMENT_ID,
    itemCount: items.length,
    packageDigest,
    completedAt: SUPPLEMENTED_AT,
  }, null, 2)}\n`);
}

async function main() {
  const databasePath = path.resolve(argument("--database") ?? "data/tonggan.sqlite");
  const validateOnly = process.argv.includes("--validate-only");
  const sourceArtifactDigest = sha256(stableJson({
    supplementId: SUPPLEMENT_ID,
    supplementedAt: SUPPLEMENTED_AT,
    corrections,
  }));
  const readonly = new Database(databasePath, { readonly: true, fileMustExist: true });
  const prepared = corrections.map((correction) => {
    const row = readonly.prepare(
      `SELECT review_pack_id reviewPackId, candidate_id candidateId, revision, stage,
        material_hash materialHash, pack_json packJson
       FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id = ?`,
    ).get(correction.reviewPackId) as {
      reviewPackId: string;
      candidateId: string;
      revision: number;
      stage: string;
      materialHash: string;
      packJson: string;
    } | undefined;
    if (!row || row.candidateId !== correction.candidateId) throw new Error(`${correction.reviewPackId} 身份不匹配`);
    const existingAudit = readonly.prepare(
      `SELECT previous_revision previousRevision, next_revision nextRevision,
        previous_material_hash previousMaterialHash, revised_pack_json revisedPackJson
       FROM inspiration_wiki_evidence_gap_analysis_revisions WHERE idempotency_key = ?`,
    ).get(`${SUPPLEMENT_ID}:${correction.candidateId}`) as {
      previousRevision: number;
      nextRevision: number;
      previousMaterialHash: string;
      revisedPackJson: string;
    } | undefined;
    if (existingAudit) {
      return {
        correction,
        expectedRevision: existingAudit.previousRevision,
        expectedMaterialHash: existingAudit.previousMaterialHash,
        revisedPack: EvidenceGapReviewPackSchema.parse(JSON.parse(existingAudit.revisedPackJson)),
      };
    }
    if (row.stage !== "RETURNED_TO_CODEX") throw new Error(`${correction.reviewPackId} 当前不是教师退回状态`);
    const decision = readonly.prepare(
      `SELECT note FROM inspiration_wiki_evidence_gap_review_decisions
       WHERE review_pack_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).get(correction.reviewPackId) as { note: string } | undefined;
    if (!decision || decision.note !== correction.teacherNote) throw new Error(`${correction.reviewPackId} 教师说明不匹配`);
    const previous = EvidenceGapReviewPackSchema.parse(JSON.parse(row.packJson));
    return {
      correction,
      expectedRevision: row.revision,
      expectedMaterialHash: row.materialHash,
      revisedPack: revisePack(previous, row.revision, correction),
    };
  });
  readonly.close();

  if (validateOnly) {
    console.log(JSON.stringify({
      ok: true,
      mode: "VALIDATE_ONLY",
      supplementId: SUPPLEMENT_ID,
      sourceArtifactDigest,
      items: prepared.map(({ correction, expectedRevision, revisedPack }) => ({
        reviewPackId: correction.reviewPackId,
        previousRevision: expectedRevision,
        revision: revisedPack.revision,
        correctedSummary: revisedPack.visualDescription.summary,
      })),
      databaseWrites: 0,
    }, null, 2));
    return;
  }

  const connection = createDb(databasePath);
  let results;
  try {
    results = connection.sqlite.transaction(() => prepared.map(({ correction, expectedRevision, expectedMaterialHash, revisedPack }) => (
      supplementReturnedEvidenceGapReviewPackAnalysis(connection, {
        expectedRevision,
        expectedMaterialHash,
        idempotencyKey: `${SUPPLEMENT_ID}:${correction.candidateId}`,
        sourceArtifactDigest,
        revisedPack,
      }, SUPPLEMENTED_AT)
    ))).immediate();
  } finally {
    connection.sqlite.close();
  }

  const items = prepared.map(({ correction, revisedPack }, index) => ({
    reviewPackId: correction.reviewPackId,
    candidateId: correction.candidateId,
    title: correction.title,
    teacherNote: correction.teacherNote,
    previousRevision: results[index]!.previousRevision,
    revision: results[index]!.revision,
    materialHash: revisedPack.materialHash,
    correctedVisualSummary: revisedPack.visualDescription.summary,
    artisticStyle: revisedPack.visualDescription.artisticStyle,
    stage: results[index]!.stage,
  }));
  await writeArtifact(items, sourceArtifactDigest);
  console.log(JSON.stringify({ ok: true, supplementId: SUPPLEMENT_ID, items, databaseWrites: results.filter((result) => !result.replayed).length }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
