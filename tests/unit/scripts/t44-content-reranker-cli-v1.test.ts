import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import {
  T44_CONTENT_RERANKER_CONFIG_HASH_V1,
  T44_CONTENT_RERANKER_CONFIG_V1,
  T44_CONTENT_RERANKER_PILOT_CASES_V1,
  buildT44ContentRerankerPromptV1,
  type T44ContentRerankerSelectionArtifactV1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  evaluateT44ContentRerankerSelectionV1,
  parseT44ContentRerankerAuditArguments,
} from "@/scripts/audit-t44-content-reranker-v1";
import {
  assertT44ExplicitCasePortV1,
  buildT44ContentRerankerPromptsForCasesV1,
  mergeT44ContentRerankerWholeRanksV1,
  parseT44ContentRerankerRunArguments,
  runT44ContentRerankerModelBatchV1,
} from "@/scripts/run-t44-content-reranker-v1";

const HASH = "a".repeat(64);

function promptFixture() {
  const candidate = (suffix: string) => ({
    nodeId: `node-${suffix}`,
    objectId: `object-${suffix}`,
    coursePackId: "layout-design",
    objectRank: 1,
    kind: "TEXT" as const,
    role: "FACT" as const,
    text: `证据${suffix}`,
    nodeContentHash: HASH,
    objectContentHash: HASH,
    sourceHash: HASH,
  });
  const one = candidate("one");
  const two = candidate("two");
  return buildT44ContentRerankerPromptV1({
    caseId: "t44-support-layout-p2a",
    coursePackId: "layout-design",
    question: "这页为什么看起来很散？",
    obligations: [{
      obligationId: "obligation-1",
      learnerNeed: "找到建立版面秩序的证据。",
      intent: "EXPLAIN_CONCEPT",
    }],
    bCandidateNodes: [one, two],
    aCandidateNodes: [one, two],
    aBaselineSelectedNodeIds: ["node-two"],
    wholeQueryRanking: [
      { nodeId: "node-one", rank: 1 },
      { nodeId: "node-two", rank: 2 },
    ],
    obligationRankings: [{
      obligationId: "obligation-1",
      ranking: [
        { nodeId: "node-one", rank: 1 },
        { nodeId: "node-two", rank: 2 },
      ],
    }],
  });
}

function artifactFixture(): {
  artifact: T44ContentRerankerSelectionArtifactV1;
  labels: {
    caseId: string;
    multiClaim: boolean;
    requiredEvidenceGroups: {
      groupId: string;
      acceptableNodeIds: string[];
    }[];
    hardNegativeNodeIds: string[];
  }[];
  baseline: {
    caseId: string;
    selectedNodeIds: string[];
  }[];
} {
  const cases =
    T44_CONTENT_RERANKER_PILOT_CASES_V1.map(
      ({ caseId, coursePackId }, index) => ({
        caseId,
        coursePackId,
        candidateMapHash: HASH,
        promptHash: HASH,
        status: "VALID" as const,
        failureCategory: null,
        selected: [{
          candidateIndex: 1,
          nodeId: `node-correct-${index}`,
          objectId: `object-${index}`,
          coursePackId,
          role: "FACT" as const,
          text: "直接证据",
          nodeContentHash: HASH,
          baselineRank: null,
          wholeQueryRank: 1,
          obligationRanks: [],
          obligationIds: ["obligation-1"],
          evidenceRole: "DIRECT" as const,
        }],
        audit: {
          elapsedMs: 100 + index,
          rawOutputHash: HASH,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        },
      }),
    );
  return {
    artifact: {
      schemaVersion: 1,
      kind:
        "T44_CONTENT_RERANKER_SELECTIONS",
      artifactId: "pilot-v1",
      scope: "PILOT",
      runtimeSuite: {
        id: "t44-support-dev-runtime-v1",
        version: "1.0.0",
        suiteHash: HASH,
      },
      inputs: {
        plannerSha256: HASH,
        candidateSha256: HASH,
        matrixSha256: HASH,
        legacySelectionSha256: HASH,
      },
      config: T44_CONTENT_RERANKER_CONFIG_V1,
      configHash:
        T44_CONTENT_RERANKER_CONFIG_HASH_V1,
      model: {
        source: "service-env",
        modelId: "GPT-5.6 Luna",
        endpointHash: HASH,
      },
      graphifyInvocationCount: 0,
      cases,
      summary: {
        total: 25,
        valid: 25,
        invalid: 0,
      },
      generatedAt:
        "2026-07-29T00:00:00.000Z",
      operations: {
        graphify: "NOT_USED",
        database: "NOT_USED",
        web: "NOT_USED",
        deployment: "NOT_PERFORMED",
      },
    },
    labels: cases.map((testCase, index) => ({
      caseId: testCase.caseId,
      multiClaim: index < 6,
      requiredEvidenceGroups: [{
        groupId: `group-${index}`,
        acceptableNodeIds: [
          `node-correct-${index}`,
        ],
      }],
      hardNegativeNodeIds: [
        `node-hard-${index}`,
      ],
    })),
    baseline: cases.map((testCase, index) => ({
      caseId: testCase.caseId,
      selectedNodeIds:
        index < 11
          ? [`node-hard-${index}`]
          : [],
    })),
  };
}

describe("T44 content reranker CLIs", () => {
  it("exports an explicit-case prompt helper for 20/50 case ports", () => {
    expect(
      buildT44ContentRerankerPromptsForCasesV1,
    ).toBeTypeOf("function");
  });

  it("locks explicit 20/50 case order, uniqueness, presence and course scope", () => {
    const identities = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        caseId: `case-${index + 1}`,
        coursePackId: index % 2 === 0
          ? "layout-design"
          : "brand-vi-design",
      }));
    for (const count of [20, 50]) {
      const rows = identities(count);
      expect(
        assertT44ExplicitCasePortV1({
          caseIdentities: rows,
          sources: [{
            label: "TEST",
            rows,
          }],
        }),
      ).toHaveLength(count);
    }
    const twenty = identities(20);
    expect(() =>
      assertT44ExplicitCasePortV1({
        caseIdentities: twenty,
        sources: [{
          label: "TEST",
          rows: twenty.slice(0, -1),
        }],
      }),
    ).toThrow(
      "T44_CONTENT_RERANKER_TEST_CASE_ORDER_DRIFT",
    );
    expect(() =>
      assertT44ExplicitCasePortV1({
        caseIdentities: twenty,
        sources: [{
          label: "TEST",
          rows: [...twenty].reverse(),
        }],
      }),
    ).toThrow(
      "T44_CONTENT_RERANKER_TEST_CASE_ORDER_DRIFT",
    );
    expect(() =>
      assertT44ExplicitCasePortV1({
        caseIdentities: twenty,
        sources: [{
          label: "TEST",
          rows: twenty.map((row, index) =>
            index === 2
              ? {
                  ...row,
                  coursePackId: "wrong-course",
                }
              : row),
        }],
      }),
    ).toThrow(
      "T44_CONTENT_RERANKER_TEST_CASE_ORDER_DRIFT",
    );
    expect(() =>
      assertT44ExplicitCasePortV1({
        caseIdentities: [
          ...twenty.slice(0, -1),
          twenty[0]!,
        ],
        sources: [],
      }),
    ).toThrow(
      "T44_CONTENT_RERANKER_EXPLICIT_CASE_DUPLICATE",
    );
  });

  it("parses a scope-bound run without allowing pilot/full artifact mismatch", () => {
    expect(
      parseT44ContentRerankerRunArguments([
        "--",
        "--run-id",
        "legacy-v2",
        "--scope",
        "pilot",
        "--artifact-id",
        "pilot-v1",
      ]),
    ).toEqual({
      runId: "legacy-v2",
      scope: "PILOT",
      artifactId: "pilot-v1",
    });
    expect(() =>
      parseT44ContentRerankerRunArguments([
        "--run-id",
        "legacy-v2",
        "--scope",
        "pilot",
        "--artifact-id",
        "full-v1",
      ]),
    ).toThrow(
      "T44_CONTENT_RERANKER_ARTIFACT_SCOPE_MISMATCH",
    );
    expect(
      parseT44ContentRerankerAuditArguments([
        "--",
        "--run-id",
        "legacy-v2",
        "--artifact-id",
        "pilot-v1",
      ]),
    ).toEqual({
      runId: "legacy-v2",
      artifactId: "pilot-v1",
    });
  });

  it("keeps the runner source independent from every scoring label path and field", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "scripts/run-t44-content-reranker-v1.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/qrels?/i);
    expect(source).not.toContain(
      "requiredEvidenceGroups",
    );
    expect(source).not.toContain(
      "acceptableNodeIds",
    );
    expect(source).not.toContain(
      "hardNegativeNodeIds",
    );
  });

  it("filters A and B matrix ranks to the actual candidate union before compact re-ranking", () => {
    const merged =
      mergeT44ContentRerankerWholeRanksV1({
        candidateNodeIds: [
          "node-b-2",
          "node-a-1",
        ],
        bWholeQueryRanking: [
          { nodeId: "node-b-1", rank: 1 },
          { nodeId: "node-b-2", rank: 2 },
          { nodeId: "node-b-3", rank: 3 },
        ],
        aWholeQueryRanking: [
          { nodeId: "node-a-1", rank: 1 },
          { nodeId: "node-b-2", rank: 2 },
          { nodeId: "node-a-3", rank: 3 },
        ],
      });

    expect(merged).toEqual([
      { nodeId: "node-b-2", rank: 1 },
      { nodeId: "node-a-1", rank: 2 },
    ]);
  });

  it("uses strict structured output and counts invalid model output instead of silently falling back", async () => {
    const prompt = promptFixture();
    const seenOptions: unknown[] = [];
    const validModel: ModelProviderAdapter = {
      provider: "TEST",
      capabilities: { vision: false },
      complete: async (_messages, options) => {
        seenOptions.push(options);
        options?.onUsage?.({
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        });
        return JSON.stringify({
          selections: [
            {
              candidateIndex: 1,
              obligationIds: ["obligation-1"],
              evidenceRole: "DIRECT",
            },
            {
              candidateIndex: 2,
              obligationIds: ["obligation-1"],
              evidenceRole: "COMPLEMENT",
            },
          ],
        });
      },
    };
    const valid =
      await runT44ContentRerankerModelBatchV1({
        prompts: [prompt],
        model: validModel,
        now: (() => {
          let value = 0;
          return () => {
            value += 10;
            return value;
          };
        })(),
      });

    expect(valid[0]?.status).toBe("VALID");
    expect(valid[0]?.selected[0]?.nodeId)
      .toBe("node-one");
    expect(seenOptions[0]).toMatchObject({
      reasoningEffort: "none",
      totalTimeoutMs: 30_000,
    });
    expect(seenOptions[0]).not.toHaveProperty(
      "structuredOutput",
    );
    expect(
      T44_CONTENT_RERANKER_CONFIG_V1
        .modelCall.structuredOutputTransport,
    ).toBe("PROMPT_JSON_LOCAL_STRICT");
    expect(
      T44_CONTENT_RERANKER_CONFIG_V1
        .modelCall.concurrency,
    ).toBe(1);

    const invalidModel: ModelProviderAdapter = {
      provider: "TEST",
      capabilities: { vision: false },
      complete: async () => JSON.stringify({
        selections: [
          {
            candidateIndex: 1,
            obligationIds: ["obligation-1"],
            evidenceRole: "DIRECT",
          },
          {
            candidateIndex: 1,
            obligationIds: ["obligation-1"],
            evidenceRole: "CONTEXT",
          },
        ],
      }),
    };
    const invalid =
      await runT44ContentRerankerModelBatchV1({
        prompts: [prompt],
        model: invalidModel,
      });

    expect(invalid[0]).toMatchObject({
      status: "INVALID",
      failureCategory:
        "OUTPUT_BINDING_INVALID",
      selected: [],
    });
  });

  it("scores the frozen pilot gates and fails below 23 of 25 without changing the denominator", () => {
    const fixture = artifactFixture();
    const passed =
      evaluateT44ContentRerankerSelectionV1({
        artifact: fixture.artifact,
        labels: fixture.labels,
        aBaseline: fixture.baseline,
      });

    expect(passed.decision).toBe("PILOT_GO");
    expect(passed.metrics).toMatchObject({
      support: {
        covered: 25,
        total: 25,
      },
      multi: {
        covered: 6,
        total: 6,
      },
      hardNegative: {
        nodes: 0,
        cases: 0,
        aBaselineNodes: 11,
        aBaselineCases: 11,
      },
      modelValid: {
        valid: 25,
        total: 25,
      },
    });

    const failedArtifact =
      structuredClone(fixture.artifact);
    for (const index of [0, 1, 2]) {
      failedArtifact.cases[index]!.selected[0]!
        .nodeId = `node-wrong-${index}`;
    }
    const failed =
      evaluateT44ContentRerankerSelectionV1({
        artifact: failedArtifact,
        labels: fixture.labels,
        aBaseline: fixture.baseline,
      });
    expect(failed.decision)
      .toBe("PILOT_NO_GO");
    expect(failed.metrics.support)
      .toEqual({ covered: 22, total: 25 });
    expect(failed.gates.support.passed)
      .toBe(false);
  });
});
