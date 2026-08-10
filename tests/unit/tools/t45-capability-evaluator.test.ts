// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
  T44_OBLIGATION_CANDIDATE_CONFIG_V1,
  T44ObligationCandidateArtifactV1Schema,
  type T44ObligationCandidateArtifactV1,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2,
  T44ObligationSelectionArtifactV1Schema,
  type T44ObligationSelectionArtifactV1,
} from "@/tools/mixed-retrieval/t44-obligation-label-blind-v2";
import {
  T45_CAPABILITY_VERSION,
  type T45CapabilityInventoryV1,
  type T45CapabilityQrelsSuite,
  type T45CapabilityRuntimeSuite,
  type T45CapabilitySplit,
} from "@/tools/mixed-retrieval/t45-capability-authoring";
import {
  T45CapabilityInventorySchema,
  T45CapabilityQrelsSuiteSchema,
  t45CapabilityInventoryHash,
  t45CapabilityQrelsSuiteHash,
} from "@/tools/mixed-retrieval/t45-capability-loader";
import {
  T45CandidateStructuralReadinessV1Schema,
} from "@/tools/mixed-retrieval/t45-candidate-structural-gates-v1";
import {
  T45_CAPABILITY_DENOMINATORS_V1,
  T45_CAPABILITY_SELECTION_GATES_V1,
  T45SelectionReportSchema,
  assertT45CandidateOracleReadyForSelection,
  evaluateT45CandidateOracle,
  evaluateT45Selection,
  type T45BaselineCase,
  type T45FinalSelectionCase,
} from "@/tools/mixed-retrieval/t45-capability-evaluator";

const HASH = "a".repeat(64);
const CORPUS_HASH = "b".repeat(64);
const RUNTIME_HASH = "c".repeat(64);
const COURSE_PACK_ID = "layout-design";

function hash(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function nodeId(label: string) {
  return `node-${hash(label)}`;
}

function familyId(index: number) {
  return `family-${String(index).padStart(2, "0")}`;
}

function caseId(index: number, kind: "direct" | "compose") {
  return `case-${String(index).padStart(2, "0")}-${kind}`;
}

function readyStructuralReadiness(
  qrels: T45CapabilityQrelsSuite,
) {
  const cases = qrels.cases.map((testCase) => ({
    caseId: testCase.caseId,
    aBaselineCount: 8,
    protectedAnchorCount: 8,
    baselineAvailable: true,
    protectedAnchorsValid: true,
    baselineReused: false,
    baselineSingleCount: true,
  }));
  return T45CandidateStructuralReadinessV1Schema.parse({
    schemaVersion: 1,
    kind: "T45_CANDIDATE_STRUCTURAL_READINESS",
    gates: {
      baselineAvailable: {
        observedCases: 20,
        requiredCases: 20,
        passed: true,
      },
      protectedAnchors: {
        observedCases: 20,
        requiredCases: 20,
        minimumPerCase: 1,
        maximumPerCase: 8,
        passed: true,
      },
      baselineSingleCount: {
        observedCases: 20,
        requiredCases: 20,
        passed: true,
      },
    },
    cases,
    passed: true,
  });
}

function createQrels(
  split: T45CapabilitySplit = "CALIBRATION",
) {
  const runtimeId:
    T45CapabilityRuntimeSuite["id"] =
    split === "CALIBRATION"
    ? "lumi-t45-capability-calibration-runtime"
    : "lumi-t45-capability-validation-runtime";
  const qrelsId: T45CapabilityQrelsSuite["id"] =
    split === "CALIBRATION"
    ? "lumi-t45-capability-calibration-qrels"
    : "lumi-t45-capability-validation-qrels";
  const cases = Array.from({ length: 10 }, (_, offset) => {
    const index = offset + 1;
    const family = familyId(index);
    const direct = {
      caseId: caseId(index, "direct"),
      familyId: family,
      multiClaim: false,
      requiredEvidenceGroups: [{
        groupId: `group-${index}-direct`,
        acceptableNodeIds: [
          nodeId(`${family}-direct-primary`),
          nodeId(`${family}-direct-alternative`),
        ],
      }],
      hardNegativeNodeIds: [
        nodeId(`${family}-direct-hard-1`),
        ...(index === 1
          ? [nodeId(`${family}-direct-hard-2`)]
          : []),
      ],
    };
    const compose = {
      caseId: caseId(index, "compose"),
      familyId: family,
      multiClaim: true,
      requiredEvidenceGroups: [
        {
          groupId: `group-${index}-compose-a`,
          acceptableNodeIds: [
            nodeId(`${family}-compose-a`),
          ],
        },
        {
          groupId: `group-${index}-compose-b`,
          acceptableNodeIds: [
            nodeId(`${family}-compose-b-primary`),
            nodeId(`${family}-compose-b-alternative`),
          ],
        },
      ],
      hardNegativeNodeIds: [
        nodeId(`${family}-compose-hard`),
      ],
    };
    return [direct, compose];
  }).flat();
  const input = {
    schemaVersion: 1 as const,
    id: qrelsId,
    version: T45_CAPABILITY_VERSION,
    split,
    runtimeSuite: {
      id: runtimeId,
      version: T45_CAPABILITY_VERSION,
      suiteHash: RUNTIME_HASH,
    },
    corpusSnapshot: {
      path:
        "data/knowledge-v2/knowledge-corpus.v2.json" as const,
      bundleHash: CORPUS_HASH,
    },
    capabilityInventory: {
      id: "lumi-t45-capability-inventory" as const,
      inventoryHash: HASH,
    },
    cases,
    suiteHash: HASH,
  };
  const withHash = {
    ...input,
    suiteHash: t45CapabilityQrelsSuiteHash(input),
  };
  return T45CapabilityQrelsSuiteSchema.parse(
    withHash,
  ) as T45CapabilityQrelsSuite;
}

function createInventory(
  qrels: T45CapabilityQrelsSuite,
) {
  const partition = qrels.split === "CALIBRATION"
    ? "DEV_CAL" as const
    : "VALIDATION" as const;
  const targetFamilies = Array.from(
    { length: 10 },
    (_, offset) => {
      const index = offset + 1;
      const family = familyId(index);
      const objectId = `object-target-${index}`;
      return {
        family: {
          familyId: family,
          objectIds: [objectId],
          partition,
        },
        object: {
          objectId,
          coursePackId: COURSE_PACK_ID,
          objectContentHash: hash(
            `${objectId}-content`,
          ),
          eligibleNodeIds: qrels.cases
            .filter((testCase) =>
              testCase.familyId === family)
            .flatMap((testCase) => [
              ...testCase.requiredEvidenceGroups.flatMap(
                ({ acceptableNodeIds }) =>
                  acceptableNodeIds,
              ),
              ...testCase.hardNegativeNodeIds,
            ]),
          capabilityFingerprint: hash(
            `${objectId}-fingerprint`,
          ),
          familyId: family,
          partition,
        },
      };
    },
  );
  const fillerFamilies = Array.from(
    { length: 53 },
    (_, offset) => {
      const index = offset + 1;
      const fillerObjectCount = index === 1
        ? 50
        : index === 2
          ? 5
          : 1;
      const objectIds = Array.from(
        { length: fillerObjectCount },
        (_, objectOffset) =>
          `object-filler-${index}-${objectOffset + 1}`,
      );
      return {
        family: {
          familyId: `filler-family-${index}`,
          objectIds,
          partition: "FROZEN_T44" as const,
        },
        objects: objectIds.map((objectId) => ({
          objectId,
          coursePackId: COURSE_PACK_ID,
          objectContentHash: hash(
            `${objectId}-content`,
          ),
          eligibleNodeIds: [nodeId(objectId)],
          capabilityFingerprint: hash(
            `${objectId}-fingerprint`,
          ),
          familyId: `filler-family-${index}`,
          partition: "FROZEN_T44" as const,
        })),
      };
    },
  );
  const input = {
    schemaVersion: 1 as const,
    id: "lumi-t45-capability-inventory" as const,
    corpusBundleHash: CORPUS_HASH,
    fingerprintPolicy: {
      normalization: "NFKC_TRIM" as const,
      projection: "KIND_ROLE_BODY_SORTED" as const,
      hash: "SHA256" as const,
    },
    objects: [
      ...targetFamilies.map(({ object }) => object),
      ...fillerFamilies.flatMap(({ objects }) => objects),
    ],
    families: [
      ...targetFamilies.map(({ family }) => family),
      ...fillerFamilies.map(({ family }) => family),
    ],
    inventoryHash: HASH,
  };
  const inventory = {
    ...input,
    inventoryHash: t45CapabilityInventoryHash(
      input,
    ),
  };
  return T45CapabilityInventorySchema.parse(
    inventory,
  ) as T45CapabilityInventoryV1;
}

function inventoryObjectForNode(
  inventory: T45CapabilityInventoryV1,
  targetNodeId: string,
) {
  const object = inventory.objects.find(
    ({ eligibleNodeIds }) =>
      eligibleNodeIds.includes(targetNodeId),
  );
  if (!object) {
    throw new Error(
      `TEST_INVENTORY_NODE_MISSING:${targetNodeId}`,
    );
  }
  return object;
}

function candidateNode(
  inventory: T45CapabilityInventoryV1,
  targetNodeId: string,
) {
  const object = inventoryObjectForNode(
    inventory,
    targetNodeId,
  );
  return {
    nodeId: targetNodeId,
    objectId: object.objectId,
    coursePackId: object.coursePackId,
    objectRank: 1,
    kind: "TEXT" as const,
    role: "FACT" as const,
    text: `Evidence ${targetNodeId}`,
    nodeContentHash: hash(
      `${targetNodeId}-content`,
    ),
    objectContentHash: object.objectContentHash,
    sourceHash: hash(`${targetNodeId}-source`),
  };
}

function candidateArm(
  inventory: T45CapabilityInventoryV1,
  nodeIds: readonly string[],
) {
  const nodes = nodeIds.map((targetNodeId) =>
    candidateNode(inventory, targetNodeId));
  const objectIds = [
    ...new Set(nodes.map(({ objectId }) => objectId)),
  ];
  return {
    directEvidenceBatchHash: null,
    rrfResultHash: null,
    objectRanking: objectIds.map(
      (objectId, index) => ({
        objectId,
        fusedRank: index + 1,
        fusionScore: 1 / (index + 1),
        bestRawRank: index + 1,
        obligationIds: [],
        origins: ["LEXICAL" as const],
      }),
    ),
    candidateNodes: nodes.map((node) => ({
      ...node,
      objectRank:
        objectIds.indexOf(node.objectId) + 1,
    })),
    candidateNodeIdsSha256:
      sha256StableJsonV2(nodeIds),
  };
}

function selectedNode(
  inventory: T45CapabilityInventoryV1,
  targetNodeId: string,
) {
  const object = inventoryObjectForNode(
    inventory,
    targetNodeId,
  );
  return {
    nodeId: targetNodeId,
    objectId: object.objectId,
    coursePackId: object.coursePackId,
    selectionSource: "RRF_FILL" as const,
    obligationId: null,
    aggregateRrfScore: 1,
  };
}

function createCandidateInputs(
  qrels: T45CapabilityQrelsSuite,
  inventory: T45CapabilityInventoryV1,
  missing: Readonly<{
    caseId: string;
    groupId: string;
  }> | null = null,
) {
  const candidateCases = qrels.cases.map((testCase) => {
    const aNodeIds = testCase.multiClaim
      ? [
          testCase.requiredEvidenceGroups[0]!
            .acceptableNodeIds[0]!,
        ]
      : [];
    const bNodeIds =
      testCase.requiredEvidenceGroups.flatMap(
        (group) => {
          if (
            missing?.caseId === testCase.caseId
            && missing.groupId === group.groupId
          ) {
            return [];
          }
          return [
            group.acceptableNodeIds[
              group.acceptableNodeIds.length - 1
            ]!,
          ];
        },
      );
    const filteredA = aNodeIds.filter(
      (targetNodeId) => {
        const group =
          testCase.requiredEvidenceGroups.find(
            ({ acceptableNodeIds }) =>
              acceptableNodeIds.includes(
                targetNodeId,
              ),
          );
        return !(
          missing?.caseId === testCase.caseId
          && missing.groupId === group?.groupId
        );
      },
    );
    return {
      testCase,
      aNodeIds: filteredA,
      bNodeIds,
      aArm: candidateArm(inventory, filteredA),
      bArm: candidateArm(inventory, bNodeIds),
    };
  });
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_CANDIDATES",
      runtimeSuite: qrels.runtimeSuite,
      corpusSnapshot: {
        bundleHash: CORPUS_HASH,
      },
      config: T44_OBLIGATION_CANDIDATE_CONFIG_V1,
      configHash:
        T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
      graphifyInvocationCount: 0,
      providerAudit: {
        expectedCalls: 40,
        actualCalls: 40,
        channelCounts: {
          LEXICAL: 20,
          TEXT_VECTOR: 20,
          VISUAL_VECTOR: 0,
        },
        matched: true,
      },
      cases: candidateCases.map((entry) => ({
        caseId: entry.testCase.caseId,
        coursePackId: COURSE_PACK_ID,
        coursePackVersion: "1",
        normalizedQuestionHash: hash(
          `${entry.testCase.caseId}-question`,
        ),
        obligationSetHash: hash(
          `${entry.testCase.caseId}-obligation`,
        ),
        retrievalPlanHash: hash(
          `${entry.testCase.caseId}-plan`,
        ),
        arms: {
          A_WHOLE_QUERY: entry.aArm,
          B_MODEL_GUIDED: entry.bArm,
        },
      })),
    }) as T44ObligationCandidateArtifactV1;
  const selection =
    T44ObligationSelectionArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_SELECTIONS",
      candidateArtifactSha256: hash("candidate"),
      matrixOutputSha256: hash("matrix"),
      selectorConfigId:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2.id,
      selectorConfigVersion:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2
          .version,
      selectorConfigHash:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
      graphifyInvocationCount: 0,
      cases: candidateCases.map((entry) => ({
        caseId: entry.testCase.caseId,
        coursePackId: COURSE_PACK_ID,
        candidateNodeIdsSha256:
          sha256StableJsonV2({
            A_WHOLE_QUERY:
              entry.aArm.candidateNodeIdsSha256,
            B_MODEL_GUIDED:
              entry.bArm.candidateNodeIdsSha256,
          }),
        arms: {
          A_WHOLE_QUERY: {
            selected: entry.aNodeIds.map(
              (targetNodeId) =>
                selectedNode(inventory, targetNodeId),
            ),
          },
          B_MODEL_GUIDED: {
            selected: [],
          },
        },
      })),
    }) as T44ObligationSelectionArtifactV1;
  return { candidate, selection };
}

function createCandidateFixture(
  split: T45CapabilitySplit = "CALIBRATION",
  missing: Readonly<{
    caseId: string;
    groupId: string;
  }> | null = null,
) {
  const qrelsInput = createQrels(split);
  const inventory = createInventory(qrelsInput);
  const qrels = T45CapabilityQrelsSuiteSchema.parse({
    ...qrelsInput,
    capabilityInventory: {
      ...qrelsInput.capabilityInventory,
      inventoryHash: inventory.inventoryHash,
    },
    suiteHash: HASH,
  }) as T45CapabilityQrelsSuite;
  qrels.suiteHash = t45CapabilityQrelsSuiteHash(
    qrels,
  );
  return {
    qrels,
    inventory,
    ...createCandidateInputs(
      qrels,
      inventory,
      missing,
    ),
  };
}

function createSelectionCases(
  qrels: T45CapabilityQrelsSuite,
  inventory: T45CapabilityInventoryV1,
): T45FinalSelectionCase[] {
  return qrels.cases.map((testCase) => ({
    caseId: testCase.caseId,
    coursePackId: COURSE_PACK_ID,
    status: "VALID" as const,
    selected: testCase.requiredEvidenceGroups.map(
      ({ acceptableNodeIds }) => {
        const targetNodeId =
          acceptableNodeIds[
            acceptableNodeIds.length - 1
          ]!;
        const object = inventoryObjectForNode(
          inventory,
          targetNodeId,
        );
        return {
          nodeId: targetNodeId,
          objectId: object.objectId,
          coursePackId: object.coursePackId,
        };
      },
    ),
    bindingViolations: [],
  }));
}

function createBaselineCases(
  qrels: T45CapabilityQrelsSuite,
) {
  return qrels.cases.map((testCase, index) => ({
    caseId: testCase.caseId,
    coursePackId: COURSE_PACK_ID,
    selectedNodeIds: index === 0
      ? [...testCase.hardNegativeNodeIds]
      : [],
  })) satisfies T45BaselineCase[];
}

function dropGroup(
  rows: T45FinalSelectionCase[],
  qrels: T45CapabilityQrelsSuite,
  targetCaseId: string,
  groupIndex: number,
) {
  const qrel = qrels.cases.find(
    ({ caseId: observed }) =>
      observed === targetCaseId,
  )!;
  const omitted = new Set(
    qrel.requiredEvidenceGroups[groupIndex]!
      .acceptableNodeIds,
  );
  const row = rows.find(
    ({ caseId: observed }) =>
      observed === targetCaseId,
  )!;
  row.selected = row.selected.filter(
    ({ nodeId: selectedNodeId }) =>
      !omitted.has(selectedNodeId),
  );
}

describe("T45 capability evaluator", () => {
  it("freezes the approved denominators and selection gates", () => {
    expect(T45_CAPABILITY_DENOMINATORS_V1).toEqual({
      cases: 20,
      requiredGroups: 30,
      multiCases: 10,
      families: 10,
    });
    expect(T45_CAPABILITY_SELECTION_GATES_V1).toEqual({
      supportCasesMinimum: 18,
      requiredGroupsCoveredMinimum: 28,
      multiJointCoverageMinimum: 9,
      familiesWithBothCasesSupportedMinimum: 9,
      validSelectionsRequired: 20,
      bindingViolationsMaximum: 0,
      reviewerP95MsMaximum: 30_000,
    });
  });

  it("scores group alternatives, multi joint coverage and both-case families over the protected candidate pool", () => {
    const fixture = createCandidateFixture();
    const report = evaluateT45CandidateOracle({
      split: "CALIBRATION",
      candidate: fixture.candidate,
      selection: fixture.selection,
      qrels: fixture.qrels,
      inventory: fixture.inventory,
      structuralReadiness:
        readyStructuralReadiness(fixture.qrels),
    });

    expect(report.candidateOracle).toEqual({
      casesCovered: 20,
      casesTotal: 20,
      groupsCovered: 30,
      groupsTotal: 30,
      coveragePassed: true,
      structuralGates: {
        baselineAvailableCases: 20,
        protectedAnchorCases: 20,
        baselineSingleCountCases: 20,
        casesTotal: 20,
        passed: true,
      },
      passed: true,
    });
    expect(report.split).toBe("CALIBRATION");
    if (report.split !== "CALIBRATION") {
      throw new Error("TEST_EXPECTED_CALIBRATION");
    }
    expect(report.diagnostics).toMatchObject({
      multiJointCoverage: 10,
      multiCasesTotal: 10,
      familiesWithBothCasesCovered: 10,
      familiesTotal: 10,
    });
    expect(report.decision).toBe(
      "CALIBRATION_CANDIDATE_READY",
    );
  });

  it("counts a missing direct group against its case and family without changing multi joint coverage", () => {
    const base = createCandidateFixture();
    const direct = base.qrels.cases[0]!;
    const fixture = createCandidateFixture(
      "CALIBRATION",
      {
        caseId: direct.caseId,
        groupId:
          direct.requiredEvidenceGroups[0]!.groupId,
      },
    );
    const report = evaluateT45CandidateOracle({
      split: "CALIBRATION",
      candidate: fixture.candidate,
      selection: fixture.selection,
      qrels: fixture.qrels,
      inventory: fixture.inventory,
      structuralReadiness:
        readyStructuralReadiness(fixture.qrels),
    });

    expect(report.candidateOracle).toMatchObject({
      casesCovered: 19,
      groupsCovered: 29,
      passed: false,
    });
    expect(report.split).toBe("CALIBRATION");
    if (report.split !== "CALIBRATION") {
      throw new Error("TEST_EXPECTED_CALIBRATION");
    }
    expect(report.diagnostics).toMatchObject({
      multiJointCoverage: 10,
      familiesWithBothCasesCovered: 9,
    });
  });

  it("counts a missing composition group as one failed multi joint case", () => {
    const base = createCandidateFixture();
    const compose = base.qrels.cases[1]!;
    const fixture = createCandidateFixture(
      "CALIBRATION",
      {
        caseId: compose.caseId,
        groupId:
          compose.requiredEvidenceGroups[1]!.groupId,
      },
    );
    const report = evaluateT45CandidateOracle({
      split: "CALIBRATION",
      candidate: fixture.candidate,
      selection: fixture.selection,
      qrels: fixture.qrels,
      inventory: fixture.inventory,
      structuralReadiness:
        readyStructuralReadiness(fixture.qrels),
    });

    expect(report.candidateOracle).toMatchObject({
      casesCovered: 19,
      groupsCovered: 29,
    });
    expect(report.split).toBe("CALIBRATION");
    if (report.split !== "CALIBRATION") {
      throw new Error("TEST_EXPECTED_CALIBRATION");
    }
    expect(report.diagnostics).toMatchObject({
      multiJointCoverage: 9,
      familiesWithBothCasesCovered: 9,
    });
  });

  it.each([
    {
      label: "cases",
      mutate(qrels: T45CapabilityQrelsSuite) {
        qrels.cases.pop();
      },
      code:
        "T45_CAPABILITY_CASE_DENOMINATOR_INVALID:19",
    },
    {
      label: "groups",
      mutate(qrels: T45CapabilityQrelsSuite) {
        qrels.cases[0]!.requiredEvidenceGroups.push({
          groupId: "extra-group",
          acceptableNodeIds: [nodeId("extra-group")],
        });
      },
      code:
        "T45_CAPABILITY_GROUP_DENOMINATOR_INVALID:31",
    },
    {
      label: "multi cases",
      mutate(qrels: T45CapabilityQrelsSuite) {
        qrels.cases[1]!.multiClaim = false;
      },
      code:
        "T45_CAPABILITY_MULTI_DENOMINATOR_INVALID:9",
    },
    {
      label: "families",
      mutate(qrels: T45CapabilityQrelsSuite) {
        qrels.cases[18]!.familyId =
          qrels.cases[0]!.familyId;
        qrels.cases[19]!.familyId =
          qrels.cases[0]!.familyId;
      },
      code:
        "T45_CAPABILITY_FAMILY_DENOMINATOR_INVALID:9",
    },
  ])("fails closed on the fixed $label denominator", ({
    mutate,
    code,
  }) => {
    const fixture = createCandidateFixture();
    const qrels = structuredClone(fixture.qrels);
    mutate(qrels);
    expect(() => evaluateT45CandidateOracle({
      split: "CALIBRATION",
      candidate: fixture.candidate,
      selection: fixture.selection,
      qrels,
      inventory: fixture.inventory,
      structuralReadiness:
        readyStructuralReadiness(fixture.qrels),
    })).toThrow(code);
  });

  it("returns only the approved aggregate and decision for validation", () => {
    const fixture = createCandidateFixture(
      "VALIDATION",
    );
    const report = evaluateT45CandidateOracle({
      split: "VALIDATION",
      candidate: fixture.candidate,
      selection: fixture.selection,
      qrels: fixture.qrels,
      inventory: fixture.inventory,
      structuralReadiness:
        readyStructuralReadiness(fixture.qrels),
    });
    const serialized = JSON.stringify(report);

    expect(report).toEqual({
      split: "VALIDATION",
      candidateOracle: {
        casesCovered: 20,
        casesTotal: 20,
        groupsCovered: 30,
        groupsTotal: 30,
        coveragePassed: true,
        structuralGates: {
          baselineAvailableCases: 20,
          protectedAnchorCases: 20,
          baselineSingleCountCases: 20,
          casesTotal: 20,
          passed: true,
        },
        passed: true,
      },
      decision: "VALIDATION_CANDIDATE_READY",
    });
    expect(serialized).not.toMatch(
      /case-01|family-01|group-1|requiredEvidenceGroups|acceptableNodeIds|hardNegative/i,
    );
  });

  it("forbids selection after a validation candidate NO-GO", () => {
    const base = createCandidateFixture("VALIDATION");
    const direct = base.qrels.cases[0]!;
    const fixture = createCandidateFixture(
      "VALIDATION",
      {
        caseId: direct.caseId,
        groupId:
          direct.requiredEvidenceGroups[0]!.groupId,
      },
    );
    const report = evaluateT45CandidateOracle({
      split: "VALIDATION",
      candidate: fixture.candidate,
      selection: fixture.selection,
      qrels: fixture.qrels,
      inventory: fixture.inventory,
      structuralReadiness:
        readyStructuralReadiness(fixture.qrels),
    });

    expect(report.decision).toBe(
      "VALIDATION_CANDIDATE_NO_GO",
    );
    expect(() =>
      assertT45CandidateOracleReadyForSelection(
        report,
      )).toThrow(
        "T45_VALIDATION_CANDIDATE_NO_GO_SELECTION_FORBIDDEN",
      );
  });

  it("passes every selection gate at the inclusive threshold boundary", () => {
    const fixture = createCandidateFixture();
    const selectionCases = createSelectionCases(
      fixture.qrels,
      fixture.inventory,
    );
    dropGroup(
      selectionCases,
      fixture.qrels,
      fixture.qrels.cases[0]!.caseId,
      0,
    );
    dropGroup(
      selectionCases,
      fixture.qrels,
      fixture.qrels.cases[1]!.caseId,
      1,
    );
    const report = evaluateT45Selection({
      split: "CALIBRATION",
      selectionCases,
      aBaselineCases:
        createBaselineCases(fixture.qrels),
      qrels: fixture.qrels,
      reviewerP95Ms: 30_000,
    });

    expect(report.summary).toMatchObject({
      supportCases: 18,
      requiredGroupsCovered: 28,
      multiJointCoverage: 9,
      familiesWithBothCasesSupported: 9,
      validSelections: 20,
      bindingViolations: 0,
      reviewerP95Ms: 30_000,
    });
    expect(report.passed).toBe(true);
    expect(Object.values(report.gates).every(
      ({ passed }) => passed,
    )).toBe(true);
  });

  it("fails support, group and family gates below their fixed boundaries", () => {
    const fixture = createCandidateFixture();
    const selectionCases = createSelectionCases(
      fixture.qrels,
      fixture.inventory,
    );
    dropGroup(
      selectionCases,
      fixture.qrels,
      fixture.qrels.cases[0]!.caseId,
      0,
    );
    dropGroup(
      selectionCases,
      fixture.qrels,
      fixture.qrels.cases[1]!.caseId,
      1,
    );
    dropGroup(
      selectionCases,
      fixture.qrels,
      fixture.qrels.cases[2]!.caseId,
      0,
    );
    const report = evaluateT45Selection({
      split: "CALIBRATION",
      selectionCases,
      aBaselineCases:
        createBaselineCases(fixture.qrels),
      qrels: fixture.qrels,
      reviewerP95Ms: 30_000,
    });

    expect(report.summary).toMatchObject({
      supportCases: 17,
      requiredGroupsCovered: 27,
      familiesWithBothCasesSupported: 8,
    });
    expect(report.gates.supportCases.passed)
      .toBe(false);
    expect(report.gates.requiredGroupsCovered.passed)
      .toBe(false);
    expect(
      report.gates.familiesWithBothCasesSupported
        .passed,
    ).toBe(false);
    expect(report.passed).toBe(false);
  });

  it("counts hard-negative nodes and cases independently against the A baseline", () => {
    const fixture = createCandidateFixture();
    const selectionCases = createSelectionCases(
      fixture.qrels,
      fixture.inventory,
    );
    const firstQrel = fixture.qrels.cases[0]!;
    const firstSelection = selectionCases[0]!;
    firstSelection.selected.push(
      ...firstQrel.hardNegativeNodeIds.map(
        (targetNodeId) => {
          const object = inventoryObjectForNode(
            fixture.inventory,
            targetNodeId,
          );
          return {
            nodeId: targetNodeId,
            objectId: object.objectId,
            coursePackId: object.coursePackId,
          };
        },
      ),
    );
    const report = evaluateT45Selection({
      split: "CALIBRATION",
      selectionCases,
      aBaselineCases:
        createBaselineCases(fixture.qrels),
      qrels: fixture.qrels,
      reviewerP95Ms: 1,
    });

    expect(report.summary).toMatchObject({
      hardNegativeNodes: 2,
      hardNegativeCases: 1,
      aBaselineHardNegativeNodes: 2,
      aBaselineHardNegativeCases: 1,
    });
    expect(
      report.gates.hardNegativeNodes.passed,
    ).toBe(true);
    expect(
      report.gates.hardNegativeCases.passed,
    ).toBe(true);

    const secondQrel = fixture.qrels.cases[1]!;
    const secondSelection = selectionCases[1]!;
    const secondHard =
      secondQrel.hardNegativeNodeIds[0]!;
    const object = inventoryObjectForNode(
      fixture.inventory,
      secondHard,
    );
    secondSelection.selected.push({
      nodeId: secondHard,
      objectId: object.objectId,
      coursePackId: object.coursePackId,
    });
    const regressed = evaluateT45Selection({
      split: "CALIBRATION",
      selectionCases,
      aBaselineCases:
        createBaselineCases(fixture.qrels),
      qrels: fixture.qrels,
      reviewerP95Ms: 1,
    });

    expect(regressed.summary).toMatchObject({
      hardNegativeNodes: 3,
      hardNegativeCases: 2,
    });
    expect(
      regressed.gates.hardNegativeNodes.passed,
    ).toBe(false);
    expect(
      regressed.gates.hardNegativeCases.passed,
    ).toBe(false);
  });

  it("separately gates model validity, binding violations and reviewer latency", () => {
    const fixture = createCandidateFixture();
    const selectionCases = createSelectionCases(
      fixture.qrels,
      fixture.inventory,
    );
    selectionCases[0]!.status = "INVALID";
    selectionCases[0]!.selected = [];
    selectionCases[1]!.bindingViolations = [
      "SCOPE:synthetic",
    ];
    const report = evaluateT45Selection({
      split: "CALIBRATION",
      selectionCases,
      aBaselineCases:
        createBaselineCases(fixture.qrels),
      qrels: fixture.qrels,
      reviewerP95Ms: 30_000.001,
    });

    expect(report.summary).toMatchObject({
      validSelections: 19,
      bindingViolations: 1,
      reviewerP95Ms: 30_000.001,
    });
    expect(report.gates.validSelections.passed)
      .toBe(false);
    expect(report.gates.bindingViolations.passed)
      .toBe(false);
    expect(report.gates.reviewerP95Ms.passed)
      .toBe(false);
    expect(report.passed).toBe(false);
  });

  it("fails closed when the explicit selection split drifts from qrels", () => {
    const fixture = createCandidateFixture();

    expect(() =>
      evaluateT45Selection({
        split: "VALIDATION",
        selectionCases: createSelectionCases(
          fixture.qrels,
          fixture.inventory,
        ),
        aBaselineCases:
          createBaselineCases(fixture.qrels),
        qrels: fixture.qrels,
        reviewerP95Ms: 1,
      })).toThrow(
        "T45_CAPABILITY_SELECTION_SPLIT_DRIFT",
      );
  });

  it("parses only reports whose config, gates, passed flag and decision agree", () => {
    const fixture = createCandidateFixture();
    const report = evaluateT45Selection({
      split: "CALIBRATION",
      selectionCases: createSelectionCases(
        fixture.qrels,
        fixture.inventory,
      ),
      aBaselineCases:
        createBaselineCases(fixture.qrels),
      qrels: fixture.qrels,
      reviewerP95Ms: 1,
    });
    expect(
      T45SelectionReportSchema.parse(report),
    ).toEqual(report);
    const forgedEmptyGo = structuredClone(
      report,
    );
    forgedEmptyGo.cases =
      forgedEmptyGo.cases.map(
        (testCase) => ({
          ...testCase,
          selectedNodeIds: [],
          groups: testCase.groups.map(
            (group) => ({
              ...group,
              covered: true,
              matchedNodeIds: [],
            }),
          ),
          covered: true,
          hardNegativeNodeIds: [],
        }),
      );
    expect(() =>
      T45SelectionReportSchema.parse(
        forgedEmptyGo,
      ),
    ).toThrow(
      /selection report case structural truth drift/,
    );
    expect(() =>
      T45SelectionReportSchema.parse({
        ...report,
        decision: "CALIBRATION_NO_GO",
      }),
    ).toThrow(
      /selection report config\/gate\/decision drift/,
    );
    expect(() =>
      T45SelectionReportSchema.parse({
        ...report,
        configHash: "b".repeat(64),
      }),
    ).toThrow(
      /selection report config\/gate\/decision drift/,
    );
    expect(() =>
      T45SelectionReportSchema.parse({
        ...report,
        passed: false,
      }),
    ).toThrow(
      /selection report config\/gate\/decision drift/,
    );
    expect(() =>
      T45SelectionReportSchema.parse({
        ...report,
        cases: report.cases.map(
          (testCase) => ({
            ...testCase,
            status: "INVALID",
            covered: false,
            groups: testCase.groups.map(
              (group) => ({
                ...group,
                covered: false,
                matchedNodeIds: [],
              }),
            ),
          }),
        ),
      }),
    ).toThrow(
      /selection report summary aggregate drift/,
    );
  });
});
