// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  T42AbcHeldoutPublicManifestSchema,
  T42_RECALL_CORPUS_BUNDLE_SHA256,
  T42_RECALL_SUITE_SHA256,
  T42RecallSuiteSchema,
  loadT42RecallSuite,
} from "../../../tools/mixed-retrieval/t42-recall-loader";

type MutableSuite = {
  cases: Array<{
    id: string;
    familyId: string;
    clusterId: string;
    runtime: {
      mode: string;
      coursePackId: string;
      coursePackVersion: string;
      question: string;
      expectation?: string;
    };
    expected: {
      expectation: string;
      targetObjectIds: string[];
      requiredEvidenceGroups: string[][];
    };
  }>;
  smallPackOverlapStrata: Array<{
    objectCaseCounts: Array<{
      objectId: string;
      caseCount: number;
    }>;
  }>;
  unexpected?: boolean;
};

const DEV_PATH = join(
  process.cwd(),
  "tests",
  "retrieval-quality",
  "t42-recall-dev.json",
);

function devBytes() {
  return readFileSync(DEV_PATH);
}

function mutableDevSuite(): MutableSuite {
  return JSON.parse(devBytes().toString("utf8")) as MutableSuite;
}

function heldoutPublicManifest() {
  return {
    schemaVersion: 1,
    manifestId: "T42-ABC-HELDOUT-PUBLIC",
    suiteId: "T42-ABC-HELDOUT",
    split: "HELDOUT",
    splitRole: "FINAL_BLINDED_EVALUATION",
    corpusBundleHash: T42_RECALL_CORPUS_BUNDLE_SHA256,
    caseCount: 12,
    strata: [
      {
        stratumId: "layout-text-image",
        coursePackId: "layout-design",
        mode: "TEXT_TO_IMAGE",
        caseCount: 8,
      },
      {
        stratumId: "brand-image-text",
        coursePackId: "brand-vi-design",
        mode: "IMAGE_TEXT_TO_EVIDENCE",
        caseCount: 4,
      },
    ],
    sealedPayload: {
      kind: "EXTERNAL_OPAQUE",
      sha256: "b".repeat(64),
      byteLength: 4096,
    },
    confidentiality: {
      questionTextIncluded: false,
      expectedLabelsIncluded: false,
      qrelsIncluded: false,
      decryptionMaterialIncluded: false,
    },
  };
}

describe("T4.2 recall suite loader", () => {
  it("loads and deeply freezes the exact DEV bytes", () => {
    const loaded = loadT42RecallSuite(devBytes());

    expect(loaded.suiteSha256).toBe(T42_RECALL_SUITE_SHA256);
    expect(loaded.suite).toMatchObject({
      suiteId: "T42-RECALL-DEV",
      split: "DEV",
      splitRole: "MODEL_DEVELOPMENT",
    });
    expect(loaded.suite.cases).toHaveLength(40);
    expect(
      loaded.suite.cases.filter(
        (testCase) =>
          testCase.expected.expectation === "ANSWERABLE",
      ),
    ).toHaveLength(25);
    expect(
      loaded.suite.cases.filter(
        (testCase) =>
          testCase.expected.expectation === "NO_ANSWER",
      ),
    ).toHaveLength(15);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.suite)).toBe(true);
    expect(Object.isFrozen(loaded.suite.cases[0].runtime)).toBe(true);
    expect(Object.isFrozen(loaded.suite.cases[0].expected)).toBe(true);
    expect(
      Object.isFrozen(
        loaded.suite.cases[0].expected.requiredEvidenceGroups[0],
      ),
    ).toBe(true);
  });

  it("rejects a byte-level change after successful schema validation", () => {
    const changed = Buffer.concat([devBytes(), Buffer.from("\n")]);

    expect(() => loadT42RecallSuite(changed)).toThrow(
      /byte sha256 mismatch/,
    );
  });

  it("keeps expected labels outside the strict runtime object", () => {
    const suite = mutableDevSuite();
    suite.cases[0].runtime.expectation = "ANSWERABLE";

    expect(() => T42RecallSuiteSchema.parse(suite)).toThrow();
  });

  it("rejects strict-schema additions", () => {
    const suite = mutableDevSuite();
    suite.unexpected = true;

    expect(() => T42RecallSuiteSchema.parse(suite)).toThrow();
  });

  it("requires targets and evidence groups only for ANSWERABLE cases", () => {
    const positiveSuite = mutableDevSuite();
    const positive = positiveSuite.cases.find(
      (testCase) =>
        testCase.expected.expectation === "ANSWERABLE",
    )!;
    positive.expected.targetObjectIds = [];
    positive.expected.requiredEvidenceGroups = [];

    expect(() => T42RecallSuiteSchema.parse(positiveSuite)).toThrow(
      /ANSWERABLE requires at least one targetObjectId/,
    );

    const negativeSuite = mutableDevSuite();
    const negative = negativeSuite.cases.find(
      (testCase) =>
        testCase.expected.expectation === "NO_ANSWER",
    )!;
    negative.expected.targetObjectIds = ["forbidden-target"];
    negative.expected.requiredEvidenceGroups = [
      [`node-${"a".repeat(64)}`],
    ];

    expect(() => T42RecallSuiteSchema.parse(negativeSuite)).toThrow(
      /NO_ANSWER requires an empty targetObjectIds array/,
    );
  });

  it("rejects evidence-node reuse and undeclared object overlap", () => {
    const nodeReuseSuite = mutableDevSuite();
    const positives = nodeReuseSuite.cases.filter(
      (testCase) =>
        testCase.expected.expectation === "ANSWERABLE",
    );
    positives[1].expected.requiredEvidenceGroups[0][0] =
      positives[0].expected.requiredEvidenceGroups[0][0];

    expect(() => T42RecallSuiteSchema.parse(nodeReuseSuite)).toThrow(
      /required evidence nodes cannot be reused/,
    );

    const objectReuseSuite = mutableDevSuite();
    const generalPositives = objectReuseSuite.cases.filter(
      (testCase) =>
        testCase.runtime.coursePackId === "general-design" &&
        testCase.expected.expectation === "ANSWERABLE",
    );
    generalPositives[1].expected.targetObjectIds =
      generalPositives[0].expected.targetObjectIds;

    expect(() => T42RecallSuiteSchema.parse(objectReuseSuite)).toThrow(
      /target object reused outside declared small pack/,
    );
  });

  it("requires the declared brand overlap to match actual reuse", () => {
    const suite = mutableDevSuite();
    const brandCases = suite.cases.filter(
      (testCase) =>
        testCase.runtime.coursePackId === "brand-vi-design" &&
        testCase.expected.expectation === "ANSWERABLE",
    );
    const firstObjectId = brandCases[0].expected.targetObjectIds[0];
    const caseUsingSecondObject = brandCases.find(
      (testCase) =>
        testCase.expected.targetObjectIds[0] !== firstObjectId,
    )!;
    caseUsingSecondObject.expected.targetObjectIds = [firstObjectId];

    expect(() => T42RecallSuiteSchema.parse(suite)).toThrow(
      /brand overlap metadata must match actual object reuse/,
    );
  });

  it("accepts only aggregate held-out metadata plus an opaque payload digest", () => {
    expect(
      T42AbcHeldoutPublicManifestSchema.parse(
        heldoutPublicManifest(),
      ),
    ).toMatchObject({
      suiteId: "T42-ABC-HELDOUT",
      split: "HELDOUT",
      caseCount: 12,
      confidentiality: {
        questionTextIncluded: false,
        expectedLabelsIncluded: false,
        qrelsIncluded: false,
        decryptionMaterialIncluded: false,
      },
    });
  });

  it("rejects held-out question material, duplicate strata and count drift", () => {
    expect(() => T42AbcHeldoutPublicManifestSchema.parse({
      ...heldoutPublicManifest(),
      question: "forbidden held-out text",
    })).toThrow();

    const duplicate = heldoutPublicManifest();
    duplicate.strata[1].stratumId = duplicate.strata[0].stratumId;
    expect(() =>
      T42AbcHeldoutPublicManifestSchema.parse(duplicate))
      .toThrow(/unique ids/);

    const countDrift = heldoutPublicManifest();
    countDrift.caseCount = 13;
    expect(() =>
      T42AbcHeldoutPublicManifestSchema.parse(countDrift))
      .toThrow(/stratum counts/);
  });
});
