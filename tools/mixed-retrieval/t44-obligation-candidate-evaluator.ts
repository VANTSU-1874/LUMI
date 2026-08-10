import { createHash } from "node:crypto";

import { z } from "zod";

import {
  AnswerObligationSetV1Schema,
  type AnswerObligationSetV1,
} from "../../lib/knowledge/answer-obligation-v1";
import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeObjectV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  ObligationRrfResultV1Schema,
  type ObligationRrfResultV1,
} from "../../lib/knowledge/obligation-rrf-v1";
import {
  QUERY_CLAIM_DECOMPOSER_CONFIG_HASH_V1,
  QUERY_CLAIM_DECOMPOSER_CONFIG_V1,
  QueryClaimDecompositionV1Schema,
} from "../../lib/knowledge/query-claim-decomposer-v1";
import {
  T44_CLAIM_CANDIDATE_CONFIG_HASH_V1,
  T44_CLAIM_CANDIDATE_CONFIG_V1,
} from "./t44-claim-matrix-contract-v1";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);

export const T44_OBLIGATION_CANDIDATE_CONFIG_V1 =
  Object.freeze({
    id: "lumi-t44-obligation-candidate-v1",
    version: "1.0.0",
    maximumObjects: 16,
    eligibleAtomicNodes: [
      "TEXT/FACT",
      "TEXT/ACTION",
      "TABLE",
    ],
    maximumAtomicNodesPerObject: 11,
    maximumCandidateNodes: 176,
    labelPolicy:
      "RUNTIME_AND_PROVIDER_TRACES_ONLY_NO_QRELS",
    graphifyPolicy: "NOT_USED",
  } as const);

export const T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1 =
  sha256StableJsonV2(
    T44_OBLIGATION_CANDIDATE_CONFIG_V1,
  );

const CandidateConfigSchema = z
  .object({
    id: z.literal(
      T44_OBLIGATION_CANDIDATE_CONFIG_V1.id,
    ),
    version: z.literal("1.0.0"),
    maximumObjects: z.literal(16),
    eligibleAtomicNodes: z.tuple([
      z.literal("TEXT/FACT"),
      z.literal("TEXT/ACTION"),
      z.literal("TABLE"),
    ]),
    maximumAtomicNodesPerObject: z.literal(11),
    maximumCandidateNodes: z.literal(176),
    labelPolicy: z.literal(
      "RUNTIME_AND_PROVIDER_TRACES_ONLY_NO_QRELS",
    ),
    graphifyPolicy: z.literal("NOT_USED"),
  })
  .strict();

export const T44ObligationCandidateNodeV1Schema = z
  .object({
    nodeId: IdSchema,
    objectId: IdSchema,
    coursePackId: IdSchema,
    objectRank: z.number().int().min(1).max(16),
    kind: z.enum(["TEXT", "TABLE"]),
    role: z.enum(["FACT", "ACTION"]).nullable(),
    text: z.string().trim().min(1).max(32_000),
    nodeContentHash: HashSchema,
    objectContentHash: HashSchema,
    sourceHash: HashSchema,
  })
  .strict()
  .superRefine((node, context) => {
    if (
      (node.kind === "TABLE") !== (node.role === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["role"],
        message:
          "tables require null role and text nodes require FACT or ACTION",
      });
    }
  });

const CandidateObjectV1Schema = z
  .object({
    objectId: IdSchema,
    fusedRank: z.number().int().min(1).max(16),
    fusionScore: z.number().finite().positive(),
    bestRawRank: z.number().int().min(1).max(20),
    obligationIds: z
      .array(z.string().regex(/^obligation-[1-4]$/))
      .max(4),
    origins: z.array(z.enum([
      "LEXICAL",
      "TEXT_VECTOR",
      "VISUAL_VECTOR",
    ])).min(1).max(3),
  })
  .strict();

const CandidateArmV1Schema = z
  .object({
    directEvidenceBatchHash: HashSchema.nullable(),
    rrfResultHash: HashSchema.nullable(),
    objectRanking: z
      .array(CandidateObjectV1Schema)
      .max(16),
    candidateNodes: z
      .array(T44ObligationCandidateNodeV1Schema)
      .max(176),
    candidateNodeIdsSha256: HashSchema,
  })
  .strict()
  .superRefine((arm, context) => {
    if (
      (arm.directEvidenceBatchHash === null)
        !== (arm.rrfResultHash === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["rrfResultHash"],
        message:
          "direct batch and RRF hashes must both exist or both be absent",
      });
    }
    if (
      arm.objectRanking.some(
        ({ fusedRank }, index) =>
          fusedRank !== index + 1,
      )
      || new Set(
        arm.objectRanking.map(
          ({ objectId }) => objectId,
        ),
      ).size !== arm.objectRanking.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectRanking"],
        message:
          "candidate objects must be unique and contiguously ranked",
      });
    }
    const objectRanks = new Map(
      arm.objectRanking.map((candidate) => [
        candidate.objectId,
        candidate.fusedRank,
      ]),
    );
    if (
      arm.candidateNodes.some((node) =>
        objectRanks.get(node.objectId)
          !== node.objectRank)
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidateNodes"],
        message:
          "candidate nodes must bind to ranked objects",
      });
    }
    const nodeIds = arm.candidateNodes.map(
      ({ nodeId }) => nodeId,
    );
    if (
      new Set(nodeIds).size !== nodeIds.length
      || arm.candidateNodeIdsSha256
        !== sha256StableJsonV2(nodeIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidateNodeIdsSha256"],
        message:
          "candidate node ids must be unique and hash-bound",
      });
    }
  });

export const T44ObligationCandidateCaseV1Schema = z
  .object({
    caseId: IdSchema,
    coursePackId: IdSchema,
    coursePackVersion: z.literal("1"),
    normalizedQuestionHash: HashSchema,
    obligationSetHash: HashSchema,
    retrievalPlanHash: HashSchema,
    arms: z
      .object({
        A_WHOLE_QUERY: CandidateArmV1Schema,
        B_MODEL_GUIDED: CandidateArmV1Schema,
      })
      .strict(),
  })
  .strict()
  .superRefine((testCase, context) => {
    if (
      Object.values(testCase.arms).some((arm) =>
        arm.candidateNodes.some((node) =>
          node.coursePackId
          !== testCase.coursePackId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["arms"],
        message:
          "all arm candidates must remain in course scope",
      });
    }
  });

const ProviderAuditSchema = z
  .object({
    expectedCalls: z.number().int().nonnegative(),
    actualCalls: z.number().int().nonnegative(),
    channelCounts: z
      .object({
        LEXICAL: z.number().int().nonnegative(),
        TEXT_VECTOR: z.number().int().nonnegative(),
        VISUAL_VECTOR: z.number().int().nonnegative(),
      })
      .strict(),
    matched: z.boolean(),
  })
  .strict()
  .superRefine((audit, context) => {
    const observed = Object.values(
      audit.channelCounts,
    ).reduce((sum, value) => sum + value, 0);
    if (
      observed !== audit.actualCalls
      || audit.matched
        !== (audit.expectedCalls === audit.actualCalls)
    ) {
      context.addIssue({
        code: "custom",
        path: ["matched"],
        message:
          "provider audit totals and matched flag must agree",
      });
    }
  });

export const T44ObligationCandidateArtifactV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("T44_OBLIGATION_CANDIDATES"),
    runtimeSuite: z
      .object({
        id: IdSchema,
        version: z.string().trim().min(1).max(50),
        suiteHash: HashSchema,
      })
      .strict(),
    corpusSnapshot: z
      .object({
        bundleHash: HashSchema,
      })
      .strict(),
    config: CandidateConfigSchema,
    configHash: z.literal(
      T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
    ),
    graphifyInvocationCount: z.literal(0),
    providerAudit: ProviderAuditSchema,
    cases: z
      .array(T44ObligationCandidateCaseV1Schema)
      .min(1)
      .max(50),
  })
    .strict()
    .superRefine((artifact, context) => {
      const caseIds = artifact.cases.map(
        ({ caseId }) => caseId,
      );
      if (new Set(caseIds).size !== caseIds.length) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message: "candidate case ids must be unique",
        });
      }
    });

export type T44ObligationCandidateNodeV1 = z.infer<
  typeof T44ObligationCandidateNodeV1Schema
>;
export type T44ObligationCandidateCaseV1 = z.infer<
  typeof T44ObligationCandidateCaseV1Schema
>;
export type T44ObligationCandidateArtifactV1 = z.infer<
  typeof T44ObligationCandidateArtifactV1Schema
>;

function sha256Bytes(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sourceHash(object: KnowledgeObjectV2) {
  return sha256StableJsonV2({
    sourceIdentityBasis: object.sourceIdentityBasis,
    provenance: object.provenance,
    parser: object.parser,
    contentVersion: object.contentVersion,
  });
}

export function isT44ObligationCandidateEligibleNodeV1(
  node: KnowledgeObjectV2["nodes"][number],
) {
  return (
    node.kind === "TABLE"
    || (
      node.kind === "TEXT"
      && (
        node.role === "FACT"
        || node.role === "ACTION"
      )
    )
  );
}

function atomicNodeText(
  node: KnowledgeObjectV2["nodes"][number],
) {
  if (node.kind === "TABLE") return node.plainText;
  if (node.kind === "TEXT") return node.text;
  throw new Error(
    `T44_OBLIGATION_NODE_NOT_ATOMIC:${node.id}`,
  );
}

export function enumerateT44ObligationCandidateNodesV1(
  input: {
    corpus: KnowledgeCorpusBundleV2;
    coursePackId: string;
    rankedObjectIds: readonly string[];
  },
): T44ObligationCandidateNodeV1[] {
  const corpus = verifyKnowledgeCorpusBundleV2(
    input.corpus,
  );
  const coursePackId = IdSchema.parse(
    input.coursePackId,
  );
  const rankedObjectIds = z.array(IdSchema)
    .max(
      T44_OBLIGATION_CANDIDATE_CONFIG_V1
        .maximumObjects,
    )
    .parse(input.rankedObjectIds);
  if (
    new Set(rankedObjectIds).size
      !== rankedObjectIds.length
  ) {
    throw new Error(
      "T44_OBLIGATION_CANDIDATE_OBJECT_IDS_DUPLICATE",
    );
  }
  const objectById = new Map(
    corpus.objects.map((object) => [
      object.id,
      object,
    ]),
  );
  const nodes = rankedObjectIds.flatMap(
    (objectId, index) => {
      const object = objectById.get(objectId);
      if (
        !object
        || object.sourceCoursePack.id
          !== coursePackId
      ) {
        throw new Error(
          `T44_OBLIGATION_CANDIDATE_OBJECT_BINDING_INVALID:${objectId}`,
        );
      }
      const eligible = object.nodes
        .filter(isT44ObligationCandidateEligibleNodeV1)
        .sort((left, right) =>
          compareCodePoints(left.id, right.id));
      if (
        eligible.length
        > T44_OBLIGATION_CANDIDATE_CONFIG_V1
          .maximumAtomicNodesPerObject
      ) {
        throw new Error(
          `T44_OBLIGATION_CANDIDATE_OBJECT_NODE_LIMIT:${objectId}:${eligible.length}`,
        );
      }
      const canonicalSourceHash = sourceHash(object);
      return eligible.map((node) =>
        T44ObligationCandidateNodeV1Schema.parse({
          nodeId: node.id,
          objectId: object.id,
          coursePackId:
            object.sourceCoursePack.id,
          objectRank: index + 1,
          kind: node.kind,
          role: node.kind === "TEXT"
            ? node.role
            : null,
          text: atomicNodeText(node),
          nodeContentHash: node.contentHash,
          objectContentHash: object.contentHash,
          sourceHash: canonicalSourceHash,
        }));
    },
  );
  if (
    nodes.length
    > T44_OBLIGATION_CANDIDATE_CONFIG_V1
      .maximumCandidateNodes
  ) {
    throw new Error(
      `T44_OBLIGATION_CANDIDATE_NODE_LIMIT:${nodes.length}`,
    );
  }
  return nodes;
}

export function projectT44ObligationMatrixClaimTextV1(
  input: string,
) {
  const normalized = z.string()
    .trim()
    .min(1)
    .max(1_000)
    .parse(input);
  const codePoints = Array.from(normalized);
  const projected = codePoints.slice(0, 120);
  return Object.freeze({
    text: projected.join(""),
    truncated: projected.length < codePoints.length,
    originalCodePoints: codePoints.length,
    projectedCodePoints: projected.length,
  });
}

const LABEL_FIELD_PATTERNS = [
  /^qrels?$/i,
  /^qrel/i,
  /^(?:required|forbidden|target)(?:[A-Z_]|$)/,
  /^expected(?:Obligation|Node|Path|Answer|Label|Evidence|Gold)/i,
  /^gold/i,
  /^acceptableNodeIds$/i,
  /^(?=.*hard)(?=.*negative)(?=.*node)(?=.*id)[a-z0-9_-]+$/i,
] as const;

function assertLabelBlind(
  value: unknown,
  path: readonly string[],
) {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertLabelBlind(child, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (
    const [key, child]
    of Object.entries(value as Record<string, unknown>)
  ) {
    if (
      LABEL_FIELD_PATTERNS.some((pattern) =>
        pattern.test(key))
    ) {
      throw new Error(
        `T44_OBLIGATION_LABEL_FIELD_FORBIDDEN:${[
          ...path,
          key,
        ].join(".")}`,
      );
    }
    assertLabelBlind(child, [...path, key]);
  }
}

export function assertT44ObligationArtifactLabelBlindV1<
  T,
>(value: T): T {
  assertLabelBlind(value, []);
  return value;
}

export function buildT44ObligationCandidateCaseV1(
  input: {
    caseId: string;
    coursePackId: string;
    coursePackVersion: "1";
    normalizedQuestionHash: string;
    obligationSetHash: string;
    retrievalPlanHash: string;
    aDirectEvidenceBatchHash: string;
    aRrfResult: ObligationRrfResultV1;
    bDirectEvidenceBatchHash: string | null;
    bRrfResult: ObligationRrfResultV1 | null;
    corpus: KnowledgeCorpusBundleV2;
  },
): T44ObligationCandidateCaseV1 {
  const aRrfResult =
    ObligationRrfResultV1Schema.parse(
      input.aRrfResult,
    );
  const bRrfResult = input.bRrfResult === null
    ? null
    : ObligationRrfResultV1Schema.parse(
        input.bRrfResult,
      );
  const arm = (
    result: ObligationRrfResultV1 | null,
    batchHash: string | null,
  ) => {
    const candidateNodes = result
      ? enumerateT44ObligationCandidateNodesV1({
          corpus: input.corpus,
          coursePackId: input.coursePackId,
          rankedObjectIds: result.candidates.map(
            ({ objectId }) => objectId,
          ),
        })
      : [];
    return {
      directEvidenceBatchHash: batchHash,
      rrfResultHash: result
        ? sha256StableJsonV2(result)
        : null,
      objectRanking: result
        ? result.candidates.map(
            ({
              objectId,
              fusedRank,
              fusionScore,
              bestRawRank,
              obligationIds,
              contributions,
            }) => ({
              objectId,
              fusedRank,
              fusionScore,
              bestRawRank,
              obligationIds,
              origins: Array.from(new Set(
                contributions.map(
                  ({ channel }) => channel,
                ),
              )).sort(compareCodePoints),
            }),
          )
        : [],
      candidateNodes,
      candidateNodeIdsSha256:
        sha256StableJsonV2(
          candidateNodes.map(
            ({ nodeId }) => nodeId,
          ),
        ),
    };
  };
  return T44ObligationCandidateCaseV1Schema.parse({
    caseId: input.caseId,
    coursePackId: input.coursePackId,
    coursePackVersion: input.coursePackVersion,
    normalizedQuestionHash:
      input.normalizedQuestionHash,
    obligationSetHash: input.obligationSetHash,
    retrievalPlanHash: input.retrievalPlanHash,
    arms: {
      A_WHOLE_QUERY: arm(
        aRrfResult,
        input.aDirectEvidenceBatchHash,
      ),
      B_MODEL_GUIDED: arm(
        bRrfResult,
        input.bDirectEvidenceBatchHash,
      ),
    },
  });
}

export function createT44ObligationCandidateArtifactV1(
  input: {
    runtimeSuite: {
      id: string;
      version: string;
      suiteHash: string;
    };
    corpusBundleHash: string;
    providerAudit: z.input<
      typeof ProviderAuditSchema
    >;
    cases:
      readonly T44ObligationCandidateCaseV1[];
  },
) {
  const artifact =
    T44ObligationCandidateArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_CANDIDATES",
      runtimeSuite: input.runtimeSuite,
      corpusSnapshot: {
        bundleHash: input.corpusBundleHash,
      },
      config: T44_OBLIGATION_CANDIDATE_CONFIG_V1,
      configHash:
        T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
      graphifyInvocationCount: 0,
      providerAudit: input.providerAudit,
      cases: input.cases,
    });
  return assertT44ObligationArtifactLabelBlindV1(
    artifact,
  );
}

export type T44ObligationArtifactSealV1 = {
  serialized: string;
  sha256: string;
  bytes: number;
};

export function sealT44ObligationArtifactV1(
  input: T44ObligationCandidateArtifactV1,
): T44ObligationArtifactSealV1 {
  const artifact =
    T44ObligationCandidateArtifactV1Schema.parse(
      input,
    );
  assertT44ObligationArtifactLabelBlindV1(artifact);
  const serialized = `${JSON.stringify(
    artifact,
    null,
    2,
  )}\n`;
  return {
    serialized,
    sha256: sha256Bytes(serialized),
    bytes: Buffer.byteLength(serialized, "utf8"),
  };
}

export function verifyT44ObligationArtifactSealV1(
  seal: T44ObligationArtifactSealV1,
) {
  if (
    sha256Bytes(seal.serialized) !== seal.sha256
    || Buffer.byteLength(seal.serialized, "utf8")
      !== seal.bytes
  ) {
    throw new Error(
      "T44_OBLIGATION_ARTIFACT_SHA_DRIFT",
    );
  }
  const artifact =
    T44ObligationCandidateArtifactV1Schema.parse(
      JSON.parse(seal.serialized) as unknown,
    );
  return assertT44ObligationArtifactLabelBlindV1(
    artifact,
  );
}

const MatrixBridgeSourceV1Schema = z
  .object({
    probeId: IdSchema,
    probeKind: z.enum([
      "WHOLE_QUERY",
      "SUPPORT_CLAIM",
    ]),
    claimId: IdSchema.nullable(),
    channel: z.enum([
      "LEXICAL",
      "TEXT_VECTOR",
      "VISUAL_VECTOR",
    ]),
    sourceRank: z.number().int().min(1).max(20),
    weight: z.number().finite().positive(),
    contribution: z.number().finite().positive(),
  })
  .strict();

const MatrixBridgeObjectV1Schema = z
  .object({
    objectId: IdSchema,
    coursePackId: IdSchema,
    rank: z.number().int().min(1).max(16),
    weightedRrfScore: z.number().finite().positive(),
    bestSourceRank:
      z.number().int().min(1).max(20),
    reserved: z.literal(false),
    reservations: z.array(z.never()).length(0),
    sources: z.array(
      MatrixBridgeSourceV1Schema,
    ).min(1).max(3),
  })
  .strict();

const MatrixCompatibilityProbeV1Schema = z
  .object({
    kind: z.literal("MATRIX_COMPATIBILITY_ONLY"),
    probeId: z.literal("probe-whole"),
    textHash: HashSchema,
    sourceArtifact:
      z.literal("SEALED_OBLIGATION_CANDIDATE"),
  })
  .strict();

const MatrixBridgeCaseV1Schema = z
  .object({
    caseId: IdSchema,
    coursePackId: IdSchema,
    coursePackVersion: z.literal("1"),
    normalizedQuestion: z.string().min(1).max(500),
    decomposition: QueryClaimDecompositionV1Schema,
    expectedProviderCalls: z.literal(2),
    probeRankings: z.tuple([
      MatrixCompatibilityProbeV1Schema,
    ]),
    objectRanking:
      z.array(MatrixBridgeObjectV1Schema).max(16),
    candidateNodes:
      z.array(T44ObligationCandidateNodeV1Schema)
        .max(176),
    candidateNodeIdsSha256: HashSchema,
  })
  .strict()
  .superRefine((testCase, context) => {
    if (
      testCase.decomposition.wholeQuery
        !== testCase.normalizedQuestion
      || testCase.probeRankings[0].textHash
        !== testCase.decomposition.wholeQueryHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["decomposition"],
        message:
          "matrix bridge question and compatibility probe must agree",
      });
    }
    if (
      testCase.objectRanking.some(
        ({ rank }, index) => rank !== index + 1,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectRanking"],
        message:
          "matrix bridge object ranks must be contiguous",
      });
    }
    const nodeIds = testCase.candidateNodes.map(
      ({ nodeId }) => nodeId,
    );
    if (
      testCase.candidateNodeIdsSha256
        !== sha256StableJsonV2(nodeIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidateNodeIdsSha256"],
        message:
          "matrix bridge candidate node hash mismatch",
      });
    }
  });

const FrozenClaimCandidateConfigSchema = z
  .unknown()
  .refine(
    (value) =>
      sha256StableJsonV2(value)
      === T44_CLAIM_CANDIDATE_CONFIG_HASH_V1,
    "frozen claim candidate config drift",
  )
  .transform(() => T44_CLAIM_CANDIDATE_CONFIG_V1);

export const T44ObligationMatrixBridgeInputV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T44_CLAIM_CANDIDATE_RUNTIME_INPUT",
    ),
    runtimeSuite: z
      .object({
        id: IdSchema,
        version: z.string().trim().min(1).max(50),
        suiteHash: HashSchema,
      })
      .strict(),
    corpusSnapshot: z
      .object({
        bundleHash: HashSchema,
      })
      .strict(),
    config: FrozenClaimCandidateConfigSchema,
    configHash: z.literal(
      T44_CLAIM_CANDIDATE_CONFIG_HASH_V1,
    ),
    expectedProviderCalls:
      z.number().int().min(2).max(100),
    expectedChannelCalls: z
      .object({
        LEXICAL: z.number().int().min(1).max(50),
        TEXT_VECTOR:
          z.number().int().min(1).max(50),
      })
      .strict(),
    cases: z.array(
      MatrixBridgeCaseV1Schema,
    ).min(1).max(50),
  })
    .strict()
    .superRefine((bridge, context) => {
      if (
        bridge.expectedProviderCalls
          !== bridge.cases.length * 2
        || bridge.expectedChannelCalls.LEXICAL
          !== bridge.cases.length
        || bridge.expectedChannelCalls.TEXT_VECTOR
          !== bridge.cases.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["expectedProviderCalls"],
          message:
            "compatibility calls derive only from the frozen scorer schema",
        });
      }
    });

const ClaimProjectionAuditV1Schema = z
  .object({
    obligationId: IdSchema,
    originalCodePoints: z.number().int().positive(),
    projectedCodePoints:
      z.number().int().min(1).max(120),
    truncated: z.boolean(),
    textHash: HashSchema,
  })
  .strict();

const MatrixBridgeArmV1Schema = z
  .object({
    input: T44ObligationMatrixBridgeInputV1Schema,
    audit: z
      .object({
        compatibilityExpectedProviderCalls:
          z.number().int().min(2).max(100),
        actualProviderCallsSource:
          z.literal("SEALED_PROVIDER_ARTIFACT"),
        claimProjections: z.array(z
          .object({
            caseId: IdSchema,
            claims: z.array(
              ClaimProjectionAuditV1Schema,
            ).min(1).max(4),
          })
          .strict()).min(1).max(50),
      })
      .strict(),
  })
  .strict()
  .superRefine((arm, context) => {
    const expectedCalls = arm.input.cases.length * 2;
    if (
      arm.audit.compatibilityExpectedProviderCalls
        !== expectedCalls
    ) {
      context.addIssue({
        code: "custom",
        path: [
          "audit",
          "compatibilityExpectedProviderCalls",
        ],
        message:
          "bridge audit count must bind to its arm input",
      });
    }
    if (
      arm.audit.claimProjections.length
        !== arm.input.cases.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["audit", "claimProjections"],
        message:
          "bridge projections must cover every arm input case",
      });
    }
    arm.audit.claimProjections.forEach(
      (projection, index) => {
        const inputCase = arm.input.cases[index];
        if (
          !inputCase
          || projection.caseId !== inputCase.caseId
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "audit",
              "claimProjections",
              index,
              "caseId",
            ],
            message:
              "bridge projection case order must bind to arm input",
          });
        }
      },
    );
  });

export const T44ObligationMatrixBridgeManifestV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T44_OBLIGATION_MATRIX_BRIDGES",
    ),
    candidateArtifactSha256: HashSchema,
    graphifyInvocationCount: z.literal(0),
    arms: z
      .object({
        A_WHOLE_QUERY: MatrixBridgeArmV1Schema,
        B_MODEL_GUIDED: MatrixBridgeArmV1Schema,
      })
      .strict(),
  })
    .strict();

export type T44ObligationMatrixBridgeManifestV1 =
  z.infer<
    typeof T44ObligationMatrixBridgeManifestV1Schema
  >;

function matrixDecomposition(input: {
  normalizedQuestion: string;
  obligations:
    Readonly<AnswerObligationSetV1["obligations"]>;
  arm: "A_WHOLE_QUERY" | "B_MODEL_GUIDED";
}) {
  const rawClaims = input.arm === "A_WHOLE_QUERY"
    ? [{
        obligationId: "claim-a-whole",
        learnerNeed: input.normalizedQuestion,
      }]
    : input.obligations.map(
        ({ obligationId, learnerNeed }) => ({
          obligationId,
          learnerNeed,
        }),
      );
  const projections = rawClaims.map(
    ({ obligationId, learnerNeed }) => {
      const projection =
        projectT44ObligationMatrixClaimTextV1(
          learnerNeed,
        );
      return {
        obligationId,
        projection,
      };
    },
  );
  const claims = projections.map(
    ({ obligationId, projection }) => ({
      claimId: obligationId,
      text: projection.text,
      textHash:
        sha256StableJsonV2(projection.text),
      sourceRule: "WHOLE_FALLBACK" as const,
      sourceSpan: {
        startCodePoint: 0,
        endCodePoint:
          projection.projectedCodePoints,
      },
    }),
  );
  const decomposition =
    QueryClaimDecompositionV1Schema.parse({
      schemaVersion: 1,
      kind: "QUERY_CLAIM_DECOMPOSITION",
      decomposerId:
        QUERY_CLAIM_DECOMPOSER_CONFIG_V1.id,
      decomposerVersion:
        QUERY_CLAIM_DECOMPOSER_CONFIG_V1
          .version,
      configHash:
        QUERY_CLAIM_DECOMPOSER_CONFIG_HASH_V1,
      wholeQuery: input.normalizedQuestion,
      wholeQueryHash: sha256StableJsonV2(
        input.normalizedQuestion,
      ),
      claims,
      probes: [{
        probeId: "probe-whole",
        kind: "WHOLE_QUERY",
        text: input.normalizedQuestion,
        textHash: sha256StableJsonV2(
          input.normalizedQuestion,
        ),
        claimIds: input.arm === "A_WHOLE_QUERY"
          ? [claims[0]!.claimId]
          : [],
      }],
    });
  return {
    decomposition,
    audit: projections.map(
      ({ obligationId, projection }) => ({
        obligationId,
        originalCodePoints:
          projection.originalCodePoints,
        projectedCodePoints:
          projection.projectedCodePoints,
        truncated: projection.truncated,
        textHash: sha256StableJsonV2(
          projection.text,
        ),
      }),
    ),
  };
}

function matrixObjectRanking(
  arm: z.infer<typeof CandidateArmV1Schema>,
) {
  return arm.objectRanking.map((candidate) => ({
    objectId: candidate.objectId,
    coursePackId:
      arm.candidateNodes.find(
        ({ objectId }) =>
          objectId === candidate.objectId,
      )?.coursePackId
      ?? (() => {
        throw new Error(
          `T44_OBLIGATION_MATRIX_OBJECT_WITHOUT_NODE:${candidate.objectId}`,
        );
      })(),
    rank: candidate.fusedRank,
    weightedRrfScore: candidate.fusionScore,
    bestSourceRank: candidate.bestRawRank,
    reserved: false as const,
    reservations: [],
    sources: candidate.origins.map(
      (channel) => ({
        probeId: "probe-whole",
        probeKind:
          candidate.obligationIds.length > 0
            ? "SUPPORT_CLAIM" as const
            : "WHOLE_QUERY" as const,
        claimId:
          candidate.obligationIds[0] ?? null,
        channel,
        sourceRank: candidate.bestRawRank,
        weight: 1 / candidate.origins.length,
        contribution:
          candidate.fusionScore
          / candidate.origins.length,
      }),
    ),
  }));
}

export function buildT44ObligationMatrixBridgeManifestV1(
  input: {
    candidateArtifact:
      T44ObligationCandidateArtifactV1;
    candidateArtifactSha256: string;
    obligationSets: ReadonlyMap<
      string,
      AnswerObligationSetV1
    >;
  },
): T44ObligationMatrixBridgeManifestV1 {
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse(
      input.candidateArtifact,
    );
  const candidateArtifactSha256 =
    HashSchema.parse(input.candidateArtifactSha256);
  const buildArm = (
    armName:
      | "A_WHOLE_QUERY"
      | "B_MODEL_GUIDED",
  ) => {
    const claimProjections: Array<{
      caseId: string;
      claims: Array<z.infer<
        typeof ClaimProjectionAuditV1Schema
      >>;
    }> = [];
    const cases = candidate.cases.map((testCase) => {
      const obligationSet =
        AnswerObligationSetV1Schema.parse(
          input.obligationSets.get(testCase.caseId),
        );
      if (
        obligationSet.normalizedQuestionHash
          !== testCase.normalizedQuestionHash
        || sha256StableJsonV2(obligationSet)
          !== testCase.obligationSetHash
      ) {
        throw new Error(
          `T44_OBLIGATION_MATRIX_PLANNER_BINDING_DRIFT:${testCase.caseId}`,
        );
      }
      const { decomposition, audit } =
        matrixDecomposition({
          normalizedQuestion:
            obligationSet.normalizedQuestion,
          obligations: obligationSet.obligations,
          arm: armName,
        });
      claimProjections.push({
        caseId: testCase.caseId,
        claims: audit,
      });
      const arm = testCase.arms[armName];
      return {
        caseId: testCase.caseId,
        coursePackId: testCase.coursePackId,
        coursePackVersion:
          testCase.coursePackVersion,
        normalizedQuestion:
          obligationSet.normalizedQuestion,
        decomposition,
        expectedProviderCalls: 2 as const,
        probeRankings: [{
          kind:
            "MATRIX_COMPATIBILITY_ONLY" as const,
          probeId: "probe-whole" as const,
          textHash:
            decomposition.wholeQueryHash,
          sourceArtifact:
            "SEALED_OBLIGATION_CANDIDATE" as const,
        }] as const,
        objectRanking:
          matrixObjectRanking(arm),
        candidateNodes: arm.candidateNodes,
        candidateNodeIdsSha256:
          arm.candidateNodeIdsSha256,
      };
    });
    const bridge =
      T44ObligationMatrixBridgeInputV1Schema.parse({
        schemaVersion: 1,
        kind:
          "T44_CLAIM_CANDIDATE_RUNTIME_INPUT",
        runtimeSuite: candidate.runtimeSuite,
        corpusSnapshot:
          candidate.corpusSnapshot,
        config: T44_CLAIM_CANDIDATE_CONFIG_V1,
        configHash:
          T44_CLAIM_CANDIDATE_CONFIG_HASH_V1,
        expectedProviderCalls:
          candidate.cases.length * 2,
        expectedChannelCalls: {
          LEXICAL: candidate.cases.length,
          TEXT_VECTOR: candidate.cases.length,
        },
        cases,
      });
    return {
      input: bridge,
      audit: {
        compatibilityExpectedProviderCalls:
          candidate.cases.length * 2,
        actualProviderCallsSource:
          "SEALED_PROVIDER_ARTIFACT" as const,
        claimProjections,
      },
    };
  };
  const manifest =
    T44ObligationMatrixBridgeManifestV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_MATRIX_BRIDGES",
      candidateArtifactSha256,
      graphifyInvocationCount: 0,
      arms: {
        A_WHOLE_QUERY: buildArm(
          "A_WHOLE_QUERY",
        ),
        B_MODEL_GUIDED: buildArm(
          "B_MODEL_GUIDED",
        ),
      },
    });
  return assertT44ObligationArtifactLabelBlindV1(
    manifest,
  );
}
