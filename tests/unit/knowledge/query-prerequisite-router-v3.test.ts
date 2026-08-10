// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createCapabilityEntityManifestV2,
} from "@/lib/knowledge/capability-boundary-v2";
import { sha256StableJsonV2 } from "@/lib/knowledge/knowledge-object-v2";
import {
  evaluateQueryPrerequisiteV3,
  QUERY_PREREQUISITE_CONFIG_HASH_V3,
  QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3,
  QUERY_PREREQUISITE_FEATURE_ALGORITHM_V3,
  QUERY_PREREQUISITE_POLICY_HASH_V3,
  QUERY_PREREQUISITE_POLICY_V3,
  runQueryPrerequisiteShadowV3,
} from "@/lib/knowledge/query-prerequisite-router-v3";
import {
  createRetrievalQueryV2,
  type RetrievalQueryV2,
} from "@/lib/knowledge/retrieval-query-v2";

const CORPUS_HASH = "a".repeat(64);
const OTHER_CORPUS_HASH = "b".repeat(64);
const ASSET_HASH = "c".repeat(64);
const LAYOUT = { id: "layout-design", version: "1" } as const;
const BRAND = { id: "brand-vi-design", version: "1" } as const;

function query(
  text: string,
  sourceCoursePack: typeof LAYOUT | typeof BRAND = LAYOUT,
) {
  return createRetrievalQueryV2({
    mode: "TEXT_TO_TEXT",
    text,
    scope: {
      corpusBundleHash: CORPUS_HASH,
      sourceCoursePack,
    },
  });
}

function imageTextQuery(text: string) {
  return createRetrievalQueryV2({
    mode: "IMAGE_TEXT_TO_EVIDENCE",
    text,
    queryAsset: {
      assetId: "asset-query",
      sha256: ASSET_HASH,
    },
    scope: {
      corpusBundleHash: CORPUS_HASH,
      sourceCoursePack: LAYOUT,
    },
  });
}

function imageOnlyQuery() {
  return createRetrievalQueryV2({
    mode: "IMAGE_TO_IMAGE",
    queryAsset: {
      assetId: "asset-query",
      sha256: ASSET_HASH,
    },
    scope: {
      corpusBundleHash: CORPUS_HASH,
      sourceCoursePack: LAYOUT,
    },
  });
}

function manifest(corpusBundleHash = CORPUS_HASH) {
  return createCapabilityEntityManifestV2({
    id: "query-prerequisite-test-manifest",
    version: "1.0.0",
    corpusBundleHash,
    entities: [
      {
        entityId: "brand-wordmark",
        ownerCoursePack: BRAND,
        scope: "COURSE_EXCLUSIVE",
        evidenceObjectIds: ["brand-wordmark-object"],
        aliases: [
          { text: "Wordmark", classification: "EXCLUSIVE" },
          { text: "字标", classification: "EXCLUSIVE" },
        ],
      },
      {
        entityId: "layout-shared-language",
        ownerCoursePack: LAYOUT,
        scope: "SHARED_OR_AMBIGUOUS",
        evidenceObjectIds: ["layout-language-object"],
        aliases: [
          { text: "版式", classification: "AMBIGUOUS" },
        ],
      },
    ],
  });
}

function route(
  retrievalQuery: RetrievalQueryV2,
  withManifest = false,
) {
  return evaluateQueryPrerequisiteV3({
    query: retrievalQuery,
    ...(withManifest ? { capabilityEntityManifest: manifest() } : {}),
  });
}

describe("query prerequisite router v3", () => {
  it("binds policy, feature algorithm, and combined config identities", () => {
    expect(
      sha256StableJsonV2(QUERY_PREREQUISITE_FEATURE_ALGORITHM_V3),
    ).toBe(QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3);
    expect(sha256StableJsonV2(QUERY_PREREQUISITE_POLICY_V3))
      .toBe(QUERY_PREREQUISITE_POLICY_HASH_V3);
    expect(sha256StableJsonV2({
      featureAlgorithmHash:
        QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3,
      policyHash: QUERY_PREREQUISITE_POLICY_HASH_V3,
    })).toBe(QUERY_PREREQUISITE_CONFIG_HASH_V3);
  });

  it("treats 版权页 as static document anatomy rather than copyright ownership", () => {
    const trace = route(query(
      "选设计类书时，怎么核对版本、版权页和目录？",
    ));

    expect(trace).toMatchObject({
      decision: "STATIC_CORPUS_ELIGIBLE",
      failClosedEligible: false,
    });
    expect(trace.features.map(({ featureId }) => featureId))
      .not.toContain("EXTERNAL_OWNERSHIP_REQUEST");
  });

  it("still recognizes an actual ownership request", () => {
    const trace = route(query("这张作品的版权归谁所有？"));

    expect(trace).toMatchObject({
      decision: "EXTERNAL_STATE_REQUIRED",
      confidence: "HIGH",
      failClosedEligible: true,
      decisionSignals: ["EXTERNAL_OWNERSHIP_REQUEST"],
    });
  });

  it.each([
    "今天展厅里 A 方案被认错的比例有多少？",
    "本周预约流程到哪一步了？",
    "此刻传感器的噪声读数是多少？",
  ])("uses temporal plus state-seeking grammar for open-vocabulary live facts: %s", (text) => {
    expect(route(query(text))).toMatchObject({
      decision: "EXTERNAL_STATE_REQUIRED",
      confidence: "HIGH",
      failClosedEligible: true,
      decisionSignals: [
        "EXTERNAL_STATE_REQUEST",
        "TEMPORAL_REFERENCE",
      ],
    });
  });

  it.each([
    "当前这个版本的版式怎么调？",
    "现在注册页面怎么排版？",
    "今天这张练习主要分析层级关系。",
  ])("does not fail-close static guidance merely because it has a temporal word: %s", (text) => {
    const trace = route(query(text));
    expect(trace.failClosedEligible).toBe(false);
    expect(trace.decision).not.toBe("EXTERNAL_STATE_REQUIRED");
  });

  it("keeps narrative temporal wording executable when the learner asks for static filtering guidance", () => {
    expect(route(query(
      "备选方案现在越看越乱，应该先按什么来筛？",
    ))).toMatchObject({
      decision: "STATIC_CORPUS_ELIGIBLE",
      failClosedEligible: false,
    });
  });

  it.each([
    "这个素材有品牌官方授权，可以商用吗？",
    "这门训练营收费多少钱？",
    "报名答辩的截止日期是哪天？",
    "照这个模板做能保证获奖吗？",
    "最新合规要求对包装标签怎么规定？",
  ])("recognizes explicit externally verifiable facts: %s", (text) => {
    expect(route(query(text))).toMatchObject({
      decision: "EXTERNAL_STATE_REQUIRED",
      confidence: "HIGH",
      failClosedEligible: true,
    });
  });

  it("separates a direct local-tool action from software how-to guidance", () => {
    expect(route(query(
      "请你在 InDesign 里直接替我导出这个文件。",
    ))).toMatchObject({
      decision: "LOCAL_TOOL_ACTION_REQUIRED",
      confidence: "HIGH",
      failClosedEligible: true,
    });
    expect(route(query(
      "InDesign 里导出 PDF 应该怎么设置？",
    ))).toMatchObject({
      decision: "STATIC_CORPUS_ELIGIBLE",
      failClosedEligible: false,
    });
  });

  it("requires a referenced student asset only for inspection or editing", () => {
    expect(route(query(
      "帮我看看这张海报里哪个标题没对齐。",
    ))).toMatchObject({
      decision: "USER_ASSET_REQUIRED",
      confidence: "HIGH",
      failClosedEligible: true,
    });
    expect(route(query(
      "海报标题没对齐时，一般怎么调整？",
    ))).toMatchObject({
      decision: "STATIC_CORPUS_ELIGIBLE",
      failClosedEligible: false,
    });
  });

  it("keeps a learner's visual-attention description eligible for static retrieval", () => {
    const trace = route(query(
      "我的标题、图片和亮色都很抢，第一眼不知道看哪儿，先怎么判断冲突？",
    ));

    expect(trace).toMatchObject({
      decision: "STATIC_CORPUS_ELIGIBLE",
      failClosedEligible: false,
    });
    expect(trace.features.map(({ featureId }) => featureId))
      .toContain("USER_ASSET_REFERENCE");
    expect(trace.features.map(({ featureId }) => featureId))
      .not.toContain("ASSET_INSPECTION_OR_EDIT_REQUEST");
  });

  it("does not report a missing asset when the query already carries one", () => {
    const trace = route(imageTextQuery(
      "帮我看看这张海报里哪个标题没对齐。",
    ));

    expect(trace).toMatchObject({
      decision: "STATIC_CORPUS_ELIGIBLE",
      failClosedEligible: false,
    });
    expect(trace.features.map(({ featureId }) => featureId))
      .toContain("QUERY_ASSET_PRESENT");
  });

  it("distinguishes a demanded exact value from contextual design guidance", () => {
    expect(route(query(
      "没有给你画布，标题的精确字号到底设多少？",
    ))).toMatchObject({
      decision: "PARAMETER_CONTEXT_REQUIRED",
      confidence: "HIGH",
      failClosedEligible: true,
      decisionSignals: [
        "EXACT_PARAMETER_REQUEST",
        "PARAMETER_CONTEXT_ABSENCE",
      ],
    });

    const contextual = route(query(
      "用于 A4 纸张、观看距离 40cm，正文的具体字号怎么选？",
    ));
    expect(contextual.failClosedEligible).toBe(false);
    expect(contextual.decision).toBe("AMBIGUOUS");
  });

  it("does not mistake a fixed test signal for a request for an exact parameter value", () => {
    const trace = route(query(
      "两台电脑间想先用固定值和单通道把 OSC 跑通。发送和接收两边各要核对什么？",
    ));

    expect(trace).toMatchObject({
      decision: "STATIC_CORPUS_ELIGIBLE",
      failClosedEligible: false,
    });
    expect(trace.features.map(({ featureId }) => featureId))
      .not.toContain("EXACT_PARAMETER_REQUEST");
  });

  it("emits a foreign course scope candidate but never fail-closes it before retrieval", () => {
    const trace = route(query(
      "Wordmark 的字面语气应该怎么判断？",
      LAYOUT,
    ), true);

    expect(trace).toMatchObject({
      decision: "COURSE_SCOPE_MISMATCH_CANDIDATE",
      confidence: "HIGH",
      failClosedEligible: false,
      capabilityEntityManifestHash: manifest().configHash,
      decisionSignals: ["FOREIGN_EXCLUSIVE_ENTITY"],
    });
  });

  it("keeps same-pack and broad ambiguous aliases retrieval eligible while tracing them", () => {
    expect(route(query(
      "Wordmark 的字面语气应该怎么判断？",
      BRAND,
    ), true)).toMatchObject({
      decision: "STATIC_CORPUS_ELIGIBLE",
      failClosedEligible: false,
      decisionSignals: ["SCOPED_EXCLUSIVE_ENTITY"],
    });
    expect(route(query(
      "这个版式怎么整理层级？",
      LAYOUT,
    ), true)).toMatchObject({
      decision: "STATIC_CORPUS_ELIGIBLE",
      failClosedEligible: false,
    });
    expect(route(query(
      "这个版式怎么整理层级？",
      LAYOUT,
    ), true).features.map(({ featureId }) => featureId))
      .toContain("AMBIGUOUS_CAPABILITY_ENTITY");
  });

  it("treats an image-only query with a bound asset as corpus eligible", () => {
    expect(route(imageOnlyQuery())).toMatchObject({
      decision: "STATIC_CORPUS_ELIGIBLE",
      confidence: "HIGH",
      failClosedEligible: false,
      decisionSignals: ["QUERY_ASSET_PRESENT"],
    });
  });

  it("is deterministic and retains only a query hash, not raw query text", () => {
    const retrievalQuery = query("这句不会原样进入路由 trace，怎么分析？");
    const first = route(retrievalQuery);
    const second = route(retrievalQuery);

    expect(first).toEqual(second);
    expect(first.queryHash).toBe(sha256StableJsonV2(retrievalQuery));
    expect(JSON.stringify(first)).not.toContain(retrievalQuery.originalText!);
  });

  it("rejects a capability manifest from another corpus identity", () => {
    expect(() => evaluateQueryPrerequisiteV3({
      query: query("Wordmark 怎么判断？"),
      capabilityEntityManifest: manifest(OTHER_CORPUS_HASH),
    })).toThrow(/manifest must match the query corpus bundle/);
  });

  it.each([
    "这个训练营现在收费多少钱？",
    "请你在 Photoshop 里直接替我打开这个文件。",
    "帮我检查这份设计稿哪里没有对齐。",
    "画布没提供时，标题的精确字号到底设多少？",
    "普通标题层级应该怎么组织？",
  ])("shadow mode always runs retrieval exactly once and preserves its result: %s", async (text) => {
    const retrieve = vi.fn(async () => ({
      sentinel: "UNCHANGED_RETRIEVAL_RESULT",
    }));
    const shadow = await runQueryPrerequisiteShadowV3({
      query: query(text),
      retrieve,
    });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(shadow.retrievalResult).toEqual({
      sentinel: "UNCHANGED_RETRIEVAL_RESULT",
    });
  });
});
