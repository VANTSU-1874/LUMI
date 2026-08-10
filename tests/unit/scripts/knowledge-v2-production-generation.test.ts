// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  parseKnowledgeV2ProductionActivationArguments,
} from "@/scripts/activate-knowledge-v2-production-generation";
import {
  parseKnowledgeV2ProductionRehearsalArguments,
} from "@/scripts/rehearse-knowledge-v2-production-generation";

const commit = "a".repeat(40);

describe("Knowledge V2 production generation CLIs", () => {
  it("accepts only an exact activation commit", () => {
    expect(parseKnowledgeV2ProductionActivationArguments([
      "--expected-commit",
      commit,
    ])).toEqual({ expectedCommit: commit });
    expect(() => parseKnowledgeV2ProductionActivationArguments([
      "--expected-commit",
      "a".repeat(39),
    ])).toThrow(/usage/);
    expect(() => parseKnowledgeV2ProductionActivationArguments([
      "--expected-commit",
      commit,
      "--extra",
    ])).toThrow(/usage/);
  });

  it("requires a package root and exact commit for rehearsal", () => {
    expect(parseKnowledgeV2ProductionRehearsalArguments([
      "--package-root",
      "package",
      "--expected-commit",
      commit,
    ])).toEqual({
      packageRoot: "package",
      expectedCommit: commit,
    });
    expect(() => parseKnowledgeV2ProductionRehearsalArguments([
      "--expected-commit",
      commit,
      "--package-root",
      "package",
    ])).toThrow(/usage/);
  });
});
