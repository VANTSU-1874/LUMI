// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  adaptLegacyKnowledgeItemV2,
  type KnowledgeAssetBindingV2,
} from "@/lib/knowledge/knowledge-v2-corpus";
import type { KnowledgeItem } from "@/lib/knowledge/retrieve";

const ASSET_HASH = "a".repeat(64);
const ASSET_ID = `asset-${"b".repeat(64)}`;

const legacyItem: KnowledgeItem = {
  id: "layout-adapter-fixture",
  title: "版式适配测试",
  topic: "LAYOUT_EVIDENCE",
  tags: ["版式", "证据"],
  content: "先看阅读顺序，再看尺寸关系。",
  facts: [
    { id: "layout-adapter-fact", text: "版式判断要落到可观察关系。" },
  ],
  actions: [
    { id: "layout-compare-reading-path", text: "比较调整前后的阅读顺序。" },
  ],
  source: {
    localDocument: "data/courses/layout-design/999-adapter-fixture.md",
    authority: "TEACHER_EXPERIENCE",
    verifiedDate: "2026-07-28",
    scope: "仅用于契约测试。",
  },
};

function binding(caption: string): KnowledgeAssetBindingV2 {
  return {
    assetId: ASSET_ID,
    assetHash: ASSET_HASH,
    sourceOrdinal: 0,
    sourceDocumentPath: "data/courses/layout-design/999-adapter-fixture.md",
    sourceDocumentHash: "c".repeat(64),
    sourceSectionHash: "d".repeat(64),
    caption,
    mappingMethod: "ROLE_ALIAS",
    headingPath: ["核心内容", "版式拆分"],
  };
}

describe("KnowledgeItem -> KnowledgeObjectV2 adapter", () => {
  it("preserves the complete legacy item while making source identity explicit", () => {
    const adapted = adaptLegacyKnowledgeItemV2({
      item: legacyItem,
      sourceCoursePackId: "layout-design",
      sourceIdentityBasis: "COURSE_DIRECTORY",
      assetBindings: [],
    });

    expect(adapted.legacyItem).toEqual(legacyItem);
    expect(adapted.sourceCoursePack.id).toBe("layout-design");
    expect(adapted.legacyPlacement.coursePack.id).toBe("book-design");
    expect(adapted.nodes.filter(({ kind }) => kind === "TEXT").map((node) =>
      node.kind === "TEXT" ? [node.role, node.legacyStatementId, node.text] : null
    )).toEqual([
      ["CONTENT", null, legacyItem.content],
      ["FACT", "layout-adapter-fact", legacyItem.facts[0]?.text],
      ["ACTION", "layout-compare-reading-path", legacyItem.actions[0]?.text],
    ]);
  });

  it("is deterministic and keeps source captions out of the raw content hash", () => {
    const first = adaptLegacyKnowledgeItemV2({
      item: legacyItem,
      sourceCoursePackId: "layout-design",
      sourceIdentityBasis: "COURSE_DIRECTORY",
      assetBindings: [binding("第一版图片说明。")],
    });
    const repeated = adaptLegacyKnowledgeItemV2({
      item: legacyItem,
      sourceCoursePackId: "layout-design",
      sourceIdentityBasis: "COURSE_DIRECTORY",
      assetBindings: [binding("第一版图片说明。")],
    });
    const changedCaption = adaptLegacyKnowledgeItemV2({
      item: legacyItem,
      sourceCoursePackId: "layout-design",
      sourceIdentityBasis: "COURSE_DIRECTORY",
      assetBindings: [binding("第二版图片说明。")],
    });

    expect(repeated).toEqual(first);
    expect(changedCaption.contentHash).toBe(first.contentHash);
    expect(changedCaption.annotationHash).not.toBe(first.annotationHash);
    expect(first.assetIds).toEqual([ASSET_ID]);
    expect(first.annotations[0]).toMatchObject({
      kind: "CAPTION",
      origin: "SOURCE",
      inputs: [
        { kind: "SOURCE_DOCUMENT", sha256: "c".repeat(64) },
        { kind: "SOURCE_SECTION", sha256: "d".repeat(64) },
        { kind: "ASSET", assetId: ASSET_ID, sha256: ASSET_HASH },
      ],
    });
    expect(ASSET_HASH).toHaveLength(64);
  });
});
