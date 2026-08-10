import { z } from "zod";

import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";

const IdSchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
);

const CaseGateSchema = z.object({
  caseId: IdSchema,
  aBaselineCount: z.number().int().min(0).max(50),
  protectedAnchorCount:
    z.number().int().min(0).max(50),
  baselineAvailable: z.boolean(),
  protectedAnchorsValid: z.boolean(),
  baselineReused: z.boolean(),
  baselineSingleCount: z.boolean(),
}).strict();

const AllCasesGateSchema = z.object({
  observedCases: z.number().int().nonnegative(),
  requiredCases: z.number().int().positive(),
  passed: z.boolean(),
}).strict();

export const T45CandidateStructuralReadinessV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T45_CANDIDATE_STRUCTURAL_READINESS",
    ),
    gates: z.object({
      baselineAvailable: AllCasesGateSchema,
      protectedAnchors: AllCasesGateSchema.extend({
        minimumPerCase: z.literal(1),
        maximumPerCase: z.literal(8),
      }).strict(),
      baselineSingleCount: AllCasesGateSchema,
    }).strict(),
    cases: z.array(CaseGateSchema).min(1).max(50),
    passed: z.boolean(),
  })
    .strict()
    .superRefine((report, context) => {
      const total = report.cases.length;
      const expected = {
        baselineAvailable:
          report.cases.filter(
            ({ baselineAvailable }) =>
              baselineAvailable,
          ).length,
        protectedAnchors:
          report.cases.filter(
            ({ protectedAnchorsValid }) =>
              protectedAnchorsValid,
          ).length,
        baselineSingleCount:
          report.cases.filter(
            ({ baselineSingleCount }) =>
              baselineSingleCount,
          ).length,
      };
      const gatesAgree =
        Object.entries(expected).every(
          ([name, observed]) => {
            const gate = report.gates[
              name as keyof typeof expected
            ];
            return gate.observedCases === observed
              && gate.requiredCases === total
              && gate.passed === (observed === total);
          },
        );
      if (
        !gatesAgree
        || report.passed
          !== Object.values(report.gates).every(
            ({ passed }) => passed,
          )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "T45_CANDIDATE_STRUCTURAL_READINESS_DRIFT",
        });
      }
    });

export type T45CandidateStructuralReadinessV1 =
  z.infer<
    typeof T45CandidateStructuralReadinessV1Schema
  >;

type CandidateLike = {
  providerAudit: {
    expectedCalls: number;
    actualCalls: number;
    matched: boolean;
  };
  cases: Array<{
    caseId: string;
    arms: Record<
      "A_WHOLE_QUERY" | "B_MODEL_GUIDED",
      {
        directEvidenceBatchHash: string | null;
        rrfResultHash: string | null;
        candidateNodeIdsSha256: string;
        candidateNodes: Array<{ nodeId: string }>;
      }
    >;
  }>;
};

type SelectionLike = {
  cases: Array<{
    caseId: string;
    arms: Record<
      "A_WHOLE_QUERY" | "B_MODEL_GUIDED",
      {
        selected: Array<{
          nodeId: string;
          selectionSource: string;
        }>;
      }
    >;
  }>;
};

type ProviderArmLike = {
  status: string;
  retrievalMode?: string;
  expectedProviderCalls: number;
  actualProviderCalls: number;
  batch: unknown;
  rrf: unknown;
};

type ProviderLike = {
  expectedCalls: number;
  actualCalls: number;
  matched: boolean;
  cases: Array<{
    caseId: string;
    A_WHOLE_QUERY: ProviderArmLike;
    B_MODEL_GUIDED: ProviderArmLike;
  }>;
};

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function sameArtifact(
  left: unknown,
  right: unknown,
) {
  return left !== null
    && right !== null
    && sha256StableJsonV2(left)
      === sha256StableJsonV2(right);
}

function isLeadingSubset(
  complete: readonly string[],
  subset: readonly string[],
) {
  return subset.length <= complete.length
    && subset.every(
      (id, index) => complete[index] === id,
    );
}

export function evaluateT45CandidateStructuralReadinessV1(
  input: {
    candidate: CandidateLike;
    selection: SelectionLike;
    provider: ProviderLike;
  },
): T45CandidateStructuralReadinessV1 {
  const total = input.candidate.cases.length;
  if (
    total < 1
    || input.selection.cases.length !== total
    || input.provider.cases.length !== total
  ) {
    throw new Error(
      "T45_CANDIDATE_STRUCTURAL_CASE_COUNT_DRIFT",
    );
  }
  const cases = input.candidate.cases.map(
    (candidateCase, index) => {
      const selectionCase =
        input.selection.cases[index]!;
      const providerCase = input.provider.cases[index]!;
      if (
        selectionCase.caseId !== candidateCase.caseId
        || providerCase.caseId !== candidateCase.caseId
      ) {
        throw new Error(
          "T45_CANDIDATE_STRUCTURAL_CASE_ORDER_DRIFT",
        );
      }
      const aCandidate =
        candidateCase.arms.A_WHOLE_QUERY;
      const bCandidate =
        candidateCase.arms.B_MODEL_GUIDED;
      const aSelected =
        selectionCase.arms.A_WHOLE_QUERY.selected;
      const protectedAnchors =
        selectionCase.arms.B_MODEL_GUIDED.selected
          .filter(
            ({ selectionSource }) =>
              selectionSource
                === "WHOLE_QUERY_BASELINE",
          );
      const aCandidateIds = new Set(
        aCandidate.candidateNodes.map(
          ({ nodeId }) => nodeId,
        ),
      );
      const bCandidateIds = new Set(
        bCandidate.candidateNodes.map(
          ({ nodeId }) => nodeId,
        ),
      );
      const aSelectedIds = aSelected.map(
        ({ nodeId }) => nodeId,
      );
      const protectedIds = protectedAnchors.map(
        ({ nodeId }) => nodeId,
      );
      const baselineAvailable =
        aCandidate.directEvidenceBatchHash !== null
        && aCandidate.rrfResultHash !== null
        && aCandidate.candidateNodes.length > 0
        && aSelected.length >= 1
        && aSelected.length <= 8
        && unique(aSelectedIds)
        && aSelectedIds.every((id) =>
          aCandidateIds.has(id));
      const protectedAnchorsValid =
        protectedAnchors.length >= 1
        && protectedAnchors.length <= 8
        && unique(protectedIds)
        && protectedIds.every((id) =>
          bCandidateIds.has(id));
      const aProvider = providerCase.A_WHOLE_QUERY;
      const bProvider = providerCase.B_MODEL_GUIDED;
      const baselineReused =
        bProvider.retrievalMode === "BASELINE_REUSED";
      const validCount = (value: number) =>
        Number.isInteger(value) && value >= 0;
      const caseCallsAgree =
        validCount(aProvider.expectedProviderCalls)
        && validCount(aProvider.actualProviderCalls)
        && validCount(bProvider.expectedProviderCalls)
        && validCount(bProvider.actualProviderCalls)
        && aProvider.status === "EXECUTED"
        && aProvider.expectedProviderCalls >= 1
        && aProvider.actualProviderCalls >= 1
        && aProvider.batch !== null
        && aProvider.rrf !== null
        && (
          baselineReused
          || (
            bProvider.status === "EXECUTED"
            && bProvider.retrievalMode === undefined
            && bProvider.expectedProviderCalls >= 1
            && bProvider.actualProviderCalls >= 1
            && bProvider.batch !== null
            && bProvider.rrf !== null
          )
        );
      const reusedBaselineAgrees =
        !baselineReused
        || (
          aProvider.status === "EXECUTED"
          && bProvider.status === "CLARIFY"
          && bProvider.expectedProviderCalls === 0
          && bProvider.actualProviderCalls === 0
          && sameArtifact(
            aProvider.batch,
            bProvider.batch,
          )
          && sameArtifact(
            aProvider.rrf,
            bProvider.rrf,
          )
          && aCandidate.directEvidenceBatchHash
            === bCandidate.directEvidenceBatchHash
          && aCandidate.rrfResultHash
            === bCandidate.rrfResultHash
          && aCandidate.candidateNodeIdsSha256
            === bCandidate.candidateNodeIdsSha256
          && isLeadingSubset(
            aSelectedIds,
            protectedIds,
          )
        );
      const clarifyModeAgrees =
        bProvider.status !== "CLARIFY"
        || baselineReused;
      return {
        caseId: candidateCase.caseId,
        aBaselineCount: aSelected.length,
        protectedAnchorCount:
          protectedAnchors.length,
        baselineAvailable,
        protectedAnchorsValid,
        baselineReused,
        baselineSingleCount:
          caseCallsAgree
          && reusedBaselineAgrees
          && clarifyModeAgrees,
      };
    },
  );
  const summedExpected = input.provider.cases.reduce(
    (sum, testCase) =>
      sum
      + testCase.A_WHOLE_QUERY
        .expectedProviderCalls
      + testCase.B_MODEL_GUIDED
        .expectedProviderCalls,
    0,
  );
  const summedActual = input.provider.cases.reduce(
    (sum, testCase) =>
      sum
      + testCase.A_WHOLE_QUERY
        .actualProviderCalls
      + testCase.B_MODEL_GUIDED
        .actualProviderCalls,
    0,
  );
  const totalsAgree =
    input.provider.expectedCalls === summedExpected
    && input.provider.actualCalls === summedActual
    && input.provider.matched
      === (
        input.provider.expectedCalls
          === input.provider.actualCalls
      )
    && input.provider.matched
    && input.candidate.providerAudit.expectedCalls
      === input.provider.expectedCalls
    && input.candidate.providerAudit.actualCalls
      === input.provider.actualCalls
    && input.candidate.providerAudit.matched
      === input.provider.matched;
  if (!totalsAgree) {
    for (const testCase of cases) {
      testCase.baselineSingleCount = false;
    }
  }
  const count = (
    field:
      | "baselineAvailable"
      | "protectedAnchorsValid"
      | "baselineSingleCount",
  ) => cases.filter((testCase) =>
    testCase[field]).length;
  const allCasesGate = (
    observedCases: number,
  ) => ({
    observedCases,
    requiredCases: total,
    passed: observedCases === total,
  });
  const gates = {
    baselineAvailable: allCasesGate(
      count("baselineAvailable"),
    ),
    protectedAnchors: {
      ...allCasesGate(
        count("protectedAnchorsValid"),
      ),
      minimumPerCase: 1 as const,
      maximumPerCase: 8 as const,
    },
    baselineSingleCount: allCasesGate(
      count("baselineSingleCount"),
    ),
  };
  return T45CandidateStructuralReadinessV1Schema.parse({
    schemaVersion: 1,
    kind: "T45_CANDIDATE_STRUCTURAL_READINESS",
    gates,
    cases,
    passed: Object.values(gates).every(
      ({ passed }) => passed,
    ),
  });
}
