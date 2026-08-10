// @vitest-environment node

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  buildT45SelectorFreezeV1,
  parseT45SelectorFreezeArguments,
  runT45SelectorFreezeCli,
  T45_SELECTOR_SOURCE_FILES_V1,
} from "@/scripts/freeze-t45-selector-v1";
import {
  T45SelectorFreezeV1Schema,
  verifyT45SelectorFreezeV1,
} from "@/scripts/run-t45-multi-anchor-reviewer-v1";
import {
  T44_CONTENT_RERANKER_CONFIG_HASH_V1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T45_CAPABILITY_DENOMINATORS_V1,
  T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1,
} from "@/tools/mixed-retrieval/t45-capability-evaluator";
import {
  T45_BASELINE_SELECTOR_CONFIG_HASH_LOCK_V2,
  T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1,
  sealT45CandidateOracleGateV1,
} from "@/tools/mixed-retrieval/t45-candidate-oracle-gate-v1";
import {
  T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
} from "@/tools/mixed-retrieval/t45-multi-anchor-reviewer-v1";
import {
  sealT45AuditReceiptV1,
} from "@/tools/mixed-retrieval/t45-audit-receipt-v1";
import {
  captureT45SelectorSourceClosureV1,
  collectT45SelectorSourceFilesV1,
  T45_SELECTOR_EXECUTION_ROOTS_V1,
} from "@/tools/mixed-retrieval/t45-selector-source-closure-v1";

const H = "a".repeat(64);
const H2 = "b".repeat(64);
const roots: string[] = [];
const sourceFiles = [
  { path: "a.ts", sha256: H },
  { path: "z.ts", sha256: H },
];
const SOURCE_CLOSURE_HASH =
  sha256StableJsonV2(sourceFiles);
const validateFinalArtifacts =
  async () => undefined;
const assertReportMatchesSelection =
  () => undefined as never;

function calibrationEvaluation(
  passed: boolean,
) {
  const minimum = (
    observed: number,
    required: number,
  ) => ({
    observed,
    required,
    passed: observed >= required,
  });
  const maximum = (
    observed: number,
    requiredMaximum: number,
  ) => ({
    observed,
    requiredMaximum,
    passed: observed <= requiredMaximum,
  });
  return {
    schemaVersion: 1,
    kind: "T45_CAPABILITY_SELECTION_REPORT",
    split: "CALIBRATION",
    configHash:
      T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1,
    denominators:
      T45_CAPABILITY_DENOMINATORS_V1,
    summary: {
      supportCases: passed ? 20 : 0,
      requiredGroupsCovered: passed ? 30 : 0,
      multiJointCoverage: passed ? 10 : 0,
      familiesWithBothCasesSupported:
        passed ? 10 : 0,
      hardNegativeNodes: 0,
      hardNegativeCases: 0,
      aBaselineHardNegativeNodes: 0,
      aBaselineHardNegativeCases: 0,
      validSelections: passed ? 20 : 0,
      bindingViolations: passed ? 0 : 1,
      reviewerP95Ms: passed ? 1 : 31_000,
    },
    gates: {
      supportCases:
        minimum(passed ? 20 : 0, 18),
      requiredGroupsCovered:
        minimum(passed ? 30 : 0, 28),
      multiJointCoverage:
        minimum(passed ? 10 : 0, 9),
      familiesWithBothCasesSupported:
        minimum(passed ? 10 : 0, 9),
      hardNegativeNodes:
        maximum(0, 0),
      hardNegativeCases:
        maximum(0, 0),
      validSelections:
        minimum(passed ? 20 : 0, 20),
      bindingViolations:
        maximum(passed ? 0 : 1, 0),
      reviewerP95Ms:
        maximum(passed ? 1 : 31_000, 30_000),
    },
    cases: Array.from(
      { length: 20 },
      (_, index) => {
        const selectedNodeIds = passed
          ? [`node-${index + 1}`]
          : [];
        return {
        caseId: `case-${index + 1}`,
        familyId:
          `family-${Math.floor(index / 2) + 1}`,
        multiClaim: index < 10,
        status: passed ? "VALID" : "INVALID",
        selectedNodeIds,
        groups: Array.from(
          { length: index < 10 ? 2 : 1 },
          (_, groupIndex) => ({
            groupId:
              `group-${index + 1}-${groupIndex + 1}`,
            covered: passed,
            matchedNodeIds:
              passed ? selectedNodeIds : [],
          }),
        ),
        covered: passed,
        hardNegativeNodeIds: [],
        bindingViolations:
          !passed && index === 0
            ? ["binding-drift-1"]
            : [],
        };
      },
    ),
    families: Array.from(
      { length: 10 },
      (_, index) => ({
        familyId: `family-${index + 1}`,
        casesSupported: passed ? 2 : 0,
        casesTotal: 2,
        bothCasesSupported: passed,
      }),
    ),
    passed,
    decision: passed
      ? "CALIBRATION_GO"
      : "CALIBRATION_NO_GO",
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

function sha256(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

async function sourceClosureWorkspaceFixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "t45-source-closure-"),
  );
  roots.push(root);
  await Promise.all(
    T45_SELECTOR_SOURCE_FILES_V1.map(
      async (relative) => {
        const target = path.join(root, relative);
        await mkdir(path.dirname(target), {
          recursive: true,
        });
        await copyFile(
          path.join(process.cwd(), relative),
          target,
        );
      },
    ),
  );
  const sourceFiles = await Promise.all(
    T45_SELECTOR_SOURCE_FILES_V1.map(
      async (relative) => ({
        path: relative,
        sha256: sha256(
          await readFile(path.join(root, relative)),
        ),
      }),
    ),
  );
  const manifest = buildT45SelectorFreezeV1({
    calibration: {
      runId: "calibration-v1",
      artifactId: "calibration-v1",
      selectionSha256: H,
      draftSelectionSha256: H,
      reportSha256: H,
    },
    model: {
      source: "service-env",
      modelId: "GPT-5.6 Luna",
      endpointHash: H,
      configHash: H,
    },
    sourceFiles,
  });
  await writeCanonical(
    path.join(
      root,
      ".runtime/mixed-retrieval/t45-selector-freeze-v1.json",
    ),
    manifest,
  );
  return root;
}

async function writeCanonical(
  target: string,
  value: unknown,
) {
  const serialized =
    `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(path.dirname(target), {
    recursive: true,
  });
  await writeFile(target, serialized, "utf8");
  return sha256(serialized);
}

async function workspaceFixture(input: {
  decision?: "CALIBRATION_GO" | "CALIBRATION_NO_GO";
  draftModelHash?: string;
} = {}) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "t45-freeze-"),
  );
  roots.push(root);
  const artifactRoot = path.join(
    root,
    ".runtime/mixed-retrieval",
  );
  const runtimeSuite = {
    id: "runtime-suite",
    version: "1",
    suiteHash: H,
    split: "CALIBRATION",
  };
  const model = {
    source: "service-env",
    modelId: "GPT-5.6 Luna",
    endpointHash: H,
    configHash: H,
  };
  const gate = sealT45CandidateOracleGateV1({
    schemaVersion: 1,
    kind:
      "T45_CAPABILITY_CANDIDATE_ORACLE_GATE",
    split: "CALIBRATION",
    runId: "calibration-v1",
    runtimeSuite: {
      id: runtimeSuite.id,
      version: runtimeSuite.version,
      suiteHash: runtimeSuite.suiteHash,
    },
    inventoryHash: H,
    corpusBundleHash: H,
    inputs: {
      boundarySha256: H,
      plannerSha256: H,
      candidateSha256: H,
      matrixSha256: H,
      baselineSelectionSha256: H,
      oracleReportSha256: H,
    },
    selectorConfigHash:
      T45_BASELINE_SELECTOR_CONFIG_HASH_LOCK_V2,
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
    decision: "CALIBRATION_CANDIDATE_READY",
    evaluatorConfigHash:
      T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1,
  });
  const gatePath = path.join(
    artifactRoot,
    "t45-capability-calibration-v1.oracle-gate.json",
  );
  const gateSha = await writeCanonical(
    gatePath,
    gate,
  );
  const inputs = {
    boundarySha256: H,
    plannerSha256: H,
    candidateSha256: H,
    matrixSha256: H,
    baselineSelectionSha256: H,
    oracleGateSha256: gateSha,
  };
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  const draft = {
    schemaVersion: 1,
    kind: "T45_CONTENT_DRAFT_SELECTIONS",
    runId: "calibration-v1",
    artifactId: "calibration-v1",
    runtimeSuite,
    inventoryHash: H,
    sourceClosureHash: SOURCE_CLOSURE_HASH,
    inputs,
    configHash:
      T44_CONTENT_RERANKER_CONFIG_HASH_V1,
    model: {
      ...model,
      configHash:
        input.draftModelHash ?? model.configHash,
    },
    cases: [{
      caseId: "case-1",
      coursePackId: "layout-design",
      candidateMapHash: H,
      promptHash: H,
      status: "INVALID",
      failureCategory: "OFFLINE",
      selected: [],
      audit: {
        elapsedMs: 0,
        rawOutputHash: null,
        usage,
      },
    }],
    summary: { total: 1, valid: 0, invalid: 1 },
    generatedAt: "2026-07-29T00:00:00.000Z",
  };
  const draftPath = path.join(
    artifactRoot,
    "t45-capability-calibration-v1.content-draft-calibration-v1.selection.json",
  );
  const draftSha = await writeCanonical(
    draftPath,
    draft,
  );
  const selection = {
    schemaVersion: 1,
    kind: "T45_MULTI_ANCHOR_SELECTIONS",
    runId: "calibration-v1",
    artifactId: "calibration-v1",
    runtimeSuite,
    inventoryHash: H,
    sourceClosureHash: SOURCE_CLOSURE_HASH,
    inputs: {
      ...inputs,
      draftSelectionSha256: draftSha,
    },
    configHash:
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
    model,
    cases: [{
      ...draft.cases[0],
      stageAudit: {
        draft: { elapsedMs: 0, usage },
        reviewer: { elapsedMs: 0, usage },
        endToEnd: { elapsedMs: 0, usage },
      },
      completion: {
        modelSelectionLedger: [],
        obligationAnchors: [],
        protectedKept: [],
        modelSelectedBaselineKept: [],
        baselineRejected: [],
        modelAdded: [],
        deterministicAdded: [],
        unprotectedDropped: [],
      },
      bindingViolations: [],
    }],
    summary: draft.summary,
    generatedAt: draft.generatedAt,
  };
  const selectionPath = path.join(
    artifactRoot,
    "t45-capability-calibration-v1.multi-anchor-calibration-v1.selection.json",
  );
  const selectionSha = await writeCanonical(
    selectionPath,
    selection,
  );
  const report = {
    schemaVersion: 1,
    kind: "T45_MULTI_ANCHOR_AUDIT",
    split: "CALIBRATION",
    runId: "calibration-v1",
    artifactId: "calibration-v1",
    decision:
      input.decision ?? "CALIBRATION_GO",
    inputs: {
      selectionSha256: selectionSha,
      draftSelectionSha256: draftSha,
      oracleGateSha256: gateSha,
      freezeHash: null,
      source: inputs,
    },
    sourceClosureHash: SOURCE_CLOSURE_HASH,
    evaluation: calibrationEvaluation(
      (input.decision ?? "CALIBRATION_GO")
        === "CALIBRATION_GO",
    ),
    generatedAt: draft.generatedAt,
  };
  const reportPath = path.join(
    artifactRoot,
    "t45-capability-calibration-v1.multi-anchor-calibration-v1.report.json",
  );
  const reportSha = await writeCanonical(
    reportPath,
    report,
  );
  const passed =
    (input.decision ?? "CALIBRATION_GO")
      === "CALIBRATION_GO";
  await writeCanonical(
    path.join(
      artifactRoot,
      "t45-capability-calibration-v1.multi-anchor-calibration-v1.receipt.json",
    ),
    sealT45AuditReceiptV1({
      schemaVersion: 1,
      kind: "T45_AUDIT_RECEIPT",
      split: "CALIBRATION",
      runId: "calibration-v1",
      artifactId: "calibration-v1",
      decision:
        input.decision ?? "CALIBRATION_GO",
      inputs: report.inputs,
      reportSha256: reportSha,
      sourceClosureHash: SOURCE_CLOSURE_HASH,
      evaluatorConfigHash:
        T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1,
      aggregate: {
        kind: "CAPABILITY",
        cases: 20,
        requiredGroups: 30,
        multiCases: 10,
        families: 10,
        supportCases: passed ? 20 : 0,
        requiredGroupsCovered: passed ? 30 : 0,
        multiJointCoverage: passed ? 10 : 0,
        familiesWithBothCasesSupported:
          passed ? 10 : 0,
        hardNegativeNodes: 0,
        hardNegativeCases: 0,
        aBaselineHardNegativeNodes: 0,
        aBaselineHardNegativeCases: 0,
        validSelections: passed ? 20 : 0,
        bindingViolations: passed ? 0 : 1,
        reviewerP95Ms: passed ? 1 : 31_000,
      },
    }),
  );
  return root;
}

async function verifyExisting(root: string) {
  return T45SelectorFreezeV1Schema.parse(
    JSON.parse(
      await readFile(
        path.join(
          root,
          ".runtime/mixed-retrieval/t45-selector-freeze-v1.json",
        ),
        "utf8",
      ),
    ) as unknown,
  );
}

describe("T45 selector freeze CLI", () => {
  it("accepts only one calibration identity", () => {
    expect(
      parseT45SelectorFreezeArguments([
        "--run-id", "calibration-v3",
        "--artifact-id", "calibration-v3",
      ]),
    ).toEqual({
      runId: "calibration-v3",
      artifactId: "calibration-v3",
    });
    expect(() =>
      parseT45SelectorFreezeArguments([
        "--run-id", "validation-v1",
        "--artifact-id", "validation-v1",
      ]),
    ).toThrow("T45_SELECTOR_FREEZE_IDENTITY_LOCKED");
  });

  it("seals the exact calibration, model, sources and runtime config", () => {
    const manifest = buildT45SelectorFreezeV1({
      calibration: {
        runId: "calibration-v3",
        artifactId: "calibration-v3",
        selectionSha256: H,
        draftSelectionSha256: H,
        reportSha256: H,
      },
      model: {
        source: "service-env",
        modelId: "GPT-5.6 Luna",
        endpointHash: H,
        configHash: H,
      },
      sourceFiles: [
        { path: "z.ts", sha256: H },
        { path: "a.ts", sha256: H },
      ],
    });
    expect(
      manifest.sourceFiles.map(({ path }) => path),
    ).toEqual(["a.ts", "z.ts"]);
    expect(manifest.freezeHash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(manifest.runtimeConfig).toMatchObject({
      promptTemplateHash:
        expect.stringMatching(/^[0-9a-f]{64}$/),
      outputSchemaHash:
        expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(
      T45_SELECTOR_SOURCE_FILES_V1,
    ).toEqual(
      expect.arrayContaining([
        "scripts/evaluate-t45-capability-obligations-v1.ts",
        "scripts/audit-t45-capability-oracle-v1.ts",
        "tools/mixed-retrieval/t45-obligation-runtime-port.ts",
        "tools/mixed-retrieval/t45-capability-authoring.ts",
        "tools/mixed-retrieval/t45-capability-loader.ts",
        "tools/mixed-retrieval/t44-claim-matrix-contract-v1.ts",
        "scripts/check-runtime-tools.mjs",
        "tsconfig.json",
        "lib/ai/client.ts",
        "lib/ai/structured.ts",
        "lib/config/service-environment.ts",
        "tools/reranker/t44_claim_matrix.py",
      ]),
    );
  });

  it("recursively closes all six execution roots and detects drift in reviewer, client, and service environment", async () => {
    const collected =
      collectT45SelectorSourceFilesV1(
        process.cwd(),
      );
    const captured =
      captureT45SelectorSourceClosureV1(
        process.cwd(),
      );
    expect(T45_SELECTOR_EXECUTION_ROOTS_V1)
      .toHaveLength(6);
    expect(collected).toEqual(
      [...new Set(collected)].sort(
        (left, right) =>
          left.localeCompare(right, "en"),
      ),
    );
    expect(T45_SELECTOR_SOURCE_FILES_V1)
      .toEqual(collected);
    expect(captured.sourceFiles.map(
      ({ path: relative }) => relative,
    )).toEqual(collected);
    expect(captured.sourceClosureHash)
      .toMatch(/^[0-9a-f]{64}$/);
    expect(
      collected.some(
        (relative) =>
          relative.startsWith("tests/"),
      ),
    ).toBe(false);
    expect(collected).toEqual(
      expect.arrayContaining([
        "tools/mixed-retrieval/t45-selector-source-closure-v1.ts",
        "lib/ai/client.ts",
        "lib/ai/structured.ts",
        "lib/agent/latency-limits.ts",
        "lib/config/service-environment.ts",
      ]),
    );
    expect(collected).not.toContain(
      "tools/mixed-retrieval/t44-content-reviewer-v1.ts",
    );

    const root =
      await sourceClosureWorkspaceFixture();
    await expect(
      verifyT45SelectorFreezeV1(root),
    ).resolves.toMatchObject({
      freezeHash:
        expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    for (const relative of [
      "tools/mixed-retrieval/t45-multi-anchor-reviewer-v1.ts",
      "lib/ai/client.ts",
      "lib/config/service-environment.ts",
    ]) {
      const target = path.join(root, relative);
      const original = await readFile(target);
      await writeFile(
        target,
        Buffer.concat([
          original,
          Buffer.from("\n// drift\n", "utf8"),
        ]),
      );
      await expect(
        verifyT45SelectorFreezeV1(root),
      ).rejects.toThrow(
        `T45_MULTI_ANCHOR_FREEZE_SOURCE_DRIFT:${relative}`,
      );
      await writeFile(target, original);
    }

    const tsconfigPath = path.join(
      root,
      "tsconfig.json",
    );
    const tsconfig = await readFile(
      tsconfigPath,
      "utf8",
    );
    const driftedTsconfig = JSON.parse(tsconfig) as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    driftedTsconfig.compilerOptions.paths["@/*"] = ["./src/*"];
    await writeFile(
      tsconfigPath,
      `${JSON.stringify(driftedTsconfig, null, 2)}\n`,
      "utf8",
    );
    expect(() =>
      collectT45SelectorSourceFilesV1(root),
    ).toThrow(
      "T45_SELECTOR_TSCONFIG_ALIAS_DRIFT",
    );
    await writeFile(tsconfigPath, tsconfig, "utf8");

    const verifierPath = path.join(
      root,
      "scripts/check-runtime-tools.mjs",
    );
    await rm(verifierPath);
    await mkdir(verifierPath);
    expect(() =>
      collectT45SelectorSourceFilesV1(root),
    ).toThrow(
      "T45_SELECTOR_SOURCE_NOT_REGULAR:scripts/check-runtime-tools.mjs",
    );
  });

  it("freezes only CALIBRATION_GO and idempotently closes source, model and config bindings", async () => {
    const root = await workspaceFixture();
    const args = [
      "--run-id", "calibration-v1",
      "--artifact-id", "calibration-v1",
    ];
    const assertFreezeReportTruth =
      vi.fn(assertReportMatchesSelection);
    const first = await runT45SelectorFreezeCli(
      args,
      root,
      {
        validateFinalArtifacts,
        assertReportMatchesSelection:
          assertFreezeReportTruth,
        hashSourceFiles:
          async () => sourceFiles,
      },
    );
    expect(assertFreezeReportTruth)
      .toHaveBeenCalledOnce();
    expect(first.resumed).toBe(false);
    expect(first.manifest.sourceFiles)
      .toEqual(sourceFiles);
    expect(first.manifest.model.configHash).toBe(H);
    expect(first.manifest.runtimeConfig)
      .toMatchObject({
        draftConfigHash:
          T44_CONTENT_RERANKER_CONFIG_HASH_V1,
        reviewerConfigHash:
          T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
      });

    const resumed = await runT45SelectorFreezeCli(
      args,
      root,
      {
        validateFinalArtifacts,
        assertReportMatchesSelection,
        hashSourceFiles:
          async () => sourceFiles,
        verifyExisting,
      },
    );
    expect(resumed.resumed).toBe(true);
    expect(resumed.output.sha256)
      .toBe(first.output.sha256);

    const noGoRoot = await workspaceFixture({
      decision: "CALIBRATION_NO_GO",
    });
    await expect(
      runT45SelectorFreezeCli(args, noGoRoot, {
        validateFinalArtifacts,
        assertReportMatchesSelection,
        hashSourceFiles:
          async () => sourceFiles,
      }),
    ).rejects.toThrow(
      "T45_SELECTOR_FREEZE_CALIBRATION_BINDING_DRIFT",
    );

    const modelDriftRoot = await workspaceFixture({
      draftModelHash: H2,
    });
    await expect(
      runT45SelectorFreezeCli(
        args,
        modelDriftRoot,
        {
          validateFinalArtifacts,
          assertReportMatchesSelection,
          hashSourceFiles:
            async () => sourceFiles,
        },
      ),
    ).rejects.toThrow(
      "T45_SELECTOR_FREEZE_CALIBRATION_BINDING_DRIFT",
    );
  });
});
