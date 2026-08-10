// @vitest-environment node

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createCapabilityEntityManifestV2,
} from "@/lib/knowledge/capability-boundary-v2";
import {
  ChannelRetrievalResultV2Schema,
} from "@/lib/knowledge/hybrid-retriever-v2";
import {
  sealKnowledgeCorpusBundleV2,
  sealKnowledgeObjectV2,
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeObjectV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  decomposeRetrievalClaimsV1,
} from "@/lib/knowledge/query-claim-decomposer-v1";
import {
  createRetrievalQueryV2,
} from "@/lib/knowledge/retrieval-query-v2";
import {
  createTextObjectChannelProbeV3,
} from "@/lib/knowledge/text-object-channel-probe-v3";
import {
  buildT44ClaimCandidateCaseV1,
  createT44ClaimCandidateRuntimeInputV1,
  evaluateT44ClaimCandidateOracleV1,
  serializeT44ClaimCandidateRuntimeInputV1,
  sha256T44ClaimCandidateRuntimeInputV1,
  T44_CLAIM_CANDIDATE_CONFIG_HASH_V1,
  T44_CLAIM_CANDIDATE_CONFIG_V1,
  T44ClaimCandidateRuntimeInputV1Schema,
} from "../../../tools/mixed-retrieval/t44-claim-candidate-evaluator";

const ACTIVE_HASH = "a".repeat(64);
const PROVIDER_HASH = "b".repeat(64);
const CONFIG_HASH = "c".repeat(64);
const PAYLOAD_HASH = "d".repeat(64);
const MODEL_REVISION = "e".repeat(40);
const SUITE_HASH = "f".repeat(64);
const COURSE_PACK_IDS = [
  "book-design",
  "brand-vi-design",
  "digital-interaction",
  "general-design",
  "layout-design",
] as const;

function syntheticObject(input: {
  coursePackId: typeof COURSE_PACK_IDS[number];
  ordinal: number;
}) {
  const slug =
    `fixture-${input.coursePackId}-${input.ordinal}`;
  const documentId = `node-${slug}-document`;
  const sectionId = `node-${slug}-section`;
  const contentId = `node-${slug}-content`;
  const factId = `node-${slug}-fact`;
  const actionId = `node-${slug}-action`;
  const sourcePath =
    `data/courses/${input.coursePackId}/${slug}.md`;
  const content = `这是 ${slug} 的合成课程内容。`;
  const fact = `事实证据 ${slug}。`;
  const action = `先确认任务，再处理 ${slug}。`;
  return sealKnowledgeObjectV2({
    schemaVersion: 2,
    id: slug,
    title: `合成对象 ${slug}`,
    topic: "LAYOUT_DESIGN_PRINCIPLES",
    tags: ["合成候选"],
    sourceCoursePack: {
      id: input.coursePackId,
      version: "1",
    },
    sourceIdentityBasis: "COURSE_DIRECTORY",
    legacyPlacement: {
      coursePack: {
        id: input.coursePackId,
        version: "1",
      },
      namespace: "layout-design-principles",
    },
    provenance: {
      authority: "TEACHER_EXPERIENCE",
      verifiedDate: "2026-07-29",
      scope: `T4.4 合成候选 ${slug}。`,
      locators: [{
        kind: "LOCAL_DOCUMENT",
        path: sourcePath,
      }],
    },
    parser: {
      id: "lumi-knowledge-v2-bridge",
      version: "1.0.0",
    },
    contentVersion: "knowledge-object-v2.1",
    rootNodeId: documentId,
    nodes: [
      {
        id: documentId,
        kind: "DOCUMENT",
        parentId: null,
        childrenIds: [sectionId],
        relatedIds: [],
        location: null,
        title: `合成对象 ${slug}`,
      },
      {
        id: sectionId,
        kind: "SECTION",
        parentId: documentId,
        childrenIds: [
          contentId,
          factId,
          actionId,
        ],
        relatedIds: [],
        location: null,
        title: "核心内容",
        level: 2,
      },
      {
        id: contentId,
        kind: "TEXT",
        parentId: sectionId,
        childrenIds: [],
        relatedIds: [],
        location: null,
        text: content,
        role: "CONTENT",
        legacyStatementId: null,
      },
      {
        id: factId,
        kind: "TEXT",
        parentId: sectionId,
        childrenIds: [],
        relatedIds: [],
        location: null,
        text: fact,
        role: "FACT",
        legacyStatementId:
          `layoutprin-fact-${input.coursePackId}-${input.ordinal}`,
      },
      {
        id: actionId,
        kind: "TEXT",
        parentId: sectionId,
        childrenIds: [],
        relatedIds: [],
        location: null,
        text: action,
        role: "ACTION",
        legacyStatementId:
          "layoutprin-clarify-reading-task",
      },
    ],
    assetIds: [],
    annotations: [],
    legacyItem: {
      id: slug,
      title: `合成对象 ${slug}`,
      topic: "LAYOUT_DESIGN_PRINCIPLES",
      tags: ["合成候选"],
      content,
      facts: [{
        id:
          `layoutprin-fact-${input.coursePackId}-${input.ordinal}`,
        text: fact,
      }],
      actions: [{
        id: "layoutprin-clarify-reading-task",
        text: action,
      }],
      source: {
        localDocument: sourcePath,
        authority: "TEACHER_EXPERIENCE",
        verifiedDate: "2026-07-29",
        scope: `T4.4 合成候选 ${slug}。`,
      },
    },
  });
}

const corpus: KnowledgeCorpusBundleV2 =
  verifyKnowledgeCorpusBundleV2(
    sealKnowledgeCorpusBundleV2({
      schemaVersion: 2,
      corpusVersion: "2026-07-29.test",
      parser: {
        id: "lumi-knowledge-v2-bridge",
        version: "1.0.0",
      },
      contentVersion: "knowledge-object-v2.1",
      objects: [
        ...Array.from({ length: 7 }, (_, index) =>
          syntheticObject({
            coursePackId: "layout-design",
            ordinal: index + 1,
          })),
        ...COURSE_PACK_IDS
          .filter((id) => id !== "layout-design")
          .map((coursePackId) =>
            syntheticObject({
              coursePackId,
              ordinal: 1,
            })),
      ],
      assets: [],
      unreferencedAssetIds: [],
    }),
  );

function firstTextNode(object: KnowledgeObjectV2) {
  const node = object.nodes.find(
    (candidate) => candidate.kind === "TEXT",
  );
  if (!node || node.kind !== "TEXT") {
    throw new Error(`TEST_TEXT_NODE_MISSING:${object.id}`);
  }
  return node;
}

function firstAtomicNode(object: KnowledgeObjectV2) {
  const node = object.nodes.find(
    (candidate) =>
      candidate.kind === "TABLE"
      || (
        candidate.kind === "TEXT"
        && (
          candidate.role === "FACT"
          || candidate.role === "ACTION"
        )
      ),
  );
  if (!node) {
    throw new Error(
      `TEST_ATOMIC_NODE_MISSING:${object.id}`,
    );
  }
  return node;
}

function objectsForPack(
  coursePackId: string,
  count: number,
) {
  const objects = corpus.objects.filter(
    (object) =>
      object.sourceCoursePack.id === coursePackId,
  );
  if (objects.length < count) {
    throw new Error(
      `TEST_OBJECT_CAPACITY:${coursePackId}`,
    );
  }
  return objects.slice(0, count);
}

function channelResult(
  channel: "LEXICAL" | "TEXT_VECTOR",
  objects: readonly KnowledgeObjectV2[],
) {
  const rows = objects.map((object, index) => {
    const node = firstTextNode(object);
    const representationId =
      channel === "LEXICAL"
        ? null
        : `representation-${index + 1}`;
    const rawScore = objects.length - index;
    return {
      hit: {
        candidateId: node.id,
        objectId: object.id,
        representationId,
        nodeId: node.id,
        assetId: null,
        region: null,
        rank: index + 1,
        rawScore,
      },
      object: {
        objectId: object.id,
        coursePackId: object.sourceCoursePack.id,
        objectRank: index + 1,
        rawScore,
        nodes: [{
          nodeId: node.id,
          objectId: object.id,
          nodeKind: "TEXT" as const,
          representationId,
          innerRank: 1,
          rawScore,
        }],
      },
    };
  });
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel,
      status: rows.length > 0 ? "SUCCESS" : "EMPTY",
      reason: null,
      corpusBundleHash: corpus.bundleHash,
      identity: {
        activeIndexBundleHash: ACTIVE_HASH,
        providerIndexBundleHash:
          channel === "LEXICAL" ? null : PROVIDER_HASH,
        indexVersionId:
          channel === "LEXICAL"
            ? "lexical-test-index"
            : "text-test-index",
        modelId:
          channel === "LEXICAL"
            ? null
            : "test/text-model",
        modelRevision:
          channel === "LEXICAL"
            ? null
            : MODEL_REVISION,
        configHash: CONFIG_HASH,
        payloadHashes: [PAYLOAD_HASH],
      },
      hitCount: rows.length,
      timingMs: 1,
    },
    hits: rows.map(({ hit }) => hit),
    objectCandidates: rows.map(({ object }) => object),
  });
}

async function probeResult(input: {
  text: string;
  coursePackId: typeof COURSE_PACK_IDS[number];
  lexical: readonly KnowledgeObjectV2[];
  textVector: readonly KnowledgeObjectV2[];
  staticParentQuery?: ReturnType<
    typeof createRetrievalQueryV2
  >;
}) {
  const lexicalProvider = {
    retrieve: vi.fn(async () =>
      channelResult("LEXICAL", input.lexical)),
  };
  const textVectorProvider = {
    retrieve: vi.fn(async () =>
      channelResult(
        "TEXT_VECTOR",
        input.textVector,
      )),
  };
  const probe = createTextObjectChannelProbeV3({
    enabled: true,
    capabilityEntityManifest:
      createCapabilityEntityManifestV2({
        id: "t44-claim-candidate-test",
        version: "1.0.0",
        corpusBundleHash: corpus.bundleHash,
        entities: [],
      }),
    lexicalProvider,
    textVectorProvider,
  });
  const probeQuery = createRetrievalQueryV2({
    mode: "TEXT_TO_TEXT",
    text: input.text,
    scope: {
      corpusBundleHash: corpus.bundleHash,
      sourceCoursePack: {
        id: input.coursePackId,
        version: "1",
      },
    },
  });
  const result = await probe(
    probeQuery,
    input.staticParentQuery === undefined
      ? undefined
      : {
          staticParentQuery:
            input.staticParentQuery,
        },
  );
  expect(lexicalProvider.retrieve).toHaveBeenCalledTimes(1);
  expect(textVectorProvider.retrieve)
    .toHaveBeenCalledTimes(1);
  return result;
}

async function buildSingleObjectCase(input: {
  caseId: string;
  coursePackId: typeof COURSE_PACK_IDS[number];
  object: KnowledgeObjectV2;
}) {
  const query = createRetrievalQueryV2({
    mode: "TEXT_TO_TEXT",
    text: "这个方案怎么调整？",
    scope: {
      corpusBundleHash: corpus.bundleHash,
      sourceCoursePack: {
        id: input.coursePackId,
        version: "1",
      },
    },
  });
  const decomposition =
    decomposeRetrievalClaimsV1(query.normalizedText!);
  const results = await Promise.all(
    decomposition.probes.map(async (probe) => ({
      probeId: probe.probeId,
      result: await probeResult({
        text: probe.text,
        coursePackId: input.coursePackId,
        lexical: [input.object],
        textVector: [input.object],
      }),
    })),
  );
  return buildT44ClaimCandidateCaseV1({
    caseId: input.caseId,
    query,
    decomposition,
    probeResults: results,
    corpus,
  });
}

describe("T4.4 claim candidate fusion and oracle", () => {
  it("freezes the weighted RRF and candidate-oracle contracts", () => {
    expect(T44_CLAIM_CANDIDATE_CONFIG_V1)
      .toEqual({
        id: "lumi-t44-claim-candidate-fusion-v1",
        version: "2026-07-29.2",
        rrfK: 60,
        rawObjectLimitPerProbeChannel: 10,
        wholeQueryChannelWeight: 1,
        supportClaimTotalWeightPerChannel: 1,
        reservation:
          "RANK_ONE_PER_SUPPORT_CLAIM_PER_HEALTHY_CHANNEL",
        fillOrdering:
          "WEIGHTED_RRF_DESC_THEN_BEST_SOURCE_RANK_THEN_OBJECT_ID",
        maximumObjects: 16,
        eligibleAtomicNodes: [
          "TEXT/FACT",
          "TEXT/ACTION",
          "TABLE",
        ],
        maximumAtomicNodesPerObject: 11,
        maximumCandidateNodes: 176,
      });
    expect(T44_CLAIM_CANDIDATE_CONFIG_HASH_V1)
      .toMatch(/^[0-9a-f]{64}$/);
  });

  it("reserves every claim-channel rank one before weighted RRF fill", async () => {
    const objects = objectsForPack("layout-design", 7);
    const query = createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text: "层级太乱怎么收拾，同时网格总是对不齐怎么办？",
      scope: {
        corpusBundleHash: corpus.bundleHash,
        sourceCoursePack: {
          id: "layout-design",
          version: "1",
        },
      },
    });
    const decomposition =
      decomposeRetrievalClaimsV1(
        query.normalizedText!,
      );
    expect(decomposition.claims).toHaveLength(2);
    const rankings = [
      {
        lexical: [objects[0]!, objects[1]!, objects[2]!],
        textVector: [
          objects[0]!,
          objects[2]!,
          objects[1]!,
        ],
      },
      {
        lexical: [objects[3]!, objects[0]!],
        textVector: [objects[4]!, objects[0]!],
      },
      {
        lexical: [objects[5]!, objects[0]!],
        textVector: [objects[6]!, objects[0]!],
      },
    ];
    const probeResults = await Promise.all(
      decomposition.probes.map(async (probe, index) => ({
        probeId: probe.probeId,
        result: await probeResult({
          text: probe.text,
          coursePackId: "layout-design",
          ...rankings[index]!,
        }),
      })),
    );

    const candidate = buildT44ClaimCandidateCaseV1({
      caseId: "synthetic-reservation",
      query,
      decomposition,
      probeResults,
      corpus,
    });

    expect(
      candidate.objectRanking
        .slice(0, 4)
        .map(({ objectId }) => objectId),
    ).toEqual([
      objects[3]!.id,
      objects[4]!.id,
      objects[5]!.id,
      objects[6]!.id,
    ]);
    expect(candidate.objectRanking[4]!.objectId)
      .toBe(objects[0]!.id);
    expect(
      candidate.objectRanking
        .slice(0, 4)
        .every(({ reserved }) => reserved),
    ).toBe(true);
    const claimSource =
      candidate.objectRanking[0]!.sources[0]!;
    expect(claimSource.weight).toBe(0.5);
    expect(claimSource.contribution)
      .toBe(0.5 / 61);
    expect(candidate.expectedProviderCalls).toBe(6);
    expect(candidate.probeRankings).toHaveLength(3);
    expect(
      candidate.probeRankings.every(
        ({ prerequisiteBasis }) =>
          prerequisiteBasis === "PROBE_QUERY",
      ),
    ).toBe(true);
    expect(JSON.stringify(candidate)).not.toMatch(
      /qrels|requiredEvidenceGroups|hardNegative/i,
    );
    for (const rankedObject of candidate.objectRanking) {
      const object = corpus.objects.find(
        ({ id }) => id === rankedObject.objectId,
      )!;
      const expectedAtomicCount = object.nodes.filter(
        (node) =>
          node.kind === "TABLE"
          || (
            node.kind === "TEXT"
            && (
              node.role === "FACT"
              || node.role === "ACTION"
            )
          ),
      ).length;
      expect(
        candidate.candidateNodes.filter(
          ({ objectId }) =>
            objectId === rankedObject.objectId,
        ),
      ).toHaveLength(expectedAtomicCount);
    }
  });

  it("binds an ambiguous support probe to the static whole-query prerequisite", async () => {
    const objects = objectsForPack("brand-vi-design", 1);
    const query = createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text:
        "这个字标感觉太冷，怎么判断是字形问题还是受众不合适？",
      scope: {
        corpusBundleHash: corpus.bundleHash,
        sourceCoursePack: {
          id: "brand-vi-design",
          version: "1",
        },
      },
    });
    const decomposition =
      decomposeRetrievalClaimsV1(
        query.normalizedText!,
      );
    const probeResults = await Promise.all(
      decomposition.probes.map(async (probe) => ({
        probeId: probe.probeId,
        result: await probeResult({
          text: probe.text,
          staticParentQuery:
            probe.kind === "SUPPORT_CLAIM"
              ? query
              : undefined,
          coursePackId: "brand-vi-design",
          lexical: objects,
          textVector: objects,
        }),
      })),
    );

    const candidate = buildT44ClaimCandidateCaseV1({
      caseId: "static-parent-binding",
      query,
      decomposition,
      probeResults,
      corpus,
    });
    const inherited =
      candidate.probeRankings.find(
        ({ prerequisiteBasis }) =>
          prerequisiteBasis
            === "STATIC_PARENT_QUERY",
      );

    expect(inherited).toMatchObject({
      kind: "SUPPORT_CLAIM",
      probePrerequisiteDecision: "AMBIGUOUS",
      prerequisiteDecision:
        "STATIC_CORPUS_ELIGIBLE",
      queryHash: sha256StableJsonV2(query),
    });
    expect(inherited?.probeQueryHash)
      .not.toBe(inherited?.queryHash);
  });

  it("requires a byte-sealed label-blind input before loading qrels", async () => {
    const baseByPack = new Map(
      await Promise.all(
        COURSE_PACK_IDS.map(async (coursePackId) => {
          const object =
            objectsForPack(coursePackId, 1)[0]!;
          return [
            coursePackId,
            await buildSingleObjectCase({
              caseId: `base-${coursePackId}`,
              coursePackId,
              object,
            }),
          ] as const;
        }),
      ),
    );
    const cases = COURSE_PACK_IDS.flatMap(
      (coursePackId) =>
        Array.from({ length: 10 }, (_, index) => ({
          ...structuredClone(baseByPack.get(
            coursePackId,
          )!),
          caseId: `oracle-${coursePackId}-${index + 1}`,
        })),
    );
    const candidateInput =
      createT44ClaimCandidateRuntimeInputV1({
        runtimeSuite: {
          id: "lumi-t44-claim-recovery-test-runtime",
          version: "2026-07-29.1",
          suiteHash: SUITE_HASH,
        },
        corpusBundleHash: corpus.bundleHash,
        cases,
      });
    const serialized =
      serializeT44ClaimCandidateRuntimeInputV1(
        candidateInput,
      );
    const sealedHash =
      sha256T44ClaimCandidateRuntimeInputV1(serialized);
    const qrelCases = candidateInput.cases.map(
      (testCase, index) => ({
        caseId: testCase.caseId,
        multiClaim: index % 10 < 2,
        requiredEvidenceGroups: [{
          groupId: `group-${index + 1}`,
          acceptableNodeIds: [
            firstAtomicNode(
              corpus.objects.find(
                ({ id }) =>
                  id
                  === testCase.objectRanking[0]!.objectId,
              )!,
            ).id,
          ],
        }],
      }),
    );

    const report =
      evaluateT44ClaimCandidateOracleV1({
        serializedCandidateInput: serialized,
        candidateInputSha256: sealedHash,
        qrelCases,
        corpus,
      });

    expect(report.passed).toBe(true);
    expect(report.aggregate).toMatchObject({
      totalCases: 50,
      ownerOracleCaseCoverage: 50,
      groupOracleCaseCoverage: 50,
      multiClaim: {
        total: 10,
        groupOracleCaseCoverage: 10,
      },
      bindingViolationCount: 0,
    });
    expect(Object.keys(report.byCoursePack))
      .toEqual([...COURSE_PACK_IDS].sort());
    expect(() =>
      evaluateT44ClaimCandidateOracleV1({
        serializedCandidateInput: serialized,
        candidateInputSha256: "0".repeat(64),
        qrelCases,
        corpus,
      }),
    ).toThrow("T44_CLAIM_CANDIDATE_SEAL_MISMATCH");

    const insufficient =
      structuredClone(candidateInput);
    for (const testCase of insufficient.cases.slice(0, 3)) {
      testCase.candidateNodes = [];
      testCase.candidateNodeIdsSha256 =
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
    }
    const insufficientParsed =
      T44ClaimCandidateRuntimeInputV1Schema.parse(
        insufficient,
      );
    const insufficientText =
      serializeT44ClaimCandidateRuntimeInputV1(
        insufficientParsed,
      );
    const insufficientReport =
      evaluateT44ClaimCandidateOracleV1({
        serializedCandidateInput: insufficientText,
        candidateInputSha256:
          sha256T44ClaimCandidateRuntimeInputV1(
            insufficientText,
          ),
        qrelCases,
        corpus,
      });
    expect(
      insufficientReport.aggregate
        .groupOracleCaseCoverage,
    ).toBe(47);
    expect(
      insufficientReport.gates
        .groupOracleCaseCoverage.passed,
    ).toBe(false);
    expect(insufficientReport.passed).toBe(false);

    const sourceDrift = structuredClone(candidateInput);
    sourceDrift.cases[0]!.candidateNodes[0]!.sourceHash =
      "0".repeat(64);
    const sourceDriftText =
      serializeT44ClaimCandidateRuntimeInputV1(
        T44ClaimCandidateRuntimeInputV1Schema.parse(
          sourceDrift,
        ),
      );
    const sourceDriftReport =
      evaluateT44ClaimCandidateOracleV1({
        serializedCandidateInput: sourceDriftText,
        candidateInputSha256:
          sha256T44ClaimCandidateRuntimeInputV1(
            sourceDriftText,
          ),
        qrelCases,
        corpus,
      });
    expect(
      sourceDriftReport.aggregate
        .bindingViolationCount,
    ).toBe(1);
    expect(
      sourceDriftReport.gates
        .bindingViolations.passed,
    ).toBe(false);
  });
});
