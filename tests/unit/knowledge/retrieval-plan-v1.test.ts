import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AnswerObligationSetV1Schema,
  createDegradedAnswerObligationSetV1,
} from "@/lib/knowledge/answer-obligation-v1";
import {
  MODEL_GUIDED_RETRIEVAL_LIMITS_V1,
  RELATION_ALLOWLIST_BY_INTENT_V1,
  compileRetrievalPlanV1,
  retrievalPlanHashV1,
} from "@/lib/knowledge/retrieval-plan-v1";
import { normalizeRetrievalTextV2 } from "@/lib/knowledge/retrieval-query-v2";

const question = "这个版面看着乱，怎么判断原因、先改哪里，还要怎么检查改完有没有用？";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function obligationSet(input: {
  status?: "READY" | "CLARIFY";
  obligationCount?: number;
  sharedQuery?: string;
  visual?: boolean;
}) {
  const obligationCount = input.obligationCount ?? 2;
  const intents = [
    "DIAGNOSE_CAUSE",
    "FIRST_ACTION",
    "CHECK_CRITERIA",
    "RISK_MITIGATION",
  ] as const;
  return AnswerObligationSetV1Schema.parse({
    schemaVersion: 1,
    plannerId: "lumi-answer-obligation-planner-v1",
    plannerVersion: "1.0.0",
    modelId: "gpt-5.6",
    normalizedQuestion: normalizeRetrievalTextV2(question),
    normalizedQuestionHash: sha256(normalizeRetrievalTextV2(question)),
    status: input.status ?? "READY",
    obligations: Array.from({ length: obligationCount }, (_, index) => ({
      obligationId: `obligation-${index + 1}`,
      learnerNeed: `处理第 ${index + 1} 项真实需求`,
      intent: intents[index]!,
      sourceAnchors: [{
        source: "CURRENT_MESSAGE",
        sourceMessageHash: sha256(question),
        quote: question,
        startCodePoint: 0,
        endCodePoint: Array.from(question).length,
      }],
      entityMentions: [{
        surface: "版面",
        normalized: "版面",
        anchorIndexes: [0],
      }],
      constraints: [],
      evidenceNeeds: input.visual && index === 0
        ? ["VISUAL_EXAMPLE"]
        : ["DIRECT_TEXT"],
      retrievalQueries: input.sharedQuery
        ? [{ text: input.sharedQuery, purpose: "DIRECT" }]
        : [
            { text: `第 ${index + 1} 项直接证据`, purpose: "DIRECT" },
            { text: `第 ${index + 1} 项同义表达`, purpose: "ALIAS" },
          ],
      confidence: 0.9,
    })),
    clarifyingQuestion: input.status === "CLARIFY"
      ? "你更想先解决哪个部分？"
      : null,
    artworkObservationHints: [],
    trace: {
      promptHash: "1".repeat(64),
      outputHash: "2".repeat(64),
      elapsedMs: 25,
    },
  });
}

describe("retrieval plan v1", () => {
  it("caps physical queries at five including the whole question", () => {
    const compiled = compileRetrievalPlanV1(obligationSet({
      obligationCount: 4,
    }));

    expect(compiled.physicalQueries).toHaveLength(5);
    expect(compiled.physicalQueries[0]).toMatchObject({
      source: "WHOLE_QUERY",
      normalizedText: normalizeRetrievalTextV2(question),
    });
    expect(compiled.plan.directEvidenceQueries).toHaveLength(4);
    expect(new Set(
      compiled.plan.directEvidenceQueries.map(({ obligationId }) => obligationId),
    ).size).toBe(4);
    expect(compiled.physicalQueries.length).toBeLessThanOrEqual(
      MODEL_GUIDED_RETRIEVAL_LIMITS_V1.maximumPhysicalQueries,
    );
  });

  it("executes a normalized duplicate once while retaining every obligation binding", () => {
    const compiled = compileRetrievalPlanV1(obligationSet({
      obligationCount: 2,
      sharedQuery: "  版面   层级  ",
    }));
    const shared = compiled.physicalQueries.find(
      ({ normalizedText }) => normalizedText === "版面 层级",
    );

    expect(compiled.physicalQueries).toHaveLength(2);
    expect(shared?.obligationIds).toEqual([
      "obligation-1",
      "obligation-2",
    ]);
    expect(compiled.plan.directEvidenceQueries).toHaveLength(2);
  });

  it("derives relation hints only from the frozen intent allowlist", () => {
    const compiled = compileRetrievalPlanV1(obligationSet({
      obligationCount: 4,
    }));

    expect(compiled.plan.relationIntentHints).toEqual([
      expect.objectContaining({
        obligationId: "obligation-1",
        allowedRelationTypes: RELATION_ALLOWLIST_BY_INTENT_V1.DIAGNOSE_CAUSE,
      }),
      expect.objectContaining({
        obligationId: "obligation-2",
        allowedRelationTypes: RELATION_ALLOWLIST_BY_INTENT_V1.FIRST_ACTION,
      }),
      expect.objectContaining({
        obligationId: "obligation-3",
        allowedRelationTypes: RELATION_ALLOWLIST_BY_INTENT_V1.CHECK_CRITERIA,
      }),
      expect.objectContaining({
        obligationId: "obligation-4",
        allowedRelationTypes: RELATION_ALLOWLIST_BY_INTENT_V1.RISK_MITIGATION,
      }),
    ]);
    expect(JSON.stringify(compiled.plan.relationIntentHints)).not.toContain(
      "canonicalEntityId",
    );
  });

  it("uses IMAGE as text-to-image evidence targeting without a query asset", () => {
    const compiled = compileRetrievalPlanV1(obligationSet({
      obligationCount: 1,
      visual: true,
    }));

    expect(compiled.plan.directEvidenceQueries[0]?.modalities).toEqual([
      "IMAGE",
    ]);
    expect(compiled.physicalQueries[0]?.modalities).toEqual([
      "TEXT",
      "IMAGE",
    ]);
    expect(compiled.physicalQueries[1]?.modalities).toEqual([
      "IMAGE",
    ]);
    expect(JSON.stringify(compiled)).not.toContain("queryAsset");
  });

  it("keeps the whole-query baseline for CLARIFY without model-guided probes", () => {
    const compiled = compileRetrievalPlanV1(obligationSet({
      status: "CLARIFY",
    }));

    expect(compiled.plan.directEvidenceQueries).toEqual([]);
    expect(compiled.physicalQueries).toHaveLength(1);
    expect(compiled.physicalQueries[0]).toMatchObject({
      normalizedText: normalizeRetrievalTextV2(question),
      source: "WHOLE_QUERY",
      obligationIds: [],
    });
  });

  it("degrades to the whole question without obligation probes", () => {
    const degraded = createDegradedAnswerObligationSetV1({
      request: {
        schemaVersion: 1,
        currentMessage: {
          source: "CURRENT_MESSAGE",
          message: question,
          messageHash: sha256(question),
        },
        recentTurns: [],
        coursePack: {
          id: "layout-design",
          version: "1",
          label: "版式设计",
          summary: "版式设计课程包。",
        },
        view: { id: "student-conversation", focus: null },
        hasArtwork: false,
        artworkHash: null,
      },
      metadata: {
        plannerVersion: "1.0.0",
        modelId: "gpt-5.6",
        promptHash: "1".repeat(64),
        outputHash: "2".repeat(64),
        elapsedMs: 5_000,
      },
    });
    const compiled = compileRetrievalPlanV1(degraded);

    expect(compiled.plan.directEvidenceQueries).toEqual([]);
    expect(compiled.physicalQueries).toHaveLength(1);
    expect(compiled.physicalQueries[0]?.source).toBe("WHOLE_QUERY");
  });

  it("produces deterministic plan and config hashes", () => {
    const first = compileRetrievalPlanV1(obligationSet({}));
    const second = compileRetrievalPlanV1(obligationSet({}));

    expect(first).toEqual(second);
    expect(first.planHash).toBe(retrievalPlanHashV1(first.plan));
    expect(first.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.configHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
