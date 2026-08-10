// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANSWER_OBLIGATION_PLANNER_ID_V1,
  createDegradedAnswerObligationSetV1,
  type QueryUnderstandingInputV1,
  validateAnswerObligationSetV1,
} from "@/lib/knowledge/answer-obligation-v1";
import {
  QUERY_UNDERSTANDING_CONFIG_HASH_V1,
  QUERY_UNDERSTANDING_PROMPT_HASH_V1,
  QueryUnderstandingPlannerAuditV1Schema,
  QueryUnderstandingPublicTraceV1Schema,
} from "@/lib/knowledge/query-understanding-planner-v1";
import {
  createT45PlannerCaseCheckpointV1,
} from "@/tools/mixed-retrieval/t45-planner-case-checkpoint-v1";

const roots: string[] = [];
const HASH = "a".repeat(64);
const MODEL = {
  modelId: "GPT-5.6 Luna",
  endpointHash: "b".repeat(64),
  credentialSlotHash: "c".repeat(64),
  configurationSource: "service-env" as const,
  providerSelection: "planner-override",
  plannerVersion: "1.4.0",
  promptHash: QUERY_UNDERSTANDING_PROMPT_HASH_V1,
  configHash: QUERY_UNDERSTANDING_CONFIG_HASH_V1,
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

function request(
  message = "我的按钮点完没反应，先检查什么？",
): QueryUnderstandingInputV1 {
  return {
    schemaVersion: 1,
    currentMessage: {
      source: "CURRENT_MESSAGE",
      message,
      messageHash: sha256(message),
    },
    recentTurns: [],
    coursePack: {
      id: "general-design",
      version: "1",
      label: "通用设计",
      summary: "设计基础",
    },
    view: {
      id: "student-conversation",
      focus: "mentor",
    },
    hasArtwork: false,
    artworkHash: null,
  };
}

function result(
  input: QueryUnderstandingInputV1,
  status: "READY" | "DEGRADED" = "READY",
) {
  const metadata = {
    plannerVersion: "1.4.0",
    modelId: MODEL.modelId,
    promptHash: MODEL.promptHash,
    outputHash: "d".repeat(64),
    elapsedMs: 10,
  };
  const obligationSet = status === "READY"
    ? validateAnswerObligationSetV1({
        request: input,
        payload: {
          status: "READY",
          obligations: [{
            learnerNeed: "确认按钮操作后的反馈状态",
            intent: "DIAGNOSE_CAUSE",
            sourceAnchors: [{
              source: "CURRENT_MESSAGE",
              sourceMessageHash:
                input.currentMessage.messageHash,
              quote: input.currentMessage.message,
              startCodePoint: 0,
              endCodePoint:
                Array.from(input.currentMessage.message).length,
            }],
            entityMentions: [],
            constraints: [],
            evidenceNeeds: ["DIRECT_TEXT"],
            retrievalQueries: [{
              text: "按钮操作 状态反馈",
              purpose: "DIRECT",
            }],
            confidence: 0.9,
          }],
          clarifyingQuestion: null,
          artworkObservationHints: [],
        },
        metadata,
      })
    : createDegradedAnswerObligationSetV1({
        request: input,
        metadata,
      });
  const failureCategory =
    status === "READY" ? null : "PROVIDER_ERROR";
  return {
    obligationSet,
    audit: QueryUnderstandingPlannerAuditV1Schema.parse({
      firstAttempt:
        status === "READY" ? "VALID" : "PROVIDER_ERROR",
      repairAttempt: "NOT_USED",
      callCount: 1,
      failureCategory,
      usage: {
        first: null,
        repair: null,
        total: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      },
    }),
    publicTrace: QueryUnderstandingPublicTraceV1Schema.parse({
      schemaVersion: 1,
      plannerId: ANSWER_OBLIGATION_PLANNER_ID_V1,
      plannerVersion: "1.4.0",
      modelId: MODEL.modelId,
      status,
      promptHash: MODEL.promptHash,
      configHash: MODEL.configHash,
      cacheKey: "e".repeat(64),
      outputHash: obligationSet.trace.outputHash,
      elapsedMs: obligationSet.trace.elapsedMs,
      firstAttempt:
        status === "READY" ? "VALID" : "PROVIDER_ERROR",
      repairAttempt: "NOT_USED",
      callCount: 1,
      failureCategory,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    }),
  };
}

async function fixture(status: "READY" | "DEGRADED" = "READY") {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "lumi-planner-checkpoint-"),
  );
  roots.push(root);
  const current = request();
  const plan = vi.fn(async () => result(current, status));
  const events: unknown[] = [];
  const planner = createT45PlannerCaseCheckpointV1({
    checkpointRoot: root,
    runId: "post-remediation-v4",
    runtimeSuiteHash: HASH,
    cases: [{
      caseId: "case-one",
      currentMessageHash:
        current.currentMessage.messageHash,
    }],
    model: MODEL,
    planner: { plan },
    onEvent: (event) => events.push(event),
  });
  return { root, current, plan, planner, events };
}

describe("T45 planner case checkpoint", () => {
  it("publishes once and reuses the same bound result", async () => {
    const value = await fixture();

    const first = await value.planner.plan(value.current);
    const second = await value.planner.plan(value.current);

    expect(first).toEqual(second);
    expect(value.plan).toHaveBeenCalledTimes(1);
    expect(value.events).toEqual([
      { caseId: "case-one", status: "PUBLISHED" },
      { caseId: "case-one", status: "HIT" },
    ]);
    const persisted = await readFile(
      path.join(value.root, "case-one.json"),
      "utf8",
    );
    expect(persisted).not.toContain("qrels");
    expect(persisted).not.toContain("hardNegative");
  });

  it("never checkpoints a degraded provider result", async () => {
    const value = await fixture("DEGRADED");

    await value.planner.plan(value.current);
    await value.planner.plan(value.current);

    expect(value.plan).toHaveBeenCalledTimes(2);
    expect(value.events).toEqual([
      { caseId: "case-one", status: "NOT_PUBLISHED" },
      { caseId: "case-one", status: "NOT_PUBLISHED" },
    ]);
    await expect(readFile(
      path.join(value.root, "case-one.json"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects any request not registered in the frozen runtime", async () => {
    const value = await fixture();
    await expect(
      value.planner.plan(request("另一个未冻结问题")),
    ).rejects.toThrow(
      "T45_PLANNER_CASE_CHECKPOINT_REQUEST_UNREGISTERED",
    );
    expect(value.plan).not.toHaveBeenCalled();
  });
});
