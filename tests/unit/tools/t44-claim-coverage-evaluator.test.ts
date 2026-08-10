// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

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
  serializeT44ClaimCandidateRuntimeInputV1,
  sha256T44ClaimCandidateRuntimeInputV1,
} from "../../../tools/mixed-retrieval/t44-claim-candidate-evaluator";
import {
  buildT44ClaimSelectionArtifactV1,
  evaluateT44ClaimCoverageV1,
  maximumWeightClaimNodeAssignmentV1,
  selectT44BaselineNodesV1,
  selectT44ClaimCoverageNodesV1,
  serializeT44ClaimMatrixOutputV1,
  serializeT44ClaimSelectionArtifactV1,
  sha256T44ClaimSelectionArtifactV1,
  T44_CLAIM_COVERAGE_GATES_V1,
  T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1,
  T44_CLAIM_COVERAGE_STRATA_V1,
  T44_CLAIM_MATRIX_CONFIG_HASH_V1,
  T44_CLAIM_MATRIX_CONFIG_V1,
  T44ClaimMatrixSidecarOutputV1Schema,
  type T44ClaimMatrixRankedNodeV1,
} from "../../../tools/mixed-retrieval/t44-claim-coverage-evaluator";

const COURSE_PACKS = [
  "book-design",
  "brand-vi-design",
  "digital-interaction",
  "general-design",
  "layout-design",
] as const;
type CoursePackId = typeof COURSE_PACKS[number];

const ACTIVE_HASH = "a".repeat(64);
const PROVIDER_HASH = "b".repeat(64);
const CONFIG_HASH = "c".repeat(64);
const PAYLOAD_HASH = "d".repeat(64);
const MODEL_REVISION = "e".repeat(40);
const SUITE_HASH = "f".repeat(64);

function ranked(
  id: string,
  objectId: string,
  rank: number,
  score = 100 - rank,
): T44ClaimMatrixRankedNodeV1 {
  return {
    nodeId: `node-${id}`,
    objectId,
    coursePackId: "layout-design",
    score,
    rank,
  };
}

function rerankFirst(
  rows: readonly T44ClaimMatrixRankedNodeV1[],
  nodeId: string,
) {
  return [...rows]
    .sort((left, right) =>
      left.nodeId === nodeId
        ? -1
        : right.nodeId === nodeId
          ? 1
          : left.rank - right.rank)
    .map((row, index) => ({
      ...row,
      score: 100 - index,
      rank: index + 1,
    }));
}

function matrixTransportFixture(caseCount: number) {
  return {
    schemaVersion: 1 as const,
    kind: "T44_CLAIM_NODE_MATRIX_SCORES" as const,
    candidateInputSha256: ACTIVE_HASH,
    runtimeSuite: {
      id: "lumi-t44-claim-coverage-test-runtime",
      version: "2026-07-29.1",
      suiteHash: SUITE_HASH,
    },
    corpusBundleHash: ACTIVE_HASH,
    config: T44_CLAIM_MATRIX_CONFIG_V1,
    configHash: T44_CLAIM_MATRIX_CONFIG_HASH_V1,
    model: {
      modelId: "BAAI/bge-small-zh-v1.5" as const,
      modelRevision:
        "7999e1d3359715c523056ef9478215996d62a620" as const,
      modelLicense: "MIT" as const,
      modelDirectorySha256: ACTIVE_HASH,
      modelSealSha256: PROVIDER_HASH,
      indexBundleHash: CONFIG_HASH,
      indexPayloadSha256: PAYLOAD_HASH,
    },
    environment: {
      pythonVersion: "3.12.0",
      torchVersion: "test",
      transformersVersion: "test",
      safetensorsVersion: "test",
      actualDevice: "cpu" as const,
      cudaRuntime: null,
      deviceName: null,
      tokenizerClassName: "TestTokenizer",
      modelClassName: "TestModel",
      modelDtype: "torch.float32",
    },
    timingProtocol: {
      warmupRunsPerModel: 1 as const,
      repetitionsPerCase: 3 as const,
      caseAggregate: "MEDIAN" as const,
      suiteAggregate: "P95_NEAREST_RANK" as const,
      aMatrixBoundary:
        T44_CLAIM_MATRIX_CONFIG_V1.aMatrixBoundary,
      bMatrixBoundary:
        T44_CLAIM_MATRIX_CONFIG_V1.bMatrixBoundary,
    },
    cases: Array.from(
      { length: caseCount },
      (_, index) => ({
        caseId: `matrix-case-${index + 1}`,
        coursePackId: "layout-design",
        candidateCount: 0,
        candidateNodeIdsSha256:
          sha256StableJsonV2([]),
        arms: {
          A_FULL_QUERY: {
            timingMs: {
              samples: [1, 1, 1],
              median: 1,
            },
            wholeQueryRanking: [],
          },
          B_CLAIM_MATRIX: {
            timingMs: {
              samples: [2, 2, 2],
              median: 2,
            },
            wholeQueryRanking: [],
            claimRankings: [{
              claimId: "claim-1",
              textHash: ACTIVE_HASH,
              ranking: [],
            }],
          },
        },
      }),
    ),
  };
}

const SHORT_PACK = {
  "book-design": "book",
  "brand-vi-design": "brand",
  "digital-interaction": "digital",
  "general-design": "general",
  "layout-design": "layout",
} as const;

function nodeId(...parts: readonly unknown[]) {
  return `node-${sha256StableJsonV2(parts)}`;
}

function syntheticObject(input: {
  coursePackId: CoursePackId;
  kind: "primary" | "decoy";
}) {
  const short = SHORT_PACK[input.coursePackId];
  const slug = `claim-${short}-${input.kind}`;
  const documentId = nodeId(slug, "document");
  const sectionId = nodeId(slug, "section");
  const contentId = nodeId(slug, "content");
  const sourcePath =
    `data/courses/${input.coursePackId}/${slug}.md`;
  const statementCount =
    input.kind === "primary" ? 8 : 2;
  const facts = Array.from(
    { length: Math.ceil(statementCount / 2) },
    (_, index) => ({
      id: `layoutprin-${short}-${input.kind}-fact-${index + 1}`,
      text:
        `${slug} 的事实证据 ${index + 1}。`,
    }),
  );
  const actions = Array.from(
    { length: Math.floor(statementCount / 2) },
    (_, index) => ({
      id:
        index === 0
          ? "layoutprin-clarify-reading-task"
          : `layoutprin-${short}-${input.kind}-action-${index + 1}`,
      text:
        `${slug} 的操作证据 ${index + 1}。`,
    }),
  );
  const statements = [
    ...facts.map((statement) => ({
      ...statement,
      role: "FACT" as const,
    })),
    ...actions.map((statement) => ({
      ...statement,
      role: "ACTION" as const,
    })),
  ];
  const statementNodes = statements.map(
    (statement, index) => ({
      id: nodeId(slug, statement.role, index),
      kind: "TEXT" as const,
      parentId: sectionId,
      childrenIds: [],
      relatedIds: [],
      location: null,
      text: statement.text,
      role: statement.role,
      legacyStatementId: statement.id,
    }),
  );
  const content = `${slug} 的合成课程正文。`;
  return sealKnowledgeObjectV2({
    schemaVersion: 2,
    id: slug,
    title: `合成 ${slug}`,
    topic: "LAYOUT_DESIGN_PRINCIPLES",
    tags: ["声明覆盖"],
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
      scope: `T4.4 ${slug} 合成验证。`,
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
        title: `合成 ${slug}`,
      },
      {
        id: sectionId,
        kind: "SECTION",
        parentId: documentId,
        childrenIds: [
          contentId,
          ...statementNodes.map(({ id }) => id),
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
      ...statementNodes,
    ],
    assetIds: [],
    annotations: [],
    legacyItem: {
      id: slug,
      title: `合成 ${slug}`,
      topic: "LAYOUT_DESIGN_PRINCIPLES",
      tags: ["声明覆盖"],
      content,
      facts,
      actions,
      source: {
        localDocument: sourcePath,
        authority: "TEACHER_EXPERIENCE",
        verifiedDate: "2026-07-29",
        scope: `T4.4 ${slug} 合成验证。`,
      },
    },
  });
}

function syntheticCorpus() {
  return sealKnowledgeCorpusBundleV2({
    schemaVersion: 2,
    corpusVersion: "2026-07-29.claim-test",
    parser: {
      id: "lumi-knowledge-v2-bridge",
      version: "1.0.0",
    },
    contentVersion: "knowledge-object-v2.1",
    objects: COURSE_PACKS.flatMap((coursePackId) => [
      syntheticObject({
        coursePackId,
        kind: "primary",
      }),
      syntheticObject({
        coursePackId,
        kind: "decoy",
      }),
    ]),
    assets: [],
    unreferencedAssetIds: [],
  });
}

function textNode(object: KnowledgeObjectV2) {
  const node = object.nodes.find(
    (candidate) =>
      candidate.kind === "TEXT"
      && candidate.role === "CONTENT",
  );
  if (!node || node.kind !== "TEXT") {
    throw new Error("TEST_CONTENT_NODE_MISSING");
  }
  return node;
}

function channelResult(
  corpus: KnowledgeCorpusBundleV2,
  channel: "LEXICAL" | "TEXT_VECTOR",
  object: KnowledgeObjectV2,
) {
  const node = textNode(object);
  const representationId =
    channel === "LEXICAL"
      ? null
      : "claim-test-representation";
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel,
      status: "SUCCESS",
      reason: null,
      corpusBundleHash: corpus.bundleHash,
      identity: {
        activeIndexBundleHash: ACTIVE_HASH,
        providerIndexBundleHash:
          channel === "LEXICAL"
            ? null
            : PROVIDER_HASH,
        indexVersionId:
          channel === "LEXICAL"
            ? "claim-lexical-index"
            : "claim-text-index",
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
      hitCount: 1,
      timingMs: 1,
    },
    hits: [{
      candidateId: node.id,
      objectId: object.id,
      representationId,
      nodeId: node.id,
      assetId: null,
      region: null,
      rank: 1,
      rawScore: 1,
    }],
    objectCandidates: [{
      objectId: object.id,
      coursePackId: object.sourceCoursePack.id,
      objectRank: 1,
      rawScore: 1,
      nodes: [{
        nodeId: node.id,
        objectId: object.id,
        nodeKind: "TEXT",
        representationId,
        innerRank: 1,
        rawScore: 1,
      }],
    }],
  });
}

async function candidateCaseForPack(input: {
  corpus: KnowledgeCorpusBundleV2;
  coursePackId: CoursePackId;
  primary: KnowledgeObjectV2;
}) {
  const query = createRetrievalQueryV2({
    mode: "TEXT_TO_TEXT",
    text: "先看第一部分怎么改，同时检查第二部分怎么办？",
    scope: {
      corpusBundleHash: input.corpus.bundleHash,
      sourceCoursePack: {
        id: input.coursePackId,
        version: "1",
      },
    },
  });
  const decomposition =
    decomposeRetrievalClaimsV1(
      query.normalizedText!,
    );
  expect(decomposition.claims).toHaveLength(2);
  const probe = createTextObjectChannelProbeV3({
    enabled: true,
    capabilityEntityManifest:
      createCapabilityEntityManifestV2({
        id: "claim-coverage-test-manifest",
        version: "1.0.0",
        corpusBundleHash: input.corpus.bundleHash,
        entities: [],
      }),
    lexicalProvider: {
      retrieve: vi.fn(async () =>
        channelResult(
          input.corpus,
          "LEXICAL",
          input.primary,
        )),
    },
    textVectorProvider: {
      retrieve: vi.fn(async () =>
        channelResult(
          input.corpus,
          "TEXT_VECTOR",
          input.primary,
        )),
    },
  });
  const probeResults = await Promise.all(
    decomposition.probes.map(async (claimProbe) => ({
      probeId: claimProbe.probeId,
      result: await probe(createRetrievalQueryV2({
        mode: "TEXT_TO_TEXT",
        text: claimProbe.text,
        scope: query.scope,
      })),
    })),
  );
  return buildT44ClaimCandidateCaseV1({
    caseId: `base-${input.coursePackId}`,
    query,
    decomposition,
    probeResults,
    corpus: input.corpus,
  });
}

function matrixRanking(
  nodes: readonly {
    nodeId: string;
    objectId: string;
    coursePackId: string;
  }[],
  firstNodeId?: string,
) {
  const ordered = firstNodeId
    ? [
        ...nodes.filter(
          ({ nodeId: id }) => id === firstNodeId,
        ),
        ...nodes.filter(
          ({ nodeId: id }) => id !== firstNodeId,
        ),
      ]
    : [...nodes];
  return ordered.map((node, index) => ({
    ...node,
    score: 100 - index,
    rank: index + 1,
  }));
}

describe("T4.4 claim coverage selector", () => {
  it("accepts 20- and 50-case label-blind matrix transports", () => {
    for (const caseCount of [20, 50]) {
      const parsed =
        T44ClaimMatrixSidecarOutputV1Schema.parse(
          matrixTransportFixture(caseCount),
        );
      expect(parsed.cases).toHaveLength(caseCount);
    }
  });

  it("freezes assignment, fill, timing, and gate contracts", () => {
    expect(T44_CLAIM_MATRIX_CONFIG_V1)
      .toMatchObject({
        modelId: "BAAI/bge-small-zh-v1.5",
        maxClaims: 4,
        maximumCandidateNodes: 176,
        repetitions: 3,
      });
    expect(T44_CLAIM_MATRIX_CONFIG_HASH_V1)
      .toMatch(/^[0-9a-f]{64}$/);
    expect(T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1)
      .toMatchObject({
        topK: 8,
        baselineMaxPerObject: 3,
        claimCandidateLimit: 8,
        fillRrfK: 60,
        timingRepetitions: 3,
      });
    expect(T44_CLAIM_COVERAGE_GATES_V1)
      .toEqual({
        supportCaseCoverageMinimum: 45,
        multiClaimJointCoverageMinimum: 9,
        bindingViolationMaximum: 0,
        nodeSelectionExtraP95MaximumMs: 50,
        candidateExpansionP95MaximumMs: 250,
      });
  });

  it("uses claim order and node id to break equal assignment weights", () => {
    const rows = [
      ranked("a", "object-one", 1),
      ranked("b", "object-two", 2),
    ];
    const assignments =
      maximumWeightClaimNodeAssignmentV1([
        {
          claimId: "claim-1",
          ranking: rows,
        },
        {
          claimId: "claim-2",
          ranking: rows,
        },
      ]);

    expect(assignments.map(({ claimId, nodeId }) => ({
      claimId,
      nodeId,
    }))).toEqual([
      { claimId: "claim-1", nodeId: "node-a" },
      { claimId: "claim-2", nodeId: "node-b" },
    ]);
  });

  it("covers four claims from one object instead of applying the baseline cap", () => {
    const whole = [
      ranked("a", "object-shared", 1),
      ranked("b", "object-shared", 2),
      ranked("c", "object-shared", 3),
      ranked("d", "object-shared", 4),
      ranked("e", "object-other-a", 5),
      ranked("f", "object-other-b", 6),
      ranked("g", "object-other-c", 7),
      ranked("h", "object-other-d", 8),
    ];
    const claims = ["a", "b", "c", "d"].map(
      (id, index) => ({
        claimId: `claim-${index + 1}`,
        ranking: rerankFirst(whole, `node-${id}`),
      }),
    );

    const baseline = selectT44BaselineNodesV1(whole);
    const claimAware = selectT44ClaimCoverageNodesV1({
      wholeQueryRanking: whole,
      claimRankings: claims,
    });

    expect(
      baseline.filter(
        ({ objectId }) =>
          objectId === "object-shared",
      ),
    ).toHaveLength(3);
    expect(
      claimAware
        .slice(0, 4)
        .map(({ nodeId, selectionSource }) => ({
          nodeId,
          selectionSource,
        })),
    ).toEqual([
      {
        nodeId: "node-a",
        selectionSource: "CLAIM_ASSIGNMENT",
      },
      {
        nodeId: "node-b",
        selectionSource: "CLAIM_ASSIGNMENT",
      },
      {
        nodeId: "node-c",
        selectionSource: "CLAIM_ASSIGNMENT",
      },
      {
        nodeId: "node-d",
        selectionSource: "CLAIM_ASSIGNMENT",
      },
    ]);
  });

  it("preserves cross-object claims and labels non-claim hard negatives as fill", () => {
    const whole = [
      ranked("h", "object-hard", 1),
      ranked("a", "object-a", 2),
      ranked("b", "object-b", 3),
      ranked("c", "object-a", 4),
      ranked("d", "object-b", 5),
    ];
    const selected = selectT44ClaimCoverageNodesV1({
      wholeQueryRanking: whole,
      claimRankings: [
        {
          claimId: "claim-1",
          ranking: rerankFirst(whole, "node-a"),
        },
        {
          claimId: "claim-2",
          ranking: rerankFirst(whole, "node-b"),
        },
      ],
    });

    expect(selected.slice(0, 2).map(
      ({ nodeId, objectId }) => ({
        nodeId,
        objectId,
      }),
    )).toEqual([
      { nodeId: "node-a", objectId: "object-a" },
      { nodeId: "node-b", objectId: "object-b" },
    ]);
    expect(
      selected.find(({ nodeId }) => nodeId === "node-h")
        ?.selectionSource,
    ).toBe("RRF_FILL");
  });

  it("fills one node per object per round using a fixed object order", () => {
    const whole = [
      ranked("a1", "object-a", 1),
      ranked("a2", "object-a", 2),
      ranked("a3", "object-a", 3),
      ranked("b1", "object-b", 4),
      ranked("b2", "object-b", 5),
      ranked("c1", "object-c", 6),
      ranked("d1", "object-d", 7),
      ranked("e1", "object-e", 8),
    ];
    const selected = selectT44ClaimCoverageNodesV1({
      wholeQueryRanking: whole,
      claimRankings: [{
        claimId: "claim-1",
        ranking: whole,
      }],
    });

    expect(selected.map(({ nodeId }) => nodeId))
      .toEqual([
        "node-a1",
        "node-a2",
        "node-b1",
        "node-c1",
        "node-d1",
        "node-e1",
        "node-a3",
        "node-b2",
      ]);
  });

  it("builds a label-blind selection artifact and passes the frozen gates", async () => {
    const corpus = syntheticCorpus();
    const objectFor = (
      coursePackId: CoursePackId,
      kind: "primary" | "decoy",
    ) => corpus.objects.find((object) =>
      object.sourceCoursePack.id === coursePackId
      && object.id.endsWith(kind))!;
    const baseCases = new Map(
      await Promise.all(
        COURSE_PACKS.map(async (coursePackId) => [
          coursePackId,
          await candidateCaseForPack({
            corpus,
            coursePackId,
            primary: objectFor(coursePackId, "primary"),
          }),
        ] as const),
      ),
    );
    const cases = COURSE_PACKS.flatMap(
      (coursePackId) =>
        Array.from({ length: 10 }, (_, index) => ({
          ...structuredClone(baseCases.get(
            coursePackId,
          )!),
          caseId:
            `coverage-${coursePackId}-${index + 1}`,
        })),
    );
    const candidate =
      createT44ClaimCandidateRuntimeInputV1({
        runtimeSuite: {
          id: "lumi-t44-claim-coverage-test-runtime",
          version: "2026-07-29.1",
          suiteHash: SUITE_HASH,
        },
        corpusBundleHash: corpus.bundleHash,
        cases,
      });
    const candidateText =
      serializeT44ClaimCandidateRuntimeInputV1(
        candidate,
      );
    const candidateHash =
      sha256T44ClaimCandidateRuntimeInputV1(
        candidateText,
      );
    const matrix =
      T44ClaimMatrixSidecarOutputV1Schema.parse({
        schemaVersion: 1,
        kind: "T44_CLAIM_NODE_MATRIX_SCORES",
        candidateInputSha256: candidateHash,
        runtimeSuite: candidate.runtimeSuite,
        corpusBundleHash: corpus.bundleHash,
        config: T44_CLAIM_MATRIX_CONFIG_V1,
        configHash: T44_CLAIM_MATRIX_CONFIG_HASH_V1,
        model: {
          modelId: "BAAI/bge-small-zh-v1.5",
          modelRevision:
            "7999e1d3359715c523056ef9478215996d62a620",
          modelLicense: "MIT",
          modelDirectorySha256: "1".repeat(64),
          modelSealSha256: "2".repeat(64),
          indexBundleHash: "3".repeat(64),
          indexPayloadSha256: "4".repeat(64),
        },
        environment: {
          pythonVersion: "3.12.0",
          torchVersion: "test",
          transformersVersion: "test",
          safetensorsVersion: "test",
          actualDevice: "cuda",
          cudaRuntime: "test",
          deviceName: "test",
          tokenizerClassName: "TestTokenizer",
          modelClassName: "TestModel",
          modelDtype: "torch.float32",
        },
        timingProtocol: {
          warmupRunsPerModel: 1,
          repetitionsPerCase: 3,
          caseAggregate: "MEDIAN",
          suiteAggregate: "P95_NEAREST_RANK",
          aMatrixBoundary:
            T44_CLAIM_MATRIX_CONFIG_V1
              .aMatrixBoundary,
          bMatrixBoundary:
            T44_CLAIM_MATRIX_CONFIG_V1
              .bMatrixBoundary,
        },
        cases: candidate.cases.map((testCase) => {
          const nodes = testCase.candidateNodes.map(
            ({ nodeId: id, objectId, coursePackId }) => ({
              nodeId: id,
              objectId,
              coursePackId,
            }),
          );
          const whole = matrixRanking(nodes);
          return {
            caseId: testCase.caseId,
            coursePackId: testCase.coursePackId,
            candidateCount: nodes.length,
            candidateNodeIdsSha256:
              testCase.candidateNodeIdsSha256,
            arms: {
              A_FULL_QUERY: {
                timingMs: {
                  samples: [1, 1, 1],
                  median: 1,
                },
                wholeQueryRanking: whole,
              },
              B_CLAIM_MATRIX: {
                timingMs: {
                  samples: [2, 2, 2],
                  median: 2,
                },
                wholeQueryRanking: whole,
                claimRankings:
                  testCase.decomposition.claims.map(
                    (claim, index) => ({
                      claimId: claim.claimId,
                      textHash: claim.textHash,
                      ranking: matrixRanking(
                        nodes,
                        nodes[index === 0 ? 0 : 3]!
                          .nodeId,
                      ),
                    }),
                  ),
              },
            },
          };
        }),
      });
    const matrixText =
      serializeT44ClaimMatrixOutputV1(matrix);
    const actualMatrixHash = createHash("sha256")
      .update(matrixText, "utf8")
      .digest("hex");
    const selection =
      buildT44ClaimSelectionArtifactV1({
        serializedCandidateInput: candidateText,
        candidateInputSha256: candidateHash,
        serializedMatrixOutput: matrixText,
        matrixOutputSha256: actualMatrixHash,
      });
    const selectionText =
      serializeT44ClaimSelectionArtifactV1(selection);
    const selectionHash =
      sha256T44ClaimSelectionArtifactV1(
        selectionText,
      );
    expect(JSON.stringify(selection)).not.toMatch(
      /qrels|requiredEvidenceGroups|hardNegative/i,
    );
    const qrelCases = candidate.cases.map(
      (testCase, index) => {
        const decoy = objectFor(
          testCase.coursePackId as CoursePackId,
          "decoy",
        );
        const hardNegative = decoy.nodes.find(
          (node) =>
            node.kind === "TEXT"
            && node.role === "FACT",
        )!;
        return {
          caseId: testCase.caseId,
          stratum:
            T44_CLAIM_COVERAGE_STRATA_V1[
              index
              % T44_CLAIM_COVERAGE_STRATA_V1.length
            ],
          multiClaim: index % 10 < 2,
          requiredEvidenceGroups: [
            {
              groupId: `group-${index + 1}-a`,
              acceptableNodeIds: [
                testCase.candidateNodes[0]!.nodeId,
              ],
            },
            {
              groupId: `group-${index + 1}-b`,
              acceptableNodeIds: [
                testCase.candidateNodes[3]!.nodeId,
              ],
            },
          ],
          hardNegativeNodeIds: [hardNegative.id],
        };
      },
    );
    const report = evaluateT44ClaimCoverageV1({
      serializedCandidateInput: candidateText,
      candidateInputSha256: candidateHash,
      serializedMatrixOutput: matrixText,
      matrixOutputSha256: actualMatrixHash,
      serializedSelectionArtifact: selectionText,
      selectionArtifactSha256: selectionHash,
      qrelCases,
      corpus,
      candidateExpansionTimingMs:
        candidate.cases.map(({ caseId }) => ({
          caseId,
          durationMs: 10,
        })),
      providerInvocationAudit: {
        observedCalls: candidate.expectedProviderCalls,
        channelCounts: {
          LEXICAL:
            candidate.expectedChannelCalls.LEXICAL,
          TEXT_VECTOR:
            candidate.expectedChannelCalls.TEXT_VECTOR,
          VISUAL_VECTOR: 0,
          CAPTION_LEXICAL: 0,
        },
      },
    });

    expect(report.passed).toBe(true);
    expect(
      report.arms.A_FULL_QUERY.aggregate
        .supportCaseCoverage,
    ).toBe(0);
    expect(
      report.arms.B_CLAIM_MATRIX.aggregate
        .supportCaseCoverage,
    ).toBe(50);
    expect(
      report.arms.B_CLAIM_MATRIX.aggregate
        .multiClaimJointCoverage,
    ).toBe(10);
    expect(
      report.arms.B_CLAIM_MATRIX.aggregate
        .bindingViolationCount,
    ).toBe(0);
    expect(
      report.gates.providerInvocationParity.passed,
    ).toBe(true);
    expect(
      report.gates.nodeSelectionExtraP95.passed,
    ).toBe(true);
  });
});
