// @vitest-environment node

import { beforeAll, describe, expect, it } from "vitest";

import { buildKnowledgeV2Corpus } from "@/lib/knowledge/knowledge-v2-corpus";
import {
  retrieveLexicalCandidatesV2,
  retrieveLexicalObjectCandidatesV2,
  retrieveLexicalPackCompetitionV2,
} from "@/lib/knowledge/lexical-retriever-v2";
import { createRetrievalQueryV2 } from "@/lib/knowledge/retrieval-query-v2";
import type { KnowledgeCorpusBundleV2 } from "@/lib/knowledge/knowledge-object-v2";

describe("lexical retriever V2", () => {
  let corpus: KnowledgeCorpusBundleV2;

  beforeAll(async () => {
    corpus = (await buildKnowledgeV2Corpus({ workspaceRoot: process.cwd() })).bundle;
  }, 60_000);

  it("scopes by source course identity and returns real V2 owner nodes", () => {
    const query = createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text: "标题、正文和版式层级应该怎么调整？",
      scope: {
        corpusBundleHash: corpus.bundleHash,
        sourceCoursePack: { id: "layout-design", version: "1" },
      },
    });
    const hits = retrieveLexicalCandidatesV2(query, corpus.objects, {
      minScore: 0,
      maxCandidates: 20,
    });
    const objects = new Map(corpus.objects.map((object) => [object.id, object]));
    expect(hits).toHaveLength(20);
    expect(hits.every(({ candidateId, objectId, nodeId }) => {
      const object = objects.get(objectId);
      return candidateId === nodeId
        && object?.sourceCoursePack.id === "layout-design"
        && object.nodes.some(({ id }) => id === nodeId);
    })).toBe(true);
    expect(hits.map(({ rank }) => rank)).toEqual(
      Array.from({ length: hits.length }, (_, index) => index + 1),
    );
  });

  it("keeps object projection for cross-modal text queries", () => {
    const query = createRetrievalQueryV2({
      mode: "TEXT_TO_IMAGE",
      text: "标题、正文和版式层级应该怎么调整？",
      scope: {
        corpusBundleHash: corpus.bundleHash,
        sourceCoursePack: { id: "layout-design", version: "1" },
      },
    });
    const hits = retrieveLexicalCandidatesV2(query, corpus.objects, {
      minScore: 0,
      maxCandidates: 5,
    });
    expect(hits).toHaveLength(5);
    expect(hits.every(({ candidateId, objectId }) =>
      candidateId === objectId)).toBe(true);
  });

  it("does not fabricate lexical candidates for a pure image query", () => {
    const query = createRetrievalQueryV2({
      mode: "IMAGE_TO_IMAGE",
      queryAsset: { assetId: "asset-query", sha256: "a".repeat(64) },
      scope: {
        corpusBundleHash: corpus.bundleHash,
        sourceCoursePack: null,
      },
    });
    expect(retrieveLexicalCandidatesV2(query, corpus.objects)).toEqual([]);
  });

  it("emits global pack competition from the same scoped lexical query", () => {
    const query = createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text: "DMX 和 Art-Net 灯光通道怎么排查？",
      scope: {
        corpusBundleHash: corpus.bundleHash,
        sourceCoursePack: { id: "general-design", version: "1" },
      },
    });
    const diagnostics = retrieveLexicalPackCompetitionV2(query, corpus.objects);
    expect(diagnostics).toMatchObject({
      scoreMetric: "LEXICAL_NORMALIZED_SCORE",
      sourceScope: { coursePackId: "general-design" },
      globalWinner: { coursePackId: "digital-interaction" },
      scopedWinner: { coursePackId: "general-design" },
    });
    expect(diagnostics?.deduplicatedObjectCount).toBe(corpus.objects.length);
    expect(new Set(diagnostics?.perPackWinners.map(({ objectId }) => objectId)).size)
      .toBe(diagnostics?.perPackWinners.length);
  });

  it("emits bounded real TEXT nodes for same-call object consensus", () => {
    const query = createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text: "我只会说想让海报更有力量，你先帮我把下一步问清楚。",
      scope: {
        corpusBundleHash: corpus.bundleHash,
        sourceCoursePack: { id: "general-design", version: "1" },
      },
    });
    const candidates = retrieveLexicalObjectCandidatesV2(
      query,
      corpus.objects,
    );
    const objects = new Map(corpus.objects.map((object) => [object.id, object]));

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(10);
    expect(candidates.map(({ objectRank }) => objectRank)).toEqual(
      Array.from({ length: candidates.length }, (_, index) => index + 1),
    );
    expect(candidates.every((candidate) => {
      const object = objects.get(candidate.objectId);
      return object?.sourceCoursePack.id === "general-design"
        && candidate.nodes.length <= 3
        && candidate.nodes.every(({ nodeId, representationId }, index) =>
          representationId === null
          && object.nodes.some((node) =>
            node.id === nodeId && node.kind === "TEXT")
          && candidate.nodes[index]?.innerRank === index + 1);
    })).toBe(true);
  });
});
