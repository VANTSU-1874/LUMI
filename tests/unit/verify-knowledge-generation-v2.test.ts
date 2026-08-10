// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  parseKnowledgeGenerationVerificationArguments,
} from "@/scripts/verify-knowledge-generation-v2";

describe("isolated KnowledgeObjectV2 generation verifier CLI", () => {
  it("requires explicit workspace and control directories", () => {
    expect(parseKnowledgeGenerationVerificationArguments([
      "--workspace-root",
      ".",
      "--control-dir",
      ".runtime/knowledge-index/control/example",
    ])).toEqual({
      workspaceRoot: ".",
      controlDirectory: ".runtime/knowledge-index/control/example",
    });
  });

  it("accepts only the explicit Linux text profile override", () => {
    expect(parseKnowledgeGenerationVerificationArguments([
      "--workspace-root",
      ".",
      "--control-dir",
      ".runtime/knowledge-index/control/example",
      "--runtime-profile",
      "linux-text",
      "--package-manifest",
      ".runtime/package/runtime-manifest.json",
    ])).toEqual({
      workspaceRoot: ".",
      controlDirectory:
        ".runtime/knowledge-index/control/example",
      runtimeProfile: "linux-text",
      packageManifest:
        ".runtime/package/runtime-manifest.json",
    });
    expect(() =>
      parseKnowledgeGenerationVerificationArguments([
        "--workspace-root",
        ".",
        "--control-dir",
        "control",
        "--runtime-profile",
        "visual",
        "--package-manifest",
        "manifest.json",
      ])).toThrow(/unknown|duplicate/i);
    expect(() =>
      parseKnowledgeGenerationVerificationArguments([
        "--workspace-root",
        ".",
        "--control-dir",
        "control",
        "--runtime-profile",
        "linux-text",
      ])).toThrow(/MANIFEST_REQUIRED/);
  });

  it.each([
    { argv: [] },
    { argv: ["--workspace-root", "."] },
    { argv: ["--control-dir", "control"] },
    {
      argv: [
        "--workspace-root",
        ".",
        "--workspace-root",
        "other",
        "--control-dir",
        "control",
      ],
    },
    {
      argv: [
        "--workspace-root",
        ".",
        "--control-dir",
        "control",
        "--unknown",
        "value",
      ],
    },
  ])("rejects incomplete, duplicate or unknown arguments: $argv", ({ argv }) => {
    expect(() => parseKnowledgeGenerationVerificationArguments(argv)).toThrow(
      /usage|unknown|duplicate/i,
    );
  });
});
