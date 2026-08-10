import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  evaluateT44ContentRerankerSelectionV1,
} from "@/scripts/audit-t44-content-reranker-v1";
import {
  loadT45ReviewerSourceBundleV1,
  parseT45MultiAnchorReviewerArguments,
  T45ContentDraftArtifactV1Schema,
  T45FinalSelectionArtifactV1Schema,
  verifyT45SelectorFreezeV1,
  type T45FinalSelectionArtifactV1,
  type T45ReviewerArguments,
  type T45ReviewerSourceBundleV1,
  type T45SelectorFreezeV1,
} from "@/scripts/run-t45-multi-anchor-reviewer-v1";
import {
  T44_CONTENT_RERANKER_CONFIG_HASH_V1,
  T44_CONTENT_RERANKER_CONFIG_V1,
  T44ContentRerankerSelectionArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  assertT45CandidateOracleReadyForSelection,
} from "@/tools/mixed-retrieval/t45-candidate-oracle-gate-v1";
import {
  evaluateT45Selection,
  T45SelectionReportSchema,
} from "@/tools/mixed-retrieval/t45-capability-evaluator";
import {
  loadT45CapabilityArtifacts,
} from "@/tools/mixed-retrieval/t45-capability-loader";
import {
  loadT44SupportDevArtifacts,
} from "@/tools/mixed-retrieval/t44-support-loader";
import {
  acquireT45StageReservationV1,
  publishT45SealedCheckpointV1,
} from "@/tools/mixed-retrieval/t45-sealed-checkpoint-v1";
import {
  sealT45AuditReceiptV1,
  verifyT45AuditReceiptV1,
  type T45AuditReceiptV1,
} from "@/tools/mixed-retrieval/t45-audit-receipt-v1";
import {
  captureT45SelectorSourceClosureV1,
} from "@/tools/mixed-retrieval/t45-selector-source-closure-v1";
import {
  validateT45FinalArtifactV1,
} from "@/tools/mixed-retrieval/t45-final-artifact-validator-v1";

const HASH = /^[0-9a-f]{64}$/;
const HashSchema = z.string().regex(HASH);
const ARTIFACT_ROOT = ".runtime/mixed-retrieval";

export type T45MultiAnchorAuditArguments =
  T45ReviewerArguments;

export function parseT45MultiAnchorAuditArguments(
  argv: readonly string[],
): T45MultiAnchorAuditArguments {
  return parseT45MultiAnchorReviewerArguments(argv);
}

export type T45LegacyAuditDecision =
  | "LEGACY_REGRESSION_RECOVERED"
  | "LEGACY_REGRESSION_NONREGRESSION_ONLY"
  | "LEGACY_REGRESSION_NO_GO";

export function classifyT45LegacyAuditDecisionV1(
  input: {
    supportCases: number;
    otherHardGatesPassed: boolean;
  },
): T45LegacyAuditDecision {
  if (!input.otherHardGatesPassed) {
    return "LEGACY_REGRESSION_NO_GO";
  }
  if (input.supportCases >= 45) {
    return "LEGACY_REGRESSION_RECOVERED";
  }
  if (input.supportCases >= 43) {
    return "LEGACY_REGRESSION_NONREGRESSION_ONLY";
  }
  return "LEGACY_REGRESSION_NO_GO";
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function canonicalJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson<T>(
  target: string,
  label: string,
  parse: (value: unknown) => T,
) {
  let serialized: string;
  try {
    serialized = await readFile(target, "utf8");
  } catch {
    throw new Error(
      `T45_MULTI_ANCHOR_AUDIT_${label}_MISSING`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error(
      `T45_MULTI_ANCHOR_AUDIT_${label}_JSON_INVALID`,
    );
  }
  return {
    path: path.resolve(target),
    bytes: Buffer.byteLength(serialized, "utf8"),
    sha256: sha256(serialized),
    value: parse(raw),
    serialized,
  };
}

async function readIfExists<T>(
  target: string,
  parse: (value: unknown) => T,
) {
  try {
    return await readJson(target, "REPORT", parse);
  } catch (error) {
    if (
      error instanceof Error
      && error.message
        === "T45_MULTI_ANCHOR_AUDIT_REPORT_MISSING"
    ) {
      return null;
    }
    throw error;
  }
}

async function writeNew(
  target: string,
  value: unknown,
) {
  const serialized = canonicalJson(value);
  const published =
    await publishT45SealedCheckpointV1({
      target,
      bytes: serialized,
      errorPrefix:
        "T45_MULTI_ANCHOR_AUDIT_REPORT",
    });
  const observed = published.bytes.toString("utf8");
  if (observed !== serialized) {
    throw new Error(
      "T45_MULTI_ANCHOR_AUDIT_REPORT_BYTE_DRIFT",
    );
  }
  return {
    path: published.path,
    bytes: published.bytes.byteLength,
    sha256: sha256(published.bytes),
  };
}

function same(left: unknown, right: unknown) {
  return canonicalJson(left) === canonicalJson(right);
}

function nearestRankP95(
  values: readonly number[],
) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort(
    (left, right) => left - right,
  );
  return sorted[
    Math.ceil(sorted.length * 0.95) - 1
  ] ?? 0;
}

const LegacyMinimumGateSchema = z.object({
  observed: z.number().finite().nonnegative(),
  minimum: z.number().finite().nonnegative(),
  passed: z.boolean(),
}).strict();
const LegacyMaximumGateSchema = z.object({
  observed: z.number().finite().nonnegative(),
  maximum: z.number().finite().nonnegative(),
  passed: z.boolean(),
}).strict();
const LegacyCourseAggregateSchema = z.object({
  cases: z.number().int().nonnegative(),
  supportCovered: z.number().int().nonnegative(),
  supportTotal: z.number().int().nonnegative(),
  groupCovered: z.number().int().nonnegative(),
  groupTotal: z.number().int().nonnegative(),
  multiCovered: z.number().int().nonnegative(),
  multiTotal: z.number().int().nonnegative(),
  hardNegativeNodes: z.number().int().nonnegative(),
  hardNegativeCases: z.number().int().nonnegative(),
}).strict();

export const T45LegacyEvaluationV1Schema =
z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("T44_CONTENT_RERANKER_AUDIT"),
  artifactId: z.string(),
  scope: z.literal("FULL"),
  decision: z.enum([
    "LEGACY_REGRESSION_RECOVERED",
    "LEGACY_REGRESSION_NONREGRESSION_ONLY",
    "LEGACY_REGRESSION_NO_GO",
  ]),
  metrics: z.object({
    support: z.object({
      covered: z.number().int().min(0).max(50),
      total: z.literal(50),
    }).strict(),
    requiredGroups: z.object({
      covered: z.number().int().min(0).max(97),
      total: z.literal(97),
    }).strict(),
    multi: z.object({
      covered: z.number().int().min(0).max(10),
      total: z.literal(10),
    }).strict(),
    hardNegative: z.object({
      nodes: z.number().int().nonnegative(),
      cases: z.number().int().min(0).max(50),
      aBaselineNodes:
        z.number().int().nonnegative(),
      aBaselineCases:
        z.number().int().min(0).max(50),
    }).strict(),
    modelValid: z.object({
      valid: z.number().int().min(0).max(50),
      total: z.literal(50),
    }).strict(),
    latency: z.object({
      p50Ms: z.number().finite().nonnegative(),
      p95Ms: z.number().finite().nonnegative(),
    }).strict(),
  }).strict(),
  aBaseline: z.object({
    support: z.object({
      covered: z.number().int().min(0).max(50),
      total: z.literal(50),
    }).strict(),
  }).strict(),
  delta: z.object({
    gainedCaseIds: z.array(z.string().regex(
      /^[a-z0-9][a-z0-9-]{0,127}$/,
    )),
    lostCaseIds: z.array(z.string().regex(
      /^[a-z0-9][a-z0-9-]{0,127}$/,
    )),
  }).strict(),
  byCoursePack: z.record(
    z.string(),
    LegacyCourseAggregateSchema,
  ),
  gates: z.object({
    support: LegacyMinimumGateSchema,
    multi: LegacyMinimumGateSchema,
    hardNegativeNodes: LegacyMaximumGateSchema,
    hardNegativeCases: LegacyMaximumGateSchema,
    modelValid: LegacyMinimumGateSchema,
    bindingViolations: LegacyMaximumGateSchema,
    p95Ms: LegacyMaximumGateSchema,
  }).strict(),
  caseResults: z.array(z.object({
    caseId: z.string().regex(
      /^[a-z0-9][a-z0-9-]{0,127}$/,
    ),
    coursePackId: z.string().regex(
      /^[a-z0-9][a-z0-9-]{0,127}$/,
    ),
    modelStatus: z.enum(["VALID", "INVALID"]),
    multiClaim: z.boolean(),
    support: z.boolean(),
    coveredGroupIds: z.array(z.string()),
    missingGroupIds: z.array(z.string()),
    hardNegativeIntrusionNodeIds:
      z.array(z.string()),
    selected: z.array(z.object({
      nodeId: z.string(),
      objectId: z.string(),
      text: z.string(),
      evidenceRole: z.enum([
        "DIRECT",
        "COMPLEMENT",
        "CONTEXT",
      ]),
      obligationIds: z.array(z.string()),
    }).strict()).max(8),
  }).strict()).length(50),
  operations: z.object({
    graphify: z.literal("NOT_USED"),
    database: z.literal("NOT_USED"),
    web: z.literal("NOT_USED"),
    deployment: z.literal("NOT_PERFORMED"),
  }).strict(),
  interpretationBoundary: z.string().min(1),
  bindingViolations:
    z.number().int().nonnegative(),
}).strict().superRefine((evaluation, context) => {
  const packs = Object.values(
    evaluation.byCoursePack,
  );
  const sum = (
    field: keyof z.infer<
      typeof LegacyCourseAggregateSchema
    >,
  ) => packs.reduce(
    (total, pack) => total + pack[field],
    0,
  );
  const caseSupport = evaluation.caseResults.filter(
    ({ support }) => support,
  ).length;
  const groupCovered =
    evaluation.caseResults.reduce(
      (total, testCase) =>
        total + testCase.coveredGroupIds.length,
      0,
    );
  const groupTotal =
    evaluation.caseResults.reduce(
      (total, testCase) =>
        total
        + testCase.coveredGroupIds.length
        + testCase.missingGroupIds.length,
      0,
    );
  const hardNegativeNodes =
    evaluation.caseResults.reduce(
      (total, testCase) =>
        total
        + testCase
          .hardNegativeIntrusionNodeIds.length,
      0,
    );
  const hardNegativeCases =
    evaluation.caseResults.filter(
      ({ hardNegativeIntrusionNodeIds }) =>
        hardNegativeIntrusionNodeIds.length > 0,
    ).length;
  const valid = evaluation.caseResults.filter(
    ({ modelStatus }) => modelStatus === "VALID",
  ).length;
  const expectedByCoursePack = new Map<
    string,
    z.infer<typeof LegacyCourseAggregateSchema>
  >();
  let caseTruthDrift = false;
  for (const testCase of evaluation.caseResults) {
    const selectedNodeIds = testCase.selected.map(
      ({ nodeId }) => nodeId,
    );
    const selected = new Set(selectedNodeIds);
    const covered = new Set(
      testCase.coveredGroupIds,
    );
    const missing = new Set(
      testCase.missingGroupIds,
    );
    const hardNegative = new Set(
      testCase.hardNegativeIntrusionNodeIds,
    );
    const requiredGroupCount =
      testCase.coveredGroupIds.length
      + testCase.missingGroupIds.length;
    if (
      selected.size !== selectedNodeIds.length
      || covered.size
        !== testCase.coveredGroupIds.length
      || missing.size
        !== testCase.missingGroupIds.length
      || [...covered].some(
        (groupId) => missing.has(groupId),
      )
      || requiredGroupCount < 1
      || testCase.support
        !== (testCase.missingGroupIds.length === 0)
      || (
        testCase.support
        && testCase.selected.length === 0
      )
      || hardNegative.size
        !== testCase
          .hardNegativeIntrusionNodeIds.length
      || testCase
        .hardNegativeIntrusionNodeIds.some(
          (nodeId) => !selected.has(nodeId),
        )
      || testCase.selected.some(
        ({ obligationIds }) =>
          new Set(obligationIds).size
            !== obligationIds.length,
      )
      || (
        testCase.modelStatus === "INVALID"
        && (
          testCase.selected.length > 0
          || testCase.support
          || testCase.coveredGroupIds.length > 0
          || testCase
            .hardNegativeIntrusionNodeIds.length
            > 0
        )
      )
    ) {
      caseTruthDrift = true;
    }
    const pack =
      expectedByCoursePack.get(
        testCase.coursePackId,
      ) ?? {
        cases: 0,
        supportCovered: 0,
        supportTotal: 0,
        groupCovered: 0,
        groupTotal: 0,
        multiCovered: 0,
        multiTotal: 0,
        hardNegativeNodes: 0,
        hardNegativeCases: 0,
      };
    pack.cases += 1;
    pack.supportTotal += 1;
    pack.groupCovered +=
      testCase.coveredGroupIds.length;
    pack.groupTotal += requiredGroupCount;
    pack.hardNegativeNodes +=
      testCase
        .hardNegativeIntrusionNodeIds.length;
    if (testCase.support) {
      pack.supportCovered += 1;
    }
    if (testCase.multiClaim) {
      pack.multiTotal += 1;
      if (testCase.support) {
        pack.multiCovered += 1;
      }
    }
    if (
      testCase.hardNegativeIntrusionNodeIds
        .length > 0
    ) {
      pack.hardNegativeCases += 1;
    }
    expectedByCoursePack.set(
      testCase.coursePackId,
      pack,
    );
  }
  const expectedByCoursePackObject =
    Object.fromEntries(
      [...expectedByCoursePack.entries()].sort(
        ([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
      ),
    );
  const expectedMultiCovered =
    evaluation.caseResults.filter(
      (testCase) =>
        testCase.multiClaim
        && testCase.support,
    ).length;
  const expectedMultiTotal =
    evaluation.caseResults.filter(
      (testCase) => testCase.multiClaim,
    ).length;
  const deltaIds = [
    ...evaluation.delta.gainedCaseIds,
    ...evaluation.delta.lostCaseIds,
  ];
  const aggregatesDrift = (
    caseTruthDrift
    || new Set(evaluation.caseResults.map(
      ({ caseId }) => caseId,
    )).size !== 50
    || !same(
      evaluation.byCoursePack,
      expectedByCoursePackObject,
    )
    || packs.length !== 5
    || sum("cases") !== 50
    || sum("supportCovered") !== caseSupport
    || sum("supportTotal") !== 50
    || sum("groupCovered") !== groupCovered
    || sum("groupTotal") !== groupTotal
    || sum("multiCovered")
      !== evaluation.metrics.multi.covered
    || sum("multiTotal") !== 10
    || expectedMultiCovered
      !== evaluation.metrics.multi.covered
    || expectedMultiTotal !== 10
    || sum("hardNegativeNodes")
      !== hardNegativeNodes
    || sum("hardNegativeCases")
      !== hardNegativeCases
    || evaluation.metrics.support.covered
      !== caseSupport
    || evaluation.metrics.requiredGroups.covered
      !== groupCovered
    || groupTotal !== 97
    || evaluation.metrics.hardNegative.nodes
      !== hardNegativeNodes
    || evaluation.metrics.hardNegative.cases
      !== hardNegativeCases
    || evaluation.metrics.modelValid.valid !== valid
    || new Set(deltaIds).size !== deltaIds.length
    || deltaIds.some(
      (caseId) =>
        !evaluation.caseResults.some(
          (testCase) =>
            testCase.caseId === caseId,
        ),
    )
  );
  const expectedGates = {
    support: {
      observed: evaluation.metrics.support.covered,
      threshold: 45,
      passed:
        evaluation.metrics.support.covered >= 45,
    },
    multi: {
      observed: evaluation.metrics.multi.covered,
      threshold: 9,
      passed:
        evaluation.metrics.multi.covered >= 9,
    },
    hardNegativeNodes: {
      observed:
        evaluation.metrics.hardNegative.nodes,
      threshold:
        evaluation.metrics.hardNegative
          .aBaselineNodes,
      passed:
        evaluation.metrics.hardNegative.nodes
        <= evaluation.metrics.hardNegative
          .aBaselineNodes,
    },
    hardNegativeCases: {
      observed:
        evaluation.metrics.hardNegative.cases,
      threshold:
        evaluation.metrics.hardNegative
          .aBaselineCases,
      passed:
        evaluation.metrics.hardNegative.cases
        <= evaluation.metrics.hardNegative
          .aBaselineCases,
    },
    modelValid: {
      observed:
        evaluation.metrics.modelValid.valid,
      threshold: 50,
      passed:
        evaluation.metrics.modelValid.valid === 50,
    },
    bindingViolations: {
      observed: evaluation.bindingViolations,
      threshold: 0,
      passed: evaluation.bindingViolations === 0,
    },
    p95Ms: {
      observed:
        evaluation.metrics.latency.p95Ms,
      threshold: 30_000,
      passed:
        evaluation.metrics.latency.p95Ms <= 30_000,
    },
  };
  const gatesDrift = Object.entries(
    expectedGates,
  ).some(([name, expected]) => {
    const gate = evaluation.gates[
      name as keyof typeof expectedGates
    ];
    const threshold = "minimum" in gate
      ? gate.minimum
      : gate.maximum;
    return (
      gate.observed !== expected.observed
      || threshold !== expected.threshold
      || gate.passed !== expected.passed
    );
  });
  const otherHardGatesPassed = Object.entries(
    expectedGates,
  ).filter(([name]) => name !== "support")
    .every(([, gate]) => gate.passed);
  const expectedDecision =
    classifyT45LegacyAuditDecisionV1({
      supportCases:
        evaluation.metrics.support.covered,
      otherHardGatesPassed,
    });
  if (
    aggregatesDrift
    || gatesDrift
    || evaluation.decision !== expectedDecision
  ) {
    context.addIssue({
      code: "custom",
      message:
        "T45_LEGACY_EVALUATION_TRUTH_DRIFT",
    });
  }
});

export const T45MultiAnchorAuditReportV1Schema =
z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("T45_MULTI_ANCHOR_AUDIT"),
  split: z.enum([
    "CALIBRATION",
    "VALIDATION",
    "LEGACY_REGRESSION",
  ]),
  runId: z.string(),
  artifactId: z.string(),
  decision: z.enum([
    "CALIBRATION_GO",
    "CALIBRATION_NO_GO",
    "VALIDATION_GO",
    "VALIDATION_SELECTOR_NO_GO",
    "LEGACY_REGRESSION_RECOVERED",
    "LEGACY_REGRESSION_NONREGRESSION_ONLY",
    "LEGACY_REGRESSION_NO_GO",
  ]),
  inputs: z.object({
    selectionSha256: HashSchema,
    draftSelectionSha256: HashSchema,
    oracleGateSha256: HashSchema.nullable(),
    freezeHash: HashSchema.nullable(),
    source: z.object({
      boundarySha256: HashSchema,
      plannerSha256: HashSchema,
      candidateSha256: HashSchema,
      matrixSha256: HashSchema,
      baselineSelectionSha256: HashSchema,
      oracleGateSha256: HashSchema.nullable(),
    }).strict(),
  }).strict(),
  sourceClosureHash: HashSchema,
  evaluation: z.union([
    T45SelectionReportSchema,
    T45LegacyEvaluationV1Schema,
  ]),
  generatedAt: z.string().datetime(),
}).strict().superRefine((report, context) => {
  if (
    report.split === "CALIBRATION"
    || report.split === "VALIDATION"
  ) {
    const evaluation =
      T45SelectionReportSchema.safeParse(
        report.evaluation,
      );
    if (
      !evaluation.success
      || evaluation.data.split !== report.split
      || evaluation.data.decision
        !== report.decision
    ) {
      context.addIssue({
        code: "custom",
        path: ["evaluation"],
        message:
          "T45 audit evaluation/top-level drift",
      });
    }
  } else if (
    report.evaluation.decision !== report.decision
  ) {
    context.addIssue({
      code: "custom",
      path: ["evaluation", "decision"],
      message:
        "legacy evaluation/top-level drift",
    });
  }
});

export type T45MultiAnchorAuditReportV1 =
  z.infer<
    typeof T45MultiAnchorAuditReportV1Schema
  >;

function nearestRank(
  values: readonly number[],
  quantile: number,
) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort(
    (left, right) => left - right,
  );
  return sorted[
    Math.ceil(sorted.length * quantile) - 1
  ] ?? 0;
}

export function assertT45AuditReportMatchesSelectionV1(
  rawReport: T45MultiAnchorAuditReportV1,
  rawSelection: T45FinalSelectionArtifactV1,
) {
  const report =
    T45MultiAnchorAuditReportV1Schema.parse(
      rawReport,
    );
  const selection =
    T45FinalSelectionArtifactV1Schema.parse(
      rawSelection,
    );
  if (
    report.split === "CALIBRATION"
    || report.split === "VALIDATION"
  ) {
    const evaluation =
      T45SelectionReportSchema.parse(
        report.evaluation,
      );
    const expectedCases =
      selection.cases.map((testCase) => ({
        caseId: testCase.caseId,
        status: testCase.status,
        selectedNodeIds:
          testCase.selected.map(
            ({ nodeId }) => nodeId,
          ),
        bindingViolations:
          testCase.bindingViolations,
      }));
    const observedCases =
      evaluation.cases.map((testCase) => ({
        caseId: testCase.caseId,
        status: testCase.status,
        selectedNodeIds:
          testCase.selectedNodeIds,
        bindingViolations:
          testCase.bindingViolations,
      }));
    const reviewerP95Ms = nearestRank(
      selection.cases.map(
        ({ stageAudit }) =>
          stageAudit.reviewer.elapsedMs,
      ),
      0.95,
    );
    if (
      !same(observedCases, expectedCases)
      || evaluation.summary.reviewerP95Ms
        !== reviewerP95Ms
    ) {
      throw new Error(
        "T45_CAPABILITY_REPORT_SELECTION_TRUTH_DRIFT",
      );
    }
    return report;
  }
  const evaluation =
    T45LegacyEvaluationV1Schema.parse(
      report.evaluation,
    );
  const expectedCases =
    selection.cases.map((testCase) => ({
      caseId: testCase.caseId,
      coursePackId: testCase.coursePackId,
      modelStatus: testCase.status,
      selected: testCase.selected.map(
        ({
          nodeId,
          objectId,
          text,
          evidenceRole,
          obligationIds,
        }) => ({
          nodeId,
          objectId,
          text,
          evidenceRole,
          obligationIds,
        }),
      ),
    }));
  const observedCases =
    evaluation.caseResults.map(
      (testCase) => ({
        caseId: testCase.caseId,
        coursePackId:
          testCase.coursePackId,
        modelStatus:
          testCase.modelStatus,
        selected: testCase.selected,
      }),
    );
  const elapsed = selection.cases.map(
    ({ audit }) => audit.elapsedMs,
  );
  const bindingViolations =
    selection.cases.reduce(
      (sum, testCase) =>
        sum + testCase.bindingViolations.length,
      0,
    );
  if (
    !same(observedCases, expectedCases)
    || evaluation.bindingViolations
      !== bindingViolations
    || evaluation.metrics.modelValid.valid
      !== selection.summary.valid
    || evaluation.metrics.latency.p50Ms
      !== nearestRank(elapsed, 0.5)
    || evaluation.metrics.latency.p95Ms
      !== nearestRank(elapsed, 0.95)
  ) {
    throw new Error(
      "T45_LEGACY_REPORT_SELECTION_TRUTH_DRIFT",
    );
  }
  return report;
}

function buildAuditReceipt(
  report: T45MultiAnchorAuditReportV1,
  reportSha256: string,
): T45AuditReceiptV1 {
  const aggregate =
    report.split === "LEGACY_REGRESSION"
      ? (() => {
          const evaluation =
            T45LegacyEvaluationV1Schema.parse(
              report.evaluation,
            );
          return {
            kind: "LEGACY" as const,
            cases: 50 as const,
            requiredGroups: 97 as const,
            multiCases: 10 as const,
            supportCases:
              evaluation.metrics.support.covered,
            requiredGroupsCovered:
              evaluation.metrics.requiredGroups
                .covered,
            multiCoverage:
              evaluation.metrics.multi.covered,
            hardNegativeNodes:
              evaluation.metrics.hardNegative.nodes,
            hardNegativeCases:
              evaluation.metrics.hardNegative.cases,
            aBaselineHardNegativeNodes:
              evaluation.metrics.hardNegative
                .aBaselineNodes,
            aBaselineHardNegativeCases:
              evaluation.metrics.hardNegative
                .aBaselineCases,
            validSelections:
              evaluation.metrics.modelValid.valid,
            bindingViolations:
              evaluation.bindingViolations,
            p95Ms:
              evaluation.metrics.latency.p95Ms,
          };
        })()
      : (() => {
          const evaluation =
            T45SelectionReportSchema.parse(
              report.evaluation,
            );
          return {
            kind: "CAPABILITY" as const,
            cases: 20 as const,
            requiredGroups: 30 as const,
            multiCases: 10 as const,
            families: 10 as const,
            supportCases:
              evaluation.summary.supportCases,
            requiredGroupsCovered:
              evaluation.summary
                .requiredGroupsCovered,
            multiJointCoverage:
              evaluation.summary
                .multiJointCoverage,
            familiesWithBothCasesSupported:
              evaluation.summary
                .familiesWithBothCasesSupported,
            hardNegativeNodes:
              evaluation.summary.hardNegativeNodes,
            hardNegativeCases:
              evaluation.summary.hardNegativeCases,
            aBaselineHardNegativeNodes:
              evaluation.summary
                .aBaselineHardNegativeNodes,
            aBaselineHardNegativeCases:
              evaluation.summary
                .aBaselineHardNegativeCases,
            validSelections:
              evaluation.summary.validSelections,
            bindingViolations:
              evaluation.summary.bindingViolations,
            reviewerP95Ms:
              evaluation.summary.reviewerP95Ms,
          };
        })();
  return sealT45AuditReceiptV1({
    schemaVersion: 1,
    kind: "T45_AUDIT_RECEIPT",
    split: report.split,
    runId: report.runId,
    artifactId: report.artifactId,
    decision: report.decision,
    inputs: report.inputs,
    reportSha256,
    sourceClosureHash:
      report.sourceClosureHash,
    evaluatorConfigHash:
      report.split === "LEGACY_REGRESSION"
        ? T44_CONTENT_RERANKER_CONFIG_HASH_V1
        : T45SelectionReportSchema.parse(
            report.evaluation,
          ).configHash,
    aggregate,
  });
}

export function assertT45AuditReceiptMatchesReportV1(
  report: T45MultiAnchorAuditReportV1,
  reportSha256: string,
  receipt: T45AuditReceiptV1,
) {
  const expected = buildAuditReceipt(
    T45MultiAnchorAuditReportV1Schema.parse(
      report,
    ),
    reportSha256,
  );
  if (!same(expected, receipt)) {
    throw new Error(
      "T45_AUDIT_RECEIPT_REPORT_TRUTH_DRIFT",
    );
  }
  return receipt;
}

function assertSelectionBindings(
  parsed: T45ReviewerArguments,
  source: T45ReviewerSourceBundleV1,
  selection: T45FinalSelectionArtifactV1,
  freeze: T45SelectorFreezeV1 | null,
) {
  const sourceInputs = {
    boundarySha256:
      selection.inputs.boundarySha256,
    plannerSha256:
      selection.inputs.plannerSha256,
    candidateSha256:
      selection.inputs.candidateSha256,
    matrixSha256:
      selection.inputs.matrixSha256,
    baselineSelectionSha256:
      selection.inputs.baselineSelectionSha256,
    oracleGateSha256:
      selection.inputs.oracleGateSha256,
  };
  if (
    selection.runId !== parsed.runId
    || selection.artifactId !== parsed.artifactId
    || !same(selection.runtimeSuite, source.runtimeSuite)
    || selection.inventoryHash !== source.inventoryHash
    || !same(sourceInputs, source.inputs)
    || (
      freeze
      && !same(selection.model, freeze.model)
    )
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_AUDIT_SELECTION_BINDING_DRIFT",
    );
  }
}

function baselineCases(
  source: T45ReviewerSourceBundleV1,
) {
  return source.baselineSelection.cases.map(
    (testCase) => ({
      caseId: testCase.caseId,
      coursePackId: testCase.coursePackId,
      selectedNodeIds:
        testCase.arms.A_WHOLE_QUERY.selected.map(
          ({ nodeId }) => nodeId,
        ),
    }),
  );
}

function selectionCases(
  selection: T45FinalSelectionArtifactV1,
) {
  return selection.cases.map((testCase) => ({
    caseId: testCase.caseId,
    coursePackId: testCase.coursePackId,
    status: testCase.status,
    selected: testCase.selected.map((node) => ({
      nodeId: node.nodeId,
      objectId: node.objectId,
      coursePackId: node.coursePackId,
    })),
    bindingViolations:
      testCase.bindingViolations,
  }));
}

async function readJsonValue(target: string) {
  return JSON.parse(
    await readFile(target, "utf8"),
  ) as unknown;
}

async function evaluateCapability(
  parsed: T45ReviewerArguments,
  source: T45ReviewerSourceBundleV1,
  selection: T45FinalSelectionArtifactV1,
  workspaceRoot: string,
) {
  const split = parsed.split as
    | "CALIBRATION"
    | "VALIDATION";
  const stem = split === "CALIBRATION"
    ? "calibration"
    : "validation";
  const qualityRoot = path.resolve(
    workspaceRoot,
    "tests/retrieval-quality",
  );
  const [inventory, runtime, qrels, corpus] =
    await Promise.all([
      readJsonValue(path.join(
        qualityRoot,
        "t45-capability-inventory.json",
      )),
      readJsonValue(path.join(
        qualityRoot,
        `t45-capability-${stem}.runtime.json`,
      )),
      readJsonValue(path.join(
        qualityRoot,
        `t45-capability-${stem}.qrels.json`,
      )),
      readJsonValue(path.resolve(
        workspaceRoot,
        "data/knowledge-v2/knowledge-corpus.v2.json",
      )),
    ]);
  const loaded = loadT45CapabilityArtifacts({
    inventoryInput: inventory,
    runtimeInput: runtime,
    qrelsInput: qrels,
    corpusInput: corpus,
    expectedSplit: split,
  });
  if (
    loaded.runtime.id !== source.runtimeSuite.id
    || loaded.runtime.version
      !== source.runtimeSuite.version
    || loaded.runtime.suiteHash
      !== source.runtimeSuite.suiteHash
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_AUDIT_RUNTIME_DRIFT",
    );
  }
  return evaluateT45Selection({
    split,
    selectionCases: selectionCases(selection),
    aBaselineCases: baselineCases(source),
    qrels: loaded.qrels,
    reviewerP95Ms: nearestRankP95(
      selection.cases.map(
        ({ stageAudit }) =>
          stageAudit.reviewer.elapsedMs,
      ),
    ),
  });
}

async function evaluateLegacy(
  parsed: T45ReviewerArguments,
  source: T45ReviewerSourceBundleV1,
  selection: T45FinalSelectionArtifactV1,
  workspaceRoot: string,
) {
  const [runtimeInput, qrelsInput, corpusInput] =
    await Promise.all([
      readJsonValue(path.resolve(
        workspaceRoot,
        "tests/retrieval-quality/t44-support-dev.runtime.json",
      )),
      readJsonValue(path.resolve(
        workspaceRoot,
        "tests/retrieval-quality/t44-support-dev.qrels.json",
      )),
      readJsonValue(path.resolve(
        workspaceRoot,
        "data/knowledge-v2/knowledge-corpus.v2.json",
      )),
    ]);
  const loaded = loadT44SupportDevArtifacts(
    runtimeInput,
    qrelsInput,
    corpusInput,
  );
  const projected =
    T44ContentRerankerSelectionArtifactV1Schema
      .parse({
        schemaVersion: 1,
        kind: "T44_CONTENT_RERANKER_SELECTIONS",
        artifactId: parsed.artifactId,
        scope: "FULL",
        runtimeSuite: {
          id: source.runtimeSuite.id,
          version: source.runtimeSuite.version,
          suiteHash: source.runtimeSuite.suiteHash,
        },
        inputs: {
          plannerSha256:
            selection.inputs.plannerSha256,
          candidateSha256:
            selection.inputs.candidateSha256,
          matrixSha256:
            selection.inputs.matrixSha256,
          legacySelectionSha256:
            selection.inputs.baselineSelectionSha256,
        },
        config: T44_CONTENT_RERANKER_CONFIG_V1,
        configHash:
          T44_CONTENT_RERANKER_CONFIG_HASH_V1,
        model: {
          source: selection.model.source,
          modelId: selection.model.modelId,
          endpointHash: selection.model.endpointHash,
        },
        graphifyInvocationCount: 0,
        cases: selection.cases.map((testCase) => ({
          caseId: testCase.caseId,
          coursePackId: testCase.coursePackId,
          candidateMapHash:
            testCase.candidateMapHash,
          promptHash: testCase.promptHash,
          status: testCase.status,
          failureCategory:
            testCase.failureCategory,
          selected: testCase.selected.map(
            (node) => ({
              candidateIndex: node.candidateIndex,
              nodeId: node.nodeId,
              objectId: node.objectId,
              coursePackId: node.coursePackId,
              role: node.role,
              text: node.text,
              nodeContentHash:
                node.nodeContentHash,
              baselineRank: node.baselineRank,
              wholeQueryRank:
                node.wholeQueryRank,
              obligationRanks:
                node.obligationRanks,
              obligationIds: node.obligationIds,
              evidenceRole: node.evidenceRole,
            }),
          ),
          audit: testCase.audit,
        })),
        summary: selection.summary,
        generatedAt: selection.generatedAt,
        operations: {
          graphify: "NOT_USED",
          database: "NOT_USED",
          web: "NOT_USED",
          deployment: "NOT_PERFORMED",
        },
      });
  const evaluation =
    evaluateT44ContentRerankerSelectionV1({
      artifact: projected,
      labels: loaded.qrels.cases,
      aBaseline: baselineCases(source).map(
        ({ caseId, selectedNodeIds }) => ({
          caseId,
          selectedNodeIds,
        }),
      ),
    });
  const multiClaimByCaseId = new Map(
    loaded.qrels.cases.map(
      ({ caseId, multiClaim }) => [
        caseId,
        multiClaim,
      ],
    ),
  );
  const bindingViolations = selection.cases.reduce(
    (sum, testCase) =>
      sum + testCase.bindingViolations.length,
    0,
  );
  const otherHardGatesPassed = Object.entries(
    evaluation.gates,
  ).filter(([name]) => name !== "support")
    .every(([, gate]) => gate.passed)
    && selection.summary.valid === 50
    && bindingViolations === 0;
  return {
    ...evaluation,
    caseResults: evaluation.caseResults.map(
      (testCase) => ({
        ...testCase,
        multiClaim:
          multiClaimByCaseId.get(
            testCase.caseId,
          ) ?? false,
      }),
    ),
    bindingViolations,
    decision: classifyT45LegacyAuditDecisionV1({
      supportCases:
        evaluation.metrics.support.covered,
      otherHardGatesPassed,
    }),
  };
}

export type T45MultiAnchorAuditDependenciesV1 = {
  captureSourceClosure(
    workspaceRoot: string,
  ): ReturnType<
    typeof captureT45SelectorSourceClosureV1
  >;
  loadSource:
    typeof loadT45ReviewerSourceBundleV1;
  verifyFreeze:
    typeof verifyT45SelectorFreezeV1;
  validateFinal:
    typeof validateT45FinalArtifactV1;
  assertReportMatchesSelection:
    typeof assertT45AuditReportMatchesSelectionV1;
  evaluate(
    parsed: T45ReviewerArguments,
    source: T45ReviewerSourceBundleV1,
    selection: T45FinalSelectionArtifactV1,
    workspaceRoot: string,
  ): Promise<unknown>;
};

const DEFAULT_DEPENDENCIES:
T45MultiAnchorAuditDependenciesV1 = {
  captureSourceClosure:
    captureT45SelectorSourceClosureV1,
  loadSource: loadT45ReviewerSourceBundleV1,
  verifyFreeze: verifyT45SelectorFreezeV1,
  validateFinal: validateT45FinalArtifactV1,
  assertReportMatchesSelection:
    assertT45AuditReportMatchesSelectionV1,
  evaluate: async (
    parsed,
    source,
    selection,
    workspaceRoot,
  ) => parsed.split === "LEGACY_REGRESSION"
    ? evaluateLegacy(
        parsed,
        source,
        selection,
        workspaceRoot,
      )
    : evaluateCapability(
        parsed,
        source,
        selection,
        workspaceRoot,
      ),
};

export async function runT45MultiAnchorAuditCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
  overrides: Partial<
    T45MultiAnchorAuditDependenciesV1
  > = {},
) {
  const parsed =
    parseT45MultiAnchorAuditArguments(argv);
  const dependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
  };
  const sourceClosure =
    dependencies.captureSourceClosure(workspaceRoot);
  const assertSourceClosure = () => {
    const observed =
      dependencies.captureSourceClosure(workspaceRoot);
    if (
      !same(observed.sourceFiles, sourceClosure.sourceFiles)
      || observed.sourceClosureHash
        !== sourceClosure.sourceClosureHash
    ) {
      throw new Error(
        "T45_MULTI_ANCHOR_AUDIT_SOURCE_CLOSURE_DRIFT",
      );
    }
  };
  let freeze = parsed.split === "LEGACY_REGRESSION"
    ? await dependencies.verifyFreeze(workspaceRoot)
    : null;
  const source = await dependencies.loadSource(
    parsed,
    workspaceRoot,
    freeze,
  );
  if (source.gate) {
    assertT45CandidateOracleReadyForSelection(
      source.gate,
    );
  }
  if (parsed.split === "VALIDATION") {
    freeze = await dependencies.verifyFreeze(
      workspaceRoot,
    );
  }
  const root = path.resolve(
    workspaceRoot,
    ARTIFACT_ROOT,
  );
  const stem = `t45-capability-${parsed.runId}`;
  const selectionPath = path.join(
    root,
    `${stem}.multi-anchor-${parsed.artifactId}.selection.json`,
  );
  const reportPath = path.join(
    root,
    `${stem}.multi-anchor-${parsed.artifactId}.report.json`,
  );
  const receiptPath = path.join(
    root,
    `${stem}.multi-anchor-${parsed.artifactId}.receipt.json`,
  );
  const selection = await readJson(
    selectionPath,
    "SELECTION",
    (value) =>
      T45FinalSelectionArtifactV1Schema.parse(value),
  );
  const draftPath = path.join(
    root,
    `${stem}.content-draft-${parsed.artifactId}.selection.json`,
  );
  const draft = await readJson(
    draftPath,
    "DRAFT",
    (value) =>
      T45ContentDraftArtifactV1Schema.parse(value),
  );
  if (
    draft.sha256
      !== selection.value.inputs
        .draftSelectionSha256
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_AUDIT_DRAFT_SHA_DRIFT",
    );
  }
  if (
    draft.value.runId !== parsed.runId
    || draft.value.artifactId
      !== parsed.artifactId
    || !same(
      draft.value.runtimeSuite,
      source.runtimeSuite,
    )
    || draft.value.inventoryHash
      !== source.inventoryHash
    || !same(draft.value.inputs, source.inputs)
    || !same(
      draft.value.model,
      selection.value.model,
    )
    || draft.value.sourceClosureHash
      !== sourceClosure.sourceClosureHash
    || selection.value.sourceClosureHash
      !== sourceClosure.sourceClosureHash
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_AUDIT_DRAFT_BINDING_DRIFT",
    );
  }
  assertSelectionBindings(
    parsed,
    source,
    selection.value,
    freeze,
  );
  dependencies.validateFinal({
    prompts: source.prompts,
    candidate: source.candidate,
    baselineSelection:
      source.baselineSelection,
    draft: draft.value,
    final: selection.value,
  });
  const expectedInputs = {
    selectionSha256: selection.sha256,
    draftSelectionSha256:
      draft.sha256,
    oracleGateSha256:
      selection.value.inputs.oracleGateSha256,
    freezeHash: freeze?.freezeHash ?? null,
    source: source.inputs,
  };
  const existing = await readIfExists(
    reportPath,
    (value) =>
      T45MultiAnchorAuditReportV1Schema.parse(value),
  );
  const existingReceipt = await readIfExists(
    receiptPath,
    (value) => verifyT45AuditReceiptV1(value),
  );
  if (existing) {
    if (
      existing.value.split !== parsed.split
      || existing.value.runId !== parsed.runId
      || existing.value.artifactId
        !== parsed.artifactId
      || !same(
        existing.value.inputs,
        expectedInputs,
      )
      || existing.value.sourceClosureHash
        !== sourceClosure.sourceClosureHash
    ) {
      throw new Error(
        "T45_MULTI_ANCHOR_AUDIT_REPORT_BINDING_DRIFT",
      );
    }
    dependencies.assertReportMatchesSelection(
      existing.value,
      selection.value,
    );
    const expectedReceipt = buildAuditReceipt(
      existing.value,
      existing.sha256,
    );
    if (existingReceipt) {
      assertT45AuditReceiptMatchesReportV1(
        existing.value,
        existing.sha256,
        existingReceipt.value,
      );
    } else {
      await writeNew(receiptPath, expectedReceipt);
      assertSourceClosure();
    }
    return {
      report: existing.value,
      output: {
        path: existing.path,
        bytes: existing.bytes,
        sha256: existing.sha256,
      },
      receipt: expectedReceipt,
      resumed: true,
    };
  }
  if (existingReceipt) {
    throw new Error(
      "T45_MULTI_ANCHOR_AUDIT_REPORT_MISSING_FOR_RECEIPT",
    );
  }
  const reservation =
    await acquireT45StageReservationV1({
      target: `${reportPath}.reservation`,
      stage: `audit:${parsed.runId}`,
      runId: parsed.runId,
      artifactId: parsed.artifactId,
    });
  try {
  const racedReport = await readIfExists(
    reportPath,
    (value) =>
      T45MultiAnchorAuditReportV1Schema.parse(value),
  );
  const racedReceipt = await readIfExists(
    receiptPath,
    (value) => verifyT45AuditReceiptV1(value),
  );
  if (racedReport) {
    if (
      racedReport.value.split !== parsed.split
      || racedReport.value.runId !== parsed.runId
      || racedReport.value.artifactId
        !== parsed.artifactId
      || !same(
        racedReport.value.inputs,
        expectedInputs,
      )
      || racedReport.value.sourceClosureHash
        !== sourceClosure.sourceClosureHash
    ) {
      throw new Error(
        "T45_MULTI_ANCHOR_AUDIT_REPORT_BINDING_DRIFT",
      );
    }
    dependencies.assertReportMatchesSelection(
      racedReport.value,
      selection.value,
    );
    const expectedReceipt = buildAuditReceipt(
      racedReport.value,
      racedReport.sha256,
    );
    if (
      racedReceipt
    ) {
      assertT45AuditReceiptMatchesReportV1(
        racedReport.value,
        racedReport.sha256,
        racedReceipt.value,
      );
    }
    if (!racedReceipt) {
      await writeNew(receiptPath, expectedReceipt);
      assertSourceClosure();
    }
    return {
      report: racedReport.value,
      output: {
        path: racedReport.path,
        bytes: racedReport.bytes,
        sha256: racedReport.sha256,
      },
      receipt: expectedReceipt,
      resumed: true,
    };
  }
  if (racedReceipt) {
    throw new Error(
      "T45_MULTI_ANCHOR_AUDIT_REPORT_MISSING_FOR_RECEIPT",
    );
  }
  assertSourceClosure();
  const evaluation = await dependencies.evaluate(
    parsed,
    source,
    selection.value,
    workspaceRoot,
  );
  assertSourceClosure();
  const decision = z.object({
    decision:
      T45MultiAnchorAuditReportV1Schema
        .shape.decision,
  }).passthrough().parse(evaluation).decision;
  const report =
    T45MultiAnchorAuditReportV1Schema.parse({
    schemaVersion: 1,
    kind: "T45_MULTI_ANCHOR_AUDIT",
    split: parsed.split,
    runId: parsed.runId,
    artifactId: parsed.artifactId,
    decision,
    inputs: expectedInputs,
    sourceClosureHash:
      sourceClosure.sourceClosureHash,
    evaluation,
    generatedAt: new Date().toISOString(),
  });
  dependencies.assertReportMatchesSelection(
    report,
    selection.value,
  );
  const output = await writeNew(
    reportPath,
    report,
  );
  assertSourceClosure();
  const receipt = buildAuditReceipt(
    report,
    output.sha256,
  );
  await writeNew(receiptPath, receipt);
  assertSourceClosure();
  return {
    report,
    output,
    receipt,
    resumed: false,
  };
  } finally {
    await reservation.release();
  }
}

export function formatT45MultiAnchorAuditErrorV1(
  error: unknown,
) {
  const message = error instanceof Error
    ? error.message
    : "";
  return message.match(
    /^(T45_[A-Z0-9]+(?:_[A-Z0-9]+)*)/,
  )?.[1]
    ?? "T45_MULTI_ANCHOR_AUDIT_UNEXPECTED_ERROR";
}

async function main() {
  const result = await runT45MultiAnchorAuditCli(
    process.argv.slice(2),
  );
  const evaluation =
    result.report.evaluation
    && typeof result.report.evaluation === "object"
      ? result.report.evaluation as {
          summary?: unknown;
          metrics?: unknown;
        }
      : {};
  process.stdout.write(`${JSON.stringify({
    reportPath: result.output.path,
    reportBytes: result.output.bytes,
    reportSha256: result.output.sha256,
    decision: result.report.decision,
    aggregate:
      evaluation.summary
      ?? evaluation.metrics
      ?? null,
    resumed: result.resumed,
  }, null, 2)}\n`);
}

const entryPoint = process.argv[1];
if (
  entryPoint
  && import.meta.url
    === pathToFileURL(path.resolve(entryPoint)).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${formatT45MultiAnchorAuditErrorV1(error)}\n`,
    );
    process.exitCode = 1;
  });
}
