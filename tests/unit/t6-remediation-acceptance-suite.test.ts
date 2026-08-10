import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CURRENT_T6_REMEDIATION_ACCEPTANCE_SUITE_HASH,
  loadT6RemediationAcceptanceSuite,
  T6_REMEDIATION_ACCEPTANCE_CASE_COUNT,
} from "@/lib/agent/t6-remediation-acceptance-suite";
import {
  routeDesignSpecialty,
} from "@/lib/agent/specialty-router";

const acceptancePath = path.resolve(
  "tests/tutor-quality/t6-remediation-acceptance.v1.json",
);

describe("T6 remediation acceptance suite", () => {
  it("is hash-frozen and keeps every question outside the old 52-case suite", () => {
    const { suite, suiteHash } =
      loadT6RemediationAcceptanceSuite(acceptancePath);
    const oldSuite = JSON.parse(
      readFileSync(
        path.resolve("tests/tutor-quality/golden-suite.json"),
        "utf8",
      ),
    ) as { cases: Array<{ question: string }> };
    const oldQuestions = new Set(
      oldSuite.cases.map(({ question }) => question.normalize("NFKC").trim()),
    );

    expect(suiteHash).toBe(
      CURRENT_T6_REMEDIATION_ACCEPTANCE_SUITE_HASH,
    );
    expect(suite.cases).toHaveLength(
      T6_REMEDIATION_ACCEPTANCE_CASE_COUNT,
    );
    for (const { case: qualityCase } of suite.cases) {
      expect(oldQuestions.has(
        qualityCase.question.normalize("NFKC").trim(),
      )).toBe(false);
    }
  });

  it("binds every case to a real inventory object and freezes focus coverage", () => {
    const { suite } =
      loadT6RemediationAcceptanceSuite(acceptancePath);
    const inventory = JSON.parse(
      readFileSync(
        path.resolve(
          "tests/retrieval-quality/t45-capability-inventory.json",
        ),
        "utf8",
      ),
    ) as { objects: Array<{ objectId: string }> };
    const objectIds = new Set(
      inventory.objects.map(({ objectId }) => objectId),
    );
    const focusCounts = new Map<string, number>();

    for (const acceptanceCase of suite.cases) {
      for (const objectId of acceptanceCase.knowledgeObjectIds) {
        expect(objectIds.has(objectId)).toBe(true);
      }
      for (const focus of acceptanceCase.acceptanceFocus) {
        focusCounts.set(focus, (focusCounts.get(focus) ?? 0) + 1);
      }
    }

    expect(Object.fromEntries(focusCounts)).toEqual({
      HEALTHY_EMPTY_BASELINE: 4,
      NUMERIC_BOUNDARY: 4,
      POSITIVE_V2_EVIDENCE: 4,
      CONSENTED_WEB_SEQUENCE: 2,
    });
  });

  it("routes every self-contained question to its frozen course pack", () => {
    const { suite } =
      loadT6RemediationAcceptanceSuite(acceptancePath);

    for (const { case: qualityCase } of suite.cases) {
      expect(routeDesignSpecialty(
        qualityCase.question,
        qualityCase.view,
      ).coursePackId).toBe(qualityCase.coursePackId);
    }
  });
});
