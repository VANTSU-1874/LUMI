// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  applyCapabilityBoundaryV2,
  createCapabilityEntityManifestV2,
  createPackCompetitionCalibrationV2,
  createPackCompetitionPolicyV2,
  mapPackCompetitionObservationsToBoundaryDiagnosticsV2,
  normalizeCapabilityEntityTextV2,
  PACK_COMPETITION_POLICY_V2,
  verifyCapabilityEntityManifestEvidenceV2,
  type PackCompetitionDiagnosticsV2,
} from "@/lib/knowledge/capability-boundary-v2";

const CORPUS_HASH = "a".repeat(64);
const ACCEPTANCE_HASH = "b".repeat(64);
const DEV_HASH = "c".repeat(64);
const LEXICAL_CONFIG_HASH = "d".repeat(64);
const NORMALIZER_CONFIG_HASH = "e".repeat(64);
const TEXT_PROVIDER_INDEX_BUNDLE_HASH = "f".repeat(64);
const TEXT_MODEL_ID = "BAAI/bge-small-zh-v1.5";
const TEXT_MODEL_REVISION = "7999e1d3359715c523056ef9478215996d62a620";
const LEXICAL_PACK_COMPETITION_ALGORITHM_HASH = "6".repeat(64);
const TEXT_PACK_COMPETITION_ALGORITHM_HASH = "7".repeat(64);
const GENERAL = { id: "general-design" as const, version: "1" as const };
const DIGITAL = { id: "digital-interaction" as const, version: "1" as const };
const BOOK = { id: "book-design" as const, version: "1" as const };

function manifest(reverse = false) {
  const entities = [
    {
      entityId: "osc-out-chop",
      ownerCoursePack: DIGITAL,
      scope: "COURSE_EXCLUSIVE" as const,
      evidenceObjectIds: ["osc-out-chop"],
      aliases: [
        { text: "TOP", classification: "AMBIGUOUS" as const },
        { text: "OSC Out CHOP", classification: "EXCLUSIVE" as const },
      ],
    },
    {
      entityId: "indesign-grid",
      ownerCoursePack: BOOK,
      scope: "COURSE_EXCLUSIVE" as const,
      evidenceObjectIds: ["book-layout-grid", "book-document-grid"],
      aliases: [
        { text: "Layout Grid", classification: "AMBIGUOUS" as const },
        { text: "InDesign Layout Grid", classification: "EXCLUSIVE" as const },
      ],
    },
    {
      entityId: "broad-design-language",
      ownerCoursePack: GENERAL,
      scope: "SHARED_OR_AMBIGUOUS" as const,
      evidenceObjectIds: ["design-status-feedback"],
      aliases: [
        { text: "节点", classification: "AMBIGUOUS" as const },
        { text: "品牌", classification: "AMBIGUOUS" as const },
        { text: "版式", classification: "AMBIGUOUS" as const },
        { text: "印刷", classification: "AMBIGUOUS" as const },
      ],
    },
    {
      entityId: "double-diamond",
      ownerCoursePack: GENERAL,
      scope: "COURSE_EXCLUSIVE" as const,
      evidenceObjectIds: ["design-double-diamond"],
      aliases: [
        { text: "双钻", classification: "EXCLUSIVE" as const },
      ],
    },
    {
      entityId: "status-feedback",
      ownerCoursePack: GENERAL,
      scope: "COURSE_EXCLUSIVE" as const,
      evidenceObjectIds: ["design-operation-status"],
      aliases: [
        { text: "状态反馈", classification: "EXCLUSIVE" as const },
      ],
    },
  ];
  const ordered = reverse
    ? [...entities].reverse().map((entity) => ({
      ...entity,
      evidenceObjectIds: [...entity.evidenceObjectIds].reverse(),
      aliases: [...entity.aliases].reverse(),
    }))
    : entities;
  return createCapabilityEntityManifestV2({
    corpusBundleHash: CORPUS_HASH,
    entities: ordered,
  });
}

const CALIBRATION_IDENTITY = {
  corpusBundleHash: CORPUS_HASH,
  lexicalConfigHash: LEXICAL_CONFIG_HASH,
  normalizerConfigHash: NORMALIZER_CONFIG_HASH,
  textProviderIndexBundleHash: TEXT_PROVIDER_INDEX_BUNDLE_HASH,
  textModelId: TEXT_MODEL_ID,
  textModelRevision: TEXT_MODEL_REVISION,
  lexicalPackCompetitionAlgorithmHash:
    LEXICAL_PACK_COMPETITION_ALGORITHM_HASH,
  textPackCompetitionAlgorithmHash:
    TEXT_PACK_COMPETITION_ALGORITHM_HASH,
};

function calibration(
  manifestHash = manifest().configHash,
  identityOverrides: Partial<typeof CALIBRATION_IDENTITY> = {},
) {
  return createPackCompetitionCalibrationV2({
    developmentSuiteHash: DEV_HASH,
    ...CALIBRATION_IDENTITY,
    ...identityOverrides,
    capabilityEntityManifestHash: manifestHash,
    packCompetitionPolicyHash: PACK_COMPETITION_POLICY_V2.configHash,
    channels: {
      LEXICAL: {
        minimumForeignPackMargin: 0.3,
        scopedSufficiencyFloor: 0.5,
        minimumDistinctObjects: 3,
      },
      TEXT_VECTOR: {
        minimumForeignPackMargin: 0.1,
        scopedSufficiencyFloor: 0.4,
        minimumDistinctObjects: 3,
      },
    },
  });
}

function diagnostics(): PackCompetitionDiagnosticsV2 {
  return {
    LEXICAL: {
      status: "HEALTHY",
      globalWinner: {
        coursePack: DIGITAL,
        objectId: "osc-out-chop",
        representationId: null,
        score: 0.8,
      },
      scopedWinner: {
        coursePack: GENERAL,
        objectId: "design-status-feedback",
        representationId: null,
        score: 0.2,
      },
      foreignPackMargin: 0.6,
      scopedSufficiency: 0.2,
      distinctObjectCount: 5,
      distinctRepresentationCount: 8,
    },
    TEXT_VECTOR: {
      status: "HEALTHY",
      globalWinner: {
        coursePack: DIGITAL,
        objectId: "osc-out-chop",
        representationId: "repr-osc-out",
        score: 0.5,
      },
      scopedWinner: {
        coursePack: GENERAL,
        objectId: "design-status-feedback",
        representationId: "repr-status",
        score: 0.3,
      },
      foreignPackMargin: 0.2,
      scopedSufficiency: 0.3,
      distinctObjectCount: 5,
      distinctRepresentationCount: 8,
    },
  };
}

function availableCompetitionObservation(
  scoreMetric: "LEXICAL_NORMALIZED_SCORE" | "COSINE_SIMILARITY",
  globalScore: number,
  scopedScore: number,
) {
  const globalWinner = {
    coursePackId: DIGITAL.id,
    objectCount: 3,
    objectId: "osc-out-chop",
    representationId: scoreMetric === "COSINE_SIMILARITY" ? "repr-osc-out" : null,
    nodeId: "node-osc-out",
    score: globalScore,
  };
  const scopedWinner = {
    coursePackId: GENERAL.id,
    objectCount: 2,
    objectId: "design-status-feedback",
    representationId: scoreMetric === "COSINE_SIMILARITY" ? "repr-status" : null,
    nodeId: "node-status",
    score: scopedScore,
  };
  return {
    status: "AVAILABLE" as const,
    reason: null,
    packCompetition: {
      schemaVersion: 1 as const,
      scoreMetric,
      objectDeduplication: "BEST_REPRESENTATION_PER_OBJECT" as const,
      packWinnerSelection: "BEST_OBJECT_PER_PACK" as const,
      globalWinnerSelection: "BEST_PACK_WINNER" as const,
      sourceScope: { coursePackId: GENERAL.id },
      scoredRepresentationCount: 8,
      deduplicatedObjectCount: 5,
      perPackWinners: [globalWinner, scopedWinner],
      globalWinner,
      scopedWinner,
      globalToScopedMargin: globalScore - scopedScore,
    },
  };
}

function competitionObservations() {
  return {
    LEXICAL: availableCompetitionObservation(
      "LEXICAL_NORMALIZED_SCORE",
      0.875,
      0.25,
    ),
    TEXT_VECTOR: availableCompetitionObservation(
      "COSINE_SIMILARITY",
      0.75,
      0.25,
    ),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  const entityManifest = manifest();
  const defaultOriginalText = "请继续判断这个操作";
  const originalOverride = overrides.originalText;
  const normalizedOverride = overrides.normalizedText;
  const normalizedAsOriginal =
    typeof normalizedOverride === "string"
      || normalizedOverride === null
      ? normalizedOverride
      : defaultOriginalText;
  const originalText =
    typeof originalOverride === "string"
      || originalOverride === null
      ? originalOverride
      : normalizedAsOriginal;
  return {
    queryMode: "TEXT_TO_TEXT" as const,
    originalText,
    normalizedText:
      normalizeCapabilityEntityTextV2(defaultOriginalText),
    corpusBundleHash: CORPUS_HASH,
    lexicalConfigHash: LEXICAL_CONFIG_HASH,
    normalizerConfigHash: NORMALIZER_CONFIG_HASH,
    textProviderIndexBundleHash: TEXT_PROVIDER_INDEX_BUNDLE_HASH,
    textModelId: TEXT_MODEL_ID,
    textModelRevision: TEXT_MODEL_REVISION,
    lexicalPackCompetitionAlgorithmHash:
      LEXICAL_PACK_COMPETITION_ALGORITHM_HASH,
    textPackCompetitionAlgorithmHash:
      TEXT_PACK_COMPETITION_ALGORITHM_HASH,
    sourceCoursePack: GENERAL,
    acceptedCandidateIds: ["node-accepted"],
    degradedLexicalFallback: false,
    channelStatuses: {
      LEXICAL: "SUCCESS" as const,
      TEXT_VECTOR: "SUCCESS" as const,
    },
    acceptancePolicyHash: ACCEPTANCE_HASH,
    diagnostics: diagnostics(),
    manifest: entityManifest,
    calibration: calibration(entityManifest.configHash),
    ...overrides,
  };
}

describe("T4.1 capability boundary identity", () => {
  it("canonicalizes manifest order and binds hashes to corpus, policy, and DEV calibration", () => {
    const first = manifest();
    const reordered = manifest(true);
    expect(first.configHash).toMatch(/^[0-9a-f]{64}$/);
    expect(reordered.configHash).toBe(first.configHash);
    expect(createPackCompetitionPolicyV2()).toEqual(PACK_COMPETITION_POLICY_V2);

    const firstCalibration = calibration(first.configHash);
    const secondCalibration = calibration(first.configHash);
    expect(secondCalibration.configHash).toBe(firstCalibration.configHash);
    expect(firstCalibration).toMatchObject({
      developmentSuiteHash: DEV_HASH,
      ...CALIBRATION_IDENTITY,
      capabilityEntityManifestHash: first.configHash,
      packCompetitionPolicyHash: PACK_COMPETITION_POLICY_V2.configHash,
    });

    for (const identityOverrides of [
      { corpusBundleHash: "1".repeat(64) },
      { lexicalConfigHash: "2".repeat(64) },
      { normalizerConfigHash: "3".repeat(64) },
      { textProviderIndexBundleHash: "4".repeat(64) },
      { textModelId: "replacement/text-model" },
      { textModelRevision: "9".repeat(40) },
      { lexicalPackCompetitionAlgorithmHash: "8".repeat(64) },
      { textPackCompetitionAlgorithmHash: "9".repeat(64) },
    ]) {
      expect(calibration(first.configHash, identityOverrides).configHash)
        .not.toBe(firstCalibration.configHash);
    }
    expect(() => calibration(first.configHash, {
      textModelRevision: "latest",
    })).toThrow(/revision must be an immutable/i);
  });

  it("verifies every evidence object against the manifest corpus and owner pack", () => {
    const entityManifest = manifest();
    const verified = verifyCapabilityEntityManifestEvidenceV2(entityManifest, {
      corpusBundleHash: CORPUS_HASH,
      objectCoursePacks: [
        { objectId: "osc-out-chop", coursePack: DIGITAL },
        { objectId: "book-layout-grid", coursePack: BOOK },
        { objectId: "book-document-grid", coursePack: BOOK },
        { objectId: "design-status-feedback", coursePack: GENERAL },
        { objectId: "design-double-diamond", coursePack: GENERAL },
        { objectId: "design-operation-status", coursePack: GENERAL },
      ],
    });
    expect(verified).toMatchObject({
      corpusBundleHash: CORPUS_HASH,
      manifestHash: entityManifest.configHash,
      entityCount: 5,
      evidenceObjectCount: 6,
    });
    expect(verified.evidenceBindingHash).toMatch(/^[0-9a-f]{64}$/);

    expect(() => verifyCapabilityEntityManifestEvidenceV2(entityManifest, {
      corpusBundleHash: CORPUS_HASH,
      objectCoursePacks: [
        { objectId: "osc-out-chop", coursePack: GENERAL },
        { objectId: "book-layout-grid", coursePack: BOOK },
        { objectId: "book-document-grid", coursePack: BOOK },
        { objectId: "design-status-feedback", coursePack: GENERAL },
        { objectId: "design-double-diamond", coursePack: GENERAL },
        { objectId: "design-operation-status", coursePack: GENERAL },
      ],
    })).toThrow(/owner mismatch/i);
  });
});

describe("T4.1 pack competition observation conversion", () => {
  it("maps only metric-correct AVAILABLE observations with one agreed scope", () => {
    const mapped = mapPackCompetitionObservationsToBoundaryDiagnosticsV2(
      competitionObservations(),
      {
        [DIGITAL.id]: DIGITAL.version,
        [GENERAL.id]: GENERAL.version,
      },
    );
    expect(mapped).toMatchObject({
      LEXICAL: {
        status: "HEALTHY",
        globalWinner: {
          coursePack: DIGITAL,
          objectId: "osc-out-chop",
          representationId: null,
          score: 0.875,
        },
        scopedWinner: {
          coursePack: GENERAL,
          objectId: "design-status-feedback",
          score: 0.25,
        },
        foreignPackMargin: 0.625,
        scopedSufficiency: 0.25,
        distinctObjectCount: 5,
        distinctRepresentationCount: 8,
      },
      TEXT_VECTOR: {
        status: "HEALTHY",
        globalWinner: {
          coursePack: DIGITAL,
          representationId: "repr-osc-out",
          score: 0.75,
        },
        foreignPackMargin: 0.5,
        scopedSufficiency: 0.25,
      },
    });
  });

  it("returns undefined without throwing for unavailable, invalid, or mismatched inputs", () => {
    const observations = competitionObservations();
    const versions = {
      [DIGITAL.id]: DIGITAL.version,
      [GENERAL.id]: GENERAL.version,
    };
    const unavailable = {
      ...observations,
      LEXICAL: {
        status: "UNAVAILABLE",
        reason: "NOT_PROVIDED",
        packCompetition: null,
      },
    };
    expect(mapPackCompetitionObservationsToBoundaryDiagnosticsV2(
      unavailable,
      versions,
    )).toBeUndefined();

    const wrongMetric = {
      ...observations,
      LEXICAL: {
        ...observations.LEXICAL,
        packCompetition: {
          ...observations.LEXICAL.packCompetition,
          scoreMetric: "COSINE_SIMILARITY",
        },
      },
    };
    expect(mapPackCompetitionObservationsToBoundaryDiagnosticsV2(
      wrongMetric,
      versions,
    )).toBeUndefined();

    const scopeMismatch = {
      ...observations,
      TEXT_VECTOR: {
        ...observations.TEXT_VECTOR,
        packCompetition: {
          ...observations.TEXT_VECTOR.packCompetition,
          sourceScope: { coursePackId: null },
          scopedWinner: null,
          globalToScopedMargin: null,
        },
      },
    };
    expect(mapPackCompetitionObservationsToBoundaryDiagnosticsV2(
      scopeMismatch,
      versions,
    )).toBeUndefined();
    expect(mapPackCompetitionObservationsToBoundaryDiagnosticsV2(
      observations,
      { [GENERAL.id]: GENERAL.version },
    )).toBeUndefined();
    expect(() => mapPackCompetitionObservationsToBoundaryDiagnosticsV2(
      { LEXICAL: { status: "INVALID" }, TEXT_VECTOR: 42 },
      versions,
    )).not.toThrow();
    expect(mapPackCompetitionObservationsToBoundaryDiagnosticsV2(
      { LEXICAL: { status: "INVALID" }, TEXT_VECTOR: 42 },
      versions,
    )).toBeUndefined();
  });
});

describe("T4.1 capability boundary decisions", () => {
  it("independently rejects an audited exclusive entity owned by a foreign pack", () => {
    const result = applyCapabilityBoundaryV2(input({
      normalizedText: normalizeCapabilityEntityTextV2(
        "请检查 OSC Out CHOP 的发送设置",
      ),
      diagnostics: undefined,
    }));
    expect(result.acceptedCandidateIds).toEqual([]);
    expect(result.trace).toMatchObject({
      decision: "REJECT",
      reason: "EXCLUSIVE_ENTITY_FOREIGN_PACK",
      acceptedCandidateIdsBefore: ["node-accepted"],
      acceptedCandidateIdsAfter: [],
    });
    expect(result.trace?.matchedEntities[0]).toMatchObject({
      entityId: "osc-out-chop",
      alias: "osc out chop",
      aliasClassification: "EXCLUSIVE",
    });
  });

  it("uses longest aliases while broad ambiguous terms never hard-reject by themselves", () => {
    const longest = applyCapabilityBoundaryV2(input({
      normalizedText: normalizeCapabilityEntityTextV2(
        "TOP 节点里请检查 OSC Out CHOP",
      ),
      diagnostics: undefined,
    }));
    expect(longest.trace?.reason).toBe("EXCLUSIVE_ENTITY_FOREIGN_PACK");

    const broad = applyCapabilityBoundaryV2(input({
      normalizedText: normalizeCapabilityEntityTextV2(
        "TOP 节点、品牌、版式和印刷怎么一起看",
      ),
    }));
    expect(broad.acceptedCandidateIds).toEqual(["node-accepted"]);
    expect(broad.trace).toMatchObject({
      decision: "ABSTAIN",
      reason: "AMBIGUOUS_ENTITY_PRESENT",
    });
  });

  it("resolves longest aliases per overlapping span instead of across the whole query", () => {
    const nonOverlapping = applyCapabilityBoundaryV2(input({
      normalizedText: normalizeCapabilityEntityTextV2(
        "品牌双钻的两个阶段怎么区分",
      ),
      sourceCoursePack: DIGITAL,
      diagnostics: undefined,
    }));
    expect(nonOverlapping.acceptedCandidateIds).toEqual([]);
    expect(nonOverlapping.trace).toMatchObject({
      decision: "REJECT",
      reason: "EXCLUSIVE_ENTITY_FOREIGN_PACK",
      matchedEntities: expect.arrayContaining([
        expect.objectContaining({
          alias: "品牌",
          matchStart: 0,
          matchEnd: 2,
        }),
        expect.objectContaining({
          alias: "双钻",
          matchStart: 2,
          matchEnd: 4,
        }),
      ]),
    });

    const sameForeignOwner = applyCapabilityBoundaryV2(input({
      normalizedText: normalizeCapabilityEntityTextV2(
        "双钻和状态反馈怎么结合",
      ),
      sourceCoursePack: DIGITAL,
      diagnostics: undefined,
    }));
    expect(sameForeignOwner.acceptedCandidateIds).toEqual([]);
    expect(sameForeignOwner.trace).toMatchObject({
      decision: "REJECT",
      reason: "EXCLUSIVE_ENTITY_FOREIGN_PACK",
    });
  });

  it("protects an exclusive entity that belongs to the scoped pack", () => {
    const result = applyCapabilityBoundaryV2(input({
      normalizedText: normalizeCapabilityEntityTextV2("OSC Out CHOP 地址"),
      sourceCoursePack: DIGITAL,
    }));
    expect(result.acceptedCandidateIds).toEqual(["node-accepted"]);
    expect(result.trace).toMatchObject({
      decision: "ABSTAIN",
      reason: "SCOPED_EXCLUSIVE_ENTITY_PRESENT",
    });
  });

  it("rejects by competition only when both channels agree on one foreign pack", () => {
    const result = applyCapabilityBoundaryV2(input());
    expect(result.acceptedCandidateIds).toEqual([]);
    expect(result.trace).toMatchObject({
      decision: "REJECT",
      reason: "DUAL_CHANNEL_FOREIGN_PACK_MARGIN",
      diagnostics: {
        LEXICAL: { foreignPackMargin: 0.6, scopedSufficiency: 0.2 },
        TEXT_VECTOR: { foreignPackMargin: 0.2, scopedSufficiency: 0.3 },
      },
    });
  });

  it("abstains on missing, illegal, or disagreeing competition diagnostics", () => {
    const missing = applyCapabilityBoundaryV2(input({ diagnostics: undefined }));
    expect(missing.trace?.reason).toBe("DIAGNOSTICS_MISSING");
    expect(missing.acceptedCandidateIds).toEqual(["node-accepted"]);

    const invalid = applyCapabilityBoundaryV2(input({
      diagnostics: { ...diagnostics(), extra: true },
    }));
    expect(invalid.trace?.reason).toBe("DIAGNOSTICS_INVALID");

    const fabricatedMargin = diagnostics();
    fabricatedMargin.LEXICAL.foreignPackMargin = 0.7;
    expect(applyCapabilityBoundaryV2(input({
      diagnostics: fabricatedMargin,
    })).trace?.reason).toBe("DIAGNOSTICS_INVALID");

    const disagreeing = diagnostics();
    disagreeing.TEXT_VECTOR.globalWinner.coursePack = BOOK;
    const disagreement = applyCapabilityBoundaryV2(input({
      diagnostics: disagreeing,
    }));
    expect(disagreement.trace?.reason).toBe("CHANNEL_PACK_DISAGREEMENT");
    expect(disagreement.acceptedCandidateIds).toEqual(["node-accepted"]);
  });

  it("abstains when samples or margins are insufficient or scoped evidence is sufficient", () => {
    const tooSmall = diagnostics();
    tooSmall.LEXICAL.distinctObjectCount = 2;
    tooSmall.LEXICAL.distinctRepresentationCount = 2;
    expect(applyCapabilityBoundaryV2(input({
      diagnostics: tooSmall,
    })).trace?.reason).toBe("INSUFFICIENT_COMPETITION_SAMPLE");

    const lowMargin = diagnostics();
    lowMargin.TEXT_VECTOR.foreignPackMargin = 0.09;
    lowMargin.TEXT_VECTOR.globalWinner.score = 0.39;
    expect(applyCapabilityBoundaryV2(input({
      diagnostics: lowMargin,
    })).trace?.reason).toBe("MARGIN_BELOW_THRESHOLD");

    const sufficientScopedEvidence = diagnostics();
    sufficientScopedEvidence.LEXICAL.scopedSufficiency = 0.5;
    sufficientScopedEvidence.LEXICAL.scopedWinner.score = 0.5;
    sufficientScopedEvidence.LEXICAL.foreignPackMargin = 0.3;
    expect(applyCapabilityBoundaryV2(input({
      diagnostics: sufficientScopedEvidence,
    })).trace?.reason).toBe("SCOPED_SUFFICIENCY_PROTECTED");
  });

  it("skips inapplicable paths and leaves non-TTT results bitwise-compatible", () => {
    const accepted = ["node-accepted"];
    const nonText = applyCapabilityBoundaryV2({
      ...input({
        queryMode: "TEXT_TO_IMAGE",
        normalizedText: normalizeCapabilityEntityTextV2("OSC Out CHOP"),
        acceptedCandidateIds: accepted,
      }),
      manifest: null as never,
      calibration: null as never,
    });
    expect(nonText).toEqual({
      acceptedCandidateIds: accepted,
      trace: null,
    });

    expect(applyCapabilityBoundaryV2(input({
      acceptedCandidateIds: [],
    })).trace?.reason).toBe("SKIPPED_NO_ACCEPTED_EVIDENCE");
    expect(applyCapabilityBoundaryV2(input({
      degradedLexicalFallback: true,
    })).trace?.reason).toBe("SKIPPED_DEGRADED_LEXICAL_FALLBACK");
    expect(applyCapabilityBoundaryV2(input({
      channelStatuses: { LEXICAL: "SUCCESS", TEXT_VECTOR: "TIMEOUT" },
    })).trace?.reason).toBe("SKIPPED_UNHEALTHY_TEXT_CHANNELS");
    expect(applyCapabilityBoundaryV2(input({
      sourceCoursePack: null,
    })).trace?.reason).toBe("SKIPPED_UNSCOPED");
    expect(applyCapabilityBoundaryV2(input({
      corpusBundleHash: "d".repeat(64),
    })).trace?.reason).toBe("SKIPPED_CORPUS_IDENTITY_MISMATCH");
  });

  it("rejects tampered audit identities instead of silently recomputing them", () => {
    const entityManifest = manifest();
    expect(() => applyCapabilityBoundaryV2(input({
      manifest: { ...entityManifest, version: "9.9.9" },
      calibration: calibration(entityManifest.configHash),
    }))).toThrow(/manifest config hash mismatch/i);

    expect(() => applyCapabilityBoundaryV2(input({
      calibration: {
        ...calibration(entityManifest.configHash),
        developmentSuiteHash: "e".repeat(64),
      },
    }))).toThrow(/calibration config hash mismatch/i);

    expect(() => applyCapabilityBoundaryV2(input({
      calibration: calibration(entityManifest.configHash, {
        corpusBundleHash: "1".repeat(64),
      }),
    }))).toThrow(/calibration identity mismatch/i);

    expect(() => applyCapabilityBoundaryV2(input({
      textProviderIndexBundleHash: "1".repeat(64),
    }))).toThrow(/calibration identity mismatch/i);

    expect(() => applyCapabilityBoundaryV2(input({
      originalText: "OSC Out CHOP",
      normalizedText:
        normalizeCapabilityEntityTextV2("另一个问题"),
    }))).toThrow(/derived from original text/i);
  });
});
