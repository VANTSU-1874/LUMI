// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  T41_ANSWERABILITY_SUITE_SHA256,
  T41AnswerabilitySuiteSchema,
  loadT41AnswerabilitySuite,
} from "../../../tools/mixed-retrieval/t41-answerability-loader";

type MutableCase = {
  id: string;
  category: string;
  familyId: string;
  coursePackId: string;
  question: string;
  expectation: string;
  targetObjectIds: string[];
  reasonClass: string;
};

type MutableSuite = {
  schemaVersion: number;
  suiteVersion: string;
  split: string;
  splitRole: string;
  cases: MutableCase[];
  unexpected?: boolean;
};

const DEV_PATH = join(
  process.cwd(),
  "tests",
  "retrieval-quality",
  "t41-answerability-dev.json",
);

function devBytes() {
  return readFileSync(DEV_PATH);
}

function mutableDevSuite(): MutableSuite {
  return JSON.parse(devBytes().toString("utf8")) as MutableSuite;
}

describe("T4.1 answerability suite loader", () => {
  it("loads only the frozen DEV bytes and preserves the fixed distribution", () => {
    const loaded = loadT41AnswerabilitySuite(devBytes(), {
      expectedSplit: "DEV",
    });

    expect(loaded.suiteSha256).toBe(T41_ANSWERABILITY_SUITE_SHA256.DEV);
    expect(loaded.suite.split).toBe("DEV");
    expect(loaded.suite.splitRole).toBe("MODEL_DEVELOPMENT");
    expect(loaded.suite.cases).toHaveLength(60);
    expect(
      loaded.suite.cases.filter(
        (testCase) => testCase.expectation === "ANSWERABLE",
      ),
    ).toHaveLength(20);
    expect(
      loaded.suite.cases.filter(
        (testCase) => testCase.expectation === "NO_ANSWER",
      ),
    ).toHaveLength(40);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.suite)).toBe(true);
    expect(Object.isFrozen(loaded.suite.cases[0].targetObjectIds)).toBe(true);
  });

  it("rejects a byte-level change even when the parsed suite is identical", () => {
    const bytesWithTrailingNewline = Buffer.concat([
      devBytes(),
      Buffer.from("\n"),
    ]);

    expect(() =>
      loadT41AnswerabilitySuite(bytesWithTrailingNewline, {
        expectedSplit: "DEV",
      }),
    ).toThrow(/byte sha256 mismatch/);
  });

  it("rejects strict-schema additions", () => {
    const suite = mutableDevSuite();
    suite.unexpected = true;

    expect(() => T41AnswerabilitySuiteSchema.parse(suite)).toThrow();
  });

  it("rejects an ANSWERABLE case without a target object", () => {
    const suite = mutableDevSuite();
    const answerable = suite.cases.find(
      (testCase) => testCase.expectation === "ANSWERABLE",
    );
    expect(answerable).toBeDefined();
    answerable!.targetObjectIds = [];

    expect(() => T41AnswerabilitySuiteSchema.parse(suite)).toThrow(
      /ANSWERABLE requires at least one targetObjectId/,
    );
  });

  it("rejects a category/reasonClass mismatch", () => {
    const suite = mutableDevSuite();
    suite.cases[0].reasonClass = "NON_STATIC_EXTERNAL_FACT";

    expect(() => T41AnswerabilitySuiteSchema.parse(suite)).toThrow(
      /requires reasonClass/,
    );
  });

  it("rejects split-role drift and caller split mismatch", () => {
    const suite = mutableDevSuite();
    suite.splitRole = "FINAL_BLIND_EVALUATION";
    expect(() => T41AnswerabilitySuiteSchema.parse(suite)).toThrow(
      /DEV requires splitRole MODEL_DEVELOPMENT/,
    );

    expect(() =>
      loadT41AnswerabilitySuite(devBytes(), {
        expectedSplit: "HELDOUT",
      }),
    ).toThrow(/split mismatch/);
  });
});
