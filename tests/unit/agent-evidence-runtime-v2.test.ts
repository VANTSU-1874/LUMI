// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AgentEvidenceToolOutputV2,
} from "@/lib/agent/evidence-tool-v2";
import {
  mergeAgentEvidenceTextFallbackV2,
} from "@/lib/knowledge/agent-evidence-runtime-v2";

function output(input: {
  kind: "VISUAL_EMPTY" | "TEXT_SUCCESS";
  corpusHash?: string;
}): AgentEvidenceToolOutputV2 {
  const text = input.kind === "TEXT_SUCCESS";
  return {
    schemaVersion: 2,
    kind:
      "KNOWLEDGE_MAP_SEARCH_EVIDENCE",
    bundle: {
      bundleId: text
        ? "evidence-text"
        : "evidence-visual",
      status: text ? "SUCCESS" : "EMPTY",
      queryHash: text
        ? "1".repeat(64)
        : "2".repeat(64),
      corpusBundleHash:
        input.corpusHash ?? "3".repeat(64),
      activeIndexBundleHash:
        "4".repeat(64),
      capabilitiesLost: [],
    },
    channels: [{
      channel: "LEXICAL",
      status: "SUCCESS",
      hitCount: text ? 2 : 1,
      indexVersionId: "lexical-v1",
      modelId: null,
      modelRevision: null,
    }, {
      channel: "TEXT_VECTOR",
      status: "SUCCESS",
      hitCount: text ? 2 : 1,
      indexVersionId: "text-v1",
      modelId: "bge-fixture",
      modelRevision: "revision-1",
    }, {
      channel: "VISUAL_VECTOR",
      status: text ? "SKIPPED" : "EMPTY",
      hitCount: 0,
      indexVersionId: text
        ? null
        : "visual-v1",
      modelId: text
        ? null
        : "siglip-fixture",
      modelRevision: text
        ? null
        : "revision-1",
    }],
    evidence: text
      ? {
          nodes: [{
            nodeId: "node-text",
            objectId: "object-text",
            sourceId: "source-text",
            kind: "TEXT",
            relation: "PRIMARY",
            evidenceKind:
              "KNOWLEDGE_FACT",
            excerpt: "课程文字证据。",
            assetId: null,
          }],
          assets: [],
          regions: [],
          sources: [{
            sourceId: "source-text",
            objectId: "object-text",
            title: "课程文字",
            authority: "COURSE_DESIGN",
            verifiedDate: "2026-07-31",
            scope: "本地测试。",
          }],
        }
      : {
          nodes: [],
          assets: [],
          regions: [],
          sources: [],
        },
    usageRules: {
      knowledgeFacts:
        "只把带 excerpt 的课程节点作为课程知识事实。",
      visualReferences:
        "图片和区域是课程参考图，只描述其中可见内容，不当作学生当前作品。",
      inference:
        "超出节点文字或参考图可见内容的判断必须明确标为推断。",
      uncertainty:
        "证据不足或通道降级时要说明不确定性，不得补造来源。",
    },
  };
}

describe("Agent evidence text fallback V2", () => {
  it("keeps text evidence when visual retrieval is healthy empty", () => {
    const merged =
      mergeAgentEvidenceTextFallbackV2(
        output({ kind: "VISUAL_EMPTY" }),
        output({ kind: "TEXT_SUCCESS" }),
      );

    expect(merged.bundle.status)
      .toBe("SUCCESS");
    expect(merged.evidence.nodes)
      .toHaveLength(1);
    expect(
      merged.channels.find(
        ({ channel }) =>
          channel === "VISUAL_VECTOR",
      ),
    ).toMatchObject({
      status: "EMPTY",
      hitCount: 0,
    });
    expect(merged.bundle.bundleId)
      .toMatch(/^evidence-[a-f0-9]{64}$/);
  });

  it("rejects cross-generation fallback evidence", () => {
    expect(() =>
      mergeAgentEvidenceTextFallbackV2(
        output({ kind: "VISUAL_EMPTY" }),
        output({
          kind: "TEXT_SUCCESS",
          corpusHash: "9".repeat(64),
        }),
      )).toThrow(
      "AGENT_EVIDENCE_FALLBACK_IDENTITY_DRIFT",
    );
  });
});
