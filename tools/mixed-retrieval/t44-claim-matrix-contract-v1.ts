import { z } from "zod";

import {
  sha256StableJsonV2,
} from "../../lib/knowledge/knowledge-object-v2";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);

export const T44_CLAIM_CANDIDATE_CONFIG_V1 =
  Object.freeze({
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
  } as const);

export const T44_CLAIM_CANDIDATE_CONFIG_HASH_V1 =
  sha256StableJsonV2(T44_CLAIM_CANDIDATE_CONFIG_V1);

export const T44_CLAIM_MATRIX_CONFIG_V1 =
  Object.freeze({
    id: "lumi-t44-claim-node-matrix-v1",
    version: "2026-07-29.1",
    modelId: "BAAI/bge-small-zh-v1.5",
    modelRevision:
      "7999e1d3359715c523056ef9478215996d62a620",
    maxClaims: 4,
    maximumCandidateNodes: 176,
    repetitions: 3,
    maxLength: 512,
    aMatrixBoundary:
      "WHOLE_QUERY_ENCODE_PLUS_CANDIDATE_DOT_PRODUCT",
    bMatrixBoundary:
      "WHOLE_AND_CLAIMS_BATCH_ENCODE_PLUS_CANDIDATE_MATRIX_PRODUCT",
  } as const);

export const T44_CLAIM_MATRIX_CONFIG_HASH_V1 =
  sha256StableJsonV2(T44_CLAIM_MATRIX_CONFIG_V1);

const MatrixConfigSchema = z
  .object({
    id: z.literal(T44_CLAIM_MATRIX_CONFIG_V1.id),
    version: z.literal(
      T44_CLAIM_MATRIX_CONFIG_V1.version,
    ),
    modelId: z.literal(
      T44_CLAIM_MATRIX_CONFIG_V1.modelId,
    ),
    modelRevision: z.literal(
      T44_CLAIM_MATRIX_CONFIG_V1.modelRevision,
    ),
    maxClaims: z.literal(4),
    maximumCandidateNodes: z.literal(176),
    repetitions: z.literal(3),
    maxLength: z.literal(512),
    aMatrixBoundary: z.literal(
      T44_CLAIM_MATRIX_CONFIG_V1.aMatrixBoundary,
    ),
    bMatrixBoundary: z.literal(
      T44_CLAIM_MATRIX_CONFIG_V1.bMatrixBoundary,
    ),
  })
  .strict();

export const T44ClaimMatrixTimingV1Schema = z
  .object({
    samples: z
      .array(z.number().finite().nonnegative())
      .length(3),
    median: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((timing, context) => {
    const ordered = [...timing.samples].sort(
      (left, right) => left - right,
    );
    if (timing.median !== ordered[1]) {
      context.addIssue({
        code: "custom",
        path: ["median"],
        message:
          "timing median must be the middle of three samples",
      });
    }
  });

export const T44ClaimMatrixRankedNodeV1Schema = z
  .object({
    nodeId: IdSchema,
    objectId: IdSchema,
    coursePackId: IdSchema,
    score: z.number().finite(),
    rank: z.number().int().min(1).max(176),
  })
  .strict();

export type T44ClaimMatrixRankedNodeV1 = z.infer<
  typeof T44ClaimMatrixRankedNodeV1Schema
>;

export const T44ClaimMatrixRankingV1Schema = z
  .array(T44ClaimMatrixRankedNodeV1Schema)
  .max(176)
  .superRefine((ranking, context) => {
    if (
      ranking.some(
        ({ rank }, index) => rank !== index + 1,
      )
      || new Set(
        ranking.map(({ nodeId }) => nodeId),
      ).size !== ranking.length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "matrix rankings must be unique and contiguous",
      });
    }
  });

const ClaimRankingV1Schema = z
  .object({
    claimId: IdSchema,
    textHash: HashSchema,
    ranking: T44ClaimMatrixRankingV1Schema,
  })
  .strict();

const MatrixCaseV1Schema = z
  .object({
    caseId: IdSchema,
    coursePackId: IdSchema,
    candidateCount: z
      .number()
      .int()
      .min(0)
      .max(176),
    candidateNodeIdsSha256: HashSchema,
    arms: z
      .object({
        A_FULL_QUERY: z
          .object({
            timingMs: T44ClaimMatrixTimingV1Schema,
            wholeQueryRanking:
              T44ClaimMatrixRankingV1Schema,
          })
          .strict(),
        B_CLAIM_MATRIX: z
          .object({
            timingMs: T44ClaimMatrixTimingV1Schema,
            wholeQueryRanking:
              T44ClaimMatrixRankingV1Schema,
            claimRankings: z
              .array(ClaimRankingV1Schema)
              .min(1)
              .max(4),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((testCase, context) => {
    const rankings = [
      testCase.arms.A_FULL_QUERY.wholeQueryRanking,
      testCase.arms.B_CLAIM_MATRIX.wholeQueryRanking,
      ...testCase.arms.B_CLAIM_MATRIX
        .claimRankings.map(({ ranking }) => ranking),
    ];
    if (
      rankings.some(
        (ranking) =>
          ranking.length !== testCase.candidateCount,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["arms"],
        message:
          "every matrix ranking must cover all candidates",
      });
    }
    const candidateSets = rankings.map((ranking) =>
      ranking.map(({ nodeId }) => nodeId).sort());
    if (
      candidateSets.some(
        (ids) =>
          JSON.stringify(ids)
          !== JSON.stringify(candidateSets[0]),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["arms"],
        message:
          "all matrix arms must use the same candidates",
      });
    }
    const claimIds =
      testCase.arms.B_CLAIM_MATRIX.claimRankings.map(
        ({ claimId }) => claimId,
      );
    if (new Set(claimIds).size !== claimIds.length) {
      context.addIssue({
        code: "custom",
        path: [
          "arms",
          "B_CLAIM_MATRIX",
          "claimRankings",
        ],
        message: "claim rankings must be unique",
      });
    }
  });

export const T44ClaimMatrixSidecarOutputV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("T44_CLAIM_NODE_MATRIX_SCORES"),
    candidateInputSha256: HashSchema,
    runtimeSuite: z
      .object({
        id: IdSchema,
        version: z.string().trim().min(1).max(50),
        suiteHash: HashSchema,
      })
      .strict(),
    corpusBundleHash: HashSchema,
    config: MatrixConfigSchema,
    configHash: z.literal(
      T44_CLAIM_MATRIX_CONFIG_HASH_V1,
    ),
    model: z
      .object({
        modelId: z.literal(
          "BAAI/bge-small-zh-v1.5",
        ),
        modelRevision: z.literal(
          "7999e1d3359715c523056ef9478215996d62a620",
        ),
        modelLicense: z.literal("MIT"),
        modelDirectorySha256: HashSchema,
        modelSealSha256: HashSchema,
        indexBundleHash: HashSchema,
        indexPayloadSha256: HashSchema,
      })
      .strict(),
    environment: z
      .object({
        pythonVersion: z.string().min(1),
        torchVersion: z.string().min(1),
        transformersVersion: z.string().min(1),
        safetensorsVersion: z.string().min(1),
        actualDevice: z.enum(["cuda", "cpu"]),
        cudaRuntime: z.string().nullable(),
        deviceName: z.string().nullable(),
        tokenizerClassName: z.string().min(1),
        modelClassName: z.string().min(1),
        modelDtype: z.string().min(1),
      })
      .strict(),
    timingProtocol: z
      .object({
        warmupRunsPerModel: z.literal(1),
        repetitionsPerCase: z.literal(3),
        caseAggregate: z.literal("MEDIAN"),
        suiteAggregate: z.literal(
          "P95_NEAREST_RANK",
        ),
        aMatrixBoundary: z.literal(
          T44_CLAIM_MATRIX_CONFIG_V1
            .aMatrixBoundary,
        ),
        bMatrixBoundary: z.literal(
          T44_CLAIM_MATRIX_CONFIG_V1
            .bMatrixBoundary,
        ),
      })
      .strict(),
    cases: z
      .array(MatrixCaseV1Schema)
      .min(1)
      .max(50),
  })
    .strict()
    .superRefine((output, context) => {
      if (
        output.configHash
        !== sha256StableJsonV2(output.config)
      ) {
        context.addIssue({
          code: "custom",
          path: ["configHash"],
          message: "matrix config hash mismatch",
        });
      }
      const caseIds = output.cases.map(
        ({ caseId }) => caseId,
      );
      if (new Set(caseIds).size !== caseIds.length) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message: "matrix case ids must be unique",
        });
      }
    });

export type T44ClaimMatrixSidecarOutputV1 = z.infer<
  typeof T44ClaimMatrixSidecarOutputV1Schema
>;
