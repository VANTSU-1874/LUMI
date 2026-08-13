import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  containsUnlocalizedEnglishProse,
  localizeReviewPackForTeacher,
  localizedSourceSummary,
} from "@/components/teacher/inspiration-review-copy.zh-CN";
import { StrictReviewPackSchema } from "@/lib/domain/inspiration-wiki/review-pack-contracts";

const ARTIFACT_HASH_PLACEHOLDER = "0".repeat(64);

function parsePreparedArtifactPack(raw: unknown) {
  return StrictReviewPackSchema.parse({
    ...(raw as Record<string, unknown>),
    materialHash: (raw as Record<string, unknown>).materialHash ?? ARTIFACT_HASH_PLACEHOLDER,
  });
}

function teacherVisibleProse(pack: ReturnType<typeof StrictReviewPackSchema.parse>) {
  return [
    ...pack.work.workSourceMatch.evidence,
    ...pack.sources.flatMap((source) => [source.label, source.evidenceStatement]),
    ...pack.mediaGroup.map((media) => media.alt),
    ...pack.rightsEvidence.map((evidence) => evidence.summary),
    pack.normalizedClassification.primary,
    ...pack.normalizedClassification.secondary,
    ...pack.normalizedClassification.sourceTerms,
    pack.visualDescription.summary,
    ...pack.visualDescription.observations.map((observation) => observation.observation),
    pack.duplicateRelationship.explanation,
    pack.curationRecommendation.rationale,
    pack.teachingRecommendation.rationale,
    ...pack.teachingRecommendation.prompts,
    ...pack.teachingRecommendation.cautions,
    ...pack.safetyAssessment.evidence,
  ];
}

describe("teacher review Chinese display copy", () => {
  it("localizes an English BP&O review without mutating identifiers or source URLs", () => {
    const root = path.join(process.cwd(), "data", "inspiration-wiki", "review-packs", "twenty-first-teacher-batch-021", "review-packs.json");
    const payload = JSON.parse(readFileSync(root, "utf8"));
    const original = parsePreparedArtifactPack(payload.items[0].pack);
    const localized = localizeReviewPackForTeacher(original);

    expect(localized.reviewPackId).toBe(original.reviewPackId);
    expect(localized.materialHash).toBe(original.materialHash);
    expect(localized.sources[0].pageUrl).toBe(original.sources[0].pageUrl);
    expect(localized.work.title).toBe("Kanal｜布鲁塞尔博物馆视觉识别（设计：Base Design）");
    expect(localized.work.workSourceMatch.evidence.join(" ")).toContain("Kanal 布鲁塞尔博物馆视觉识别明确归于 Base Design");
    expect(localized.normalizedClassification).toMatchObject({
      primary: "博物馆视觉识别",
      secondary: ["定制字体", "可变文字标志", "展示数字字体", "印刷应用系统"],
    });
    expect(teacherVisibleProse(localized).filter(containsUnlocalizedEnglishProse)).toEqual([]);
  });

  it("keeps every imported strict pack free of raw English prose in teacher-visible evidence fields", () => {
    const root = path.join(process.cwd(), "data", "inspiration-wiki", "review-packs");
    const packs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const file = path.join(root, entry.name, "review-packs.json");
        if (!existsSync(file)) return [];
        const payload = JSON.parse(readFileSync(file, "utf8"));
        return payload.items.map((item: { pack: unknown }) => parsePreparedArtifactPack(item.pack));
      });

    const failures = packs.flatMap((pack) => teacherVisibleProse(localizeReviewPackForTeacher(pack))
      .filter(containsUnlocalizedEnglishProse)
      .map((value) => ({ reviewPackId: pack.reviewPackId, value })));

    expect(packs).toHaveLength(98);
    expect(failures).toEqual([]);
  });

  it("translates queue source roles instead of exposing enum values", () => {
    expect(localizedSourceSummary("Typographic Posters · CURATORIAL_INDEX")).toBe("字体海报策展档案 · 策展索引");
    expect(localizedSourceSummary("Hesign · CREATOR_WORK_PAGE")).toBe("Hesign 官方设计档案 · 创作者作品页");
  });
});
