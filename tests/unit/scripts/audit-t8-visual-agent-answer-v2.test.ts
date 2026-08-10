// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { AgentEvidenceToolOutputV2 } from "@/lib/agent/evidence-tool-v2";
import {
  buildT8VisualOutboundPayload,
  parseT8VisualOutputName,
  T8_VISUAL_AGENT_QUESTION_V2,
} from "@/scripts/audit-t8-visual-agent-answer-v2";

function outputFixture(): AgentEvidenceToolOutputV2 {
  return {
    schemaVersion: 2,
    kind: "KNOWLEDGE_MAP_SEARCH_EVIDENCE",
    bundle: {
      bundleId: "bundle-t8-visual",
      status: "SUCCESS",
      queryHash: "1".repeat(64),
      corpusBundleHash: "2".repeat(64),
      activeIndexBundleHash: "3".repeat(64),
      capabilitiesLost: [],
    },
    channels: [
      { channel: "LEXICAL", status: "SUCCESS", hitCount: 1, indexVersionId: "lexical-t8", modelId: null, modelRevision: null },
      { channel: "TEXT_VECTOR", status: "SUCCESS", hitCount: 1, indexVersionId: "text-t8", modelId: "bge-t8", modelRevision: "revision-t8" },
      { channel: "VISUAL_VECTOR", status: "SUCCESS", hitCount: 1, indexVersionId: "visual-t8", modelId: "siglip-t8", modelRevision: "revision-t8" },
    ],
    evidence: {
      nodes: [
        {
          nodeId: "node-t8-first",
          objectId: "object-t8-first",
          sourceId: "source-t8-first",
          kind: "IMAGE",
          relation: "PRIMARY",
          evidenceKind: "VISUAL_REFERENCE",
          excerpt: "先比较主标题、图片与亮色的视觉主次。",
          assetId: "asset-t8-first",
        },
        {
          nodeId: "node-t8-second",
          objectId: "object-t8-second",
          sourceId: "source-t8-second",
          kind: "TEXT",
          relation: "PRIMARY",
          evidenceKind: "KNOWLEDGE_FACT",
          excerpt: "先建立一个主视觉锚点，再检查其他元素是否抢占注意力。",
          assetId: "asset-t8-second",
        },
      ],
      assets: [
        { assetId: "asset-t8-first", objectId: "object-t8-first", sha256: "4".repeat(64), widthPx: 1200, heightPx: 800, previewUrl: "/api/knowledge/assets/asset-t8-first" },
        { assetId: "asset-t8-second", objectId: "object-t8-second", sha256: "5".repeat(64), widthPx: 1200, heightPx: 800, previewUrl: "/api/knowledge/assets/asset-t8-second" },
      ],
      regions: [],
      sources: [
        { sourceId: "source-t8-first", objectId: "object-t8-first", title: "视觉层级课程参考", authority: "COURSE_DESIGN", verifiedDate: "2026-07-31", scope: "版式课程资料" },
        { sourceId: "source-t8-second", objectId: "object-t8-second", title: "主视觉锚点课程参考", authority: "COURSE_DESIGN", verifiedDate: "2026-07-31", scope: "版式课程资料" },
      ],
    },
    usageRules: {
      knowledgeFacts: "只把带 excerpt 的课程节点作为课程知识事实。",
      visualReferences: "图片和区域是课程参考图，只描述其中可见内容，不当作学生当前作品。",
      inference: "超出节点文字或参考图可见内容的判断必须明确标为推断。",
      uncertainty: "证据不足或通道降级时要说明不确定性，不得补造来源。",
    },
  };
}

describe("T8 visual agent answer audit", () => {
  it("sends only bounded evidence closure and selected course previews", () => {
    const bounded = buildT8VisualOutboundPayload({
      textOutput: outputFixture(),
      visualOutput: outputFixture(),
    });

    expect(bounded.payload.question).toBe(T8_VISUAL_AGENT_QUESTION_V2);
    expect(bounded.payload.evidence.nodes).toHaveLength(2);
    expect(bounded.payload.evidence.sources.map(({ sourceId }) => sourceId))
      .toEqual(["source-t8-first", "source-t8-second"]);
    expect(bounded.selectedAssetIds)
      .toEqual(["asset-t8-first", "asset-t8-second"]);
    expect(bounded.payloadBytes).toBeLessThanOrEqual(12 * 1024);
    expect(JSON.stringify(bounded.payload)).not.toContain("data/courses");
    expect(JSON.stringify(bounded.payload)).not.toContain("LOCAL_DOCUMENT");
  });

  it("refuses a non-success bundle before any model payload exists", () => {
    const fixture = outputFixture();
    fixture.bundle.status = "DEGRADED";

    expect(() => buildT8VisualOutboundPayload({
      textOutput: fixture,
      visualOutput: outputFixture(),
    }))
      .toThrow("T8_VISUAL_EVIDENCE_BUNDLE_NOT_SUCCESS");
  });

  it("keeps the default audit artifact name inside the explicit allowlist", () => {
    expect(parseT8VisualOutputName([]))
      .toBe("t8-3-visual-agent-answer-v1.json");
    expect(() => parseT8VisualOutputName([
      "--output-name",
      "t8.3-visual-agent-answer-v1.json",
    ])).toThrow("T8_VISUAL_OUTPUT_ARGUMENT_INVALID");
  });
});
