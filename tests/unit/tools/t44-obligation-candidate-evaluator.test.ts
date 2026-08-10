// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
  T44_OBLIGATION_CANDIDATE_CONFIG_V1,
  T44ObligationCandidateArtifactV1Schema,
  T44ObligationMatrixBridgeManifestV1Schema,
  assertT44ObligationArtifactLabelBlindV1,
  buildT44ObligationMatrixBridgeManifestV1,
  enumerateT44ObligationCandidateNodesV1,
  isT44ObligationCandidateEligibleNodeV1,
  projectT44ObligationMatrixClaimTextV1,
  sealT44ObligationArtifactV1,
  verifyT44ObligationArtifactSealV1,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";

const HASH = "a".repeat(64);

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

async function corpus() {
  return verifyKnowledgeCorpusBundleV2(JSON.parse(
    await readFile(
      path.resolve(
        "data/knowledge-v2/knowledge-corpus.v2.json",
      ),
      "utf8",
    ),
  ) as unknown);
}

function artifact() {
  return T44ObligationCandidateArtifactV1Schema.parse({
    schemaVersion: 1,
    kind: "T44_OBLIGATION_CANDIDATES",
    runtimeSuite: {
      id: "lumi-test-suite",
      version: "1",
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
      expectedCalls: 2,
      actualCalls: 2,
      channelCounts: {
        LEXICAL: 1,
        TEXT_VECTOR: 1,
        VISUAL_VECTOR: 0,
      },
      matched: true,
    },
    cases: [{
      caseId: "case-one",
      coursePackId: "layout-design",
      coursePackVersion: "1",
      normalizedQuestionHash: HASH,
      obligationSetHash: HASH,
      retrievalPlanHash: HASH,
      arms: {
        A_WHOLE_QUERY: {
          directEvidenceBatchHash: HASH,
          rrfResultHash: HASH,
          objectRanking: [],
          candidateNodes: [],
          candidateNodeIdsSha256:
            sha256StableJsonV2([]),
        },
        B_MODEL_GUIDED: {
          directEvidenceBatchHash: HASH,
          rrfResultHash: HASH,
          objectRanking: [],
          candidateNodes: [],
          candidateNodeIdsSha256:
            sha256StableJsonV2([]),
        },
      },
    }],
  });
}

describe("T4.4 obligation candidate artifact", () => {
  it("enumerates every canonical FACT/ACTION/TABLE node without a per-owner cap", async () => {
    const bundle = await corpus();
    const object = bundle.objects.find(
      ({ id }) =>
        id === "layout-022-tactile-texture-style-fit",
    );
    expect(object).toBeDefined();
    const expected = object!.nodes.filter(
      (node) =>
        node.kind === "TABLE"
        || (
          node.kind === "TEXT"
          && (
            node.role === "FACT"
            || node.role === "ACTION"
          )
        ),
    );

    const nodes =
      enumerateT44ObligationCandidateNodesV1({
        corpus: bundle,
        coursePackId: "layout-design",
        rankedObjectIds: [object!.id],
      });

    expect(nodes).toHaveLength(expected.length);
    expect(nodes.length).toBeGreaterThan(3);
    expect(nodes.map(({ nodeId }) => nodeId).sort())
      .toEqual(expected.map(({ id }) => id).sort());
    expect(new Set(nodes.map(({ objectId }) => objectId)))
      .toEqual(new Set([object!.id]));
  });

  it("exposes the exact candidate-role predicate for qrels authoring", async () => {
    const bundle = await corpus();
    const nodes = bundle.objects.flatMap(({ nodes }) => nodes);
    const content = nodes.find(
      (node) =>
        node.kind === "TEXT" && node.role === "CONTENT",
    );
    const fact = nodes.find(
      (node) =>
        node.kind === "TEXT" && node.role === "FACT",
    );
    const action = nodes.find(
      (node) =>
        node.kind === "TEXT" && node.role === "ACTION",
    );
    expect(content).toBeDefined();
    expect(fact).toBeDefined();
    expect(action).toBeDefined();
    expect(isT44ObligationCandidateEligibleNodeV1(content!))
      .toBe(false);
    expect(isT44ObligationCandidateEligibleNodeV1(fact!))
      .toBe(true);
    expect(isT44ObligationCandidateEligibleNodeV1(action!))
      .toBe(true);
  });

  it("uses a code-point-bounded, auditable matrix bridge projection", () => {
    const input = `${"版".repeat(119)}😀尾`;
    const projection =
      projectT44ObligationMatrixClaimTextV1(input);

    expect(Array.from(projection.text)).toHaveLength(120);
    expect(projection.text.endsWith("😀")).toBe(true);
    expect(projection.truncated).toBe(true);
    expect(projection.originalCodePoints).toBe(121);
    expect(projection.projectedCodePoints).toBe(120);
  });

  it("rejects label-bearing runtime fields but permits provider expected/actual audit", () => {
    const value = artifact();
    expect(
      assertT44ObligationArtifactLabelBlindV1(value),
    ).toBe(value);
    expect(() =>
      assertT44ObligationArtifactLabelBlindV1({
        ...value,
        cases: [{
          ...value.cases[0],
          requiredEvidenceGroups: [],
        }],
      })).toThrow(/LABEL_FIELD_FORBIDDEN/);
    expect(() =>
      assertT44ObligationArtifactLabelBlindV1({
        ...value,
        qrels: {},
      })).toThrow(/LABEL_FIELD_FORBIDDEN/);
    for (
      const field
      of [
        "hardNegativeNodeIds",
        "hard_negative_node_ids",
        "hard-node-negative-ids",
      ]
    ) {
      expect(() =>
        assertT44ObligationArtifactLabelBlindV1({
          ...value,
          [field]: [],
        })).toThrow(/LABEL_FIELD_FORBIDDEN/);
    }
  });

  it("byte-seals candidates and rejects candidate SHA drift", () => {
    const sealed = sealT44ObligationArtifactV1(artifact());
    expect(
      verifyT44ObligationArtifactSealV1(sealed),
    ).toEqual(artifact());

    expect(() =>
      verifyT44ObligationArtifactSealV1({
        ...sealed,
        serialized: sealed.serialized.replace(
          '"actualCalls": 2',
          '"actualCalls": 1',
        ),
      })).toThrow(/ARTIFACT_SHA_DRIFT/);
  });

  it("fixes Graphify invocation count at zero", () => {
    expect(() =>
      T44ObligationCandidateArtifactV1Schema.parse({
        ...artifact(),
        graphifyInvocationCount: 1,
      })).toThrow();
  });

  it("derives 20- and 50-case frozen-scorer transports from sealed label-blind candidates", () => {
    for (const caseCount of [20, 50]) {
      const obligationSets = new Map();
      const cases = Array.from(
      { length: caseCount },
      (_, index) => {
        const question = `测试问题${index + 1}`;
        const set = {
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
            learnerNeed: `说明${question}应该怎么处理`,
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
        const caseId = `case-${index + 1}`;
        obligationSets.set(caseId, set);
        const emptyArm = {
          directEvidenceBatchHash: null,
          rrfResultHash: null,
          objectRanking: [],
          candidateNodes: [],
          candidateNodeIdsSha256:
            sha256StableJsonV2([]),
        };
        return {
          caseId,
          coursePackId: "layout-design",
          coursePackVersion: "1" as const,
          normalizedQuestionHash:
            set.normalizedQuestionHash,
          obligationSetHash:
            sha256StableJsonV2(set),
          retrievalPlanHash: HASH,
          arms: {
            A_WHOLE_QUERY: emptyArm,
            B_MODEL_GUIDED: emptyArm,
          },
        };
      },
    );
    const candidate =
      T44ObligationCandidateArtifactV1Schema.parse({
        ...artifact(),
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
    const candidateSeal =
      sealT44ObligationArtifactV1(candidate);
    const manifest =
      buildT44ObligationMatrixBridgeManifestV1({
        candidateArtifact: candidate,
        candidateArtifactSha256:
          candidateSeal.sha256,
        obligationSets,
      });

      expect(
        manifest.arms.A_WHOLE_QUERY.input.cases,
      ).toHaveLength(caseCount);
      expect(
        manifest.arms.B_MODEL_GUIDED.input.cases,
      ).toHaveLength(caseCount);
      expect(
        manifest.arms.B_MODEL_GUIDED.input
          .expectedProviderCalls,
      ).toBe(caseCount * 2);
      expect(
        manifest.arms.B_MODEL_GUIDED.audit
          .compatibilityExpectedProviderCalls,
      ).toBe(caseCount * 2);
      expect(
        manifest.arms.B_MODEL_GUIDED.audit
          .actualProviderCallsSource,
      ).toBe("SEALED_PROVIDER_ARTIFACT");
      const mutationAccepted: Record<
        string,
        boolean
      > = {};
      for (
        const armName
        of [
          "A_WHOLE_QUERY",
          "B_MODEL_GUIDED",
        ] as const
      ) {
        const wrongCount = structuredClone(manifest);
        wrongCount.arms[armName].audit
          .compatibilityExpectedProviderCalls += 2;
        mutationAccepted[
          `${armName}:wrong-count`
        ] =
          T44ObligationMatrixBridgeManifestV1Schema
            .safeParse(wrongCount).success;

        const shortProjection =
          structuredClone(manifest);
        shortProjection.arms[armName].audit
          .claimProjections.pop();
        mutationAccepted[
          `${armName}:short-projection`
        ] =
          T44ObligationMatrixBridgeManifestV1Schema
            .safeParse(shortProjection).success;

        const reversedProjection =
          structuredClone(manifest);
        reversedProjection.arms[armName].audit
          .claimProjections.reverse();
        mutationAccepted[
          `${armName}:reversed-projection`
        ] =
          T44ObligationMatrixBridgeManifestV1Schema
            .safeParse(reversedProjection).success;
      }
      expect(mutationAccepted).toEqual({
        "A_WHOLE_QUERY:wrong-count": false,
        "A_WHOLE_QUERY:short-projection": false,
        "A_WHOLE_QUERY:reversed-projection": false,
        "B_MODEL_GUIDED:wrong-count": false,
        "B_MODEL_GUIDED:short-projection": false,
        "B_MODEL_GUIDED:reversed-projection": false,
      });
    }
  });
});
