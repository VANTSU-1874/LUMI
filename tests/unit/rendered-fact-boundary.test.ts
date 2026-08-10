import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { ModelClient } from "@/lib/ai/client";
import {
  MAX_KNOWLEDGE_STATEMENT_LENGTH,
  loadKnowledgeDirectory,
  type KnowledgeAuthority,
  type KnowledgeItem,
} from "@/lib/knowledge/retrieve";
import {
  AUTHORITY_LABELS,
  MAX_RENDERED_FACT_LENGTH,
  createGroundedHintService,
  createHintPolicyContext,
} from "@/lib/services/hints";

const authorities: KnowledgeAuthority[] = [
  "OFFICIAL",
  "COURSE_DESIGN",
  "TEACHER_EXPERIENCE",
  "ANONYMIZED_CASE",
];
const longFact = "甲".repeat(300);
const policy = createHintPolicyContext({
  previousHintRecords: [
    {
      recordId: "00000000-0000-4000-8000-000000000001",
      hintSequence: 1,
      evidenceSequenceWatermark: 0,
      createdAt: "2026-07-12T07:00:00.000Z",
    },
  ],
  currentEvidenceRecords: [],
  priorUsedEvidenceRecordIds: [],
  priorUsedEvidenceDigests: [],
});

function item(authority: KnowledgeAuthority): KnowledgeItem {
  return {
    id: `course-${authority.toLowerCase().replaceAll("_", "-")}`,
    title: `${authority}课程边界资料`,
    topic: "COURSE_PRINCIPLES",
    tags: ["文化意图", "课程"],
    content: "课程使用六要素组织交互逻辑。",
    facts: [{ id: "course-boundary-fact", text: longFact }],
    actions: [{ id: "course-clarify-intent", text: "先写清文化意图。" }],
    source: {
      localDocument: `docs/${authority.toLowerCase()}.md`,
      authority,
      verifiedDate: "2026-07-12",
      scope: "渲染事实长度边界",
    },
  };
}

describe("rendered fact length boundary", () => {
  it("derives the rendered bound from the statement and authority-label constants", () => {
    const longestLabel = Math.max(...Object.values(AUTHORITY_LABELS).map((label) => label.length));
    expect(MAX_KNOWLEDGE_STATEMENT_LENGTH).toBe(300);
    expect(MAX_RENDERED_FACT_LENGTH).toBe(MAX_KNOWLEDGE_STATEMENT_LENGTH + longestLabel);
  });

  it.each(authorities)("renders a 300-character %s fact without truncation", async (authority) => {
    const clients: Array<ModelClient | undefined> = [
      undefined,
      { complete: vi.fn(async () => Promise.reject(new Error("provider unavailable"))) },
      { complete: vi.fn(async () => "invalid model output") },
    ];

    for (const client of clients) {
      const service = createGroundedHintService({
        knowledge: [item(authority)],
        ...(client ? { client } : {}),
      });
      const response = await service.generate(
        { question: "文化意图怎么填写", confirmedFacts: [], hypotheses: [], evidence: [] },
        policy,
      );
      const rendered = response.confirmedFacts[0];
      expect(response.fallback).toBe(true);
      expect(rendered.startsWith(AUTHORITY_LABELS[authority])).toBe(true);
      expect(rendered.endsWith(longFact)).toBe(true);
      expect(rendered.length).toBe(AUTHORITY_LABELS[authority].length + longFact.length);
      expect(rendered.length).toBeLessThanOrEqual(MAX_RENDERED_FACT_LENGTH);
    }
  });

  it("rejects a 301-character fact while loading markdown", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-fact-boundary-"));
    const markdown = `---
id: course-too-long
title: 过长事实
topic: COURSE_PRINCIPLES
authority: COURSE_DESIGN
localDocument: docs/course.md
verifiedDate: 2026-07-12
scope: 长度边界
tags: ["课程", "文化意图"]
facts: [{"id":"course-too-long-fact","text":"${"乙".repeat(301)}"}]
actions: [{"id":"course-clarify-intent","text":"先写清文化意图。"}]
---
课程使用六要素组织交互逻辑。`;
    await writeFile(path.join(directory, "too-long.md"), markdown);

    await expect(loadKnowledgeDirectory(directory)).rejects.toThrow();
  });
});
