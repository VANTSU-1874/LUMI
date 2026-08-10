import { describe, expect, it } from "vitest";

import {
  parseKnowledgeIndexPackagingArguments,
} from "@/scripts/package-knowledge-index-v2";

describe("package knowledge index V2 CLI", () => {
  it("accepts detached incremental plans without making them required", () => {
    const required = [
      "--workspace-root", "workspace",
      "--corpus", "corpus.json",
      "--text-index-dir", "text-index",
      "--visual-index-dir", "visual-index",
      "--output-root", "output",
    ];

    expect(parseKnowledgeIndexPackagingArguments(required)).toEqual({
      workspaceRoot: "workspace",
      corpusPath: "corpus.json",
      textIndexDirectory: "text-index",
      visualIndexDirectory: "visual-index",
      outputRoot: "output",
    });
    expect(parseKnowledgeIndexPackagingArguments([
      ...required,
      "--text-incremental-plan", "text-plan.json",
      "--visual-incremental-plan", "visual-plan.json",
    ])).toMatchObject({
      textIncrementalPlanPath: "text-plan.json",
      visualIncrementalPlanPath: "visual-plan.json",
    });
  });

  it("rejects duplicates and incomplete optional arguments", () => {
    expect(() => parseKnowledgeIndexPackagingArguments([
      "--workspace-root", "workspace",
      "--workspace-root", "other",
    ])).toThrow(/duplicate argument/);
    expect(() => parseKnowledgeIndexPackagingArguments([
      "--text-incremental-plan",
    ])).toThrow(/usage/);
  });
});
