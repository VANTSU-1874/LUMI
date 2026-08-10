// @vitest-environment node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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
} from "vitest";

import {
  loadLegacyKnowledgeCorpusV2,
} from "../../helpers/knowledge-v2-generation-fixtures";

import {
  assertT45CapabilityPipelineBindingsV1,
  formatT45ModelProvenanceNoticeV1,
  parseT45CapabilityObligationsArguments,
  runT45CapabilityObligationsCli,
  runT45SealedCapabilityPipelineV1,
} from "@/scripts/evaluate-t45-capability-obligations-v1";
import * as t45CapabilityObligationsModule
  from "@/scripts/evaluate-t45-capability-obligations-v1";
import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T44_CLAIM_MATRIX_CONFIG_HASH_V1,
  T44_CLAIM_MATRIX_CONFIG_V1,
  T44ClaimMatrixSidecarOutputV1Schema,
} from "@/tools/mixed-retrieval/t44-claim-coverage-evaluator";
import {
  T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
  T44_OBLIGATION_CANDIDATE_CONFIG_V1,
  T44ObligationCandidateArtifactV1Schema,
  T44ObligationMatrixBridgeManifestV1Schema,
  buildT44ObligationMatrixBridgeManifestV1,
  sealT44ObligationArtifactV1,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
} from "@/tools/mixed-retrieval/t44-obligation-coverage-evaluator";
import {
  loadT45RuntimePort,
  type T44LabelBlindArtifactsV1,
  type T45RuntimePort,
} from "@/tools/mixed-retrieval/t45-obligation-runtime-port";

const roots: string[] = [];
const HASHES = {
  suite: "a".repeat(64),
  inventory: "b".repeat(64),
  corpus: "c".repeat(64),
  candidate: "d".repeat(64),
  matrix: "e".repeat(64),
} as const;
const FROZEN_HASH = "a".repeat(64);

type BridgeInput = ReturnType<
  typeof T44ObligationMatrixBridgeManifestV1Schema.parse
>["arms"]["A_WHOLE_QUERY"]["input"];

type OfflineCliDependencies = {
  loadRuntimePort: (input: {
    workspaceRoot: string;
    split: "CALIBRATION" | "VALIDATION";
  }) => Promise<T45RuntimePort>;
  loadCorpus: (
    workspaceRoot: string,
  ) => Promise<KnowledgeCorpusBundleV2>;
  preparePlanner: (
    workspaceRoot: string,
  ) => Promise<{
    planner: {
      plan(input: unknown): Promise<never>;
    };
    modelProvenance: ReturnType<
      typeof formatT45ModelProvenanceNoticeV1
    >;
    providerSelection: string;
  }>;
  collectLabelBlindArtifacts: (input: {
    runtime: T45RuntimePort;
  }) => Promise<T44LabelBlindArtifactsV1>;
  executeMatrixArm: (input: {
    armName:
      | "A_WHOLE_QUERY"
      | "B_MODEL_GUIDED";
    candidateInput: BridgeInput;
    candidateInputSha256: string;
  }) => Promise<{
    output: unknown;
    stderr: string;
  }>;
};

type OfflineCliRunner = (
  argv: readonly string[],
  workspaceRoot: string,
  dependencies: OfflineCliDependencies,
) => ReturnType<
  typeof runT45CapabilityObligationsCli
>;

function sha256Utf8(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

async function actualCorpus() {
  return verifyKnowledgeCorpusBundleV2(
    loadLegacyKnowledgeCorpusV2(),
  );
}

function offlineCollectedArtifacts(
  runtime: T45RuntimePort,
): T44LabelBlindArtifactsV1 {
  const emptyArm = {
    directEvidenceBatchHash: null,
    rrfResultHash: null,
    objectRanking: [],
    candidateNodes: [],
    candidateNodeIdsSha256:
      sha256StableJsonV2([]),
  };
  const obligationSets = new Map();
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_CANDIDATES",
      runtimeSuite: {
        id: runtime.identity.id,
        version: runtime.identity.version,
        suiteHash: runtime.identity.suiteHash,
      },
      corpusSnapshot: {
        bundleHash:
          runtime.identity.corpusBundleHash,
      },
      config: T44_OBLIGATION_CANDIDATE_CONFIG_V1,
      configHash:
        T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
      graphifyInvocationCount: 0,
      providerAudit: {
        expectedCalls: runtime.cases.length * 2,
        actualCalls: runtime.cases.length * 2,
        channelCounts: {
          LEXICAL: runtime.cases.length,
          TEXT_VECTOR: runtime.cases.length,
          VISUAL_VECTOR: 0,
        },
        matched: true,
      },
      cases: runtime.cases.map((testCase) => {
        const questionHash =
          sha256Utf8(testCase.question);
        const obligationSet = {
          schemaVersion: 1 as const,
          plannerId:
            "lumi-answer-obligation-planner-v1" as const,
          plannerVersion: "1.0.0",
          modelId: "gpt-5.6-offline-test",
          normalizedQuestion: testCase.question,
          normalizedQuestionHash: questionHash,
          status: "READY" as const,
          obligations: [{
            obligationId: "obligation-1",
            learnerNeed: testCase.question,
            intent: "HOW_TO" as const,
            sourceAnchors: [{
              source: "CURRENT_MESSAGE" as const,
              sourceMessageHash: questionHash,
              quote: testCase.question,
              startCodePoint: 0,
              endCodePoint:
                Array.from(testCase.question).length,
            }],
            entityMentions: [],
            constraints: [],
            evidenceNeeds: ["DIRECT_TEXT" as const],
            retrievalQueries: [{
              text: testCase.question,
              purpose: "DIRECT" as const,
            }],
            confidence: 1,
          }],
          clarifyingQuestion: null,
          artworkObservationHints: [],
          trace: {
            promptHash: FROZEN_HASH,
            outputHash: FROZEN_HASH,
            elapsedMs: 1,
          },
        };
        obligationSets.set(
          testCase.caseId,
          obligationSet,
        );
        return {
          caseId: testCase.caseId,
          coursePackId: testCase.coursePackId,
          coursePackVersion:
            testCase.coursePackVersion,
          normalizedQuestionHash: questionHash,
          obligationSetHash:
            sha256StableJsonV2(obligationSet),
          retrievalPlanHash: FROZEN_HASH,
          arms: {
            A_WHOLE_QUERY: emptyArm,
            B_MODEL_GUIDED: emptyArm,
          },
        };
      }),
    });
  const matrixBridge =
    buildT44ObligationMatrixBridgeManifestV1({
      candidateArtifact: candidate,
      candidateArtifactSha256:
        sealT44ObligationArtifactV1(candidate).sha256,
      obligationSets,
    });
  const caseRecords = runtime.cases.map(
    ({ caseId }) => ({ caseId }),
  );
  return {
    planner: {
      schemaVersion: 1,
      kind: "T44_OBLIGATION_PLANNER_OUTPUTS",
      runtimeSuite: {
        id: runtime.identity.id,
        version: runtime.identity.version,
        suiteHash: runtime.identity.suiteHash,
      },
      graphifyInvocationCount: 0,
      cases: caseRecords,
    } as unknown as T44LabelBlindArtifactsV1["planner"],
    provider: {
      schemaVersion: 1,
      kind: "T44_OBLIGATION_PROVIDER_TRACES",
      runtimeSuite: {
        id: runtime.identity.id,
        version: runtime.identity.version,
        suiteHash: runtime.identity.suiteHash,
      },
      expectedCalls: runtime.cases.length * 2,
      actualCalls: runtime.cases.length * 2,
      channelCounts: {
        LEXICAL: runtime.cases.length,
        TEXT_VECTOR: runtime.cases.length,
        VISUAL_VECTOR: 0,
      },
      matched: true,
      graphifyInvocationCount: 0,
      cases: caseRecords,
    } as unknown as T44LabelBlindArtifactsV1["provider"],
    candidate,
    matrixBridge,
  };
}

function offlineMatrixOutput(
  candidateInput: BridgeInput,
  candidateInputSha256: string,
) {
  return T44ClaimMatrixSidecarOutputV1Schema.parse({
    schemaVersion: 1,
    kind: "T44_CLAIM_NODE_MATRIX_SCORES",
    candidateInputSha256,
    runtimeSuite: candidateInput.runtimeSuite,
    corpusBundleHash:
      candidateInput.corpusSnapshot.bundleHash,
    config: T44_CLAIM_MATRIX_CONFIG_V1,
    configHash: T44_CLAIM_MATRIX_CONFIG_HASH_V1,
    model: {
      modelId: "BAAI/bge-small-zh-v1.5",
      modelRevision:
        "7999e1d3359715c523056ef9478215996d62a620",
      modelLicense: "MIT",
      modelDirectorySha256: FROZEN_HASH,
      modelSealSha256: FROZEN_HASH,
      indexBundleHash: FROZEN_HASH,
      indexPayloadSha256: FROZEN_HASH,
    },
    environment: {
      pythonVersion: "3.12.0",
      torchVersion: "offline",
      transformersVersion: "offline",
      safetensorsVersion: "offline",
      actualDevice: "cpu",
      cudaRuntime: null,
      deviceName: null,
      tokenizerClassName: "OfflineTokenizer",
      modelClassName: "OfflineModel",
      modelDtype: "torch.float32",
    },
    timingProtocol: {
      warmupRunsPerModel: 1,
      repetitionsPerCase: 3,
      caseAggregate: "MEDIAN",
      suiteAggregate: "P95_NEAREST_RANK",
      aMatrixBoundary:
        T44_CLAIM_MATRIX_CONFIG_V1.aMatrixBoundary,
      bMatrixBoundary:
        T44_CLAIM_MATRIX_CONFIG_V1.bMatrixBoundary,
    },
    cases: candidateInput.cases.map(
      (testCase) => ({
        caseId: testCase.caseId,
        coursePackId: testCase.coursePackId,
        candidateCount:
          testCase.candidateNodes.length,
        candidateNodeIdsSha256:
          testCase.candidateNodeIdsSha256,
        arms: {
          A_FULL_QUERY: {
            timingMs: {
              samples: [1, 1, 1],
              median: 1,
            },
            wholeQueryRanking: [],
          },
          B_CLAIM_MATRIX: {
            timingMs: {
              samples: [1, 1, 1],
              median: 1,
            },
            wholeQueryRanking: [],
            claimRankings:
              testCase.decomposition.claims.map(
                (claim) => ({
                  claimId: claim.claimId,
                  textHash: claim.textHash,
                  ranking: [],
                }),
              ),
          },
        },
      }),
    ),
  });
}

async function offlineDependencies(
  overrides: Partial<OfflineCliDependencies> = {},
): Promise<OfflineCliDependencies> {
  const corpus = await actualCorpus();
  return {
    loadRuntimePort: ({ split }) =>
      loadT45RuntimePort({
        workspaceRoot: process.cwd(),
        split,
      }),
    loadCorpus: async () => corpus,
    preparePlanner: async () => ({
      planner: {
        plan: async () => {
          throw new Error(
            "OFFLINE_PLANNER_MUST_NOT_BE_CALLED",
          );
        },
      },
      modelProvenance:
        formatT45ModelProvenanceNoticeV1({
          modelId: "gpt-5.6-offline-test",
          endpointHash: FROZEN_HASH,
          configurationSource: "service-env",
        }),
      providerSelection: "offline-test",
    }),
    collectLabelBlindArtifacts: async ({ runtime }) =>
      offlineCollectedArtifacts(runtime),
    executeMatrixArm: async ({
      candidateInput,
      candidateInputSha256,
    }) => ({
      output: offlineMatrixOutput(
        candidateInput,
        candidateInputSha256,
      ),
      stderr: "",
    }),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

function caseIds() {
  return Array.from(
    { length: 20 },
    (_, index) => `t45-cal-case-${index + 1}`,
  );
}

function labelBlindArtifacts(ids = caseIds()) {
  const cases = ids.map((caseId) => ({ caseId }));
  return {
    planner: {
      kind: "T44_OBLIGATION_PLANNER_OUTPUTS",
      cases,
    },
    provider: {
      kind: "T44_OBLIGATION_PROVIDER_TRACES",
      cases,
    },
    candidate: {
      kind: "T44_OBLIGATION_CANDIDATES",
      cases,
    },
    matrixBridge: {
      kind: "T44_OBLIGATION_MATRIX_BRIDGES",
      arms: {
        A_WHOLE_QUERY: {
          input: { cases },
        },
        B_MODEL_GUIDED: {
          input: { cases },
        },
      },
    },
  };
}

describe("T4.5 capability obligation CLI", () => {
  it("exports one bounded Luna planner timeout contract for both client and call layers", () => {
    const moduleExports =
      t45CapabilityObligationsModule as unknown as
        Record<string, unknown>;

    expect(
      moduleExports
        .T45_CAPABILITY_PLANNER_TIMEOUTS_V1,
    ).toEqual({
      id: "t45-capability-planner-timeouts-v1",
      version: "1.0.0",
      idleTimeoutMs: 60_000,
      totalTimeoutMs: 110_000,
    });
  });

  it("requires the frozen split, lowercase run id and explicit device", () => {
    expect(parseT45CapabilityObligationsArguments([
      "--split",
      "calibration",
      "--run-id",
      "calibration-v1",
      "--device",
      "cuda",
    ])).toEqual({
      split: "CALIBRATION",
      runId: "calibration-v1",
      device: "cuda",
    });
    expect(parseT45CapabilityObligationsArguments([
      "--",
      "--split",
      "validation",
      "--run-id",
      "validation-v1",
      "--device",
      "cpu",
    ])).toEqual({
      split: "VALIDATION",
      runId: "validation-v1",
      device: "cpu",
    });
    expect(() =>
      parseT45CapabilityObligationsArguments([
        "--split",
        "validation",
        "--run-id",
        "validation-v2",
        "--device",
        "cpu",
      ]),
    ).toThrow(
      "T45_CAPABILITY_OBLIGATION_CLI_VALIDATION_RUN_ID_LOCKED",
    );
    for (const argv of [
      [
        "--split", "other",
        "--run-id", "run-v1",
        "--device", "cpu",
      ],
      [
        "--split", "calibration",
        "--run-id", "Run_1",
        "--device", "cpu",
      ],
      [
        "--split", "calibration",
        "--run-id", "run-v1",
      ],
    ]) {
      expect(() =>
        parseT45CapabilityObligationsArguments(argv),
      ).toThrow(/T45_CAPABILITY_OBLIGATION_CLI_/);
    }
  });

  it("seals every label-blind stage in order before emitting the unread-label boundary", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lumi-t45-order-"),
    );
    roots.push(root);
    const ids = caseIds();
    const events: string[] = [];
    const result =
      await runT45SealedCapabilityPipelineV1({
        artifactRoot: root,
        artifactStem: "t45-calibration-order-v1",
        expectedCaseIds: ids,
        collectLabelBlindArtifacts: async () => {
          events.push("collect");
          return labelBlindArtifacts(ids);
        },
        runMatrix: async ({
          matrixBridgePath,
          matrixBridgeSha256,
        }) => {
          events.push("matrix");
          expect(
            await readFile(matrixBridgePath, "utf8"),
          ).toContain("T44_OBLIGATION_MATRIX_BRIDGES");
          return {
            kind: "T44_OBLIGATION_NODE_MATRICES",
            matrixBridgeManifestSha256:
              matrixBridgeSha256,
            arms: {
              A_WHOLE_QUERY: {
                output: {
                  cases: ids.map(
                    (caseId) => ({ caseId }),
                  ),
                },
              },
              B_MODEL_GUIDED: {
                output: {
                  cases: ids.map(
                    (caseId) => ({ caseId }),
                  ),
                },
              },
            },
          };
        },
        buildSelection: async ({
          candidatePath,
          candidateSha256,
          matrixPath,
          matrixSha256,
        }) => {
          events.push("selection");
          expect(
            await readFile(candidatePath, "utf8"),
          ).toContain("T44_OBLIGATION_CANDIDATES");
          expect(
            await readFile(matrixPath, "utf8"),
          ).toContain("T44_OBLIGATION_NODE_MATRICES");
          return {
            kind: "T44_OBLIGATION_SELECTIONS",
            candidateArtifactSha256:
              candidateSha256,
            matrixOutputSha256: matrixSha256,
            cases: ids.map(
              (caseId) => ({ caseId }),
            ),
          };
        },
        finalizeUnreadBoundary: async ({ sealed }) => {
          events.push("labels-unread");
          for (const artifact of Object.values(sealed)) {
            expect(
              await readFile(artifact.path, "utf8"),
            ).toBeTruthy();
          }
          return {
            schemaVersion: 1,
            kind:
              "T45_CAPABILITY_LABELS_REMAIN_UNREAD",
            operationBoundary:
              "SELECTION_SEALED_LABELS_UNREAD",
          };
        },
      });

    expect(events).toEqual([
      "collect",
      "matrix",
      "selection",
      "labels-unread",
    ]);
    expect(result.boundary).toMatchObject({
      kind: "T45_CAPABILITY_LABELS_REMAIN_UNREAD",
    });
    expect(result.sealed.selection.sha256)
      .toMatch(/^[0-9a-f]{64}$/);

    await expect(
      runT45SealedCapabilityPipelineV1({
        artifactRoot: root,
        artifactStem: "t45-calibration-order-v1",
        expectedCaseIds: ids,
        collectLabelBlindArtifacts: async () =>
          labelBlindArtifacts(ids),
        runMatrix: async () => ({}),
        buildSelection: async () => ({}),
        finalizeUnreadBoundary: async () => ({}),
      }),
    ).rejects.toThrow(
      /T45_CAPABILITY_OBLIGATION_ARTIFACT_ALREADY_EXISTS/,
    );
  });

  it("fails closed when any artifact changes case order", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lumi-t45-order-drift-"),
    );
    roots.push(root);
    const ids = caseIds();
    await expect(
      runT45SealedCapabilityPipelineV1({
        artifactRoot: root,
        artifactStem: "t45-calibration-order-drift",
        expectedCaseIds: ids,
        collectLabelBlindArtifacts: async () =>
          labelBlindArtifacts(ids),
        runMatrix: async () => ({
          kind: "T44_OBLIGATION_NODE_MATRICES",
          arms: {
            A_WHOLE_QUERY: {
              output: {
                cases: [...ids].reverse().map(
                  (caseId) => ({ caseId }),
                ),
              },
            },
            B_MODEL_GUIDED: {
              output: {
                cases: ids.map(
                  (caseId) => ({ caseId }),
                ),
              },
            },
          },
        }),
        buildSelection: async () => ({
          cases: ids.map(
            (caseId) => ({ caseId }),
          ),
        }),
        finalizeUnreadBoundary: async () => ({}),
      }),
    ).rejects.toThrow(
      /T45_CAPABILITY_OBLIGATION_CASE_ORDER_DRIFT:matrix/,
    );
  });

  it("rejects suite, inventory, corpus, candidate and matrix binding drift", () => {
    const expected = {
      suiteHash: HASHES.suite,
      inventoryHash: HASHES.inventory,
      corpusBundleHash: HASHES.corpus,
      candidateSha256: HASHES.candidate,
      matrixSha256: HASHES.matrix,
    };
    expect(
      assertT45CapabilityPipelineBindingsV1({
        expected,
        observed: expected,
      }),
    ).toEqual(expected);
    for (const field of Object.keys(
      expected,
    ) as Array<keyof typeof expected>) {
      expect(() =>
        assertT45CapabilityPipelineBindingsV1({
          expected,
          observed: {
            ...expected,
            [field]: "f".repeat(64),
          },
        }),
      ).toThrow(
        new RegExp(
          "T45_CAPABILITY_OBLIGATION_"
          + field
            .replace(/([A-Z])/g, "_$1")
            .toUpperCase()
          + "_DRIFT",
        ),
      );
    }
  });

  it("prints only redacted model provenance", () => {
    const notice = formatT45ModelProvenanceNoticeV1({
      modelId: "gpt-5.6-test",
      endpointHash: "f".repeat(64),
      configurationSource: "service-env",
    });
    expect(notice).toEqual({
      event: "t45-capability-model-provenance",
      environmentMode: "SERVICE_REQUIRED",
      modelId: "gpt-5.6-test",
      endpointHash: "f".repeat(64),
      configurationSource: "service-env",
    });
    expect(JSON.stringify(notice)).not.toMatch(
      /apiKey|baseUrl|databasePath|https?:\/\/|service\.env/i,
    );
  });

  it("runs the actual CLI assembly offline with exact artifact paths, V2 selection, case order and wx sealing", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lumi-t45-offline-"),
    );
    roots.push(root);
    const dependencies =
      await offlineDependencies();
    const runOffline: OfflineCliRunner =
      runT45CapabilityObligationsCli;
    const argv = [
      "--split",
      "calibration",
      "--run-id",
      "calibration-v91",
      "--device",
      "cpu",
    ] as const;
    const result = await runOffline(
      argv,
      root,
      dependencies,
    );
    const artifactRoot = path.join(
      root,
      ".runtime",
      "mixed-retrieval",
    );
    const stem = "t45-capability-calibration-v91";
    const expectedPaths = {
      planner: `${stem}.planner.json`,
      provider: `${stem}.provider.json`,
      candidate: `${stem}.candidate.json`,
      matrixBridge: `${stem}.matrix-bridge.json`,
      matrix: `${stem}.matrix.json`,
      selection: `${stem}.selection.json`,
    } as const;
    for (
      const [key, file]
      of Object.entries(expectedPaths)
    ) {
      expect(
        result.sealed[
          key as keyof typeof expectedPaths
        ].path,
      ).toBe(path.join(artifactRoot, file));
      expect(
        await readFile(path.join(artifactRoot, file)),
      ).not.toHaveLength(0);
    }
    expect(result.boundarySeal.path).toBe(
      path.join(
        artifactRoot,
        `${stem}.boundary.json`,
      ),
    );
    const selection = JSON.parse(
      await readFile(
        result.sealed.selection.path,
        "utf8",
      ),
    ) as {
      selectorConfigHash: string;
      cases: Array<{ caseId: string }>;
    };
    const runtime = await dependencies.loadRuntimePort({
      workspaceRoot: root,
      split: "CALIBRATION",
    });
    expect(selection.selectorConfigHash).toBe(
      T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
    );
    expect(selection.cases.map(
      ({ caseId }) => caseId,
    )).toEqual(runtime.cases.map(
      ({ caseId }) => caseId,
    ));
    expect(result.boundary).toMatchObject({
      kind: "T45_CAPABILITY_LABELS_REMAIN_UNREAD",
      operationBoundary:
        "SELECTION_SEALED_LABELS_UNREAD",
      operations: {
        scoring: "NOT_PERFORMED",
      },
    });
    await expect(runOffline(
      argv,
      root,
      dependencies,
    )).rejects.toThrow(
      /T45_CAPABILITY_OBLIGATION_ARTIFACT_ALREADY_EXISTS/,
    );
  });

  it("recomputes candidate, matrix-bridge and matrix SHA from the exact bytes consumed", async () => {
    const loadedModule = await import(
      "@/scripts/evaluate-t45-capability-obligations-v1"
    ) as unknown as Record<string, unknown>;
    const readSealed =
      loadedModule.readT45SealedJsonArtifactV1 as
        | undefined
        | ((input: {
          path: string;
          expectedSha256: string;
          artifact:
            | "CANDIDATE"
            | "MATRIX_BRIDGE"
            | "MATRIX";
          parse(value: unknown): unknown;
        }) => Promise<unknown>);
    expect(typeof readSealed).toBe("function");
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lumi-t45-tamper-"),
    );
    roots.push(root);
    for (
      const artifact
      of [
        "CANDIDATE",
        "MATRIX_BRIDGE",
        "MATRIX",
      ] as const
    ) {
      const target = path.join(
        root,
        `${artifact.toLowerCase()}.json`,
      );
      const original = "{\"value\":1}\n";
      await writeFile(target, original, "utf8");
      const expectedSha256 = sha256Utf8(original);
      await writeFile(
        target,
        "{\"value\":2}\n",
        "utf8",
      );
      await expect(readSealed!({
        path: target,
        expectedSha256,
        artifact,
        parse: (value) => value,
      })).rejects.toThrow(
        new RegExp(
          `T45_CAPABILITY_OBLIGATION_${artifact}_SHA256_DRIFT`,
        ),
      );
    }
  });

  it("rejects a candidate tampered after sealing inside the actual offline CLI assembly", async () => {
    const root = await mkdtemp(
      path.join(
        os.tmpdir(),
        "lumi-t45-cli-tamper-",
      ),
    );
    roots.push(root);
    const dependencies =
      await offlineDependencies();
    const executeMatrixArm =
      dependencies.executeMatrixArm;
    let tampered = false;
    dependencies.executeMatrixArm = async (input) => {
      if (!tampered) {
        tampered = true;
        const candidatePath = path.join(
          root,
          ".runtime",
          "mixed-retrieval",
          "t45-capability-calibration-v92.candidate.json",
        );
        const candidate = JSON.parse(
          await readFile(candidatePath, "utf8"),
        ) as {
          runtimeSuite: { id: string };
        };
        candidate.runtimeSuite.id =
          "lumi-t45-tampered-runtime";
        await writeFile(
          candidatePath,
          `${JSON.stringify(candidate, null, 2)}\n`,
          "utf8",
        );
      }
      return executeMatrixArm(input);
    };
    const runOffline: OfflineCliRunner =
      runT45CapabilityObligationsCli;
    await expect(runOffline([
      "--split",
      "calibration",
      "--run-id",
      "calibration-v92",
      "--device",
      "cpu",
    ], root, dependencies)).rejects.toThrow(
      /T45_CAPABILITY_OBLIGATION_CANDIDATE_SHA256_DRIFT/,
    );
  });

  it("maps known and unknown failures to stable safe stderr codes", async () => {
    const loadedModule = await import(
      "@/scripts/evaluate-t45-capability-obligations-v1"
    ) as unknown as Record<string, unknown>;
    const safeCode =
      loadedModule.formatT45CapabilityCliErrorCodeV1 as
        | undefined
        | ((error: unknown) => string);
    expect(typeof safeCode).toBe("function");
    expect(safeCode!(new Error(
      "T45_CAPABILITY_OBLIGATION_MATRIX_SHA256_DRIFT:"
      + "https://secret.invalid/config",
    ))).toBe(
      "T45_CAPABILITY_OBLIGATION_MATRIX_SHA256_DRIFT",
    );
    expect(safeCode!(new Error(
      "https://secret.invalid/config?key=leak",
    ))).toBe(
      "T45_CAPABILITY_OBLIGATION_UNEXPECTED_ERROR",
    );
  });

  it("prints only one safe code from the real CLI entry point", async () => {
    const root = await mkdtemp(
      path.join(
        os.tmpdir(),
        "lumi-t45-entry-stderr-",
      ),
    );
    roots.push(root);
    const suiteRoot = path.join(
      root,
      "tests",
      "retrieval-quality",
    );
    await mkdir(suiteRoot, { recursive: true });
    await writeFile(
      path.join(
        suiteRoot,
        "t45-capability-calibration.runtime.json",
      ),
      "\"https://secret.invalid/config?key=leak\"",
      "utf8",
    );
    await writeFile(
      path.join(
        suiteRoot,
        "t45-capability-inventory.json",
      ),
      "{}",
      "utf8",
    );
    const result = spawnSync(process.execPath, [
      path.resolve(
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs",
      ),
      "--tsconfig",
      path.resolve("tsconfig.json"),
      path.resolve(
        "scripts",
        "evaluate-t45-capability-obligations-v1.ts",
      ),
      "--split",
      "calibration",
      "--run-id",
      "calibration-v93",
      "--device",
      "cpu",
    ], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe(
      "T45_CAPABILITY_OBLIGATION_UNEXPECTED_ERROR",
    );
    expect(result.stderr).not.toMatch(
      /https?:\/\/|key=|service\.env|\n\s+at\s/i,
    );
  });
});
