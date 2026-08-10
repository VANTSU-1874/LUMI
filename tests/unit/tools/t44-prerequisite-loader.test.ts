// @vitest-environment node

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  loadT44PrerequisiteSuite,
  T44PrerequisiteSuiteSchema,
  T44_PREREQUISITE_COURSE_PACK_IDS,
  T44_PREREQUISITE_DEV_SUITE_SHA256,
  T44_PREREQUISITE_STRATA,
  t44PrerequisiteSuiteHash,
} from "@/tools/mixed-retrieval/t44-prerequisite-loader";

const SUITE_PATH =
  "tests/retrieval-quality/t44-prerequisite-dev.json";

describe("T4.4 prerequisite DEV loader", () => {
  it("loads the frozen 100-case balanced suite", async () => {
    const suite = await loadT44PrerequisiteSuite(SUITE_PATH);

    expect(suite.cases).toHaveLength(100);
    expect(t44PrerequisiteSuiteHash(suite))
      .toBe(T44_PREREQUISITE_DEV_SUITE_SHA256);
    for (const coursePackId of
      T44_PREREQUISITE_COURSE_PACK_IDS) {
      const packCases = suite.cases.filter(({ runtime }) =>
        runtime.coursePackId === coursePackId);
      expect(packCases, coursePackId).toHaveLength(20);
      expect(packCases.filter(({ scoring }) =>
        scoring.expectation === "ANSWERABLE")).toHaveLength(10);
      expect(packCases.filter(({ scoring }) =>
        scoring.expectation === "NO_ANSWER")).toHaveLength(10);
    }
    for (const stratum of T44_PREREQUISITE_STRATA) {
      expect(suite.cases.filter(({ scoring }) =>
        scoring.stratum === stratum), stratum).toHaveLength(10);
    }
  });

  it("keeps runtime input physically separate from scoring labels", async () => {
    const suite = await loadT44PrerequisiteSuite(SUITE_PATH);
    for (const testCase of suite.cases) {
      expect(Object.keys(testCase.runtime).sort()).toEqual([
        "coursePackId",
        "coursePackVersion",
        "mode",
        "question",
      ]);
      expect(JSON.stringify(testCase.runtime))
        .not.toContain(testCase.scoring.caseId);
      expect(JSON.stringify(testCase.runtime))
        .not.toContain(testCase.scoring.expectedDecision);
    }
  });

  it("rejects a scoring contract mismatch before hash verification", async () => {
    const raw = JSON.parse(await readFile(SUITE_PATH, "utf8"));
    raw.cases[0].scoring.expectedDecision =
      "EXTERNAL_STATE_REQUIRED";

    expect(() => T44PrerequisiteSuiteSchema.parse(raw))
      .toThrow(/expected route must agree with the frozen stratum/);
  });

  it("rejects a suite hash drift", async () => {
    const raw = JSON.parse(await readFile(SUITE_PATH, "utf8"));
    raw.cases[0].runtime.question += "漂移";
    const drifted = T44PrerequisiteSuiteSchema.parse(raw);

    expect(t44PrerequisiteSuiteHash(drifted))
      .not.toBe(T44_PREREQUISITE_DEV_SUITE_SHA256);
  });
});
