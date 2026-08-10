// @vitest-environment node

import { readFileSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
  unlink,
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
  buildT45ResolvedModelRuntimeV1,
  loadT45ReviewerSourceBundleV1,
  parseT45MultiAnchorReviewerArguments,
  runT45MultiAnchorReviewerCli,
  runT45ReviewerModelBatchV1,
  T45LegacyValidationReportV1Schema,
  type T45ReviewerSourceBundleV1,
} from "@/scripts/run-t45-multi-anchor-reviewer-v1";
import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import type {
  ModelProviderAdapter,
} from "@/lib/agent/model-provider-adapter";
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
  buildT44ContentRerankerPromptV1,
  mapT44ContentRerankerModelOutputV1,
  T44ContentRerankerSelectionCaseV1Schema,
  type T44ContentRerankerPromptV1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1,
  sealT45CandidateOracleGateV1,
} from "@/tools/mixed-retrieval/t45-candidate-oracle-gate-v1";
import {
  createT45LegacyDefaultFixture,
} from "@/tests/unit/scripts/t45-legacy-default-fixture";
import {
  sealT45AuditReceiptV1,
} from "@/tools/mixed-retrieval/t45-audit-receipt-v1";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const roots: string[] = [];
const MODEL = {
  source: "service-env" as const,
  modelId: "GPT-5.6 Luna",
  endpointHash: HASH,
  configHash: HASH,
};

function localTypeScriptImportGraph(
  entry: string,
) {
  const root = process.cwd();
  const seen = new Set<string>();
  const visit = (file: string) => {
    const absolute = path.resolve(file);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    const source = readFileSync(absolute, "utf8");
    const imports = source.matchAll(
      /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    );
    for (const match of imports) {
      const specifier = match[1]!;
      const base = specifier.startsWith("@/")
        ? path.resolve(root, specifier.slice(2))
        : specifier.startsWith(".")
          ? path.resolve(
              path.dirname(absolute),
              specifier,
            )
          : null;
      if (!base) continue;
      const candidates = [
        base,
        `${base}.ts`,
        path.join(base, "index.ts"),
      ];
      const target = candidates.find((candidate) => {
        try {
          return readFileSync(candidate).length >= 0;
        } catch {
          return false;
        }
      });
      if (target?.endsWith(".ts")) visit(target);
    }
  };
  visit(path.resolve(root, entry));
  return [...seen];
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "t45-reviewer-"),
  );
  roots.push(root);
  return root;
}

function sourceFixture(
  count: 20 | 50,
  split:
    | "CALIBRATION"
    | "VALIDATION"
    | "LEGACY_REGRESSION",
): T45ReviewerSourceBundleV1 {
  const promptRows = Array.from(
    { length: count },
    (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      const caseId = split === "LEGACY_REGRESSION"
        ? `t44-support-case-${number}`
        : `t45-capability-${split.toLowerCase()}-case-${number}`;
      const coursePackId = "layout-design";
      const candidates = [1, 2].map((candidateIndex) => ({
        nodeId:
          `node-${number}-${candidateIndex}`,
        objectId:
          `object-${number}-${candidateIndex}`,
        coursePackId,
        objectRank: candidateIndex,
        kind: "TEXT" as const,
        role: candidateIndex === 1
          ? "FACT" as const
          : "ACTION" as const,
        text: `第 ${number} 题证据 ${candidateIndex}`,
        nodeContentHash: HASH,
        objectContentHash: HASH,
        sourceHash: HASH,
      }));
      const prompt = buildT44ContentRerankerPromptV1({
        caseId,
        coursePackId,
        question: `第 ${number} 个学生问题`,
        obligations: [{
          obligationId: "obligation-1",
          learnerNeed: "给出诊断和修改动作。",
          intent: "DIAGNOSE_AND_FIX",
        }],
        bCandidateNodes: candidates,
        aCandidateNodes: candidates,
        aBaselineSelectedNodeIds: [
          candidates[0]!.nodeId,
        ],
        wholeQueryRanking: candidates.map(
          ({ nodeId }, rank) => ({
            nodeId,
            rank: rank + 1,
          }),
        ),
        obligationRankings: [{
          obligationId: "obligation-1",
          ranking: candidates.map(
            ({ nodeId }, rank) => ({
              nodeId,
              rank: rank + 1,
            }),
          ),
        }],
      });
      const arm = {
        directEvidenceBatchHash: HASH,
        rrfResultHash: HASH,
        objectRanking: candidates.map(
          ({ objectId }, rank) => ({
            objectId,
            fusedRank: rank + 1,
            fusionScore: 1 / (rank + 1),
            bestRawRank: rank + 1,
            obligationIds: ["obligation-1"],
            origins: ["LEXICAL" as const],
          }),
        ),
        candidateNodes: candidates,
        candidateNodeIdsSha256:
          sha256StableJsonV2(
            candidates.map(({ nodeId }) => nodeId),
          ),
      };
      return {
        caseId,
        coursePackId,
        candidates,
        prompt,
        candidateCase: {
          caseId,
          coursePackId,
          coursePackVersion: "1",
          normalizedQuestionHash: HASH,
          obligationSetHash: HASH,
          retrievalPlanHash: HASH,
          arms: {
            A_WHOLE_QUERY: arm,
            B_MODEL_GUIDED: arm,
          },
        },
      };
    },
  );
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_CANDIDATES",
      runtimeSuite: {
        id: "runtime-suite",
        version: "1",
        suiteHash: HASH,
      },
      corpusSnapshot: { bundleHash: HASH },
      config:
        T44_OBLIGATION_CANDIDATE_CONFIG_V1,
      configHash:
        T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
      graphifyInvocationCount: 0,
      providerAudit: {
        expectedCalls: 0,
        actualCalls: 0,
        channelCounts: {
          LEXICAL: 0,
          TEXT_VECTOR: 0,
          VISUAL_VECTOR: 0,
        },
        matched: true,
      },
      cases: promptRows.map(
        ({ candidateCase }) => candidateCase,
      ),
    });
  const baselineSelection =
    T44ObligationSelectionArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_SELECTIONS",
      candidateArtifactSha256: HASH,
      matrixOutputSha256: HASH,
      selectorConfigId:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2.id,
      selectorConfigVersion:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2
          .version,
      selectorConfigHash:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
      graphifyInvocationCount: 0,
      cases: promptRows.map((row) => {
        const selected = {
          nodeId: row.candidates[0]!.nodeId,
          objectId: row.candidates[0]!.objectId,
          coursePackId: row.coursePackId,
          selectionSource:
            "WHOLE_QUERY_BASELINE" as const,
          obligationId: null,
          aggregateRrfScore: 1 / 61,
        };
        return {
          caseId: row.caseId,
          coursePackId: row.coursePackId,
          candidateNodeIdsSha256:
            sha256StableJsonV2({
              A_WHOLE_QUERY:
                candidate.cases[indexOf(row, promptRows)]!
                  .arms.A_WHOLE_QUERY
                  .candidateNodeIdsSha256,
              B_MODEL_GUIDED:
                candidate.cases[indexOf(row, promptRows)]!
                  .arms.B_MODEL_GUIDED
                  .candidateNodeIdsSha256,
            }),
          arms: {
            A_WHOLE_QUERY: { selected: [selected] },
            B_MODEL_GUIDED: { selected: [selected] },
          },
        };
      }),
    });
  const gate = split === "LEGACY_REGRESSION"
    ? null
    : sealT45CandidateOracleGateV1({
        schemaVersion: 1,
        kind:
          "T45_CAPABILITY_CANDIDATE_ORACLE_GATE",
        split,
        runId: split === "CALIBRATION"
          ? "calibration-v1"
          : "validation-v1",
        runtimeSuite: {
          id: "runtime-suite",
          version: "1",
          suiteHash: HASH,
        },
        inventoryHash: HASH,
        corpusBundleHash: HASH,
        inputs: {
          boundarySha256: HASH,
          plannerSha256: HASH,
          candidateSha256: HASH,
          matrixSha256: HASH,
          baselineSelectionSha256: HASH,
          oracleReportSha256: HASH,
        },
        selectorConfigHash:
          T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
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
        decision: split === "CALIBRATION"
          ? "CALIBRATION_CANDIDATE_READY"
          : "VALIDATION_CANDIDATE_READY",
        evaluatorConfigHash:
          T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1,
      });
  return {
    runtimeSuite: {
      id: "runtime-suite",
      version: "1",
      suiteHash: HASH,
      split,
    },
    inventoryHash: HASH,
    corpusBundleHash: HASH,
    inputs: {
      boundarySha256: HASH,
      plannerSha256: HASH,
      candidateSha256: HASH,
      matrixSha256: HASH,
      baselineSelectionSha256: HASH,
      oracleGateSha256:
        split === "LEGACY_REGRESSION"
          ? null
          : HASH,
    },
    prompts: promptRows.map(({ prompt }) => prompt),
    candidate,
    baselineSelection,
    gate,
  };
}

function indexOf<T>(value: T, rows: readonly T[]) {
  return rows.indexOf(value);
}

function modelCase(
  prompt: T44ContentRerankerPromptV1,
) {
  const mapped = mapT44ContentRerankerModelOutputV1({
    prompt,
    rawOutput: JSON.stringify({
      selections: Array.from(
        { length: prompt.selectionBudget },
        (_, index) => ({
          candidateIndex: index + 1,
          obligationIds: ["obligation-1"],
          evidenceRole: "DIRECT",
        }),
      ),
    }),
  });
  return T44ContentRerankerSelectionCaseV1Schema
    .parse({
      caseId: prompt.caseId,
      coursePackId: prompt.coursePackId,
      candidateMapHash: prompt.candidateMapHash,
      promptHash: prompt.promptHash,
      status: "VALID",
      failureCategory: null,
      selected: mapped.selected,
      audit: {
        elapsedMs: 10,
        rawOutputHash: mapped.rawOutputHash,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      },
    });
}

function invalidModelCase(
  prompt: T44ContentRerankerPromptV1,
) {
  return T44ContentRerankerSelectionCaseV1Schema
    .parse({
      caseId: prompt.caseId,
      coursePackId: prompt.coursePackId,
      candidateMapHash: prompt.candidateMapHash,
      promptHash: prompt.promptHash,
      status: "INVALID",
      failureCategory: "MODEL_OUTPUT_INVALID",
      selected: [],
      audit: {
        elapsedMs: 10,
        rawOutputHash: null,
        usage: {
          inputTokens: 10,
          outputTokens: 0,
          totalTokens: 10,
        },
      },
    });
}

function dependencies(
  source: T45ReviewerSourceBundleV1,
  runModelBatch = vi.fn(
    async (
      input: {
        prompts:
          readonly T44ContentRerankerPromptV1[];
      },
    ) => input.prompts.map(modelCase),
  ),
) {
  return {
    captureSourceClosure: () => ({
      sourceFiles: [
        { path: "sealed-source.ts", sha256: HASH },
      ],
      sourceClosureHash: HASH,
    }),
    loadSource: async () => source,
    resolveModel: async () => ({
      provenance: MODEL,
      provider: {} as never,
    }),
    createProvider: () =>
      ({} as ModelProviderAdapter),
    runModelBatch,
    verifyFreeze: async () => ({
      model: MODEL,
    } as never),
  };
}

describe("T45 multi-anchor reviewer CLI", () => {
  it("locks calibration, validation and legacy identities", () => {
    expect(
      parseT45MultiAnchorReviewerArguments([
        "--split", "calibration",
        "--run-id", "calibration-v2",
        "--artifact-id", "calibration-v2",
      ]),
    ).toEqual({
      split: "CALIBRATION",
      runId: "calibration-v2",
      artifactId: "calibration-v2",
    });
    expect(
      parseT45MultiAnchorReviewerArguments([
        "--split", "validation",
        "--run-id", "validation-v1",
        "--artifact-id", "validation-v1",
      ]),
    ).toMatchObject({ split: "VALIDATION" });
    expect(
      parseT45MultiAnchorReviewerArguments([
        "--split", "legacy-regression",
        "--run-id", "legacy-v2",
        "--artifact-id", "legacy-regression-v1",
      ]),
    ).toMatchObject({
      split: "LEGACY_REGRESSION",
    });
    for (const args of [
      [
        "--split", "validation",
        "--run-id", "validation-v2",
        "--artifact-id", "validation-v2",
      ],
      [
        "--split", "calibration",
        "--run-id", "calibration-v2",
        "--artifact-id", "calibration-v3",
      ],
      [
        "--split", "legacy-regression",
        "--run-id", "legacy-v3",
        "--artifact-id", "legacy-regression-v1",
      ],
    ]) {
      expect(() =>
        parseT45MultiAnchorReviewerArguments(args),
      ).toThrow(/T45_MULTI_ANCHOR_CLI_IDENTITY_/);
    }
  });

  it("keeps the recursive runner source graph label-blind", () => {
    const source = readFileSync(
      path.resolve(
        "scripts/run-t45-multi-anchor-reviewer-v1.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /capability-evaluator|capability-authoring|capability-loader|qrels/i,
    );
    expect(source).toContain(
      "t45-candidate-oracle-gate-v1",
    );
    expect(source).toContain(
      "t44-obligation-legacy-v2",
    );
    expect(source).toContain(
      ".baseline-protected-v2.selection.json",
    );
    const graph = localTypeScriptImportGraph(
      "scripts/run-t45-multi-anchor-reviewer-v1.ts",
    );
    expect(graph.length).toBeGreaterThan(10);
    expect(
      graph.map((file) =>
        path.relative(process.cwd(), file)),
    ).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /qrels|capability-evaluator|capability-authoring|capability-loader/i,
        ),
      ]),
    );
  });

  it("blocks a candidate NO-GO before service env or either model stage", async () => {
    const resolveModel = vi.fn();
    const runModelBatch = vi.fn();
    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v1",
          "--artifact-id", "calibration-v1",
        ],
        "offline-root",
        {
          captureSourceClosure: () => ({
            sourceFiles: [{
              path: "sealed-source.ts",
              sha256: HASH,
            }],
            sourceClosureHash: HASH,
          }),
          loadSource: async () => ({
            gate: {
              split: "CALIBRATION",
              candidateOracle: { passed: false },
            },
          } as never),
          resolveModel,
          runModelBatch,
        },
      ),
    ).rejects.toThrow(
      "T45_CALIBRATION_CANDIDATE_NO_GO_SELECTION_FORBIDDEN",
    );
    expect(resolveModel).not.toHaveBeenCalled();
    expect(runModelBatch).not.toHaveBeenCalled();
  });

  it("rejects an empty protected baseline before service env or the paid draft stage", async () => {
    const source = sourceFixture(
      20,
      "CALIBRATION",
    );
    const first = source.baselineSelection.cases[0]!;
    const baselineSelection =
      T44ObligationSelectionArtifactV1Schema.parse({
        ...source.baselineSelection,
        cases: source.baselineSelection.cases.map(
          (testCase, index) =>
            index === 0
              ? {
                  ...first,
                  arms: {
                    ...first.arms,
                    B_MODEL_GUIDED: {
                      selected: [],
                    },
                  },
                }
              : testCase,
        ),
      });
    const resolveModel = vi.fn();
    const runModelBatch = vi.fn();

    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v1",
          "--artifact-id", "calibration-v1",
        ],
        "offline-root",
        {
          ...dependencies({
            ...source,
            baselineSelection,
          }),
          resolveModel,
          runModelBatch,
        },
      ),
    ).rejects.toThrow(
      "T45_MULTI_ANCHOR_PROTECTED_COUNT_INVALID",
    );
    expect(resolveModel).not.toHaveBeenCalled();
    expect(runModelBatch).not.toHaveBeenCalled();
  });

  it("assembles 20 T45 cases, seals draft/final, and resumes final without either model call", async () => {
    const root = await tempRoot();
    const source = sourceFixture(
      20,
      "CALIBRATION",
    );
    const firstBatch = vi.fn(
      async (input: {
        prompts:
          readonly T44ContentRerankerPromptV1[];
      }) => input.prompts.map(modelCase),
    );
    const first = await runT45MultiAnchorReviewerCli(
      [
        "--split", "calibration",
        "--run-id", "calibration-v1",
        "--artifact-id", "calibration-v1",
      ],
      root,
      dependencies(source, firstBatch),
    );
    expect(first.resumed).toBe("NONE");
    expect(first.artifact.cases).toHaveLength(20);
    expect(firstBatch).toHaveBeenCalledTimes(2);
    const draftPath = path.join(
      root,
      ".runtime/mixed-retrieval",
      "t45-capability-calibration-v1.content-draft-calibration-v1.selection.json",
    );
    expect(
      JSON.parse(await readFile(draftPath, "utf8")),
    ).toMatchObject({
      summary: { total: 20, valid: 20 },
    });

    const resumedBatch = vi.fn();
    const createProvider = vi.fn();
    const resumed =
      await runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v1",
          "--artifact-id", "calibration-v1",
        ],
        root,
        {
          ...dependencies(
            source,
            resumedBatch,
          ),
          createProvider,
        },
      );
    expect(resumed.resumed).toBe("FINAL");
    expect(resumed.output.sha256)
      .toBe(first.output.sha256);
    expect(resumedBatch).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();

    const forged = JSON.parse(
      await readFile(first.output.path, "utf8"),
    ) as {
      cases: Array<{
        selected: Array<{ nodeId: string }>;
      }>;
    };
    forged.cases[0]!.selected[0]!.nodeId =
      "outside-node";
    await writeFile(
      first.output.path,
      `${JSON.stringify(forged, null, 2)}\n`,
      "utf8",
    );
    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v1",
          "--artifact-id", "calibration-v1",
        ],
        root,
        dependencies(source, vi.fn()),
      ),
    ).rejects.toThrow(
      "T45_FINAL_ARTIFACT_SELECTED_OUTSIDE_PROMPT",
    );

    const ledgerRoot = await tempRoot();
    const ledgerRun =
      await runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v1",
          "--artifact-id", "calibration-v1",
        ],
        ledgerRoot,
        dependencies(source),
      );
    const forgedLedger = JSON.parse(
      await readFile(
        ledgerRun.output.path,
        "utf8",
      ),
    ) as {
      cases: Array<{
        completion: {
          modelAdded: string[];
          deterministicAdded: string[];
        };
      }>;
    };
    const relabelled =
      forgedLedger.cases[0]!
        .completion.modelAdded.shift();
    expect(relabelled).toBeTruthy();
    forgedLedger.cases[0]!
      .completion.deterministicAdded.push(
        relabelled!,
      );
    await writeFile(
      ledgerRun.output.path,
      `${JSON.stringify(
        forgedLedger,
        null,
        2,
      )}\n`,
      "utf8",
    );
    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v1",
          "--artifact-id", "calibration-v1",
        ],
        ledgerRoot,
        dependencies(source, vi.fn()),
      ),
    ).rejects.toThrow(
      "T45_FINAL_ARTIFACT_COMPLETION_LEDGER_DRIFT",
    );

    const obligationLedgerRoot =
      await tempRoot();
    const obligationLedgerRun =
      await runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v1",
          "--artifact-id", "calibration-v1",
        ],
        obligationLedgerRoot,
        dependencies(source),
      );
    const forgedObligationLedger = JSON.parse(
      await readFile(
        obligationLedgerRun.output.path,
        "utf8",
      ),
    ) as {
      cases: Array<{
        completion: {
          modelSelectionLedger: Array<{
            obligationIds: string[];
          }>;
        };
      }>;
    };
    forgedObligationLedger.cases[0]!
      .completion.modelSelectionLedger[0]!
      .obligationIds = [
        "obligation-forged",
      ];
    await writeFile(
      obligationLedgerRun.output.path,
      `${JSON.stringify(
        forgedObligationLedger,
        null,
        2,
      )}\n`,
      "utf8",
    );
    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v1",
          "--artifact-id", "calibration-v1",
        ],
        obligationLedgerRoot,
        dependencies(source, vi.fn()),
      ),
    ).rejects.toThrow(
      "T45_FINAL_ARTIFACT_OBLIGATION_LEDGER_DRIFT",
    );
  });

  it("allows only one concurrent owner to enter each model stage", async () => {
    const root = await tempRoot();
    const source = sourceFixture(
      20,
      "CALIBRATION",
    );
    let releaseFirst!: () => void;
    const firstMayContinue = new Promise<void>(
      (resolve) => {
        releaseFirst = resolve;
      },
    );
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    let calls = 0;
    const batch = vi.fn(
      async (input: {
        prompts:
          readonly T44ContentRerankerPromptV1[];
      }) => {
        calls += 1;
        if (calls === 1) {
          markEntered();
          await firstMayContinue;
        }
        return input.prompts.map(modelCase);
      },
    );
    const args = [
      "--split", "calibration",
      "--run-id", "calibration-v9",
      "--artifact-id", "calibration-v9",
    ];
    const first =
      runT45MultiAnchorReviewerCli(
        args,
        root,
        dependencies(source, batch),
      );
    await entered;
    await expect(
      runT45MultiAnchorReviewerCli(
        args,
        root,
        dependencies(source, batch),
      ),
    ).rejects.toThrow(
      "T45_STAGE_RESERVATION_HELD:draft:calibration-v9",
    );
    releaseFirst();
    await first;
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it("resumes an existing draft without rerunning draft and rejects model/config drift before reviewer", async () => {
    const root = await tempRoot();
    const source = sourceFixture(
      20,
      "CALIBRATION",
    );
    let calls = 0;
    const stopAfterDraft = vi.fn(
      async (input: {
        prompts:
          readonly T44ContentRerankerPromptV1[];
      }) => {
        calls += 1;
        if (calls === 2) {
          throw new Error("OFFLINE_STOP");
        }
        return input.prompts.map(modelCase);
      },
    );
    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v2",
          "--artifact-id", "calibration-v2",
        ],
        root,
        dependencies(source, stopAfterDraft),
      ),
    ).rejects.toThrow("OFFLINE_STOP");
    expect(stopAfterDraft).toHaveBeenCalledTimes(2);

    const reviewerOnly = vi.fn(
      async (input: {
        prompts:
          readonly T44ContentRerankerPromptV1[];
      }) => input.prompts.map(modelCase),
    );
    const resumed =
      await runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v2",
          "--artifact-id", "calibration-v2",
        ],
        root,
        dependencies(source, reviewerOnly),
      );
    expect(resumed.resumed).toBe("DRAFT");
    expect(reviewerOnly).toHaveBeenCalledTimes(1);

    const driftRoot = await tempRoot();
    calls = 0;
    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v3",
          "--artifact-id", "calibration-v3",
        ],
        driftRoot,
        dependencies(source, stopAfterDraft),
      ),
    ).rejects.toThrow("OFFLINE_STOP");
    const draftPath = path.join(
      driftRoot,
      ".runtime/mixed-retrieval",
      "t45-capability-calibration-v3.content-draft-calibration-v3.selection.json",
    );
    const raw = JSON.parse(
      await readFile(draftPath, "utf8"),
    ) as Record<string, unknown>;
    raw.configHash = OTHER_HASH;
    await writeFile(
      draftPath,
      `${JSON.stringify(raw, null, 2)}\n`,
      "utf8",
    );
    const neverRun = vi.fn();
    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v3",
          "--artifact-id", "calibration-v3",
        ],
        driftRoot,
        dependencies(source, neverRun),
      ),
    ).rejects.toThrow();
    expect(neverRun).not.toHaveBeenCalled();

    const modelDriftRoot = await tempRoot();
    calls = 0;
    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v4",
          "--artifact-id", "calibration-v4",
        ],
        modelDriftRoot,
        dependencies(source, stopAfterDraft),
      ),
    ).rejects.toThrow("OFFLINE_STOP");
    const inputBatch = vi.fn();
    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v4",
          "--artifact-id", "calibration-v4",
        ],
        modelDriftRoot,
        dependencies({
          ...source,
          inputs: {
            ...source.inputs,
            candidateSha256: OTHER_HASH,
          },
        }, inputBatch),
      ),
    ).rejects.toThrow(
      "T45_MULTI_ANCHOR_CHECKPOINT_BINDING_DRIFT",
    );
    expect(inputBatch).not.toHaveBeenCalled();

    const modelBatch = vi.fn();
    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v4",
          "--artifact-id", "calibration-v4",
        ],
        modelDriftRoot,
        {
          ...dependencies(source, modelBatch),
          resolveModel: async () => ({
            provenance: {
              ...MODEL,
              configHash: OTHER_HASH,
            },
            provider: {} as never,
          }),
        },
      ),
    ).rejects.toThrow(
      "T45_MULTI_ANCHOR_CHECKPOINT_BINDING_DRIFT",
    );
    expect(modelBatch).not.toHaveBeenCalled();
  });

  it("runs the 50-case legacy V2 source port and verifies validation freeze before env", async () => {
    const legacyRoot = await tempRoot();
    const legacySource = sourceFixture(
      50,
      "LEGACY_REGRESSION",
    );
    expect(
      legacySource.baselineSelection
        .selectorConfigVersion,
    ).toBe(
      T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2
        .version,
    );
    const legacyBatch = vi.fn(
      async (input: {
        prompts:
          readonly T44ContentRerankerPromptV1[];
      }) => input.prompts.map(modelCase),
    );
    const legacy =
      await runT45MultiAnchorReviewerCli(
        [
          "--split", "legacy-regression",
          "--run-id", "legacy-v2",
          "--artifact-id", "legacy-regression-v1",
        ],
        legacyRoot,
        dependencies(legacySource, legacyBatch),
      );
    expect(legacy.artifact.cases).toHaveLength(50);
    expect(legacyBatch).toHaveBeenCalledTimes(2);

    const validationSource = sourceFixture(
      20,
      "VALIDATION",
    );
    const resolveModel = vi.fn();
    const verifyFreeze = vi.fn(async () => {
      throw new Error("FREEZE_DRIFT");
    });
    await expect(
      runT45MultiAnchorReviewerCli(
        [
          "--split", "validation",
          "--run-id", "validation-v1",
          "--artifact-id", "validation-v1",
        ],
        await tempRoot(),
        {
          ...dependencies(validationSource),
          verifyFreeze,
          resolveModel,
        },
      ),
    ).rejects.toThrow("FREEZE_DRIFT");
    expect(verifyFreeze).toHaveBeenCalledTimes(1);
    expect(resolveModel).not.toHaveBeenCalled();
  });

  it("reviews only VALID drafts and projects INVALID drafts without fallback", async () => {
    const root = await tempRoot();
    const source = sourceFixture(
      20,
      "CALIBRATION",
    );
    let stage = 0;
    const batch = vi.fn(
      async (input: {
        prompts:
          readonly T44ContentRerankerPromptV1[];
      }) => {
        stage += 1;
        return input.prompts.map(
          (prompt, index) =>
            stage === 1 && index === 0
              ? invalidModelCase(prompt)
              : modelCase(prompt),
        );
      },
    );
    const result =
      await runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v5",
          "--artifact-id", "calibration-v5",
        ],
        root,
        dependencies(source, batch),
      );
    expect(batch).toHaveBeenCalledTimes(2);
    expect(
      batch.mock.calls[1]![0].prompts,
    ).toHaveLength(19);
    expect(result.artifact.cases[0])
      .toMatchObject({
        status: "INVALID",
        selected: [],
        stageAudit: {
          reviewer: {
            elapsedMs: 0,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
          },
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
      });
  });

  it("preserves a second-stage INVALID review for the scorer instead of rejecting the final artifact", async () => {
    const root = await tempRoot();
    const source = sourceFixture(
      20,
      "CALIBRATION",
    );
    let stage = 0;
    const batch = vi.fn(
      async (input: {
        prompts:
          readonly T44ContentRerankerPromptV1[];
      }) => {
        stage += 1;
        return input.prompts.map(
          (prompt, index) =>
            stage === 2 && index === 0
              ? invalidModelCase(prompt)
              : modelCase(prompt),
        );
      },
    );

    const result =
      await runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v6",
          "--artifact-id", "calibration-v6",
        ],
        root,
        dependencies(source, batch),
      );

    expect(batch).toHaveBeenCalledTimes(2);
    expect(result.artifact.summary)
      .toEqual({ total: 20, valid: 19, invalid: 1 });
    expect(result.artifact.cases[0])
      .toMatchObject({
        status: "INVALID",
        failureCategory: "MODEL_OUTPUT_INVALID",
        selected: [],
        stageAudit: {
          reviewer: {
            elapsedMs: 10,
            usage: {
              inputTokens: 10,
              outputTokens: 0,
              totalTokens: 10,
            },
          },
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
      });
  });

  it("skips the reviewer for all-INVALID draft and preserves that checkpoint on resume", async () => {
    const root = await tempRoot();
    const source = sourceFixture(
      20,
      "CALIBRATION",
    );
    const batch = vi.fn(
      async (input: {
        prompts:
          readonly T44ContentRerankerPromptV1[];
      }) => input.prompts.map(invalidModelCase),
    );
    const result =
      await runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v6",
          "--artifact-id", "calibration-v6",
        ],
        root,
        dependencies(source, batch),
      );
    expect(batch).toHaveBeenCalledTimes(1);
    expect(result.artifact.summary)
      .toEqual({ total: 20, valid: 0, invalid: 20 });
    expect(
      result.artifact.cases.every(
        ({ selected, stageAudit }) =>
          selected.length === 0
          && stageAudit.reviewer.elapsedMs === 0
          && stageAudit.reviewer.usage.totalTokens === 0,
      ),
    ).toBe(true);

    const resumedBatch = vi.fn();
    const resumed =
      await runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v6",
          "--artifact-id", "calibration-v6",
        ],
        root,
        dependencies(source, resumedBatch),
      );
    expect(resumed.resumed).toBe("FINAL");
    expect(resumedBatch).not.toHaveBeenCalled();

    await unlink(path.join(
      root,
      ".runtime/mixed-retrieval",
      "t45-capability-calibration-v6.multi-anchor-calibration-v6.selection.json",
    ));
    const draftResumeBatch = vi.fn();
    const createProvider = vi.fn();
    const draftResumed =
      await runT45MultiAnchorReviewerCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v6",
          "--artifact-id", "calibration-v6",
        ],
        root,
        {
          ...dependencies(
            source,
            draftResumeBatch,
          ),
          createProvider,
        },
      );
    expect(draftResumed.resumed).toBe("DRAFT");
    expect(draftResumeBatch).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("fails closed when an existing final loses or drifts from its actual draft checkpoint", async () => {
    const args = [
      "--split", "calibration",
      "--run-id", "calibration-v7",
      "--artifact-id", "calibration-v7",
    ];
    const source = sourceFixture(
      20,
      "CALIBRATION",
    );
    const missingRoot = await tempRoot();
    await runT45MultiAnchorReviewerCli(
      args,
      missingRoot,
      dependencies(source),
    );
    const draftName =
      "t45-capability-calibration-v7.content-draft-calibration-v7.selection.json";
    await unlink(path.join(
      missingRoot,
      ".runtime/mixed-retrieval",
      draftName,
    ));
    const missingBatch = vi.fn();
    await expect(
      runT45MultiAnchorReviewerCli(
        args,
        missingRoot,
        dependencies(source, missingBatch),
      ),
    ).rejects.toThrow(
      "T45_MULTI_ANCHOR_DRAFT_MISSING_FOR_FINAL",
    );
    expect(missingBatch).not.toHaveBeenCalled();

    const driftRoot = await tempRoot();
    await runT45MultiAnchorReviewerCli(
      args,
      driftRoot,
      dependencies(source),
    );
    const draftPath = path.join(
      driftRoot,
      ".runtime/mixed-retrieval",
      draftName,
    );
    const draft = JSON.parse(
      await readFile(draftPath, "utf8"),
    ) as {
      inputs: { candidateSha256: string };
    };
    draft.inputs.candidateSha256 = OTHER_HASH;
    await writeFile(
      draftPath,
      `${JSON.stringify(draft, null, 2)}\n`,
      "utf8",
    );
    const driftBatch = vi.fn();
    await expect(
      runT45MultiAnchorReviewerCli(
        args,
        driftRoot,
        dependencies(source, driftBatch),
      ),
    ).rejects.toThrow(
      "T45_MULTI_ANCHOR_FINAL_DRAFT_SHA_DRIFT",
    );
    expect(driftBatch).not.toHaveBeenCalled();
  });

  it("uses effectiveVision=false for both provenance hash and provider even when planner vision is true", () => {
    const base = {
      source: "service-env" as const,
      modelId: "GPT-5.6 Luna",
      baseUrl: "https://example.test/v1",
      apiKey: "offline-secret",
      providerSelection: "planner",
      maxOutputTokens: 1234,
    };
    const configuredTrue =
      buildT45ResolvedModelRuntimeV1({
        ...base,
        configuredVision: true,
      });
    const configuredFalse =
      buildT45ResolvedModelRuntimeV1({
        ...base,
        configuredVision: false,
      });
    expect(configuredTrue.provider.vision).toBe(false);
    expect(configuredTrue.provenance.configHash)
      .toBe(
        configuredFalse.provenance.configHash,
      );
    const anotherCredential =
      buildT45ResolvedModelRuntimeV1({
        ...base,
        apiKey: "another-offline-secret",
        configuredVision: false,
      });
    expect(
      anotherCredential.provenance.configHash,
    ).not.toBe(
      configuredFalse.provenance.configHash,
    );
    expect(
      JSON.stringify(configuredFalse.provenance),
    ).not.toContain(base.apiKey);
    expect(
      JSON.stringify(configuredFalse.provenance),
    ).not.toContain("credentialSlotHash");
    expect(configuredFalse.provider).toMatchObject({
      totalTimeoutMs: 600_000,
      idleTimeoutMs: 599_000,
    });
  });

  it("lets the T45 Luna reviewer finish up to the library ceiling while leaving latency to the scorer", async () => {
    const prompt = sourceFixture(
      20,
      "CALIBRATION",
    ).prompts[0]!;
    let seenOptions: unknown;
    const model: ModelProviderAdapter = {
      provider: "TEST",
      capabilities: { vision: false },
      complete: async (_messages, options) => {
        seenOptions = options;
        return JSON.stringify({
          selections: Array.from(
            { length: prompt.selectionBudget },
            (_, index) => ({
              candidateIndex: index + 1,
              obligationIds: ["obligation-1"],
              evidenceRole: "DIRECT",
            }),
          ),
        });
      },
    };

    const result = await runT45ReviewerModelBatchV1({
      prompts: [prompt],
      model,
    });

    expect(result[0]?.status).toBe("VALID");
    expect(seenOptions).toMatchObject({
      totalTimeoutMs: 600_000,
      reasoningEffort: "none",
    });
  });

  it("accepts both sealed validation selector outcomes for legacy prerequisite and binds current freeze", () => {
    const base = {
      schemaVersion: 1,
      kind: "T45_MULTI_ANCHOR_AUDIT",
      split: "VALIDATION",
      runId: "validation-v1",
      artifactId: "validation-v1",
      inputs: {
        selectionSha256: HASH,
        draftSelectionSha256: HASH,
        oracleGateSha256: HASH,
        freezeHash: HASH,
        source: {
          boundarySha256: HASH,
          plannerSha256: HASH,
          candidateSha256: HASH,
          matrixSha256: HASH,
          baselineSelectionSha256: HASH,
          oracleGateSha256: HASH,
        },
      },
    };
    for (const decision of [
      "VALIDATION_GO",
      "VALIDATION_SELECTOR_NO_GO",
    ] as const) {
      expect(
        T45LegacyValidationReportV1Schema
          .parse({ ...base, decision })
          .inputs.freezeHash,
      ).toBe(HASH);
    }
  });

  it("loads the real fixed legacy source after a sealed validation selector NO-GO and still blocks candidate NO-GO", async () => {
    const root = await tempRoot();
    const fixture =
      await createT45LegacyDefaultFixture(root);
    const parsed =
      parseT45MultiAnchorReviewerArguments([
        "--split", "legacy-regression",
        "--run-id", "legacy-v2",
        "--artifact-id", "legacy-regression-v1",
      ]);
    const source =
      await loadT45ReviewerSourceBundleV1(
        parsed,
        root,
        fixture.freeze as never,
        {
          loadValidationSource: async () =>
            fixture.validationSource as never,
          captureSourceClosure:
            fixture.captureSourceClosure,
        },
      );
    expect(source.runtimeSuite).toMatchObject({
      split: "LEGACY_REGRESSION",
    });
    expect(source.prompts).toHaveLength(50);
    expect(source.inputs.oracleGateSha256)
      .toBeNull();

    const noGoGate =
      sealT45CandidateOracleGateV1({
        ...fixture.gateInput,
        candidateOracle: {
          ...fixture.gateInput.candidateOracle,
          casesCovered: 19,
          coveragePassed: false,
          passed: false,
        },
        decision:
          "VALIDATION_CANDIDATE_NO_GO",
      });
    await writeFile(
      fixture.gatePath,
      `${JSON.stringify(noGoGate, null, 2)}\n`,
      "utf8",
    );
    await expect(
      loadT45ReviewerSourceBundleV1(
        parsed,
        root,
        fixture.freeze as never,
        {
          loadValidationSource: async () =>
            ({
              ...fixture.validationSource,
              gate: noGoGate,
            }) as never,
          captureSourceClosure:
            fixture.captureSourceClosure,
        },
      ),
    ).rejects.toThrow(
      "T45_VALIDATION_CANDIDATE_NO_GO_SELECTION_FORBIDDEN",
    );
  });

  it("rebuilds the label-blind validation prerequisite and rejects an out-of-pool final before reading its legacy receipt", async () => {
    const root = await tempRoot();
    const fixture =
      await createT45LegacyDefaultFixture(root);
    const validationSource = sourceFixture(
      20,
      "VALIDATION",
    );
    const artifactRoot = path.join(
      root,
      ".runtime/mixed-retrieval",
    );
    const draftPath = path.join(
      artifactRoot,
      "t45-capability-validation-v1.content-draft-validation-v1.selection.json",
    );
    const finalPath = path.join(
      artifactRoot,
      "t45-capability-validation-v1.multi-anchor-validation-v1.selection.json",
    );
    await Promise.all([
      unlink(draftPath),
      unlink(finalPath),
    ]);
    await runT45MultiAnchorReviewerCli(
      [
        "--split", "validation",
        "--run-id", "validation-v1",
        "--artifact-id", "validation-v1",
      ],
      root,
      dependencies(validationSource),
    );
    const final = JSON.parse(
      await readFile(finalPath, "utf8"),
    ) as {
      cases: Array<{
        selected: Array<{ nodeId: string }>;
      }>;
    };
    final.cases[0]!.selected[0]!.nodeId =
      "qrel-only-node";
    await writeFile(
      finalPath,
      `${JSON.stringify(final, null, 2)}\n`,
      "utf8",
    );
    await Promise.all([
      unlink(path.join(
        artifactRoot,
        "t45-capability-validation-v1.multi-anchor-validation-v1.report.json",
      )),
      unlink(path.join(
        artifactRoot,
        "t45-capability-validation-v1.multi-anchor-validation-v1.receipt.json",
      )),
    ]);
    const parsed =
      parseT45MultiAnchorReviewerArguments([
        "--split", "legacy-regression",
        "--run-id", "legacy-v2",
        "--artifact-id", "legacy-regression-v1",
      ]);
    await expect(
      loadT45ReviewerSourceBundleV1(
        parsed,
        root,
        fixture.freeze as never,
        {
          loadValidationSource: async () =>
            validationSource,
          captureSourceClosure:
            fixture.captureSourceClosure,
        },
      ),
    ).rejects.toThrow(
      "T45_FINAL_ARTIFACT_SELECTED_OUTSIDE_PROMPT",
    );
  });

  it("rejects validation models that agree with each other but drift from the freeze before reading validation report or receipt", async () => {
    const root = await tempRoot();
    const fixture =
      await createT45LegacyDefaultFixture(root);
    const artifactRoot = fixture.artifactRoot;
    await Promise.all([
      unlink(path.join(
        artifactRoot,
        "t45-capability-validation-v1.multi-anchor-validation-v1.report.json",
      )),
      unlink(path.join(
        artifactRoot,
        "t45-capability-validation-v1.multi-anchor-validation-v1.receipt.json",
      )),
    ]);
    const parsed =
      parseT45MultiAnchorReviewerArguments([
        "--split", "legacy-regression",
        "--run-id", "legacy-v2",
        "--artifact-id", "legacy-regression-v1",
      ]);
    await expect(
      loadT45ReviewerSourceBundleV1(
        parsed,
        root,
        {
          ...fixture.freeze,
          model: {
            ...fixture.model,
            configHash: OTHER_HASH,
          },
        } as never,
        {
          loadValidationSource: async () =>
            fixture.validationSource as never,
          captureSourceClosure:
            fixture.captureSourceClosure,
        },
      ),
    ).rejects.toThrow(
      "T45_MULTI_ANCHOR_LEGACY_VALIDATION_MODEL_FREEZE_DRIFT",
    );
  });

  it.each([
    "FINAL",
    "DRAFT",
    "CURRENT",
  ] as const)(
    "rejects %s validation source-closure drift before reading validation report or receipt",
    async (target) => {
      const root = await tempRoot();
      const fixture =
        await createT45LegacyDefaultFixture(root);
      const artifactRoot = fixture.artifactRoot;
      if (target !== "CURRENT") {
        const artifactPath = path.join(
          artifactRoot,
          target === "FINAL"
            ? "t45-capability-validation-v1.multi-anchor-validation-v1.selection.json"
            : "t45-capability-validation-v1.content-draft-validation-v1.selection.json",
        );
        const artifact = JSON.parse(
          await readFile(artifactPath, "utf8"),
        ) as { sourceClosureHash: string };
        artifact.sourceClosureHash = OTHER_HASH;
        await writeFile(
          artifactPath,
          `${JSON.stringify(
            artifact,
            null,
            2,
          )}\n`,
          "utf8",
        );
      }
      await Promise.all([
        unlink(path.join(
          artifactRoot,
          "t45-capability-validation-v1.multi-anchor-validation-v1.report.json",
        )),
        unlink(path.join(
          artifactRoot,
          "t45-capability-validation-v1.multi-anchor-validation-v1.receipt.json",
        )),
      ]);
      const parsed =
        parseT45MultiAnchorReviewerArguments([
          "--split", "legacy-regression",
          "--run-id", "legacy-v2",
          "--artifact-id", "legacy-regression-v1",
        ]);
      await expect(
        loadT45ReviewerSourceBundleV1(
          parsed,
          root,
          fixture.freeze as never,
          {
            loadValidationSource: async () =>
              fixture.validationSource as never,
            captureSourceClosure:
              target === "CURRENT"
                ? () => ({
                    sourceFiles: [],
                    sourceClosureHash:
                      OTHER_HASH,
                  })
                : fixture.captureSourceClosure,
          },
        ),
      ).rejects.toThrow(
        "T45_MULTI_ANCHOR_LEGACY_VALIDATION_SOURCE_CLOSURE_FREEZE_DRIFT",
      );
    },
  );

  it("rejects validation receipt source-closure drift before opening the old legacy qrels", async () => {
    const root = await tempRoot();
    const fixture =
      await createT45LegacyDefaultFixture(root);
    const receiptPath = path.join(
      fixture.artifactRoot,
      "t45-capability-validation-v1.multi-anchor-validation-v1.receipt.json",
    );
    const receipt = JSON.parse(
      await readFile(receiptPath, "utf8"),
    ) as {
      receiptHash?: string;
      sourceClosureHash: string;
      [key: string]: unknown;
    };
    delete receipt.receiptHash;
    receipt.sourceClosureHash = OTHER_HASH;
    await writeFile(
      receiptPath,
      `${JSON.stringify(
        sealT45AuditReceiptV1(
          receipt as never,
        ),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await unlink(fixture.qrelsPath);
    const parsed =
      parseT45MultiAnchorReviewerArguments([
        "--split", "legacy-regression",
        "--run-id", "legacy-v2",
        "--artifact-id", "legacy-regression-v1",
      ]);
    await expect(
      loadT45ReviewerSourceBundleV1(
        parsed,
        root,
        fixture.freeze as never,
        {
          loadValidationSource: async () =>
            fixture.validationSource as never,
          captureSourceClosure:
            fixture.captureSourceClosure,
        },
      ),
    ).rejects.toThrow(
      "T45_MULTI_ANCHOR_LEGACY_VALIDATION_RECEIPT_SOURCE_CLOSURE_FREEZE_DRIFT",
    );
  });
});
