// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  guardRagHarnessRealModelOutbound,
  runDeterministicRagAgentHarness,
} from "@/lib/agent/rag-harness-runner";
import type {
  ModelProviderAdapter,
} from "@/lib/agent/model-provider-adapter";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("deterministic RAG Agent Harness", () => {
  it("runs all 12 cases through the real Agent turn and persistence path", async () => {
    const root = await mkdtemp(path.join(
      tmpdir(),
      "lumi-rag-harness-",
    ));
    roots.push(root);
    const result =
      await runDeterministicRagAgentHarness({
        databasePath: path.join(
          root,
          "harness.sqlite",
        ),
        suitePath: path.resolve(
          "tests/rag-agent-harness/suite.v1.json",
        ),
        qrelsPath: path.resolve(
          "tests/rag-agent-harness/qrels.v1.json",
        ),
      });

    expect(result.results).toHaveLength(12);
    expect(result.results.every(
      ({ passed }) => passed,
    ), JSON.stringify(
      result.results
        .filter(({ passed }) => !passed)
        .map(({ caseId, failures }) => ({
          caseId,
          failures,
        })),
    )).toBe(true);
    expect(result.results.find(
      ({ caseId }) =>
        caseId
          === "rag-multi-obligation-coverage",
    )?.requiredGroupResults).toEqual([
      expect.objectContaining({
        groupId: "cause",
        injected: true,
        used: true,
      }),
      expect.objectContaining({
        groupId: "first-action",
        injected: true,
        used: true,
      }),
    ]);
    expect(result.results.find(
      ({ caseId }) =>
        caseId
          === "rag-disputed-memory-excluded",
    )?.observed).toMatchObject({
      forbiddenContextMatches: [],
      disputedMemoryRowRetained: true,
    });

    const resumedDatabasePath = path.join(
      root,
      "resumed.sqlite",
    );
    const newlyCompleted: string[] = [];
    const resumed =
      await runDeterministicRagAgentHarness({
        databasePath: resumedDatabasePath,
        suitePath: path.resolve(
          "tests/rag-agent-harness/suite.v1.json",
        ),
        qrelsPath: path.resolve(
          "tests/rag-agent-harness/qrels.v1.json",
        ),
        completedResults:
          result.results.slice(0, 4),
        onCaseCompleted(caseResult) {
          newlyCompleted.push(caseResult.caseId);
        },
      });
    expect(resumed.results).toHaveLength(12);
    expect(newlyCompleted).toHaveLength(8);
    expect(newlyCompleted).not.toContain(
      result.results[0]?.caseId,
    );
  });

  it("runs the 12-case real-model path without exposing scoring labels", async () => {
    const root = await mkdtemp(path.join(
      tmpdir(),
      "lumi-rag-real-model-",
    ));
    roots.push(root);
    const outboundPayloads: string[] = [];
    let callSequence = 0;
    let omittedAttributionOnce = false;
    const fixtureProvider: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "gpt-5.6-luna",
      capabilities: { vision: false },
      async complete() {
        throw new Error(
          "REAL_MODEL_FIXTURE_REQUIRES_RESPOND",
        );
      },
      async respond(messages, options) {
        outboundPayloads.push(JSON.stringify({
          messages,
          tools: options?.tools ?? [],
          toolChoice:
            options?.toolChoice ?? null,
          structuredOutput:
            options?.structuredOutput ?? null,
        }));
        if (options?.structuredOutput) {
          const repair = JSON.parse(
            messages.findLast(
              (candidate) =>
                candidate.role === "user"
                && candidate.content.includes(
                  "SOURCE_ATTRIBUTION_REPAIR",
                ),
            )?.content ?? "{}",
          ) as {
            allowedEvidenceNodeIds?:
              unknown;
          };
          const sourceIds =
            Array.isArray(
              repair.allowedEvidenceNodeIds,
            )
              ? repair
                  .allowedEvidenceNodeIds
                  .filter(
                    (candidate):
                      candidate is string =>
                        typeof candidate
                          === "string",
                  )
              : [];
          return {
            content: JSON.stringify({
              sourceIds,
            }),
            toolCalls: [],
          };
        }
        const toolMessage = [...messages]
          .reverse()
          .find(({ role }) => role === "tool");
        if (!toolMessage) {
          const tool = (options?.tools ?? [])
            .find((candidate) =>
              "name" in candidate
              && (
                candidate.name.includes(
                  "search-evidence",
                )
                || candidate.name.includes(
                  "search-concepts",
                )
              ));
          if (!tool || !("name" in tool)) {
            throw new Error(
              "REAL_MODEL_FIXTURE_TOOL_MISSING",
            );
          }
          const context = JSON.parse(
            messages.find(
              ({ role }) => role === "user",
            )?.content ?? "{}",
          ) as { studentQuestion?: unknown };
          callSequence += 1;
          return {
            content: null,
            toolCalls: [{
              id: `real-model-fixture-${callSequence}`,
              name: tool.name,
              arguments: JSON.stringify({
                query:
                  typeof context.studentQuestion
                    === "string"
                    ? context.studentQuestion
                    : "课程证据",
              }),
            }],
          };
        }
        const envelope = JSON.parse(
          toolMessage.content ?? "{}",
        ) as {
          output?: {
            evidence?: {
              nodes?: Array<{
                nodeId?: unknown;
                excerpt?: unknown;
              }>;
            };
          };
        };
        const nodes = (
          envelope.output?.evidence?.nodes
          ?? []
        ).filter(
          (node): node is {
            nodeId: string;
            excerpt?: unknown;
          } => typeof node.nodeId === "string",
        );
        const message = nodes.length > 0
          ? [
              "我依据本轮课程证据回答。",
              ...nodes.map(({ excerpt }) =>
                typeof excerpt === "string"
                  ? excerpt
                  : "证据节点没有文字摘录。"),
            ].join("\n")
          : "我目前看不到参考图，因此不能直接判断具体区域。";
        if (
          nodes.length > 0
          && !omittedAttributionOnce
        ) {
          omittedAttributionOnce = true;
          return {
            content:
              `${message}\n<!-- tutor-meta ${JSON.stringify({
                sourceIds: [],
                unexpectedField:
                  "must-not-survive-repair",
              })} -->`,
            toolCalls: [],
          };
        }
        return {
          content: nodes.length > 0
            ? `${message}\n<!-- tutor-meta ${JSON.stringify({
                sourceIds: nodes.map(
                  ({ nodeId }) => nodeId,
                ),
              })} -->`
            : message,
          toolCalls: [],
        };
      },
    };
    const guarded =
      guardRagHarnessRealModelOutbound(
        fixtureProvider,
        {
          configuredSecrets: [
            "fixture-secret-never-send",
          ],
        },
      );
    const result =
      await runDeterministicRagAgentHarness({
        databasePath: path.join(
          root,
          "real-model.sqlite",
        ),
        suitePath: path.resolve(
          "tests/rag-agent-harness/suite.v1.json",
        ),
        qrelsPath: path.resolve(
          "tests/rag-agent-harness/qrels.v1.json",
        ),
        mode: "real-model",
        modelProvider: guarded,
      });

    expect(result.results).toHaveLength(12);
    expect(result.results.every(
      ({ passed }) => passed,
    ), JSON.stringify(
      result.results
        .filter(({ passed }) => !passed)
        .map(({ caseId, failures }) => ({
          caseId,
          failures,
        })),
    )).toBe(true);
    expect(outboundPayloads.length)
      .toBeGreaterThanOrEqual(20);
    const outbound = outboundPayloads.join("\n");
    expect(outbound).toContain(
      "\"toolChoice\":\"required\"",
    );
    expect(outbound).toContain(
      "SOURCE_ATTRIBUTION_REPAIR",
    );
    expect(outbound).toContain(
      "lumi_rag_source_attribution_v1",
    );
    expect(outbound).not.toMatch(
      /qrels?|expectedSourceIds|requiredGroups|hard[-_ ]?negative/iu,
    );
    expect(outbound).not.toContain(
      "fixture-secret-never-send",
    );
  });

  it("fails closed before an unauthorized real-model payload reaches the provider", async () => {
    let upstreamCalls = 0;
    const upstream: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "gpt-5.6-luna",
      capabilities: { vision: false },
      async complete() {
        upstreamCalls += 1;
        return "unexpected";
      },
      async respond() {
        upstreamCalls += 1;
        return {
          content: "unexpected",
          toolCalls: [],
        };
      },
    };
    const guarded =
      guardRagHarnessRealModelOutbound(
        upstream,
        {
          configuredSecrets: [
            "planner-secret-value",
          ],
        },
      );
    const call = (content: string) =>
      guarded.respond!([{
        role: "user",
        content,
      }]);

    await expect(call("qrels")).rejects
      .toThrow(
        "RAG_HARNESS_REAL_MODEL_FORBIDDEN_FIELD",
      );
    await expect(call(
      "E:\\private\\course.sqlite",
    )).rejects.toThrow(
      "RAG_HARNESS_REAL_MODEL_FORBIDDEN_FIELD",
    );
    await expect(call(
      "planner-secret-value",
    )).rejects.toThrow(
      "RAG_HARNESS_REAL_MODEL_SECRET_IN_PAYLOAD",
    );
    await expect(guarded.respond!(
      [{ role: "user", content: "safe" }],
      {
        image: {
          mimeType: "image/png",
          bytes: new Uint8Array([1, 2, 3]),
        },
      },
    )).rejects.toThrow(
      "RAG_HARNESS_REAL_MODEL_IMAGE_NOT_AUTHORIZED",
    );
    expect(upstreamCalls).toBe(0);
  });
});
