import { z } from "zod";

import {
  sha256StableJsonV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  T44ObligationCandidateArtifactV1Schema,
  type T44ObligationCandidateArtifactV1,
  type T44ObligationCandidateNodeV1,
} from "./t44-obligation-candidate-evaluator";
import {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2,
  T44ObligationSelectionArtifactV1Schema,
  type T44ObligationSelectionArtifactV1,
} from "./t44-obligation-label-blind-v2";
import {
  type T45CapabilityInventoryV1,
  type T45CapabilityQrelsSuite,
  type T45CapabilitySplit,
} from "./t45-capability-authoring";
import {
  T45CapabilityInventorySchema,
  T45CapabilityQrelsSuiteSchema,
  t45CapabilityInventoryHash,
  t45CapabilityQrelsSuiteHash,
} from "./t45-capability-loader";
import {
  T45CandidateStructuralReadinessV1Schema,
  type T45CandidateStructuralReadinessV1,
} from "./t45-candidate-structural-gates-v1";
export {
  assertT45CandidateOracleReadyForSelection,
} from "./t45-candidate-oracle-gate-v1";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const T45_CAPABILITY_DENOMINATORS_V1 =
  Object.freeze({
    cases: 20,
    requiredGroups: 30,
    multiCases: 10,
    families: 10,
  } as const);

export const T45_CAPABILITY_SELECTION_GATES_V1 =
  Object.freeze({
    supportCasesMinimum: 18,
    requiredGroupsCoveredMinimum: 28,
    multiJointCoverageMinimum: 9,
    familiesWithBothCasesSupportedMinimum: 9,
    validSelectionsRequired: 20,
    bindingViolationsMaximum: 0,
    reviewerP95MsMaximum: 30_000,
  } as const);

export const T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1 =
  sha256StableJsonV2({
    denominators: T45_CAPABILITY_DENOMINATORS_V1,
    selectionGates:
      T45_CAPABILITY_SELECTION_GATES_V1,
    candidatePool:
      "B_MODEL_GUIDED_CANDIDATES_UNION_A_WHOLE_QUERY_SELECTION",
    groupCoverage:
      "ANY_ACCEPTABLE_NODE_IN_SELECTED_SET",
    familyCoverage: "BOTH_CASES_SUPPORTED",
    hardNegativeCount:
      "SELECTED_NODE_OCCURRENCES_AND_CASES",
    candidateStructuralGates: [
      "A_BASELINE_EXISTS_EVERY_CASE",
      "B_PROTECTED_ANCHORS_1_TO_8_EVERY_CASE",
      "BASELINE_REUSE_PROVIDER_SINGLE_COUNT_AND_PROTECTED_PREFIX",
    ],
  });

export type T45CandidateOracleAggregate = {
  casesCovered: number;
  casesTotal: 20;
  groupsCovered: number;
  groupsTotal: 30;
  coveragePassed: boolean;
  structuralGates: {
    baselineAvailableCases: number;
    protectedAnchorCases: number;
    baselineSingleCountCases: number;
    casesTotal: 20;
    passed: boolean;
  };
  passed: boolean;
};

type T45CandidateOracleCaseDiagnostic = {
  caseId: string;
  familyId: string;
  multiClaim: boolean;
  covered: boolean;
  groupsCovered: number;
  groupsTotal: number;
  missingGroupIds: string[];
};

type T45CandidateOracleFamilyDiagnostic = {
  familyId: string;
  casesCovered: number;
  casesTotal: 2;
  bothCasesCovered: boolean;
};

export type T45CalibrationCandidateOracleReport = {
  split: "CALIBRATION";
  candidateOracle: T45CandidateOracleAggregate;
  diagnostics: {
    multiJointCoverage: number;
    multiCasesTotal: 10;
    familiesWithBothCasesCovered: number;
    familiesTotal: 10;
    cases: T45CandidateOracleCaseDiagnostic[];
    families: T45CandidateOracleFamilyDiagnostic[];
    structural:
      T45CandidateStructuralReadinessV1;
  };
  decision:
    | "CALIBRATION_CANDIDATE_READY"
    | "CALIBRATION_CANDIDATE_NO_GO";
};

export type T45ValidationCandidateOracleReport = {
  split: "VALIDATION";
  candidateOracle: T45CandidateOracleAggregate;
  decision:
    | "VALIDATION_CANDIDATE_READY"
    | "VALIDATION_CANDIDATE_NO_GO";
};

export type T45CandidateOracleReport =
  | T45CalibrationCandidateOracleReport
  | T45ValidationCandidateOracleReport;

export type T45FinalSelectionNode = {
  nodeId: string;
  objectId: string;
  coursePackId: string;
};

export type T45FinalSelectionCase = {
  caseId: string;
  coursePackId: string;
  status: "VALID" | "INVALID";
  selected: T45FinalSelectionNode[];
  bindingViolations: string[];
};

export type T45BaselineCase = {
  caseId: string;
  coursePackId: string;
  selectedNodeIds: string[];
};

type T45SelectionCaseDiagnostic = {
  caseId: string;
  familyId: string;
  multiClaim: boolean;
  status: "VALID" | "INVALID";
  selectedNodeIds: string[];
  groups: Array<{
    groupId: string;
    covered: boolean;
    matchedNodeIds: string[];
  }>;
  covered: boolean;
  hardNegativeNodeIds: string[];
  bindingViolations: string[];
};

type MinimumGate = {
  observed: number;
  required: number;
  passed: boolean;
};

type MaximumGate = {
  observed: number;
  requiredMaximum: number;
  passed: boolean;
};

export type T45SelectionReport = {
  schemaVersion: 1;
  kind: "T45_CAPABILITY_SELECTION_REPORT";
  split: T45CapabilitySplit;
  configHash: string;
  denominators: typeof T45_CAPABILITY_DENOMINATORS_V1;
  summary: {
    supportCases: number;
    requiredGroupsCovered: number;
    multiJointCoverage: number;
    familiesWithBothCasesSupported: number;
    hardNegativeNodes: number;
    hardNegativeCases: number;
    aBaselineHardNegativeNodes: number;
    aBaselineHardNegativeCases: number;
    validSelections: number;
    bindingViolations: number;
    reviewerP95Ms: number;
  };
  gates: {
    supportCases: MinimumGate;
    requiredGroupsCovered: MinimumGate;
    multiJointCoverage: MinimumGate;
    familiesWithBothCasesSupported: MinimumGate;
    hardNegativeNodes: MaximumGate;
    hardNegativeCases: MaximumGate;
    validSelections: MinimumGate;
    bindingViolations: MaximumGate;
    reviewerP95Ms: MaximumGate;
  };
  cases: T45SelectionCaseDiagnostic[];
  families: Array<{
    familyId: string;
    casesSupported: number;
    casesTotal: 2;
    bothCasesSupported: boolean;
  }>;
  passed: boolean;
  decision:
    | "CALIBRATION_GO"
    | "CALIBRATION_NO_GO"
    | "VALIDATION_GO"
    | "VALIDATION_SELECTOR_NO_GO";
};

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const MinimumGateSchema = z.object({
  observed: z.number().finite().nonnegative(),
  required: z.number().finite().nonnegative(),
  passed: z.boolean(),
}).strict();
const MaximumGateSchema = z.object({
  observed: z.number().finite().nonnegative(),
  requiredMaximum:
    z.number().finite().nonnegative(),
  passed: z.boolean(),
}).strict();

export const T45SelectionReportSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(
    "T45_CAPABILITY_SELECTION_REPORT",
  ),
  split: z.enum(["CALIBRATION", "VALIDATION"]),
  configHash: HashSchema,
  denominators: z.object({
    cases: z.literal(20),
    requiredGroups: z.literal(30),
    multiCases: z.literal(10),
    families: z.literal(10),
  }).strict(),
  summary: z.object({
    supportCases: z.number().int().nonnegative(),
    requiredGroupsCovered:
      z.number().int().nonnegative(),
    multiJointCoverage:
      z.number().int().nonnegative(),
    familiesWithBothCasesSupported:
      z.number().int().nonnegative(),
    hardNegativeNodes:
      z.number().int().nonnegative(),
    hardNegativeCases:
      z.number().int().nonnegative(),
    aBaselineHardNegativeNodes:
      z.number().int().nonnegative(),
    aBaselineHardNegativeCases:
      z.number().int().nonnegative(),
    validSelections:
      z.number().int().nonnegative(),
    bindingViolations:
      z.number().int().nonnegative(),
    reviewerP95Ms:
      z.number().finite().nonnegative(),
  }).strict(),
  gates: z.object({
    supportCases: MinimumGateSchema,
    requiredGroupsCovered: MinimumGateSchema,
    multiJointCoverage: MinimumGateSchema,
    familiesWithBothCasesSupported:
      MinimumGateSchema,
    hardNegativeNodes: MaximumGateSchema,
    hardNegativeCases: MaximumGateSchema,
    validSelections: MinimumGateSchema,
    bindingViolations: MaximumGateSchema,
    reviewerP95Ms: MaximumGateSchema,
  }).strict(),
  cases: z.array(z.object({
    caseId: z.string().regex(ID_PATTERN),
    familyId: z.string().regex(ID_PATTERN),
    multiClaim: z.boolean(),
    status: z.enum(["VALID", "INVALID"]),
    selectedNodeIds: z.array(z.string()),
    groups: z.array(z.object({
      groupId: z.string().regex(ID_PATTERN),
      covered: z.boolean(),
      matchedNodeIds: z.array(z.string()),
    }).strict()),
    covered: z.boolean(),
    hardNegativeNodeIds: z.array(z.string()),
    bindingViolations: z.array(z.string()),
  }).strict()).length(20),
  families: z.array(z.object({
    familyId: z.string().regex(ID_PATTERN),
    casesSupported:
      z.number().int().min(0).max(2),
    casesTotal: z.literal(2),
    bothCasesSupported: z.boolean(),
  }).strict()).length(10),
  passed: z.boolean(),
  decision: z.enum([
    "CALIBRATION_GO",
    "CALIBRATION_NO_GO",
    "VALIDATION_GO",
    "VALIDATION_SELECTOR_NO_GO",
  ]),
}).strict().superRefine((report, context) => {
  const addDrift = (message: string) => {
    context.addIssue({
      code: "custom",
      message,
    });
  };
  const caseIds = report.cases.map(
    ({ caseId }) => caseId,
  );
  const familyIds = report.families.map(
    ({ familyId }) => familyId,
  );
  const groupsTotal = report.cases.reduce(
    (sum, testCase) =>
      sum + testCase.groups.length,
    0,
  );
  const multiCases = report.cases.filter(
    ({ multiClaim }) => multiClaim,
  ).length;
  if (
    new Set(caseIds).size !== 20
    || new Set(familyIds).size !== 10
    || groupsTotal !== 30
    || multiCases !== 10
  ) {
    addDrift(
      "selection report denominator/case identity drift",
    );
  }
  const familiesById = new Map(
    report.families.map((family) => [
      family.familyId,
      family,
    ]),
  );
  const familyCounts = new Map<string, {
    total: number;
    supported: number;
  }>();
  for (const testCase of report.cases) {
    const selected = new Set(
      testCase.selectedNodeIds,
    );
    const groupIds = testCase.groups.map(
      ({ groupId }) => groupId,
    );
    const caseTruthDrift =
      selected.size
        !== testCase.selectedNodeIds.length
      || testCase.groups.length
        !== (testCase.multiClaim ? 2 : 1)
      || new Set(groupIds).size
        !== groupIds.length
      || testCase.groups.some((group) => {
        const matched = new Set(
          group.matchedNodeIds,
        );
        return (
          matched.size
            !== group.matchedNodeIds.length
          || group.matchedNodeIds.some(
            (nodeId) => !selected.has(nodeId),
          )
          || group.covered
            !== (group.matchedNodeIds.length > 0)
        );
      })
      || new Set(
        testCase.hardNegativeNodeIds,
      ).size
        !== testCase.hardNegativeNodeIds.length
      || testCase.hardNegativeNodeIds.some(
        (nodeId) => !selected.has(nodeId),
      )
      || (
        testCase.status === "INVALID"
        && (
          testCase.selectedNodeIds.length > 0
          || testCase.covered
          || testCase.groups.some(
            ({ covered, matchedNodeIds }) =>
              covered || matchedNodeIds.length > 0,
          )
          || testCase.hardNegativeNodeIds.length
            > 0
        )
      );
    if (caseTruthDrift) {
      addDrift(
        "selection report case structural truth drift",
      );
    }
    const expectedCovered =
      testCase.groups.every(({ covered }) => covered);
    if (testCase.covered !== expectedCovered) {
      addDrift(
        "selection report case coverage drift",
      );
    }
    const counts = familyCounts.get(
      testCase.familyId,
    ) ?? { total: 0, supported: 0 };
    counts.total += 1;
    if (testCase.covered) counts.supported += 1;
    familyCounts.set(testCase.familyId, counts);
  }
  if (
    familyCounts.size !== 10
    || [...familyCounts.entries()].some(
      ([familyId, counts]) => {
        const family = familiesById.get(familyId);
        return (
          !family
          || counts.total !== 2
          || family.casesSupported
            !== counts.supported
          || family.bothCasesSupported
            !== (counts.supported === 2)
        );
      },
    )
  ) {
    addDrift(
      "selection report family aggregate drift",
    );
  }
  const expectedSummary = {
    supportCases: report.cases.filter(
      ({ covered }) => covered,
    ).length,
    requiredGroupsCovered:
      report.cases.reduce(
        (sum, testCase) =>
          sum + testCase.groups.filter(
            ({ covered }) => covered,
          ).length,
        0,
      ),
    multiJointCoverage:
      report.cases.filter(
        ({ multiClaim, covered }) =>
          multiClaim && covered,
      ).length,
    familiesWithBothCasesSupported:
      report.families.filter(
        ({ bothCasesSupported }) =>
          bothCasesSupported,
      ).length,
    hardNegativeNodes:
      report.cases.reduce(
        (sum, testCase) =>
          sum + testCase
            .hardNegativeNodeIds.length,
        0,
      ),
    hardNegativeCases:
      report.cases.filter(
        ({ hardNegativeNodeIds }) =>
          hardNegativeNodeIds.length > 0,
      ).length,
    validSelections:
      report.cases.filter(
        ({ status }) => status === "VALID",
      ).length,
    bindingViolations:
      report.cases.reduce(
        (sum, testCase) =>
          sum + testCase
            .bindingViolations.length,
        0,
      ),
  };
  if (
    Object.entries(expectedSummary).some(
      ([key, expected]) =>
        report.summary[
          key as keyof typeof expectedSummary
        ] !== expected,
    )
  ) {
    addDrift(
      "selection report summary aggregate drift",
    );
  }
  const minimumContracts = {
    supportCases: [report.summary.supportCases, 18],
    requiredGroupsCovered: [
      report.summary.requiredGroupsCovered,
      28,
    ],
    multiJointCoverage: [
      report.summary.multiJointCoverage,
      9,
    ],
    familiesWithBothCasesSupported: [
      report.summary
        .familiesWithBothCasesSupported,
      9,
    ],
    validSelections: [
      report.summary.validSelections,
      20,
    ],
  } as const;
  const maximumContracts = {
    hardNegativeNodes: [
      report.summary.hardNegativeNodes,
      report.summary
        .aBaselineHardNegativeNodes,
    ],
    hardNegativeCases: [
      report.summary.hardNegativeCases,
      report.summary
        .aBaselineHardNegativeCases,
    ],
    bindingViolations: [
      report.summary.bindingViolations,
      0,
    ],
    reviewerP95Ms: [
      report.summary.reviewerP95Ms,
      30_000,
    ],
  } as const;
  const minimumDrift = Object.entries(
    minimumContracts,
  ).some(([name, [observed, required]]) => {
    const gate = report.gates[
      name as keyof typeof minimumContracts
    ] as z.infer<typeof MinimumGateSchema>;
    return (
      gate.observed !== observed
      || gate.required !== required
      || gate.passed
        !== (observed >= required)
    );
  });
  const maximumDrift = Object.entries(
    maximumContracts,
  ).some(
    ([name, [observed, requiredMaximum]]) => {
      const gate = report.gates[
        name as keyof typeof maximumContracts
      ] as z.infer<typeof MaximumGateSchema>;
      return (
        gate.observed !== observed
        || gate.requiredMaximum
          !== requiredMaximum
        || gate.passed
          !== (observed <= requiredMaximum)
      );
    },
  );
  if (minimumDrift || maximumDrift) {
    addDrift(
      "selection report gate threshold drift",
    );
  }
  const gatesPassed = Object.values(
    report.gates,
  ).every(({ passed }) => passed);
  const expectedDecision =
    report.split === "CALIBRATION"
      ? report.passed
        ? "CALIBRATION_GO"
        : "CALIBRATION_NO_GO"
      : report.passed
        ? "VALIDATION_GO"
        : "VALIDATION_SELECTOR_NO_GO";
  if (
    report.configHash
      !== T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1
    || gatesPassed !== report.passed
    || report.decision !== expectedDecision
  ) {
    addDrift(
      "selection report config/gate/decision drift",
    );
  }
});

function assertId(value: string, code: string) {
  if (!ID_PATTERN.test(value)) {
    throw new Error(code);
  }
}

function assertFixedDenominators(
  qrels: T45CapabilityQrelsSuite,
) {
  const cases = Array.isArray(qrels?.cases)
    ? qrels.cases
    : [];
  if (
    cases.length
      !== T45_CAPABILITY_DENOMINATORS_V1.cases
  ) {
    throw new Error(
      "T45_CAPABILITY_CASE_DENOMINATOR_INVALID:"
      + cases.length,
    );
  }
  const groupCount = cases.reduce(
    (sum, testCase) =>
      sum
      + (
        Array.isArray(
          testCase.requiredEvidenceGroups,
        )
          ? testCase.requiredEvidenceGroups.length
          : 0
      ),
    0,
  );
  if (
    groupCount
      !== T45_CAPABILITY_DENOMINATORS_V1
        .requiredGroups
  ) {
    throw new Error(
      "T45_CAPABILITY_GROUP_DENOMINATOR_INVALID:"
      + groupCount,
    );
  }
  const multiCount = cases.filter(
    ({ multiClaim }) => multiClaim === true,
  ).length;
  if (
    multiCount
      !== T45_CAPABILITY_DENOMINATORS_V1
        .multiCases
  ) {
    throw new Error(
      "T45_CAPABILITY_MULTI_DENOMINATOR_INVALID:"
      + multiCount,
    );
  }
  const familyCounts = new Map<string, number>();
  for (const testCase of cases) {
    const count =
      familyCounts.get(testCase.familyId) ?? 0;
    familyCounts.set(testCase.familyId, count + 1);
  }
  if (
    familyCounts.size
      !== T45_CAPABILITY_DENOMINATORS_V1.families
  ) {
    throw new Error(
      "T45_CAPABILITY_FAMILY_DENOMINATOR_INVALID:"
      + familyCounts.size,
    );
  }
  for (const [familyId, count] of familyCounts) {
    if (count !== 2) {
      throw new Error(
        "T45_CAPABILITY_FAMILY_CASE_COUNT_INVALID:"
        + `${familyId}:${count}`,
      );
    }
  }
  for (const testCase of cases) {
    const expectedGroups = testCase.multiClaim
      ? 2
      : 1;
    if (
      testCase.requiredEvidenceGroups.length
        !== expectedGroups
    ) {
      throw new Error(
        "T45_CAPABILITY_CASE_GROUP_COUNT_INVALID:"
        + `${testCase.caseId}:${expectedGroups}`,
      );
    }
  }
}

function parseQrels(
  input: T45CapabilityQrelsSuite,
) {
  assertFixedDenominators(input);
  const qrels = T45CapabilityQrelsSuiteSchema.parse(
    input,
  ) as T45CapabilityQrelsSuite;
  if (
    t45CapabilityQrelsSuiteHash(qrels)
      !== qrels.suiteHash
  ) {
    throw new Error(
      "T45_CAPABILITY_QRELS_SUITE_HASH_DRIFT",
    );
  }
  return qrels;
}

function assertOrder(
  expected: readonly string[],
  observed: readonly string[],
  code: string,
) {
  if (
    expected.length !== observed.length
    || expected.some(
      (value, index) => value !== observed[index],
    )
  ) {
    throw new Error(code);
  }
}

function inventoryBindings(
  inventoryInput: T45CapabilityInventoryV1,
) {
  const inventory =
    T45CapabilityInventorySchema.parse(
      inventoryInput,
    ) as T45CapabilityInventoryV1;
  if (
    t45CapabilityInventoryHash(inventory)
      !== inventory.inventoryHash
  ) {
    throw new Error(
      "T45_CAPABILITY_INVENTORY_HASH_DRIFT",
    );
  }
  const objects = new Map(
    inventory.objects.map((object) => [
      object.objectId,
      object,
    ]),
  );
  const nodes = new Map<string, typeof inventory.objects[number]>();
  for (const object of inventory.objects) {
    for (const nodeId of object.eligibleNodeIds) {
      if (nodes.has(nodeId)) {
        throw new Error(
          "T45_CAPABILITY_INVENTORY_NODE_DUPLICATE:"
          + nodeId,
        );
      }
      nodes.set(nodeId, object);
    }
  }
  return { inventory, objects, nodes };
}

function assertQrelInventoryBindings(input: {
  split: T45CapabilitySplit;
  qrels: T45CapabilityQrelsSuite;
  inventory: T45CapabilityInventoryV1;
  nodes: ReadonlyMap<
    string,
    T45CapabilityInventoryV1["objects"][number]
  >;
}) {
  const expectedPartition = input.split === "CALIBRATION"
    ? "DEV_CAL"
    : "VALIDATION";
  if (
    input.qrels.capabilityInventory.inventoryHash
      !== input.inventory.inventoryHash
    || input.qrels.corpusSnapshot.bundleHash
      !== input.inventory.corpusBundleHash
  ) {
    throw new Error(
      "T45_CAPABILITY_QRELS_INVENTORY_BINDING_DRIFT",
    );
  }
  const allowedFamilies = new Set(
    input.inventory.families
      .filter(
        ({ partition }) =>
          partition === expectedPartition,
      )
      .map(({ familyId }) => familyId),
  );
  for (const testCase of input.qrels.cases) {
    if (!allowedFamilies.has(testCase.familyId)) {
      throw new Error(
        "T45_CAPABILITY_QREL_FAMILY_BINDING_DRIFT:"
        + testCase.caseId,
      );
    }
    const qrelNodeIds = [
      ...testCase.requiredEvidenceGroups.flatMap(
        ({ acceptableNodeIds }) =>
          acceptableNodeIds,
      ),
      ...testCase.hardNegativeNodeIds,
    ];
    for (const nodeId of qrelNodeIds) {
      const owner = input.nodes.get(nodeId);
      if (
        !owner
        || owner.familyId !== testCase.familyId
        || owner.partition !== expectedPartition
      ) {
        throw new Error(
          "T45_CAPABILITY_QREL_NODE_BINDING_DRIFT:"
          + `${testCase.caseId}:${nodeId}`,
        );
      }
    }
  }
}

function assertCandidateNodeBinding(input: {
  node: T44ObligationCandidateNodeV1;
  objects: ReadonlyMap<
    string,
    T45CapabilityInventoryV1["objects"][number]
  >;
}) {
  const object = input.objects.get(
    input.node.objectId,
  );
  if (
    !object
    || object.coursePackId
      !== input.node.coursePackId
    || object.objectContentHash
      !== input.node.objectContentHash
    || !object.eligibleNodeIds.includes(
      input.node.nodeId,
    )
  ) {
    throw new Error(
      "T45_CAPABILITY_CANDIDATE_NODE_BINDING_DRIFT:"
      + input.node.nodeId,
    );
  }
}

function assertSelectionArmBinding(input: {
  caseId: string;
  selected: T44ObligationSelectionArtifactV1[
    "cases"
  ][number]["arms"]["A_WHOLE_QUERY"]["selected"];
  candidates: readonly T44ObligationCandidateNodeV1[];
}) {
  const candidates = new Map(
    input.candidates.map((node) => [
      node.nodeId,
      node,
    ]),
  );
  for (const selected of input.selected) {
    const candidate = candidates.get(selected.nodeId);
    if (
      !candidate
      || candidate.objectId !== selected.objectId
      || candidate.coursePackId
        !== selected.coursePackId
    ) {
      throw new Error(
        "T45_CAPABILITY_SELECTION_NODE_BINDING_DRIFT:"
        + `${input.caseId}:${selected.nodeId}`,
      );
    }
  }
}

function evaluateGroups(
  testCase: T45CapabilityQrelsSuite[
    "cases"
  ][number],
  nodeIds: readonly string[],
) {
  const selected = new Set(nodeIds);
  const groups =
    testCase.requiredEvidenceGroups.map((group) => {
      const matchedNodeIds =
        group.acceptableNodeIds.filter((nodeId) =>
          selected.has(nodeId));
      return {
        groupId: group.groupId,
        covered: matchedNodeIds.length > 0,
        matchedNodeIds,
      };
    });
  return {
    groups,
    covered: groups.every(({ covered }) => covered),
  };
}

function familyDiagnostics(
  rows: readonly {
    familyId: string;
    covered: boolean;
  }[],
) {
  const familyIds = [
    ...new Set(rows.map(({ familyId }) => familyId)),
  ].sort();
  return familyIds.map((familyId) => {
    const cases = rows.filter(
      (row) => row.familyId === familyId,
    );
    const casesCovered = cases.filter(
      ({ covered }) => covered,
    ).length;
    return {
      familyId,
      casesCovered,
      casesTotal: 2 as const,
      bothCasesCovered:
        cases.length === 2 && casesCovered === 2,
    };
  });
}

export function evaluateT45CandidateOracle(input: {
  split: "CALIBRATION" | "VALIDATION";
  candidate: T44ObligationCandidateArtifactV1;
  selection: T44ObligationSelectionArtifactV1;
  qrels: T45CapabilityQrelsSuite;
  inventory: T45CapabilityInventoryV1;
  structuralReadiness:
    T45CandidateStructuralReadinessV1;
}): T45CandidateOracleReport {
  const qrels = parseQrels(input.qrels);
  if (
    qrels.split !== input.split
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_SPLIT_DRIFT",
    );
  }
  const { inventory, objects, nodes } =
    inventoryBindings(input.inventory);
  assertQrelInventoryBindings({
    split: input.split,
    qrels,
    inventory,
    nodes,
  });
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse(
      input.candidate,
    );
  const selection =
    T44ObligationSelectionArtifactV1Schema.parse(
      input.selection,
    );
  const structural =
    T45CandidateStructuralReadinessV1Schema.parse(
      input.structuralReadiness,
    );
  if (
    candidate.runtimeSuite.id
      !== qrels.runtimeSuite.id
    || candidate.runtimeSuite.version
      !== qrels.runtimeSuite.version
    || candidate.runtimeSuite.suiteHash
      !== qrels.runtimeSuite.suiteHash
    || candidate.corpusSnapshot.bundleHash
      !== qrels.corpusSnapshot.bundleHash
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_RUNTIME_BINDING_DRIFT",
    );
  }
  if (
    selection.selectorConfigId
      !== T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2.id
    || selection.selectorConfigVersion
      !== T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2
        .version
    || selection.selectorConfigHash
      !== T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_SELECTOR_CONFIG_DRIFT",
    );
  }
  const expectedCaseIds = qrels.cases.map(
    ({ caseId }) => caseId,
  );
  assertOrder(
    expectedCaseIds,
    candidate.cases.map(({ caseId }) => caseId),
    "T45_CAPABILITY_ORACLE_CANDIDATE_ORDER_DRIFT",
  );
  assertOrder(
    expectedCaseIds,
    selection.cases.map(({ caseId }) => caseId),
    "T45_CAPABILITY_ORACLE_SELECTION_ORDER_DRIFT",
  );
  assertOrder(
    expectedCaseIds,
    structural.cases.map(({ caseId }) => caseId),
    "T45_CAPABILITY_ORACLE_STRUCTURAL_ORDER_DRIFT",
  );
  const rows: T45CandidateOracleCaseDiagnostic[] =
    [];
  for (let index = 0; index < qrels.cases.length; index += 1) {
    const qrel = qrels.cases[index]!;
    const candidateCase = candidate.cases[index]!;
    const selectionCase = selection.cases[index]!;
    if (
      candidateCase.coursePackId
        !== selectionCase.coursePackId
    ) {
      throw new Error(
        "T45_CAPABILITY_ORACLE_COURSE_ORDER_DRIFT:"
        + qrel.caseId,
      );
    }
    const familyCourses = new Set(
      inventory.objects
        .filter(
          ({ familyId }) =>
            familyId === qrel.familyId,
        )
        .map(({ coursePackId }) => coursePackId),
    );
    if (!familyCourses.has(candidateCase.coursePackId)) {
      throw new Error(
        "T45_CAPABILITY_ORACLE_FAMILY_COURSE_DRIFT:"
        + qrel.caseId,
      );
    }
    for (
      const arm of [
        "A_WHOLE_QUERY",
        "B_MODEL_GUIDED",
      ] as const
    ) {
      const candidateArm = candidateCase.arms[arm];
      for (const node of candidateArm.candidateNodes) {
        assertCandidateNodeBinding({
          node,
          objects,
        });
      }
      assertSelectionArmBinding({
        caseId: qrel.caseId,
        selected: selectionCase.arms[arm].selected,
        candidates: candidateArm.candidateNodes,
      });
    }
    const expectedNodeIdsHash = sha256StableJsonV2({
      A_WHOLE_QUERY:
        candidateCase.arms.A_WHOLE_QUERY
          .candidateNodeIdsSha256,
      B_MODEL_GUIDED:
        candidateCase.arms.B_MODEL_GUIDED
          .candidateNodeIdsSha256,
    });
    if (
      selectionCase.candidateNodeIdsSha256
        !== expectedNodeIdsHash
    ) {
      throw new Error(
        "T45_CAPABILITY_ORACLE_SELECTION_CANDIDATE_MAP_DRIFT:"
        + qrel.caseId,
      );
    }
    const pool = [...new Set([
      ...selectionCase.arms.A_WHOLE_QUERY
        .selected.map(({ nodeId }) => nodeId),
      ...candidateCase.arms.B_MODEL_GUIDED
        .candidateNodes.map(({ nodeId }) => nodeId),
    ])];
    const evaluated = evaluateGroups(qrel, pool);
    rows.push({
      caseId: qrel.caseId,
      familyId: qrel.familyId,
      multiClaim: qrel.multiClaim,
      covered: evaluated.covered,
      groupsCovered: evaluated.groups.filter(
        ({ covered }) => covered,
      ).length,
      groupsTotal:
        qrel.requiredEvidenceGroups.length,
      missingGroupIds: evaluated.groups
        .filter(({ covered }) => !covered)
        .map(({ groupId }) => groupId),
    });
  }
  const families = familyDiagnostics(rows);
  const casesCovered = rows.filter(
    ({ covered }) => covered,
  ).length;
  const groupsCovered = rows.reduce(
    (sum, row) => sum + row.groupsCovered,
    0,
  );
  const coveragePassed =
    casesCovered
      === T45_CAPABILITY_DENOMINATORS_V1.cases
    && groupsCovered
      === T45_CAPABILITY_DENOMINATORS_V1
        .requiredGroups;
  const passed =
    coveragePassed && structural.passed;
  const candidateOracle: T45CandidateOracleAggregate = {
    casesCovered,
    casesTotal: 20,
    groupsCovered,
    groupsTotal: 30,
    coveragePassed,
    structuralGates: {
      baselineAvailableCases:
        structural.gates.baselineAvailable
          .observedCases,
      protectedAnchorCases:
        structural.gates.protectedAnchors
          .observedCases,
      baselineSingleCountCases:
        structural.gates.baselineSingleCount
          .observedCases,
      casesTotal: 20,
      passed: structural.passed,
    },
    passed,
  };
  if (input.split === "VALIDATION") {
    return {
      split: "VALIDATION",
      candidateOracle,
      decision: passed
        ? "VALIDATION_CANDIDATE_READY"
        : "VALIDATION_CANDIDATE_NO_GO",
    };
  }
  return {
    split: "CALIBRATION",
    candidateOracle,
    diagnostics: {
      multiJointCoverage: rows.filter(
        ({ multiClaim, covered }) =>
          multiClaim && covered,
      ).length,
      multiCasesTotal: 10,
      familiesWithBothCasesCovered:
        families.filter(
          ({ bothCasesCovered }) =>
            bothCasesCovered,
        ).length,
      familiesTotal: 10,
      cases: rows,
      families,
      structural,
    },
    decision: passed
      ? "CALIBRATION_CANDIDATE_READY"
      : "CALIBRATION_CANDIDATE_NO_GO",
  };
}

function minimumGate(
  observed: number,
  required: number,
): MinimumGate {
  return {
    observed,
    required,
    passed: observed >= required,
  };
}

function maximumGate(
  observed: number,
  requiredMaximum: number,
): MaximumGate {
  return {
    observed,
    requiredMaximum,
    passed: observed <= requiredMaximum,
  };
}

function assertSelectionInputs(input: {
  qrels: T45CapabilityQrelsSuite;
  selectionCases: readonly T45FinalSelectionCase[];
  aBaselineCases: readonly T45BaselineCase[];
}) {
  const expected = input.qrels.cases.map(
    ({ caseId }) => caseId,
  );
  assertOrder(
    expected,
    input.selectionCases.map(({ caseId }) => caseId),
    "T45_CAPABILITY_SELECTION_CASE_ORDER_DRIFT",
  );
  assertOrder(
    expected,
    input.aBaselineCases.map(({ caseId }) => caseId),
    "T45_CAPABILITY_BASELINE_CASE_ORDER_DRIFT",
  );
  for (let index = 0; index < expected.length; index += 1) {
    const selection = input.selectionCases[index]!;
    const baseline = input.aBaselineCases[index]!;
    assertId(
      selection.caseId,
      "T45_CAPABILITY_SELECTION_CASE_ID_INVALID",
    );
    assertId(
      selection.coursePackId,
      "T45_CAPABILITY_SELECTION_COURSE_ID_INVALID",
    );
    if (
      baseline.coursePackId !== selection.coursePackId
    ) {
      throw new Error(
        "T45_CAPABILITY_BASELINE_COURSE_ORDER_DRIFT:"
        + selection.caseId,
      );
    }
    if (
      new Set(baseline.selectedNodeIds).size
        !== baseline.selectedNodeIds.length
    ) {
      throw new Error(
        "T45_CAPABILITY_BASELINE_NODE_DUPLICATE:"
        + baseline.caseId,
      );
    }
  }
}

export function evaluateT45Selection(input: {
  split: "CALIBRATION" | "VALIDATION";
  selectionCases: readonly T45FinalSelectionCase[];
  aBaselineCases: readonly T45BaselineCase[];
  qrels: T45CapabilityQrelsSuite;
  reviewerP95Ms: number;
}): T45SelectionReport {
  const qrels = parseQrels(input.qrels);
  if (qrels.split !== input.split) {
    throw new Error(
      "T45_CAPABILITY_SELECTION_SPLIT_DRIFT",
    );
  }
  if (
    !Number.isFinite(input.reviewerP95Ms)
    || input.reviewerP95Ms < 0
  ) {
    throw new Error(
      "T45_CAPABILITY_REVIEWER_P95_INVALID",
    );
  }
  assertSelectionInputs({
    qrels,
    selectionCases: input.selectionCases,
    aBaselineCases: input.aBaselineCases,
  });
  const cases: T45SelectionCaseDiagnostic[] = [];
  let baselineHardNegativeNodes = 0;
  let baselineHardNegativeCases = 0;
  for (let index = 0; index < qrels.cases.length; index += 1) {
    const qrel = qrels.cases[index]!;
    const selection = input.selectionCases[index]!;
    const baseline = input.aBaselineCases[index]!;
    const bindingViolations = [
      ...selection.bindingViolations,
    ];
    if (
      selection.selected.length
        > T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2.topK
    ) {
      bindingViolations.push(
        `TOP_K:${selection.selected.length}`,
      );
    }
    const selectedNodeIds = selection.selected.map(
      ({ nodeId: selectedNodeId }) =>
        selectedNodeId,
    );
    if (
      new Set(selectedNodeIds).size
        !== selectedNodeIds.length
    ) {
      bindingViolations.push("NODE_DUPLICATE");
    }
    for (const selected of selection.selected) {
      if (
        selected.coursePackId
          !== selection.coursePackId
      ) {
        bindingViolations.push(
          `COURSE:${selected.nodeId}`,
        );
      }
    }
    if (
      selection.status === "INVALID"
      && selection.selected.length > 0
    ) {
      bindingViolations.push("INVALID_RETAINED_SELECTION");
    }
    const evaluated = evaluateGroups(
      qrel,
      selectedNodeIds,
    );
    const selectedSet = new Set(selectedNodeIds);
    const hardNegativeNodeIds =
      qrel.hardNegativeNodeIds.filter((nodeId) =>
        selectedSet.has(nodeId));
    cases.push({
      caseId: qrel.caseId,
      familyId: qrel.familyId,
      multiClaim: qrel.multiClaim,
      status: selection.status,
      selectedNodeIds,
      groups: evaluated.groups,
      covered: evaluated.covered,
      hardNegativeNodeIds,
      bindingViolations,
    });
    const baselineSet = new Set(
      baseline.selectedNodeIds,
    );
    const baselineIntrusions =
      qrel.hardNegativeNodeIds.filter((nodeId) =>
        baselineSet.has(nodeId));
    baselineHardNegativeNodes +=
      baselineIntrusions.length;
    if (baselineIntrusions.length > 0) {
      baselineHardNegativeCases += 1;
    }
  }
  const familyRows = familyDiagnostics(cases);
  const supportCases = cases.filter(
    ({ covered }) => covered,
  ).length;
  const requiredGroupsCovered = cases.reduce(
    (sum, testCase) =>
      sum
      + testCase.groups.filter(
        ({ covered }) => covered,
      ).length,
    0,
  );
  const multiJointCoverage = cases.filter(
    ({ multiClaim, covered }) =>
      multiClaim && covered,
  ).length;
  const familiesWithBothCasesSupported =
    familyRows.filter(
      ({ bothCasesCovered }) => bothCasesCovered,
    ).length;
  const hardNegativeNodes = cases.reduce(
    (sum, testCase) =>
      sum + testCase.hardNegativeNodeIds.length,
    0,
  );
  const hardNegativeCases = cases.filter(
    ({ hardNegativeNodeIds }) =>
      hardNegativeNodeIds.length > 0,
  ).length;
  const validSelections = cases.filter(
    ({ status }) => status === "VALID",
  ).length;
  const bindingViolations = cases.reduce(
    (sum, testCase) =>
      sum + testCase.bindingViolations.length,
    0,
  );
  const summary = {
    supportCases,
    requiredGroupsCovered,
    multiJointCoverage,
    familiesWithBothCasesSupported,
    hardNegativeNodes,
    hardNegativeCases,
    aBaselineHardNegativeNodes:
      baselineHardNegativeNodes,
    aBaselineHardNegativeCases:
      baselineHardNegativeCases,
    validSelections,
    bindingViolations,
    reviewerP95Ms: input.reviewerP95Ms,
  };
  const gates = {
    supportCases: minimumGate(
      supportCases,
      T45_CAPABILITY_SELECTION_GATES_V1
        .supportCasesMinimum,
    ),
    requiredGroupsCovered: minimumGate(
      requiredGroupsCovered,
      T45_CAPABILITY_SELECTION_GATES_V1
        .requiredGroupsCoveredMinimum,
    ),
    multiJointCoverage: minimumGate(
      multiJointCoverage,
      T45_CAPABILITY_SELECTION_GATES_V1
        .multiJointCoverageMinimum,
    ),
    familiesWithBothCasesSupported: minimumGate(
      familiesWithBothCasesSupported,
      T45_CAPABILITY_SELECTION_GATES_V1
        .familiesWithBothCasesSupportedMinimum,
    ),
    hardNegativeNodes: maximumGate(
      hardNegativeNodes,
      baselineHardNegativeNodes,
    ),
    hardNegativeCases: maximumGate(
      hardNegativeCases,
      baselineHardNegativeCases,
    ),
    validSelections: minimumGate(
      validSelections,
      T45_CAPABILITY_SELECTION_GATES_V1
        .validSelectionsRequired,
    ),
    bindingViolations: maximumGate(
      bindingViolations,
      T45_CAPABILITY_SELECTION_GATES_V1
        .bindingViolationsMaximum,
    ),
    reviewerP95Ms: maximumGate(
      input.reviewerP95Ms,
      T45_CAPABILITY_SELECTION_GATES_V1
        .reviewerP95MsMaximum,
    ),
  };
  const passed = Object.values(gates).every(
    ({ passed: gatePassed }) => gatePassed,
  );
  return T45SelectionReportSchema.parse({
    schemaVersion: 1,
    kind: "T45_CAPABILITY_SELECTION_REPORT",
    split: input.split,
    configHash:
      T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1,
    denominators: T45_CAPABILITY_DENOMINATORS_V1,
    summary,
    gates,
    cases,
    families: familyRows.map((family) => ({
      familyId: family.familyId,
      casesSupported: family.casesCovered,
      casesTotal: family.casesTotal,
      bothCasesSupported:
        family.bothCasesCovered,
    })),
    passed,
    decision: input.split === "CALIBRATION"
      ? (
          passed
            ? "CALIBRATION_GO"
            : "CALIBRATION_NO_GO"
        )
      : (
          passed
            ? "VALIDATION_GO"
            : "VALIDATION_SELECTOR_NO_GO"
        ),
  });
}
