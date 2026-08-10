// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateQueryPrerequisiteAcceptanceV1,
  parseQueryPrerequisiteAcceptanceSuiteV1,
  runQueryPrerequisiteAcceptanceCliV1,
} from "@/scripts/audit-query-prerequisite-acceptance-v1";

const SUITE_PATH =
  "tests/retrieval-quality/query-prerequisite-acceptance-v1.json";

async function suite() {
  return parseQueryPrerequisiteAcceptanceSuiteV1(
    JSON.parse(await readFile(
      path.resolve(SUITE_PATH),
      "utf8",
    )) as unknown,
  );
}

describe("query prerequisite acceptance v1", () => {
  it("freezes 24 unique cases with six cases in each stratum", async () => {
    const parsed = await suite();

    expect(parsed.cases).toHaveLength(24);
    expect(new Set(
      parsed.cases.map(({ id }) => id),
    ).size).toBe(24);
    expect(Object.fromEntries(
      [
        "VISUAL_ATTENTION_STATIC",
        "MISSING_ASSET_INSPECTION",
        "ASSET_PRESENT_INSPECTION",
        "STATIC_METHOD",
      ].map((stratum) => [
        stratum,
        parsed.cases.filter(
          (testCase) =>
            testCase.stratum === stratum,
        ).length,
      ]),
    )).toEqual({
      VISUAL_ATTENTION_STATIC: 6,
      MISSING_ASSET_INSPECTION: 6,
      ASSET_PRESENT_INSPECTION: 6,
      STATIC_METHOD: 6,
    });
  });

  it("rejects duplicate identities and a moved stratum denominator", async () => {
    const parsed = await suite();
    const mutated = structuredClone(parsed);
    mutated.cases[1]!.id = mutated.cases[0]!.id;
    mutated.cases[2]!.stratum =
      "STATIC_METHOD";

    expect(() =>
      parseQueryPrerequisiteAcceptanceSuiteV1(
        mutated,
      )).toThrow(
      /ids must be unique|must contain exactly 6/,
    );
  });

  it("passes every independent acceptance case without leaking raw questions", async () => {
    const parsed = await suite();
    const report =
      evaluateQueryPrerequisiteAcceptanceV1(
        parsed,
      );

    expect(report).toMatchObject({
      cases: 24,
      passed: 24,
      falsePositive: 0,
      falseNegative: 0,
      decision:
        "PREREQUISITE_REMEDIATION_GO",
    });
    expect(report.byStratum.every(
      (stratum) =>
        stratum.cases === 6
        && stratum.passed === 6,
    )).toBe(true);
    expect(JSON.stringify(report))
      .not.toContain(parsed.cases[0]!.text);
  });

  it("runs against the fixed workspace suite", async () => {
    await expect(
      runQueryPrerequisiteAcceptanceCliV1(
        process.cwd(),
      ),
    ).resolves.toMatchObject({
      suiteId:
        "query-prerequisite-acceptance-v1",
      cases: 24,
      passed: 24,
      decision:
        "PREREQUISITE_REMEDIATION_GO",
    });
  });
});
