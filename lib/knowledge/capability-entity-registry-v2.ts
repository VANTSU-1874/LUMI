import {
  createCapabilityAnchorCoverageV2,
} from "./capability-anchor-coverage-v2";
import {
  createCapabilityEntityManifestV2,
  createPackCompetitionCalibrationV2,
  PACK_COMPETITION_POLICY_V2,
  type CapabilityEntityManifestV2,
  type PackCompetitionCalibrationV2,
} from "./capability-boundary-v2";
import type { KnowledgeObjectV2 } from "./knowledge-object-v2";

type CapabilityEntityInput =
  Parameters<typeof createCapabilityEntityManifestV2>[0]["entities"][number];

const DIGITAL = { id: "digital-interaction", version: "1" } as const;
const BOOK = { id: "book-design", version: "1" } as const;
const GENERAL = { id: "general-design", version: "1" } as const;
const LAYOUT = { id: "layout-design", version: "1" } as const;
const BRAND = { id: "brand-vi-design", version: "1" } as const;

export const T41_ANSWERABILITY_DEV_SUITE_HASH =
  "79d1047bdd855f28e36d6f3f6a2e259d1f45e50ca62de80fedefc917ca4738a3";

export const T41_PACK_COMPETITION_THRESHOLDS_V2 = Object.freeze({
  LEXICAL: Object.freeze({
    minimumForeignPackMargin: 0.04,
    scopedSufficiencyFloor: 0.75,
    minimumDistinctObjects: 5,
  }),
  TEXT_VECTOR: Object.freeze({
    minimumForeignPackMargin: 0.035,
    scopedSufficiencyFloor: 0.68,
    minimumDistinctObjects: 5,
  }),
});

export const AUDITED_CAPABILITY_ENTITIES_V2 = Object.freeze([
  {
    entityId: "digital-signal-interfaces",
    ownerCoursePack: DIGITAL,
    scope: "COURSE_EXCLUSIVE",
    evidenceObjectIds: [
      "digishow-lighting-midi",
      "digishow-signals",
      "osc-out-chop",
    ],
    aliases: [
      { text: "Art-Net", classification: "EXCLUSIVE" },
      { text: "DMX", classification: "EXCLUSIVE" },
      { text: "MIDI CC", classification: "EXCLUSIVE" },
      { text: "MIDI Note", classification: "EXCLUSIVE" },
      { text: "MIDI", classification: "EXCLUSIVE" },
      { text: "OSC Out CHOP", classification: "EXCLUSIVE" },
      { text: "OSC Out", classification: "EXCLUSIVE" },
      { text: "TOP", classification: "AMBIGUOUS" },
      { text: "节点", classification: "AMBIGUOUS" },
    ],
  },
  {
    entityId: "digital-touchdesigner-operators",
    ownerCoursePack: DIGITAL,
    scope: "COURSE_EXCLUSIVE",
    evidenceObjectIds: [
      "td-analyze-chop",
      "td-feedback-top",
      "td-filter-chop",
      "td-glsl-top",
      "td-math-chop",
      "td-null-chop",
    ],
    aliases: [
      { text: "Analyze CHOP", classification: "EXCLUSIVE" },
      { text: "Feedback TOP", classification: "EXCLUSIVE" },
      { text: "Filter CHOP", classification: "EXCLUSIVE" },
      { text: "GLSL TOP", classification: "EXCLUSIVE" },
      { text: "Math CHOP", classification: "EXCLUSIVE" },
      { text: "Null CHOP", classification: "EXCLUSIVE" },
    ],
  },
  {
    entityId: "book-indesign-production",
    ownerCoursePack: BOOK,
    scope: "COURSE_EXCLUSIVE",
    evidenceObjectIds: [
      "book-document-grid",
      "book-layout-grid",
      "book-linked-assets",
      "book-printer-marks",
    ],
    aliases: [
      { text: "Color Bars", classification: "EXCLUSIVE" },
      { text: "Document Grid", classification: "EXCLUSIVE" },
      { text: "InDesign", classification: "EXCLUSIVE" },
      { text: "Layout Grid", classification: "EXCLUSIVE" },
      { text: "Links 面板", classification: "EXCLUSIVE" },
      { text: "Page Information", classification: "EXCLUSIVE" },
      { text: "Registration Marks", classification: "EXCLUSIVE" },
      { text: "套准标记", classification: "EXCLUSIVE" },
      { text: "链接面板", classification: "EXCLUSIVE" },
      { text: "印刷", classification: "AMBIGUOUS" },
    ],
  },
  {
    entityId: "general-double-diamond",
    ownerCoursePack: GENERAL,
    scope: "COURSE_EXCLUSIVE",
    evidenceObjectIds: ["design-double-diamond"],
    aliases: [
      { text: "Double Diamond", classification: "EXCLUSIVE" },
      { text: "双钻", classification: "EXCLUSIVE" },
    ],
  },
  {
    entityId: "general-status-feedback",
    ownerCoursePack: GENERAL,
    scope: "COURSE_EXCLUSIVE",
    evidenceObjectIds: ["design-status-feedback"],
    aliases: [
      { text: "交互反馈", classification: "EXCLUSIVE" },
      { text: "操作状态", classification: "EXCLUSIVE" },
      { text: "状态反馈", classification: "EXCLUSIVE" },
    ],
  },
  {
    entityId: "layout-acid-design",
    ownerCoursePack: LAYOUT,
    scope: "COURSE_EXCLUSIVE",
    evidenceObjectIds: [
      "layout-012-acid-style-fit",
      "layout-013-acid-style-history",
    ],
    aliases: [
      { text: "Acid Design", classification: "EXCLUSIVE" },
      { text: "酸性设计", classification: "EXCLUSIVE" },
      { text: "酸性风格", classification: "EXCLUSIVE" },
      { text: "酸性", classification: "EXCLUSIVE" },
      { text: "版式", classification: "AMBIGUOUS" },
    ],
  },
  {
    entityId: "layout-collage",
    ownerCoursePack: LAYOUT,
    scope: "COURSE_EXCLUSIVE",
    evidenceObjectIds: [
      "layout-014-collage-style-fit",
      "layout-015-collage-style-history",
    ],
    aliases: [
      { text: "Collage", classification: "EXCLUSIVE" },
      { text: "拼贴", classification: "EXCLUSIVE" },
    ],
  },
  {
    entityId: "brand-wordmark",
    ownerCoursePack: BRAND,
    scope: "COURSE_EXCLUSIVE",
    evidenceObjectIds: [
      "brandvi-001-assess-wordmark-fit",
      "brandvi-002-test-wordmark-tone-and-audience",
    ],
    aliases: [
      { text: "Wordmark", classification: "EXCLUSIVE" },
      { text: "字标", classification: "EXCLUSIVE" },
      { text: "品牌", classification: "AMBIGUOUS" },
    ],
  },
] satisfies readonly CapabilityEntityInput[]);

export function createAuditedCapabilityEntityManifestV2(
  corpus: {
    bundleHash: string;
    objects: readonly KnowledgeObjectV2[];
  },
): CapabilityEntityManifestV2 {
  const technicalAnchorCoverage =
    createCapabilityAnchorCoverageV2({
      corpusBundleHash: corpus.bundleHash,
      objects: corpus.objects,
    });
  return createCapabilityEntityManifestV2({
    id: "lumi-audited-capability-entities-v2",
    version: "1.0.0",
    corpusBundleHash: corpus.bundleHash,
    entities: AUDITED_CAPABILITY_ENTITIES_V2,
    technicalAnchorCoverage,
  });
}

export function createT41PackCompetitionCalibrationV2(input: {
  corpusBundleHash: string;
  lexicalConfigHash: string;
  normalizerConfigHash: string;
  textProviderIndexBundleHash: string;
  textModelId: string;
  textModelRevision: string;
  lexicalPackCompetitionAlgorithmHash: string;
  textPackCompetitionAlgorithmHash: string;
  capabilityEntityManifestHash: string;
}): PackCompetitionCalibrationV2 {
  return createPackCompetitionCalibrationV2({
    id: "lumi-t41-pack-competition-calibration-v2",
    version: "1.0.0",
    developmentSuiteHash: T41_ANSWERABILITY_DEV_SUITE_HASH,
    corpusBundleHash: input.corpusBundleHash,
    lexicalConfigHash: input.lexicalConfigHash,
    normalizerConfigHash: input.normalizerConfigHash,
    textProviderIndexBundleHash: input.textProviderIndexBundleHash,
    textModelId: input.textModelId,
    textModelRevision: input.textModelRevision,
    lexicalPackCompetitionAlgorithmHash:
      input.lexicalPackCompetitionAlgorithmHash,
    textPackCompetitionAlgorithmHash:
      input.textPackCompetitionAlgorithmHash,
    capabilityEntityManifestHash: input.capabilityEntityManifestHash,
    packCompetitionPolicyHash: PACK_COMPETITION_POLICY_V2.configHash,
    channels: T41_PACK_COMPETITION_THRESHOLDS_V2,
  });
}
