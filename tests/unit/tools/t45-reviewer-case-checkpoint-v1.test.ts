// @vitest-environment node

import {
  mkdtemp,
  readFile,
  rm,
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

import type {
  T44ContentRerankerPromptV1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  runT45ReviewerCheckpointedBatchV1,
} from "@/tools/mixed-retrieval/t45-reviewer-case-checkpoint-v1";

const roots: string[] = [];
const HASH = "a".repeat(64);
const MODEL = {
  source: "service-env" as const,
  modelId: "GPT-5.6 Luna",
  endpointHash: "b".repeat(64),
  configHash: "c".repeat(64),
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

function prompt(
  caseId = "case-one",
): T44ContentRerankerPromptV1 {
  return {
    caseId,
    coursePackId: "layout-design",
    question: "这页看着很挤，我先改哪里？",
    obligations: [{
      obligationId: "obligation-1",
      learnerNeed: "定位视觉拥挤的原因",
      intent: "DIAGNOSE_CAUSE",
    }],
    obligationIds: ["obligation-1"],
    messages: [{
      role: "user",
      content: "fixture",
    }],
    candidates: [],
    selectionBudget: 1,
    candidateMapHash: "d".repeat(64),
    promptHash: "e".repeat(64),
    promptCharacters: 7,
  };
}

function result(
  value: T44ContentRerankerPromptV1,
  failureCategory: string | null = null,
) {
  return {
    caseId: value.caseId,
    coursePackId: value.coursePackId,
    candidateMapHash: value.candidateMapHash,
    promptHash: value.promptHash,
    status:
      failureCategory === null
        ? "VALID" as const
        : "INVALID" as const,
    failureCategory,
    selected:
      failureCategory === null
        ? [{
            candidateIndex: 1,
            nodeId: "node-one",
            objectId: "object-one",
            coursePackId: value.coursePackId,
            role: "FACT" as const,
            text: "先检查信息层级和间距。",
            nodeContentHash: "8".repeat(64),
            baselineRank: 1,
            wholeQueryRank: 1,
            obligationRanks: [{
              obligationId: "obligation-1",
              rank: 1,
            }],
            obligationIds: ["obligation-1"],
            evidenceRole: "DIRECT" as const,
          }]
        : [],
    audit: {
      elapsedMs: 10,
      rawOutputHash:
        failureCategory === null
          ? "f".repeat(64)
          : null,
      usage: {
        inputTokens: 2,
        outputTokens: 1,
        totalTokens: 3,
      },
    },
  };
}

async function fixture() {
  const root = await mkdtemp(
    path.join(
      os.tmpdir(),
      "lumi-reviewer-checkpoint-",
    ),
  );
  roots.push(root);
  const events: unknown[] = [];
  const runModelBatch = vi.fn(
    async ({ prompts }: {
      prompts:
        readonly T44ContentRerankerPromptV1[];
    }) => prompts.map((value) => result(value)),
  );
  const base = {
    checkpointRoot: root,
    runId: "post-remediation-v4",
    attemptId: "recovery-one",
    runtimeSuiteHash: HASH,
    stage: "CONTENT_DRAFT" as const,
    model: MODEL,
    runModelBatch,
    onEvent: (event: unknown) => events.push(event),
  };
  return {
    root,
    events,
    runModelBatch,
    base,
  };
}

describe("T45 reviewer case checkpoint", () => {
  it("publishes a valid result once and reuses it", async () => {
    const value = await fixture();
    const prompts = [prompt()];

    const first =
      await runT45ReviewerCheckpointedBatchV1({
        ...value.base,
        prompts,
      });
    const second =
      await runT45ReviewerCheckpointedBatchV1({
        ...value.base,
        prompts,
      });

    expect(first).toEqual(second);
    expect(value.runModelBatch)
      .toHaveBeenCalledTimes(1);
    expect(value.events).toMatchObject([
      {
        caseId: "case-one",
        status: "PUBLISHED",
      },
      {
        caseId: "case-one",
        status: "HIT",
      },
    ]);
  });

  it("stops and never publishes an infrastructure failure", async () => {
    const value = await fixture();
    value.runModelBatch.mockImplementation(
      async ({ prompts }) =>
        prompts.map((item) =>
          result(
            item,
            "MODEL_SERVICE_RATE_LIMIT",
          )),
    );

    await expect(
      runT45ReviewerCheckpointedBatchV1({
        ...value.base,
        prompts: [prompt()],
      }),
    ).rejects.toThrow(
      "T45_REVIEWER_INFRASTRUCTURE_NOT_READY:"
        + "CONTENT_DRAFT:case-one:"
        + "MODEL_SERVICE_RATE_LIMIT",
    );
    await expect(
      readFile(
        path.join(value.root, "case-one.json"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(value.events).toMatchObject([{
      status: "NOT_PUBLISHED",
      failureCategory:
        "MODEL_SERVICE_RATE_LIMIT",
    }]);
  });

  it("seals a non-service structured-output failure as quality evidence", async () => {
    const value = await fixture();
    value.runModelBatch.mockImplementation(
      async ({ prompts }) =>
        prompts.map((item) =>
          result(
            item,
            "STRUCTURED_OUTPUT_INVALID",
          )),
    );

    const observed =
      await runT45ReviewerCheckpointedBatchV1({
        ...value.base,
        prompts: [prompt()],
      });

    expect(observed[0]).toMatchObject({
      status: "INVALID",
      failureCategory:
        "STRUCTURED_OUTPUT_INVALID",
    });
    expect(await readFile(
      path.join(value.root, "case-one.json"),
      "utf8",
    )).not.toContain("qrels");
  });

  it("rejects a checkpoint under a different prompt binding", async () => {
    const value = await fixture();
    await runT45ReviewerCheckpointedBatchV1({
      ...value.base,
      prompts: [prompt()],
    });
    const drifted = {
      ...prompt(),
      promptHash: "9".repeat(64),
    };

    await expect(
      runT45ReviewerCheckpointedBatchV1({
        ...value.base,
        prompts: [drifted],
      }),
    ).rejects.toThrow(
      "T45_REVIEWER_CASE_CHECKPOINT_BINDING_DRIFT:case-one",
    );
  });
});
