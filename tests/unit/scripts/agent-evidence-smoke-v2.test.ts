// @vitest-environment node

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  AgentEvidenceToolOutputV2,
} from "@/lib/agent/evidence-tool-v2";
import {
  evaluateAgentEvidenceSmokeV2,
  runAgentEvidenceSmokeV2,
  T5_AGENT_EVIDENCE_QUESTION_V2,
} from "@/scripts/audit-agent-evidence-smoke-v2";

function outputFixture():
  AgentEvidenceToolOutputV2 {
  return {
    schemaVersion: 2,
    kind: "KNOWLEDGE_MAP_SEARCH_EVIDENCE",
    bundle: {
      bundleId: "bundle-smoke",
      status: "SUCCESS",
      queryHash: "1".repeat(64),
      corpusBundleHash:
        "82db90934afaffa3d227b6b0d11ab5efdb88009fd8b9274845567de4888079f8",
      activeIndexBundleHash:
        "cad61822cf3e4d95e984b08c66fa6427c5adf182fc305329291f8eb9aad1be5d",
      capabilitiesLost: [],
    },
    channels: [
      {
        channel: "LEXICAL",
        status: "SUCCESS",
        hitCount: 1,
        indexVersionId: "lexical-v1",
        modelId: null,
        modelRevision: null,
      },
      {
        channel: "TEXT_VECTOR",
        status: "SUCCESS",
        hitCount: 1,
        indexVersionId: "text-v1",
        modelId: "bge-test",
        modelRevision: "revision-1",
      },
      {
        channel: "VISUAL_VECTOR",
        status: "SUCCESS",
        hitCount: 1,
        indexVersionId: "visual-v1",
        modelId: "siglip-test",
        modelRevision: "revision-1",
      },
    ],
    evidence: {
      nodes: [{
        nodeId: "node-smoke",
        objectId: "object-smoke",
        sourceId: "source-smoke",
        kind: "IMAGE",
        relation: "PRIMARY",
        evidenceKind: "VISUAL_REFERENCE",
        excerpt: "课程参考图。",
        assetId: "asset-smoke",
      }],
      assets: [{
        assetId: "asset-smoke",
        objectId: "object-smoke",
        sha256: "4".repeat(64),
        widthPx: 1200,
        heightPx: 800,
        previewUrl:
          "/api/knowledge/assets/asset-smoke",
      }],
      regions: [{
        regionId: "region-smoke",
        objectId: "object-smoke",
        assetId: "asset-smoke",
        regionNodeId: "node-smoke",
        bbox: {
          coordinateSpace: "NORMALIZED",
          x: 0.1,
          y: 0.2,
          width: 0.4,
          height: 0.5,
        },
        previewUrl:
          "/api/knowledge/assets/asset-smoke",
      }],
      sources: [{
        sourceId: "source-smoke",
        objectId: "object-smoke",
        title: "视觉层级课程参考",
        authority: "COURSE_DESIGN",
        verifiedDate: "2026-07-30",
        scope: "版式设计课程资料。",
      }],
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

describe("T5 Agent evidence smoke", () => {
  it("accepts a bounded and fully traceable V2 projection", () => {
    const report =
      evaluateAgentEvidenceSmokeV2(
        outputFixture(),
      );

    expect(report.decision)
      .toBe("T5_AGENT_EVIDENCE_GO");
    expect(report.question)
      .toBe(T5_AGENT_EVIDENCE_QUESTION_V2);
    expect(report.counts).toEqual({
      nodes: 1,
      assets: 1,
      regions: 1,
      sources: 1,
    });
    expect(report.jsonBytes)
      .toBeLessThanOrEqual(report.limitBytes);
    expect(Object.values(report.checks))
      .toEqual(expect.arrayContaining([true]));
  });

  it("rejects identity drift and orphaned node assets", () => {
    const drifted = outputFixture();
    drifted.bundle.activeIndexBundleHash =
      "0".repeat(64);

    const report =
      evaluateAgentEvidenceSmokeV2(drifted);

    expect(report.decision)
      .toBe("T5_AGENT_EVIDENCE_NO_GO");
    expect(report.checks.frozenIdentity)
      .toBe(false);

    const orphaned = outputFixture();
    orphaned.evidence.assets = [];
    expect(() =>
      evaluateAgentEvidenceSmokeV2(
        orphaned,
      )).toThrow(
      "Agent evidence node asset must be retained",
    );
  });

  it("uses the injected local port once and always disposes it", async () => {
    const search = vi.fn(async () =>
      outputFixture());
    const dispose = vi.fn(
      async () => undefined,
    );

    const report =
      await runAgentEvidenceSmokeV2(
        process.cwd(),
        {
          getPort: async () => ({ search }),
          dispose,
        },
      );

    expect(search).toHaveBeenCalledWith({
      query: T5_AGENT_EVIDENCE_QUESTION_V2,
      coursePackId: "layout-design",
      coursePackVersion: "1",
      signal: expect.any(AbortSignal),
    });
    expect(dispose).toHaveBeenCalledOnce();
    expect(report.decision)
      .toBe("T5_AGENT_EVIDENCE_GO");
  });
});
