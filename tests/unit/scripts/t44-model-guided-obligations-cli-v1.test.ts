// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T44_PLANNER_IDLE_TIMEOUT_MS,
  T44_PLANNER_P95_GATE_MS,
  T44_PLANNER_TOTAL_TIMEOUT_MS,
  formatT44ModelProvenanceNoticeV1,
  parseT44ModelGuidedObligationsArguments,
  runT44ModelGuidedObligationsCli,
  runT44SealedEvaluationPipelineV1,
  writeNewSealedJsonArtifactV1,
} from "@/scripts/evaluate-t44-model-guided-obligations-v1";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

describe("T4.4 model-guided obligation CLI", () => {
  it("delegates label-blind collection to the shared runtime port", async () => {
    const source = await readFile(
      path.resolve(
        "scripts/"
        + "evaluate-t44-model-guided-obligations-v1.ts",
      ),
      "utf8",
    );
    expect(source).toContain(
      "collectObligationLabelBlindArtifactsV1",
    );
  });

  it("keeps the model client idle timeout below the repair total timeout", () => {
    expect(T44_PLANNER_TOTAL_TIMEOUT_MS).toBe(20_000);
    expect(T44_PLANNER_IDLE_TIMEOUT_MS)
      .toBeLessThan(T44_PLANNER_TOTAL_TIMEOUT_MS);
    expect(T44_PLANNER_P95_GATE_MS)
      .toBe(T44_PLANNER_TOTAL_TIMEOUT_MS);
  });

  it("accepts only the two authorized suites and stable lowercase run ids", () => {
    expect(parseT44ModelGuidedObligationsArguments([
      "--suite", "legacy",
      "--run-id", "legacy-v1",
    ])).toMatchObject({
      suite: "legacy",
      runId: "legacy-v1",
    });
    expect(parseT44ModelGuidedObligationsArguments([
      "--suite", "obligation-dev",
      "--run-id", "obligation-dev-v1",
    ])).toMatchObject({
      suite: "obligation-dev",
    });
    expect(() =>
      parseT44ModelGuidedObligationsArguments([
        "--suite", "other",
        "--run-id", "legacy-v1",
      ])).toThrow(/SUITE_INVALID/);
    expect(() =>
      parseT44ModelGuidedObligationsArguments([
        "--suite", "legacy",
        "--run-id", "Legacy_1",
      ])).toThrow(/RUN_ID_INVALID/);
  });

  it("keeps the T44 obligation runtime fixed at 50 cases", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lumi-t44-runtime-"),
    );
    roots.push(root);
    const source = JSON.parse(
      await readFile(
        path.resolve(
          "tests/retrieval-quality/"
          + "t45-capability-calibration.runtime.json",
        ),
        "utf8",
      ),
    ) as {
      corpusSnapshot: {
        path: string;
        bundleHash: string;
      };
      cases: Array<{
        caseId: string;
        coursePackId: string;
        coursePackVersion: "1";
        question: string;
      }>;
    };
    const withoutHash = {
      schemaVersion: 1,
      id: "lumi-t44-obligation-dev",
      version: "2026-07-29.1",
      split: "DEV",
      corpusSnapshot: source.corpusSnapshot,
      cases: source.cases.map((testCase) => ({
        caseId: testCase.caseId,
        coursePackId: testCase.coursePackId,
        coursePackVersion:
          testCase.coursePackVersion,
        question: testCase.question,
        recentTurns: [],
        view: {
          id: "student-conversation",
          focus: "mentor",
        },
        hasArtwork: false,
        artworkHash: null,
      })),
    };
    const runtime = {
      ...withoutHash,
      suiteHash: sha256StableJsonV2(withoutHash),
    };
    const target = path.join(
      root,
      "tests",
      "retrieval-quality",
      "t44-obligation-dev.runtime.json",
    );
    await mkdir(path.dirname(target), {
      recursive: true,
    });
    await writeFile(
      target,
      `${JSON.stringify(runtime, null, 2)}\n`,
      "utf8",
    );

    await expect(
      runT44ModelGuidedObligationsCli([
        "--suite",
        "obligation-dev",
        "--run-id",
        "twenty-cases",
      ], root),
    ).rejects.toThrow(/expected array to have >=50/i);
  });

  it("writes artifacts with wx and verifies bytes plus SHA", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lumi-t44-seal-"),
    );
    roots.push(root);
    const target = path.join(root, "artifact.json");
    const first = await writeNewSealedJsonArtifactV1(
      target,
      { safe: true },
    );
    expect(first.bytes).toBeGreaterThan(0);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(await readFile(target, "utf8")))
      .toEqual({ safe: true });
    await expect(
      writeNewSealedJsonArtifactV1(
        target,
        { safe: false },
      ),
    ).rejects.toThrow(/ARTIFACT_ALREADY_EXISTS/);
  });

  it("seals planner, provider, candidate, matrix and selection before loading qrels", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lumi-t44-order-"),
    );
    roots.push(root);
    const events: string[] = [];
    const result =
      await runT44SealedEvaluationPipelineV1({
        artifactRoot: root,
        artifactStem: "legacy-v1",
        collectLabelBlindArtifacts: async () => {
          events.push("collect");
          return {
            planner: { modelId: "gpt-5.6-test" },
            provider: {
              expectedCalls: 2,
              actualCalls: 2,
            },
            candidate: {
              graphifyInvocationCount: 0,
            },
            matrixBridge: {
              projection: "label-blind",
            },
          };
        },
        runMatrix: async ({ matrixBridgePath }) => {
          events.push("matrix");
          expect(await readFile(
            matrixBridgePath,
            "utf8",
          )).toContain("label-blind");
          return { matrix: true };
        },
        buildSelection: async ({
          candidateSha256,
          matrixSha256,
        }) => {
          events.push("selection");
          return {
            candidateSha256,
            matrixSha256,
          };
        },
        loadQrels: async ({ sealed }) => {
          events.push("qrels");
          for (const value of Object.values(sealed)) {
            expect(await readFile(value.path, "utf8"))
              .toBeTruthy();
          }
          return { labels: true };
        },
        evaluate: async ({ qrels }) => {
          events.push("evaluate");
          return {
            qrelsLoaded: qrels,
            graphify: "NOT_USED",
            database: "NOT_USED",
            web: "NOT_USED",
            deployment: "NOT_PERFORMED",
          };
        },
      });

    expect(events).toEqual([
      "collect",
      "matrix",
      "selection",
      "qrels",
      "evaluate",
    ]);
    expect(result.report.graphify).toBe("NOT_USED");
    expect(result.report.database).toBe("NOT_USED");
    expect(result.sealed.candidate.sha256)
      .toMatch(/^[0-9a-f]{64}$/);
  });

  it("prints only redacted SERVICE_REQUIRED provenance", () => {
    const notice = formatT44ModelProvenanceNoticeV1({
      source: "service-env",
      sourceFile:
        "%LOCALAPPDATA%\\ChuyingAI\\config\\service.env",
      modelId: "gpt-5.6-test",
      endpointHash: "f".repeat(64),
    });
    expect(notice).toEqual({
      event: "t44-obligation-model-provenance",
      environmentMode: "SERVICE_REQUIRED",
      source: "service-env",
      sourceFile:
        "%LOCALAPPDATA%\\ChuyingAI\\config\\service.env",
      modelId: "gpt-5.6-test",
      endpointHash: "f".repeat(64),
    });
    expect(JSON.stringify(notice)).not.toMatch(
      /apiKey|databasePath|https?:\/\//i,
    );
  });
});
