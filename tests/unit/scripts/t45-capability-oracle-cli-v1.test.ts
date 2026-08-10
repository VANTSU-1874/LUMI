// @vitest-environment node

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T44_CLAIM_MATRIX_CONFIG_HASH_V1,
} from "@/tools/mixed-retrieval/t44-claim-matrix-contract-v1";
import {
  T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
  T44_OBLIGATION_CANDIDATE_CONFIG_V1,
  T44ObligationCandidateArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2,
  T44ObligationSelectionArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-label-blind-v2";
import {
  type T45CapabilityInventoryV1,
  type T45CapabilityQrelsSuite,
  type T45CapabilityRuntimeSuite,
  type T45CapabilitySplit,
} from "@/tools/mixed-retrieval/t45-capability-authoring";
import {
  T45CapabilityInventorySchema,
  T45CapabilityQrelsSuiteSchema,
  T45CapabilityRuntimeSuiteSchema,
  t45CapabilityInventoryHash,
  t45CapabilityQrelsSuiteHash,
  t45CapabilityRuntimeSuiteHash,
} from "@/tools/mixed-retrieval/t45-capability-loader";
import {
  assertT45CandidateOracleReadyForSelection,
} from "@/tools/mixed-retrieval/t45-capability-evaluator";
import {
  T45_CAPABILITY_ORACLE_FROZEN_BINDINGS_V1,
  parseT45CapabilityOracleArguments,
  readT45QrelsReadOnlyV1,
  runT45CapabilityOracleCli,
  serializeT45CapabilityOracleStdoutV1,
  type T45CapabilityOracleFrozenBindingsV1,
} from "@/scripts/audit-t45-capability-oracle-v1";

const roots: string[] = [];

type SplitFiles = {
  runtime: string;
  qrels: string;
};

type Fixture = Awaited<
  ReturnType<typeof createWorkspaceFixture>
>;

function sha256(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function canonicalJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function splitFiles(
  split: T45CapabilitySplit,
): SplitFiles {
  return split === "CALIBRATION"
    ? {
        runtime:
          "t45-capability-calibration.runtime.json",
        qrels:
          "t45-capability-calibration.qrels.json",
      }
    : {
        runtime:
          "t45-capability-validation.runtime.json",
        qrels:
          "t45-capability-validation.qrels.json",
      };
}

async function writeCanonical(
  target: string,
  value: unknown,
) {
  const content = canonicalJson(value);
  await mkdir(path.dirname(target), {
    recursive: true,
  });
  await writeFile(target, content, "utf8");
  return {
    path: path.resolve(target),
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
  };
}

function candidateNode(
  nodeId: string,
  inventory: T45CapabilityInventoryV1,
) {
  const object = inventory.objects.find(
    ({ eligibleNodeIds }) =>
      eligibleNodeIds.includes(nodeId),
  );
  if (!object) {
    throw new Error(
      `TEST_NODE_OWNER_MISSING:${nodeId}`,
    );
  }
  return {
    nodeId,
    objectId: object.objectId,
    coursePackId: object.coursePackId,
    objectRank: 1,
    kind: "TEXT" as const,
    role: "FACT" as const,
    text: `Fixture evidence ${nodeId}`,
    nodeContentHash: sha256(`${nodeId}-content`),
    objectContentHash: object.objectContentHash,
    sourceHash: sha256(`${nodeId}-source`),
  };
}

function candidateArm(
  nodeIds: readonly string[],
  inventory: T45CapabilityInventoryV1,
) {
  const nodes = nodeIds.map((nodeId) =>
    candidateNode(nodeId, inventory));
  const objectIds = [
    ...new Set(nodes.map(({ objectId }) => objectId)),
  ];
  return {
    directEvidenceBatchHash:
      sha256StableJsonV2({
        kind: "DIRECT_EVIDENCE_BATCH",
        nodeIds,
      }),
    rrfResultHash:
      sha256StableJsonV2({
        kind: "OBLIGATION_RRF",
        nodeIds,
      }),
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

async function sourceArtifacts(
  root: string,
  split: T45CapabilitySplit,
) {
  const sourceRoot = path.resolve(
    "tests/retrieval-quality",
  );
  const targetRoot = path.join(
    root,
    "tests/retrieval-quality",
  );
  const files = splitFiles(split);
  await mkdir(targetRoot, { recursive: true });
  for (
    const file
    of [
      "t45-capability-inventory.json",
      files.runtime,
      files.qrels,
    ]
  ) {
    await copyFile(
      path.join(sourceRoot, file),
      path.join(targetRoot, file),
    );
  }
  const [inventory, runtime, qrels] =
    await Promise.all([
      readFile(path.join(
        targetRoot,
        "t45-capability-inventory.json",
      ), "utf8").then((value) =>
        T45CapabilityInventorySchema.parse(
          JSON.parse(value) as unknown,
        ) as T45CapabilityInventoryV1),
      readFile(path.join(
        targetRoot,
        files.runtime,
      ), "utf8").then((value) =>
        T45CapabilityRuntimeSuiteSchema.parse(
          JSON.parse(value) as unknown,
        ) as T45CapabilityRuntimeSuite),
      readFile(path.join(
        targetRoot,
        files.qrels,
      ), "utf8").then((value) =>
        T45CapabilityQrelsSuiteSchema.parse(
          JSON.parse(value) as unknown,
        ) as T45CapabilityQrelsSuite),
    ]);
  return {
    sourceRoot: targetRoot,
    files,
    inventory,
    runtime,
    qrels,
  };
}

async function createWorkspaceFixture(input: {
  split?: T45CapabilitySplit;
  runId?: string;
  missing?: {
    caseId: string;
    groupId: string;
  } | null;
} = {}) {
  const split = input.split ?? "CALIBRATION";
  const runId = input.runId
    ?? (
      split === "CALIBRATION"
        ? "calibration-v1"
        : "validation-v1"
    );
  const root = await mkdtemp(
    path.join(os.tmpdir(), "lumi-t45-oracle-"),
  );
  roots.push(root);
  const source = await sourceArtifacts(root, split);
  const artifactRoot = path.join(
    root,
    ".runtime/mixed-retrieval",
  );
  await mkdir(artifactRoot, { recursive: true });
  const stem = `t45-capability-${runId}`;
  const candidateCases = source.qrels.cases.map(
    (qrel, index) => {
      const runtimeCase = source.runtime.cases[index]!;
      const baselineNodeId =
        qrel.hardNegativeNodeIds[0]!;
      const bNodeIds = [
        baselineNodeId,
        ...qrel.requiredEvidenceGroups.flatMap((group) =>
          input.missing?.caseId === qrel.caseId
          && input.missing.groupId === group.groupId
            ? []
            : [...group.acceptableNodeIds]),
      ];
      const aArm = candidateArm(
        [baselineNodeId],
        source.inventory,
      );
      const bArm = candidateArm(
        bNodeIds,
        source.inventory,
      );
      return {
        qrel,
        runtimeCase,
        aArm,
        bArm,
      };
    },
  );
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_CANDIDATES",
      runtimeSuite: {
        id: source.runtime.id,
        version: source.runtime.version,
        suiteHash: source.runtime.suiteHash,
      },
      corpusSnapshot: {
        bundleHash:
          source.runtime.corpusSnapshot.bundleHash,
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
        caseId: entry.qrel.caseId,
        coursePackId:
          entry.runtimeCase.coursePackId,
        coursePackVersion: "1",
        normalizedQuestionHash: sha256(
          entry.runtimeCase.question,
        ),
        obligationSetHash: sha256(
          `${entry.qrel.caseId}-obligation`,
        ),
        retrievalPlanHash: sha256(
          `${entry.qrel.caseId}-plan`,
        ),
        arms: {
          A_WHOLE_QUERY: entry.aArm,
          B_MODEL_GUIDED: entry.bArm,
        },
      })),
    });
  const plannerValue = {
    schemaVersion: 1,
    kind: "T44_OBLIGATION_PLANNER_OUTPUTS",
    runtimeSuite: {
      id: source.runtime.id,
      version: source.runtime.version,
      suiteHash: source.runtime.suiteHash,
    },
    graphifyInvocationCount: 0,
    cases: source.runtime.cases.map((testCase) => ({
      caseId: testCase.caseId,
      request: {
        coursePack: {
          id: testCase.coursePackId,
          version: testCase.coursePackVersion,
        },
      },
    })),
  };
  const providerValue = {
    schemaVersion: 1,
    kind: "T44_OBLIGATION_PROVIDER_TRACES",
    expectedCalls: 40,
    actualCalls: 40,
    matched: true,
    cases: source.runtime.cases.map(
      ({ caseId }) => ({
        caseId,
        A_WHOLE_QUERY: {
          status: "EXECUTED",
          expectedProviderCalls: 1,
          actualProviderCalls: 1,
          batch: {
            kind: "DIRECT_EVIDENCE_BATCH",
            caseId,
            arm: "A",
          },
          rrf: {
            kind: "OBLIGATION_RRF",
            caseId,
            arm: "A",
          },
        },
        B_MODEL_GUIDED: {
          status: "EXECUTED",
          expectedProviderCalls: 1,
          actualProviderCalls: 1,
          batch: {
            kind: "DIRECT_EVIDENCE_BATCH",
            caseId,
            arm: "B",
          },
          rrf: {
            kind: "OBLIGATION_RRF",
            caseId,
            arm: "B",
          },
        },
      }),
    ),
  };
  const matrixBridgeValue = {
    schemaVersion: 1,
    kind: "T44_OBLIGATION_MATRIX_BRIDGES",
    cases: source.runtime.cases.map(
      ({ caseId }) => ({ caseId }),
    ),
  };
  const planner = await writeCanonical(
    path.join(artifactRoot, `${stem}.planner.json`),
    plannerValue,
  );
  const provider = await writeCanonical(
    path.join(artifactRoot, `${stem}.provider.json`),
    providerValue,
  );
  const candidateSeal = await writeCanonical(
    path.join(
      artifactRoot,
      `${stem}.candidate.json`,
    ),
    candidate,
  );
  const matrixBridge = await writeCanonical(
    path.join(
      artifactRoot,
      `${stem}.matrix-bridge.json`,
    ),
    matrixBridgeValue,
  );
  const matrixValue = {
    schemaVersion: 1,
    kind: "T44_OBLIGATION_NODE_MATRICES",
    matrixBridgeManifestSha256:
      matrixBridge.sha256,
    graphifyInvocationCount: 0,
    arms: {
      A_WHOLE_QUERY: {
        output: {
          cases: source.runtime.cases.map(
            (testCase) => ({
              caseId: testCase.caseId,
              coursePackId: testCase.coursePackId,
            }),
          ),
        },
      },
      B_MODEL_GUIDED: {
        output: {
          cases: source.runtime.cases.map(
            (testCase) => ({
              caseId: testCase.caseId,
              coursePackId: testCase.coursePackId,
            }),
          ),
        },
      },
    },
  };
  const matrix = await writeCanonical(
    path.join(artifactRoot, `${stem}.matrix.json`),
    matrixValue,
  );
  const selection =
    T44ObligationSelectionArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_SELECTIONS",
      candidateArtifactSha256:
        candidateSeal.sha256,
      matrixOutputSha256: matrix.sha256,
      selectorConfigId:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2.id,
      selectorConfigVersion:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2
          .version,
      selectorConfigHash:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
      graphifyInvocationCount: 0,
      cases: candidateCases.map((entry) => ({
        caseId: entry.qrel.caseId,
        coursePackId:
          entry.runtimeCase.coursePackId,
        candidateNodeIdsSha256:
          sha256StableJsonV2({
          A_WHOLE_QUERY:
            entry.aArm.candidateNodeIdsSha256,
          B_MODEL_GUIDED:
            entry.bArm.candidateNodeIdsSha256,
          }),
        arms: {
          A_WHOLE_QUERY: {
            selected: [{
              nodeId:
                entry.aArm.candidateNodes[0]!.nodeId,
              objectId:
                entry.aArm.candidateNodes[0]!.objectId,
              coursePackId:
                entry.aArm.candidateNodes[0]!
                  .coursePackId,
              selectionSource: "RRF_FILL",
              obligationId: null,
              aggregateRrfScore: 1,
            }],
          },
          B_MODEL_GUIDED: {
            selected: [{
              nodeId:
                entry.bArm.candidateNodes[0]!.nodeId,
              objectId:
                entry.bArm.candidateNodes[0]!.objectId,
              coursePackId:
                entry.bArm.candidateNodes[0]!
                  .coursePackId,
              selectionSource:
                "WHOLE_QUERY_BASELINE",
              obligationId: null,
              aggregateRrfScore: 1,
            }],
          },
        },
      })),
    });
  const selectionSeal = await writeCanonical(
    path.join(
      artifactRoot,
      `${stem}.selection.json`,
    ),
    selection,
  );
  const boundaryValue = {
    schemaVersion: 1,
    kind: "T45_CAPABILITY_LABELS_REMAIN_UNREAD",
    runId,
    split,
    runtimeSuite: {
      id: source.runtime.id,
      version: source.runtime.version,
      suiteHash: source.runtime.suiteHash,
    },
    capabilityInventory: {
      inventoryHash:
        source.inventory.inventoryHash,
    },
    corpusSnapshot: {
      bundleHash:
        source.runtime.corpusSnapshot.bundleHash,
    },
    configHashes: {
      candidate:
        T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
      matrix: T44_CLAIM_MATRIX_CONFIG_HASH_V1,
      selection:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
    },
    providerInvocationAudit: {
      expectedCalls: 40,
      actualCalls: 40,
    },
    operationBoundary:
      "SELECTION_SEALED_LABELS_UNREAD",
    operations: {
      graphify: "NOT_USED",
      database: "NOT_USED",
      web: "NOT_USED",
      deployment: "NOT_PERFORMED",
      scoring: "NOT_PERFORMED",
    },
    artifacts: {
      planner,
      provider,
      candidate: candidateSeal,
      matrixBridge,
      matrix,
      selection: selectionSeal,
    },
  };
  const boundaryPath = path.join(
    artifactRoot,
    `${stem}.boundary.json`,
  );
  await writeCanonical(boundaryPath, boundaryValue);
  return {
    root,
    split,
    runId,
    stem,
    artifactRoot,
    source,
    candidate,
    selection,
    plannerValue,
    matrixValue,
    boundaryPath,
    boundaryValue,
    paths: {
      planner: planner.path,
      provider: provider.path,
      candidate: candidateSeal.path,
      matrix: matrix.path,
      selection: selectionSeal.path,
      qrels: path.join(
        source.sourceRoot,
        source.files.qrels,
      ),
      runtime: path.join(
        source.sourceRoot,
        source.files.runtime,
      ),
      inventory: path.join(
        source.sourceRoot,
        "t45-capability-inventory.json",
      ),
      oracle: path.join(
        artifactRoot,
        `${stem}.oracle.json`,
      ),
      oracleGate: path.join(
        artifactRoot,
        `${stem}.oracle-gate.json`,
      ),
    },
  };
}

async function resealBoundaryArtifact(
  fixture: Fixture,
  artifact:
    | "planner"
    | "provider"
    | "candidate"
    | "matrix"
    | "selection",
  value: unknown,
) {
  const seal = await writeCanonical(
    fixture.paths[artifact],
    value,
  );
  fixture.boundaryValue.artifacts[artifact] = seal;
  await writeCanonical(
    fixture.boundaryPath,
    fixture.boundaryValue,
  );
  return seal;
}

function mutableFrozenBindings() {
  return structuredClone(
    T45_CAPABILITY_ORACLE_FROZEN_BINDINGS_V1,
  ) as T45CapabilityOracleFrozenBindingsV1;
}

async function bytesSha256(target: string) {
  return sha256(await readFile(target));
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

describe("T45 capability oracle CLI", () => {
  it("accepts only the frozen split and run-id arguments", () => {
    expect(parseT45CapabilityOracleArguments([
      "--split",
      "calibration",
      "--run-id",
      "calibration-v1",
    ])).toEqual({
      split: "CALIBRATION",
      runId: "calibration-v1",
    });
    expect(() =>
      parseT45CapabilityOracleArguments([
        "--split",
        "legacy",
        "--run-id",
        "calibration-v1",
      ])).toThrow(
        "T45_CAPABILITY_ORACLE_CLI_SPLIT_INVALID",
      );
    expect(() =>
      parseT45CapabilityOracleArguments([
        "--split",
        "validation",
        "--run-id",
        "Validation V1",
      ])).toThrow(
        "T45_CAPABILITY_ORACLE_CLI_RUN_ID_INVALID",
      );
  });

  it("locks validation to validation-v1 at the argument boundary while calibration remains versionable", () => {
    expect(parseT45CapabilityOracleArguments([
      "--split",
      "calibration",
      "--run-id",
      "calibration-v2",
    ])).toEqual({
      split: "CALIBRATION",
      runId: "calibration-v2",
    });
    expect(parseT45CapabilityOracleArguments([
      "--split",
      "validation",
      "--run-id",
      "validation-v1",
    ])).toEqual({
      split: "VALIDATION",
      runId: "validation-v1",
    });
    expect(() =>
      parseT45CapabilityOracleArguments([
        "--split",
        "validation",
        "--run-id",
        "validation-v2",
      ])).toThrow(
        "T45_CAPABILITY_ORACLE_CLI_VALIDATION_RUN_ID_LOCKED",
      );
  });

  it("registers only the two frozen package scripts", async () => {
    const packageJson = JSON.parse(
      await readFile("package.json", "utf8"),
    ) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      "premixed:t45:oracle":
        "node scripts/check-runtime-tools.mjs --tools tsx",
      "mixed:t45:oracle":
        "tsx scripts/audit-t45-capability-oracle-v1.ts",
    });
  });

  it("reopens qrels only after the sealed selection exists and emits calibration detail", async () => {
    const fixture = await createWorkspaceFixture();
    let qrelsReads = 0;
    const result = await runT45CapabilityOracleCli(
      [
        "--split",
        "calibration",
        "--run-id",
        fixture.runId,
      ],
      fixture.root,
      {
        readQrelsReadOnly: async (target) => {
          qrelsReads += 1;
          expect(
            await stat(fixture.paths.selection),
          ).toBeTruthy();
          return readT45QrelsReadOnlyV1(target);
        },
      },
    );

    expect(qrelsReads).toBe(1);
    expect(result.report).toMatchObject({
      split: "CALIBRATION",
      candidateOracle: {
        casesCovered: 20,
        casesTotal: 20,
        groupsCovered: 30,
        groupsTotal: 30,
        passed: true,
      },
      diagnostics: {
        multiJointCoverage: 10,
        familiesWithBothCasesCovered: 10,
      },
      decision: "CALIBRATION_CANDIDATE_READY",
    });
    expect(result.seal.path).toBe(
      path.resolve(fixture.paths.oracle),
    );
    expect(result.gate).toMatchObject({
      split: "CALIBRATION",
      runId: fixture.runId,
      candidateOracle: {
        passed: true,
      },
      inputs: {
        candidateSha256:
          sha256(await readFile(
            fixture.paths.candidate,
          )),
        baselineSelectionSha256:
          sha256(await readFile(
            fixture.paths.selection,
          )),
        oracleReportSha256:
          result.seal.sha256,
      },
    });
    expect(result.gateSeal.path).toBe(
      path.resolve(fixture.paths.oracleGate),
    );
    expect(
      await readFile(
        fixture.paths.oracleGate,
        "utf8",
      ),
    ).not.toMatch(
      /requiredEvidenceGroups|acceptableNodeIds|hardNegativeNodeIds|missingGroupIds|families|cases":\[/,
    );
    const resumed = await runT45CapabilityOracleCli(
      [
        "--split",
        "calibration",
        "--run-id",
        fixture.runId,
      ],
      fixture.root,
    );
    expect(resumed.gateSeal.sha256)
      .toBe(result.gateSeal.sha256);
  });

  it("fails the structural hard gates before reading qrels", async () => {
    const fixture = await createWorkspaceFixture();
    const selection = structuredClone(
      fixture.selection,
    );
    selection.cases[0]!
      .arms.B_MODEL_GUIDED.selected = [];
    await resealBoundaryArtifact(
      fixture,
      "selection",
      selection,
    );
    let qrelsReads = 0;

    await expect(
      runT45CapabilityOracleCli(
        [
          "--split",
          "calibration",
          "--run-id",
          fixture.runId,
        ],
        fixture.root,
        {
          readQrelsReadOnly: async (target) => {
            qrelsReads += 1;
            return readT45QrelsReadOnlyV1(target);
          },
        },
      ),
    ).rejects.toThrow(
      /T45_CANDIDATE_STRUCTURAL_NO_GO:.*protected=19\/20/,
    );
    expect(qrelsReads).toBe(0);
  });

  it("does not touch qrels when selection is absent", async () => {
    const fixture = await createWorkspaceFixture();
    await rm(fixture.paths.selection);
    let qrelsReads = 0;

    await expect(
      runT45CapabilityOracleCli(
        [
          "--split",
          "calibration",
          "--run-id",
          fixture.runId,
        ],
        fixture.root,
        {
          readQrelsReadOnly: async (target) => {
            qrelsReads += 1;
            return readT45QrelsReadOnlyV1(target);
          },
        },
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_ORACLE_SELECTION_MISSING",
    );
    expect(qrelsReads).toBe(0);
  });

  it("keeps validation stdout and artifact aggregate-only with no qrel labels", async () => {
    const fixture = await createWorkspaceFixture({
      split: "VALIDATION",
    });
    const result = await runT45CapabilityOracleCli(
      [
        "--split",
        "validation",
        "--run-id",
        fixture.runId,
      ],
      fixture.root,
    );
    const artifact = await readFile(
      fixture.paths.oracle,
      "utf8",
    );
    const stdout =
      serializeT45CapabilityOracleStdoutV1(
        result.report,
      );

    expect(JSON.parse(artifact)).toEqual({
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
    expect(stdout).toBe(artifact);
    expect(artifact).not.toMatch(
      /caseId|familyId|groupId|requiredEvidenceGroups|acceptableNodeIds|hardNegative|node-[0-9a-f]/i,
    );
  });

  it("seals validation candidate NO-GO without a selection report or label leak", async () => {
    const seed = await createWorkspaceFixture({
      split: "VALIDATION",
    });
    const qrel = seed.source.qrels.cases[0]!;
    await rm(seed.root, {
      recursive: true,
      force: true,
    });
    roots.splice(roots.indexOf(seed.root), 1);
    const fixture = await createWorkspaceFixture({
      split: "VALIDATION",
      missing: {
        caseId: qrel.caseId,
        groupId:
          qrel.requiredEvidenceGroups[0]!.groupId,
      },
    });
    const result = await runT45CapabilityOracleCli(
      [
        "--split",
        "validation",
        "--run-id",
        fixture.runId,
      ],
      fixture.root,
    );
    const serialized = await readFile(
      fixture.paths.oracle,
      "utf8",
    );

    expect(result.report).toEqual({
      split: "VALIDATION",
      candidateOracle: {
        casesCovered: 19,
        casesTotal: 20,
        groupsCovered: 29,
        groupsTotal: 30,
        coveragePassed: false,
        structuralGates: {
          baselineAvailableCases: 20,
          protectedAnchorCases: 20,
          baselineSingleCountCases: 20,
          casesTotal: 20,
          passed: true,
        },
        passed: false,
      },
      decision: "VALIDATION_CANDIDATE_NO_GO",
    });
    expect(() =>
      assertT45CandidateOracleReadyForSelection(
        result.report,
      )).toThrow(
        "T45_VALIDATION_CANDIDATE_NO_GO_SELECTION_FORBIDDEN",
      );
    expect(serialized).not.toMatch(
      /caseId|familyId|groupId|node-[0-9a-f]/i,
    );
  });

  it.each([
    ["planner", "T45_CAPABILITY_ORACLE_PLANNER_BYTES_DRIFT"],
    ["provider", "T45_CAPABILITY_ORACLE_PROVIDER_BYTES_DRIFT"],
    ["candidate", "T45_CAPABILITY_ORACLE_CANDIDATE_BYTES_DRIFT"],
    ["matrix", "T45_CAPABILITY_ORACLE_MATRIX_BYTES_DRIFT"],
    ["selection", "T45_CAPABILITY_ORACLE_SELECTION_BYTES_DRIFT"],
  ] as const)(
    "rejects %s raw bytes changed after the Task2 boundary seal",
    async (artifact, code) => {
      const fixture = await createWorkspaceFixture();
      await writeFile(
        fixture.paths[artifact],
        `${
          await readFile(
            fixture.paths[artifact],
            "utf8",
          )
        } `,
        "utf8",
      );

      await expect(
        runT45CapabilityOracleCli(
          [
            "--split",
            "calibration",
            "--run-id",
            fixture.runId,
          ],
          fixture.root,
        ),
      ).rejects.toThrow(code);
    },
  );

  it("rejects inventory bytes drift before trusting its declared hash", async () => {
    const fixture = await createWorkspaceFixture();
    await writeFile(
      fixture.paths.inventory,
      `${
        await readFile(
          fixture.paths.inventory,
          "utf8",
        )
      } `,
      "utf8",
    );

    await expect(
      runT45CapabilityOracleCli(
        [
          "--split",
          "calibration",
          "--run-id",
          fixture.runId,
        ],
        fixture.root,
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_ORACLE_INVENTORY_BYTES_SHA_DRIFT",
    );
  });

  it("rejects a re-signed inventory against the external inventory hash", async () => {
    const fixture = await createWorkspaceFixture();
    const inventory = structuredClone(
      fixture.source.inventory,
    );
    inventory.objects[0]!.objectContentHash =
      "f".repeat(64);
    inventory.inventoryHash = "0".repeat(64);
    inventory.inventoryHash =
      t45CapabilityInventoryHash(inventory);
    await writeCanonical(
      fixture.paths.inventory,
      inventory,
    );
    const frozenBindings = mutableFrozenBindings();
    frozenBindings.inventoryBytesSha256 =
      await bytesSha256(fixture.paths.inventory);

    await expect(
      runT45CapabilityOracleCli(
        [
          "--split",
          "calibration",
          "--run-id",
          fixture.runId,
        ],
        fixture.root,
        { frozenBindings },
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_ORACLE_FROZEN_INVENTORY_HASH_DRIFT",
    );
  });

  it("rejects a re-signed runtime suite against the external suite hash", async () => {
    const fixture = await createWorkspaceFixture();
    const runtime = structuredClone(
      fixture.source.runtime,
    );
    runtime.cases[0]!.question += " changed";
    runtime.suiteHash = "0".repeat(64);
    runtime.suiteHash =
      t45CapabilityRuntimeSuiteHash(runtime);
    await writeCanonical(fixture.paths.runtime, runtime);
    const frozenBindings = mutableFrozenBindings();
    frozenBindings.runtimeBytesSha256.CALIBRATION =
      await bytesSha256(fixture.paths.runtime);

    await expect(
      runT45CapabilityOracleCli(
        [
          "--split",
          "calibration",
          "--run-id",
          fixture.runId,
        ],
        fixture.root,
        { frozenBindings },
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_ORACLE_FROZEN_RUNTIME_SUITE_HASH_DRIFT",
    );
  });

  it("rejects qrels whose declared suite hash no longer matches their content", async () => {
    const fixture = await createWorkspaceFixture();
    const qrels = structuredClone(
      fixture.source.qrels,
    );
    qrels.suiteHash = "f".repeat(64);
    await writeCanonical(fixture.paths.qrels, qrels);
    const frozenBindings = mutableFrozenBindings();
    frozenBindings.qrelsBytesSha256.CALIBRATION =
      await bytesSha256(fixture.paths.qrels);

    await expect(
      runT45CapabilityOracleCli(
        [
          "--split",
          "calibration",
          "--run-id",
          fixture.runId,
        ],
        fixture.root,
        { frozenBindings },
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_ORACLE_QRELS_SUITE_HASH_DRIFT",
    );
  });

  it("rejects re-signed qrels against the external qrels suite hash", async () => {
    const fixture = await createWorkspaceFixture();
    const qrels = structuredClone(
      fixture.source.qrels,
    );
    const left = qrels.cases[0]!;
    const right = qrels.cases[2]!;
    const family = left.familyId;
    left.familyId = right.familyId;
    right.familyId = family;
    qrels.suiteHash = "0".repeat(64);
    qrels.suiteHash =
      t45CapabilityQrelsSuiteHash(qrels);
    await writeCanonical(fixture.paths.qrels, qrels);
    const frozenBindings = mutableFrozenBindings();
    frozenBindings.qrelsBytesSha256.CALIBRATION =
      await bytesSha256(fixture.paths.qrels);

    await expect(
      runT45CapabilityOracleCli(
        [
          "--split",
          "calibration",
          "--run-id",
          fixture.runId,
        ],
        fixture.root,
        { frozenBindings },
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_ORACLE_FROZEN_QRELS_SUITE_HASH_DRIFT",
    );
  });

  it.each([
    [
      "candidateArtifactSha256",
      "T45_CAPABILITY_ORACLE_SELECTION_CANDIDATE_SHA_DRIFT",
    ],
    [
      "matrixOutputSha256",
      "T45_CAPABILITY_ORACLE_SELECTION_MATRIX_SHA_DRIFT",
    ],
  ] as const)(
    "rejects selection internal %s drift even after the selection bytes are re-sealed",
    async (field, code) => {
      const fixture = await createWorkspaceFixture();
      const selection = structuredClone(
        fixture.selection,
      );
      selection[field] = "f".repeat(64);
      await resealBoundaryArtifact(
        fixture,
        "selection",
        selection,
      );

      await expect(
        runT45CapabilityOracleCli(
          [
            "--split",
            "calibration",
            "--run-id",
            fixture.runId,
          ],
          fixture.root,
        ),
      ).rejects.toThrow(code);
    },
  );

  it("rejects a re-sealed selection with a different baseline-protected selector config hash", async () => {
    const fixture = await createWorkspaceFixture();
    const selection = structuredClone(
      fixture.selection,
    );
    selection.selectorConfigHash = "f".repeat(64);
    await resealBoundaryArtifact(
      fixture,
      "selection",
      selection,
    );

    await expect(
      runT45CapabilityOracleCli(
        [
          "--split",
          "calibration",
          "--run-id",
          fixture.runId,
        ],
        fixture.root,
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_ORACLE_SELECTOR_CONFIG_HASH_DRIFT",
    );
  });

  it("rejects planner caseId order drift after a valid byte re-seal", async () => {
    const fixture = await createWorkspaceFixture();
    const planner = structuredClone(
      fixture.plannerValue,
    );
    [
      planner.cases[0],
      planner.cases[1],
    ] = [
      planner.cases[1]!,
      planner.cases[0]!,
    ];
    await resealBoundaryArtifact(
      fixture,
      "planner",
      planner,
    );

    await expect(
      runT45CapabilityOracleCli(
        [
          "--split",
          "calibration",
          "--run-id",
          fixture.runId,
        ],
        fixture.root,
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_ORACLE_PLANNER_CASE_ORDER_DRIFT",
    );
  });

  it("rejects selection coursePackId order drift after a valid byte re-seal", async () => {
    const fixture = await createWorkspaceFixture();
    const selection = structuredClone(
      fixture.selection,
    );
    selection.cases[0]!.coursePackId =
      selection.cases[0]!.coursePackId
        === "book-design"
        ? "layout-design"
        : "book-design";
    await resealBoundaryArtifact(
      fixture,
      "selection",
      selection,
    );

    await expect(
      runT45CapabilityOracleCli(
        [
          "--split",
          "calibration",
          "--run-id",
          fixture.runId,
        ],
        fixture.root,
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_ORACLE_SELECTION_COURSE_ORDER_DRIFT",
    );
  });

  it("rejects qrels familyId order drift even when the changed qrels are externally admitted", async () => {
    const fixture = await createWorkspaceFixture();
    const qrels = structuredClone(
      fixture.source.qrels,
    );
    const left = qrels.cases[0]!;
    const right = qrels.cases[2]!;
    const family = left.familyId;
    left.familyId = right.familyId;
    right.familyId = family;
    qrels.suiteHash = "0".repeat(64);
    qrels.suiteHash =
      t45CapabilityQrelsSuiteHash(qrels);
    await writeCanonical(fixture.paths.qrels, qrels);
    const frozenBindings = mutableFrozenBindings();
    frozenBindings.qrelsBytesSha256.CALIBRATION =
      await bytesSha256(fixture.paths.qrels);
    frozenBindings.qrelsSuiteHashes.CALIBRATION =
      qrels.suiteHash;

    await expect(
      runT45CapabilityOracleCli(
        [
          "--split",
          "calibration",
          "--run-id",
          fixture.runId,
        ],
        fixture.root,
        { frozenBindings },
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_ORACLE_QRELS_FAMILY_ORDER_DRIFT",
    );
  });

  it("uses wx checkpoints and only resumes identical oracle bytes", async () => {
    const fixture = await createWorkspaceFixture();
    const args = [
      "--split",
      "calibration",
      "--run-id",
      fixture.runId,
    ];
    const first = await runT45CapabilityOracleCli(
      args,
      fixture.root,
    );
    const resumed =
      await runT45CapabilityOracleCli(
        args,
        fixture.root,
      );
    expect(resumed.seal.sha256)
      .toBe(first.seal.sha256);
    expect(resumed.gateSeal.sha256)
      .toBe(first.gateSeal.sha256);

    await writeFile(
      fixture.paths.oracleGate,
      "{}\n",
      "utf8",
    );
    await expect(
      runT45CapabilityOracleCli(
        args,
        fixture.root,
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_ORACLE_GATE_CHECKPOINT_DRIFT",
    );
  });
});
