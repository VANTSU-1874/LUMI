// @vitest-environment node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
  T44_OBLIGATION_CANDIDATE_CONFIG_V1,
  T44ObligationCandidateArtifactV1Schema,
  buildT44ObligationMatrixBridgeManifestV1,
  sealT44ObligationArtifactV1,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";

const HASH = "a".repeat(64);

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function frozenFiftyCaseBridgeInput() {
  const obligationSets = new Map();
  const cases = Array.from(
    { length: 50 },
    (_, index) => {
      const caseId = `matrix-case-${index + 1}`;
      const question = `矩阵传输问题 ${index + 1}`;
      const objectId = `matrix-object-${index + 1}`;
      const nodeId = `node-${sha256(caseId)}`;
      const obligationSet = {
        schemaVersion: 1 as const,
        plannerId:
          "lumi-answer-obligation-planner-v1" as const,
        plannerVersion: "1.0.0",
        modelId: "gpt-5.6-test",
        normalizedQuestion: question,
        normalizedQuestionHash: sha256(question),
        status: "READY" as const,
        obligations: [{
          obligationId: "obligation-1",
          learnerNeed: `说明${question}的处理方法`,
          intent: "HOW_TO" as const,
          sourceAnchors: [{
            source: "CURRENT_MESSAGE" as const,
            sourceMessageHash: sha256(question),
            quote: question,
            startCodePoint: 0,
            endCodePoint:
              Array.from(question).length,
          }],
          entityMentions: [],
          constraints: [],
          evidenceNeeds: ["DIRECT_TEXT" as const],
          retrievalQueries: [{
            text: `${question} 处理方法`,
            purpose: "DIRECT" as const,
          }],
          confidence: 0.9,
        }],
        clarifyingQuestion: null,
        artworkObservationHints: [],
        trace: {
          promptHash: HASH,
          outputHash: HASH,
          elapsedMs: 1,
        },
      };
      obligationSets.set(caseId, obligationSet);
      const arm = {
        directEvidenceBatchHash: HASH,
        rrfResultHash: HASH,
        objectRanking: [{
          objectId,
          fusedRank: 1,
          fusionScore: 1,
          bestRawRank: 1,
          obligationIds: ["obligation-1"],
          origins: ["LEXICAL" as const],
        }],
        candidateNodes: [{
          nodeId,
          objectId,
          coursePackId: "layout-design",
          objectRank: 1,
          kind: "TEXT" as const,
          role: "FACT" as const,
          text: `${question}的原子证据`,
          nodeContentHash: HASH,
          objectContentHash: HASH,
          sourceHash: HASH,
        }],
        candidateNodeIdsSha256:
          sha256StableJsonV2([nodeId]),
      };
      return {
        caseId,
        coursePackId: "layout-design",
        coursePackVersion: "1" as const,
        normalizedQuestionHash:
          obligationSet.normalizedQuestionHash,
        obligationSetHash:
          sha256StableJsonV2(obligationSet),
        retrievalPlanHash: HASH,
        arms: {
          A_WHOLE_QUERY: arm,
          B_MODEL_GUIDED: arm,
        },
      };
    },
  );
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_CANDIDATES",
      runtimeSuite: {
        id: "lumi-t44-cardinality-runtime",
        version: "2026-07-29.1",
        suiteHash: HASH,
      },
      corpusSnapshot: {
        bundleHash: HASH,
      },
      config: T44_OBLIGATION_CANDIDATE_CONFIG_V1,
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
      cases,
    });
  return buildT44ObligationMatrixBridgeManifestV1({
    candidateArtifact: candidate,
    candidateArtifactSha256:
      sealT44ObligationArtifactV1(candidate).sha256,
    obligationSets,
  }).arms.B_MODEL_GUIDED.input;
}

describe("T4.4 claim matrix transport cardinality", () => {
  it("derives 1..50 cardinality from sealed input and validates a 20-case transport", () => {
    const input = structuredClone(
      frozenFiftyCaseBridgeInput(),
    );
    input.cases = input.cases.slice(0, 20);
    input.expectedProviderCalls = 40;
    input.expectedChannelCalls = {
      LEXICAL: 20,
      TEXT_VECTOR: 20,
    };
    const script = String.raw`
import copy
import importlib.util
import json
import sys
from pathlib import Path

module_path = Path.cwd() / "tools" / "reranker" / "t44_claim_matrix.py"
spec = importlib.util.spec_from_file_location("lumi_t44_claim_matrix", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

value = json.loads(sys.stdin.read())
accepted = module.validate_candidate_input(value)

def error_code(candidate):
    try:
        module.validate_candidate_input(candidate)
    except ValueError as error:
        return str(error)
    raise AssertionError("candidate unexpectedly accepted")

wrong_calls = copy.deepcopy(value)
wrong_calls["expectedProviderCalls"] = 100
empty = copy.deepcopy(value)
empty["cases"] = []
empty["expectedProviderCalls"] = 0
empty["expectedChannelCalls"] = {"LEXICAL": 0, "TEXT_VECTOR": 0}
too_many = copy.deepcopy(value)
too_many["cases"] = [
    *value["cases"],
    *[
        {
            **copy.deepcopy(value["cases"][0]),
            "caseId": f"overflow-case-{index + 1}",
        }
        for index in range(31)
    ],
]
too_many["expectedProviderCalls"] = 102
too_many["expectedChannelCalls"] = {"LEXICAL": 51, "TEXT_VECTOR": 51}

print(json.dumps({
    "acceptedCases": len(accepted["cases"]),
    "wrongCalls": error_code(wrong_calls),
    "empty": error_code(empty),
    "tooMany": error_code(too_many),
}, separators=(",", ":")))
`;
    const output = JSON.parse(
      execFileSync("python", ["-c", script], {
        cwd: process.cwd(),
        encoding: "utf8",
        input: JSON.stringify(input),
        timeout: 10_000,
      }),
    ) as {
      acceptedCases: number;
      wrongCalls: string;
      empty: string;
      tooMany: string;
    };

    expect(output).toEqual({
      acceptedCases: 20,
      wrongCalls: "T44_CLAIM_PROVIDER_CALLS_INVALID",
      empty: "T44_CLAIM_CASE_COUNT_INVALID",
      tooMany: "T44_CLAIM_CASE_COUNT_INVALID",
    });
  });
});
