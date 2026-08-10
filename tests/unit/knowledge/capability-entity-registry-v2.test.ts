// @vitest-environment node

import { beforeAll, describe, expect, it } from "vitest";

import {
  applyCapabilityBoundaryV2,
  normalizeCapabilityEntityTextV2,
  verifyCapabilityEntityManifestEvidenceV2,
} from "@/lib/knowledge/capability-boundary-v2";
import {
  createAuditedCapabilityEntityManifestV2,
  createT41PackCompetitionCalibrationV2,
} from "@/lib/knowledge/capability-entity-registry-v2";
import {
  unsupportedExplicitTechnicalAnchorsV2,
} from "@/lib/knowledge/capability-anchor-coverage-v2";
import { buildKnowledgeV2Corpus } from "@/lib/knowledge/knowledge-v2-corpus";
import type { KnowledgeCorpusBundleV2 } from "@/lib/knowledge/knowledge-object-v2";

describe("audited capability entity registry V2", () => {
  let corpus: KnowledgeCorpusBundleV2;

  beforeAll(async () => {
    corpus = (await buildKnowledgeV2Corpus({ workspaceRoot: process.cwd() })).bundle;
  }, 60_000);

  it("binds every declared capability to a real object owned by its course pack", () => {
    const manifest = createAuditedCapabilityEntityManifestV2(corpus);
    const verified = verifyCapabilityEntityManifestEvidenceV2(manifest, {
      corpusBundleHash: corpus.bundleHash,
      objectCoursePacks: corpus.objects.map((object) => ({
        objectId: object.id,
        coursePack: object.sourceCoursePack,
      })),
    });
    expect(verified).toMatchObject({
      corpusBundleHash: corpus.bundleHash,
      manifestHash: manifest.configHash,
      entityCount: 8,
    });
    expect(verified.evidenceObjectCount).toBeGreaterThan(8);
  });

  it("keeps broad recall terms ambiguous while audited operator names stay exclusive", () => {
    const manifest = createAuditedCapabilityEntityManifestV2(corpus);
    const aliases = manifest.entities.flatMap((entity) =>
      entity.aliases.map((alias) => ({
        entityId: entity.entityId,
        text: alias.normalizedText,
        classification: alias.classification,
      })));
    for (const text of ["top", "节点", "品牌", "版式", "印刷"]) {
      expect(aliases.find((alias) => alias.text === text)).toMatchObject({
        classification: "AMBIGUOUS",
      });
    }
    expect(aliases.find((alias) => alias.text === "glsl top")).toMatchObject({
      entityId: "digital-touchdesigner-operators",
      classification: "EXCLUSIVE",
    });
  });

  it("does not treat standalone TD shorthand as an unsupported product", () => {
    const manifest =
      createAuditedCapabilityEntityManifestV2(corpus);
    expect(
      unsupportedExplicitTechnicalAnchorsV2({
        queryText:
          "DigiShow 里数值在跳，TD 画面还是不动",
        sourceCoursePack: {
          id: "digital-interaction",
          version: "1",
        },
        coverage:
          manifest.technicalAnchorCoverage!,
      }),
    ).toEqual([]);
  });

  it("rejects an unsupported technical anchor before protecting a scoped product", () => {
    const manifest = createAuditedCapabilityEntityManifestV2(corpus);
    const lexicalConfigHash = "1".repeat(64);
    const normalizerConfigHash = "2".repeat(64);
    const textProviderIndexBundleHash = "3".repeat(64);
    const textModelId = "fixture/bge";
    const textModelRevision = "4".repeat(40);
    const lexicalPackCompetitionAlgorithmHash = "b".repeat(64);
    const textPackCompetitionAlgorithmHash = "c".repeat(64);
    const calibration = createT41PackCompetitionCalibrationV2({
      corpusBundleHash: corpus.bundleHash,
      lexicalConfigHash,
      normalizerConfigHash,
      textProviderIndexBundleHash,
      textModelId,
      textModelRevision,
      lexicalPackCompetitionAlgorithmHash,
      textPackCompetitionAlgorithmHash,
      capabilityEntityManifestHash: manifest.configHash,
    });
    const originalText =
      "请在 InDesign 里打开 ZetaMerge Pro 面板";
    const result = applyCapabilityBoundaryV2({
      queryMode: "TEXT_TO_TEXT",
      originalText,
      normalizedText:
        normalizeCapabilityEntityTextV2(originalText),
      corpusBundleHash: corpus.bundleHash,
      lexicalConfigHash,
      normalizerConfigHash,
      textProviderIndexBundleHash,
      textModelId,
      textModelRevision,
      lexicalPackCompetitionAlgorithmHash,
      textPackCompetitionAlgorithmHash,
      sourceCoursePack: {
        id: "book-design",
        version: "1",
      },
      acceptedCandidateIds: ["node-accepted"],
      degradedLexicalFallback: false,
      channelStatuses: {
        LEXICAL: "SUCCESS",
        TEXT_VECTOR: "SUCCESS",
      },
      acceptancePolicyHash: "5".repeat(64),
      manifest,
      calibration,
    });
    expect(result.acceptedCandidateIds).toEqual([]);
    expect(result.trace).toMatchObject({
      decision: "REJECT",
      reason: "UNSUPPORTED_TECHNICAL_ANCHOR",
      unsupportedTechnicalAnchors: [
        "zetamerge pro",
      ],
    });
  });

  it("keeps a scoped exclusive technical anchor that exists in the corpus", () => {
    const manifest = createAuditedCapabilityEntityManifestV2(corpus);
    const lexicalConfigHash = "6".repeat(64);
    const normalizerConfigHash = "7".repeat(64);
    const textProviderIndexBundleHash = "8".repeat(64);
    const textModelId = "fixture/bge";
    const textModelRevision = "9".repeat(40);
    const lexicalPackCompetitionAlgorithmHash = "b".repeat(64);
    const textPackCompetitionAlgorithmHash = "c".repeat(64);
    const calibration = createT41PackCompetitionCalibrationV2({
      corpusBundleHash: corpus.bundleHash,
      lexicalConfigHash,
      normalizerConfigHash,
      textProviderIndexBundleHash,
      textModelId,
      textModelRevision,
      lexicalPackCompetitionAlgorithmHash,
      textPackCompetitionAlgorithmHash,
      capabilityEntityManifestHash: manifest.configHash,
    });
    const originalText = "Document Grid 应该怎么用";
    const result = applyCapabilityBoundaryV2({
      queryMode: "TEXT_TO_TEXT",
      originalText,
      normalizedText:
        normalizeCapabilityEntityTextV2(originalText),
      corpusBundleHash: corpus.bundleHash,
      lexicalConfigHash,
      normalizerConfigHash,
      textProviderIndexBundleHash,
      textModelId,
      textModelRevision,
      lexicalPackCompetitionAlgorithmHash,
      textPackCompetitionAlgorithmHash,
      sourceCoursePack: {
        id: "book-design",
        version: "1",
      },
      acceptedCandidateIds: ["node-accepted"],
      degradedLexicalFallback: false,
      channelStatuses: {
        LEXICAL: "SUCCESS",
        TEXT_VECTOR: "SUCCESS",
      },
      acceptancePolicyHash: "a".repeat(64),
      manifest,
      calibration,
    });
    expect(result.acceptedCandidateIds).toEqual([
      "node-accepted",
    ]);
    expect(result.trace).toMatchObject({
      decision: "ABSTAIN",
      reason: "SCOPED_EXCLUSIVE_ENTITY_PRESENT",
      unsupportedTechnicalAnchors: [],
    });
  });
});
