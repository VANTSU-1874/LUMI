import path from "node:path";

import { describe, expect, it } from "vitest";

import type { EmbeddingProvider } from "@/lib/ai/embeddings";
import { loadKnowledgeDirectory, rankKnowledge } from "@/lib/knowledge/retrieve";
import {
  clearKnowledgeVectorIndexCache,
  retrieveKnowledgeHybrid,
} from "@/lib/knowledge/semantic-retrieve";

function basis(index: number) {
  return Array.from({ length: 6 }, (_, candidate) => candidate === index ? 1 : 0);
}

function semanticVector(value: string) {
  if (/文字与背景的最低对比度检查|字像陷进底色/.test(value)) return basis(0);
  if (/操作结果与进度需要可感知的状态反馈|点完按钮完全不知道生效/.test(value)) return basis(1);
  if (/双钻设计过程|先发散再收敛但不知道研究顺序/.test(value)) return basis(2);
  if (/Feedback TOP：目标节点|上一帧留下来叠到下一帧/.test(value)) return basis(3);
  if (/出血与最终裁切边界|印刷后边缘露出一条白线/.test(value)) return basis(4);
  return basis(5);
}

describe("real-corpus hybrid retrieval benchmark", () => {
  it("raises top-1 recall on low lexical-overlap student questions", async () => {
    clearKnowledgeVectorIndexCache();
    const corpus = await loadKnowledgeDirectory(path.join(process.cwd(), "data", "knowledge"));
    const provider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "offline-semantic-benchmark",
      cacheKey: "offline-semantic-benchmark-v1",
      async embed(inputs) {
        return inputs.map(semanticVector);
      },
    };
    const cases = [
      ["海报里的字像陷进底色里，看着很费劲", "design-text-contrast"],
      ["学生点完按钮完全不知道生效没有", "design-status-feedback"],
      ["想先发散再收敛但不知道研究顺序", "design-double-diamond"],
      ["TouchDesigner里我想让上一帧留下来叠到下一帧", "td-feedback-top"],
      ["导览册导出印刷后边缘露出一条白线", "book-bleed-output"],
    ] as const;

    let lexicalTopOne = 0;
    let hybridTopOne = 0;
    for (const [query, expectedId] of cases) {
      if (rankKnowledge(query, corpus)[0]?.id === expectedId) lexicalTopOne += 1;
      const hybrid = await retrieveKnowledgeHybrid(query, corpus, provider);
      if (hybrid.items[0]?.id === expectedId) hybridTopOne += 1;
    }

    expect(hybridTopOne).toBe(cases.length);
    expect(hybridTopOne - lexicalTopOne).toBeGreaterThanOrEqual(3);
  });
});
