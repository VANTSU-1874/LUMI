import { z } from "zod";

import {
  sha256StableJsonV2,
} from "../../lib/knowledge/knowledge-object-v2";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const IdSchema = z.string().regex(ID_PATTERN);

export const T44_OBLIGATION_ORACLE_GATES_V1 =
  Object.freeze({
    totalCases: 50,
    supportCaseCoverageMinimum: 45,
    multiClaimTotal: 10,
    multiClaimCoverageMinimum: 9,
  } as const);

export const T44_OBLIGATION_ORACLE_CONFIG_HASH_V1 =
  sha256StableJsonV2(
    T44_OBLIGATION_ORACLE_GATES_V1,
  );

const EvidenceGroupSchema = z
  .object({
    groupId: IdSchema,
    acceptableNodeIds: z
      .array(IdSchema)
      .min(1)
      .max(3),
  })
  .strict();

const UniqueNodeIdsSchema = z
  .array(IdSchema)
  .max(176)
  .superRefine((nodeIds, context) => {
    if (new Set(nodeIds).size !== nodeIds.length) {
      context.addIssue({
        code: "custom",
        message:
          "T44_OBLIGATION_ORACLE_NODE_IDS_DUPLICATE",
      });
    }
  });

const T44ObligationOracleCaseV1Schema = z
  .object({
    caseId: IdSchema,
    coursePackId: IdSchema,
    multiClaim: z.boolean(),
    requiredEvidenceGroups: z
      .array(EvidenceGroupSchema)
      .min(1)
      .max(4),
    aCandidateNodeIds: UniqueNodeIdsSchema,
    bCandidateNodeIds: UniqueNodeIdsSchema,
    aSelectedNodeIds: UniqueNodeIdsSchema
      .refine(
        (nodeIds) => nodeIds.length <= 8,
        "A selection exceeds Top-8",
      ),
    bSelectedNodeIds: UniqueNodeIdsSchema
      .refine(
        (nodeIds) => nodeIds.length <= 8,
        "B selection exceeds Top-8",
      ),
  })
  .strict()
  .superRefine((testCase, context) => {
    if (
      new Set(
        testCase.requiredEvidenceGroups.map(
          ({ groupId }) => groupId,
        ),
      ).size !== testCase.requiredEvidenceGroups.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["requiredEvidenceGroups"],
        message:
          "T44_OBLIGATION_ORACLE_GROUP_IDS_DUPLICATE",
      });
    }
    const aCandidates = new Set(
      testCase.aCandidateNodeIds,
    );
    if (
      testCase.aSelectedNodeIds.some(
        (nodeId) => !aCandidates.has(nodeId),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["aSelectedNodeIds"],
        message:
          "T44_OBLIGATION_ORACLE_A_SELECTION_NOT_IN_CANDIDATE",
      });
    }
    const bCandidates = new Set(
      testCase.bCandidateNodeIds,
    );
    if (
      testCase.bSelectedNodeIds.some(
        (nodeId) => !bCandidates.has(nodeId),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["bSelectedNodeIds"],
        message:
          "T44_OBLIGATION_ORACLE_B_SELECTION_NOT_IN_CANDIDATE",
      });
    }
  });

export type T44ObligationOracleCaseV1 = z.infer<
  typeof T44ObligationOracleCaseV1Schema
>;

const POOL_NAMES = [
  "A_CANDIDATE",
  "B_CANDIDATE",
  "UNION_CANDIDATE",
  "A_SELECTION",
  "B_SELECTION",
  "UNION_SELECTION",
  "BASELINE_PROTECTED_CANDIDATE",
] as const;

type PoolName = typeof POOL_NAMES[number];

type PoolRow = {
  caseId: string;
  coursePackId: string;
  multiClaim: boolean;
  requiredGroupCount: number;
  coveredGroupCount: number;
  allGroupsCovered: boolean;
  missingGroupIds: string[];
};

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function unionNodeIds(
  ...collections: readonly (readonly string[])[]
) {
  return [...new Set(collections.flat())];
}

function evaluatePool(
  testCase: T44ObligationOracleCaseV1,
  nodeIds: readonly string[],
): PoolRow {
  const available = new Set(nodeIds);
  const missingGroupIds =
    testCase.requiredEvidenceGroups
      .filter(({ acceptableNodeIds }) =>
        !acceptableNodeIds.some((nodeId) =>
          available.has(nodeId)))
      .map(({ groupId }) => groupId);
  return {
    caseId: testCase.caseId,
    coursePackId: testCase.coursePackId,
    multiClaim: testCase.multiClaim,
    requiredGroupCount:
      testCase.requiredEvidenceGroups.length,
    coveredGroupCount:
      testCase.requiredEvidenceGroups.length
      - missingGroupIds.length,
    allGroupsCovered: missingGroupIds.length === 0,
    missingGroupIds,
  };
}

function summarizeRows(rows: readonly PoolRow[]) {
  const requiredGroups = rows.reduce(
    (sum, row) => sum + row.requiredGroupCount,
    0,
  );
  const coveredGroups = rows.reduce(
    (sum, row) => sum + row.coveredGroupCount,
    0,
  );
  return {
    totalCases: rows.length,
    caseCoverage: rows.filter(
      ({ allGroupsCovered }) => allGroupsCovered,
    ).length,
    requiredGroupCoverage: {
      covered: coveredGroups,
      total: requiredGroups,
      rate: requiredGroups === 0
        ? 0
        : coveredGroups / requiredGroups,
    },
    multiClaim: {
      total: rows.filter(
        ({ multiClaim }) => multiClaim,
      ).length,
      caseCoverage: rows.filter(
        ({ multiClaim, allGroupsCovered }) =>
          multiClaim && allGroupsCovered,
      ).length,
    },
    missingCases: rows
      .filter(
        ({ allGroupsCovered }) => !allGroupsCovered,
      )
      .map(({ caseId, missingGroupIds }) => ({
        caseId,
        missingGroupIds,
      })),
  };
}

export function evaluateT44ObligationOracleV1(
  input: {
    cases: readonly T44ObligationOracleCaseV1[];
  },
) {
  const cases = z
    .array(T44ObligationOracleCaseV1Schema)
    .length(
      T44_OBLIGATION_ORACLE_GATES_V1.totalCases,
    )
    .parse(input.cases);
  if (
    new Set(cases.map(({ caseId }) => caseId)).size
      !== cases.length
  ) {
    throw new Error(
      "T44_OBLIGATION_ORACLE_CASE_IDS_DUPLICATE",
    );
  }
  const multiClaimTotal = cases.filter(
    ({ multiClaim }) => multiClaim,
  ).length;
  if (
    multiClaimTotal
      !== T44_OBLIGATION_ORACLE_GATES_V1
        .multiClaimTotal
  ) {
    throw new Error(
      `T44_OBLIGATION_ORACLE_MULTI_TOTAL_INVALID:${multiClaimTotal}`,
    );
  }

  const rowsByPool = Object.fromEntries(
    POOL_NAMES.map((poolName) => [
      poolName,
      [] as PoolRow[],
    ]),
  ) as Record<PoolName, PoolRow[]>;

  for (const testCase of cases) {
    const pools: Record<PoolName, string[]> = {
      A_CANDIDATE: testCase.aCandidateNodeIds,
      B_CANDIDATE: testCase.bCandidateNodeIds,
      UNION_CANDIDATE: unionNodeIds(
        testCase.aCandidateNodeIds,
        testCase.bCandidateNodeIds,
      ),
      A_SELECTION: testCase.aSelectedNodeIds,
      B_SELECTION: testCase.bSelectedNodeIds,
      UNION_SELECTION: unionNodeIds(
        testCase.aSelectedNodeIds,
        testCase.bSelectedNodeIds,
      ),
      BASELINE_PROTECTED_CANDIDATE:
        unionNodeIds(
          testCase.aSelectedNodeIds,
          testCase.bCandidateNodeIds,
        ),
    };
    for (const poolName of POOL_NAMES) {
      rowsByPool[poolName].push(
        evaluatePool(testCase, pools[poolName]),
      );
    }
  }

  const pools = Object.fromEntries(
    POOL_NAMES.map((poolName) => {
      const rows = rowsByPool[poolName];
      const byCoursePack = Object.fromEntries(
        [...new Set(
          rows.map(({ coursePackId }) =>
            coursePackId),
        )]
          .sort(compareCodePoints)
          .map((coursePackId) => [
            coursePackId,
            summarizeRows(
              rows.filter((row) =>
                row.coursePackId === coursePackId),
            ),
          ]),
      );
      return [
        poolName,
        {
          ...summarizeRows(rows),
          byCoursePack,
        },
      ];
    }),
  ) as Record<
    PoolName,
    ReturnType<typeof summarizeRows> & {
      byCoursePack: Record<
        string,
        ReturnType<typeof summarizeRows>
      >;
    }
  >;

  const supportGate = (
    observed: number,
  ) => ({
    observed,
    required:
      T44_OBLIGATION_ORACLE_GATES_V1
        .supportCaseCoverageMinimum,
    passed: observed
      >= T44_OBLIGATION_ORACLE_GATES_V1
        .supportCaseCoverageMinimum,
  });
  const multiGate = (observed: number) => ({
    observed,
    required:
      T44_OBLIGATION_ORACLE_GATES_V1
        .multiClaimCoverageMinimum,
    passed: observed
      >= T44_OBLIGATION_ORACLE_GATES_V1
        .multiClaimCoverageMinimum,
  });
  const gates = {
    baselineProtectedCandidateSupport:
      supportGate(
        pools.BASELINE_PROTECTED_CANDIDATE
          .caseCoverage,
      ),
    baselineProtectedCandidateMulti:
      multiGate(
        pools.BASELINE_PROTECTED_CANDIDATE
          .multiClaim.caseCoverage,
      ),
    unionCandidateSupport:
      supportGate(
        pools.UNION_CANDIDATE.caseCoverage,
      ),
  };
  const passed = Object.values(gates).every(
    ({ passed: gatePassed }) => gatePassed,
  );
  const decision = passed
    ? "SELECTION_REPAIR_FEASIBLE" as const
    : "FIRST_STAGE_RECALL_NO_GO" as const;
  return {
    schemaVersion: 1 as const,
    kind: "T44_OBLIGATION_CANDIDATE_SELECTION_ORACLE" as const,
    configHash:
      T44_OBLIGATION_ORACLE_CONFIG_HASH_V1,
    decision,
    pools,
    gates,
    passed,
  };
}
