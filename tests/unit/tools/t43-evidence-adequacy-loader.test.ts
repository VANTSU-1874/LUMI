// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadLegacyKnowledgeCorpusV2,
} from "../../helpers/knowledge-v2-generation-fixtures";

import {
  T43_EVIDENCE_ADEQUACY_SUITE_SHA256,
  T43EvidenceAdequacySuiteSchema,
  assertT43EvidenceAdequacyQrels,
  loadT43EvidenceAdequacySuite,
  type T43EvidenceAdequacySuite,
  type T43PriorVisibleCaseReference,
} from "../../../tools/mixed-retrieval/t43-evidence-adequacy-loader";

const DEV_PATH = join(
  process.cwd(),
  "tests",
  "retrieval-quality",
  "t43-evidence-adequacy-dev.json",
);
const T41_PATH = join(
  process.cwd(),
  "tests",
  "retrieval-quality",
  "t41-answerability-dev.json",
);
const T42_PATH = join(
  process.cwd(),
  "tests",
  "retrieval-quality",
  "t42-recall-dev.json",
);
const LEGACY_PATH = join(
  process.cwd(),
  "tests",
  "retrieval-quality",
  "golden-suite.json",
);

function devBytes() {
  return readFileSync(DEV_PATH);
}

function corpusInput() {
  return loadLegacyKnowledgeCorpusV2();
}

function mutableDevSuite() {
  return JSON.parse(
    devBytes().toString("utf8"),
  ) as T43EvidenceAdequacySuite;
}

function priorVisibleCases(): T43PriorVisibleCaseReference[] {
  const t41 = JSON.parse(readFileSync(T41_PATH, "utf8")) as {
    cases: Array<{
      id: string;
      familyId: string;
      question: string;
    }>;
  };
  const t42 = JSON.parse(readFileSync(T42_PATH, "utf8")) as {
    cases: Array<{
      id: string;
      familyId: string;
      clusterId: string;
      runtime: { question: string };
    }>;
  };
  const legacy = JSON.parse(readFileSync(LEGACY_PATH, "utf8")) as {
    cases: Array<{
      id: string;
      query: { text?: string };
    }>;
  };
  return [
    ...t41.cases.map((testCase) => ({
      caseId: testCase.id,
      familyId: testCase.familyId,
      clusterId: null,
      question: testCase.question,
    })),
    ...t42.cases.map((testCase) => ({
      caseId: testCase.id,
      familyId: testCase.familyId,
      clusterId: testCase.clusterId,
      question: testCase.runtime.question,
    })),
    ...legacy.cases.map((testCase) => ({
      caseId: testCase.id,
      familyId: null,
      clusterId: null,
      question: testCase.query.text ?? null,
    })),
  ];
}

describe("T4.3 evidence adequacy suite loader", () => {
  it("loads, validates, and deeply freezes the exact DEV bytes", () => {
    const loaded = loadT43EvidenceAdequacySuite(
      devBytes(),
      corpusInput(),
      priorVisibleCases(),
    );

    expect(loaded.suiteSha256)
      .toBe(T43_EVIDENCE_ADEQUACY_SUITE_SHA256);
    expect(loaded.suite).toMatchObject({
      suiteId: "T43-EVIDENCE-ADEQUACY-DEV",
      split: "DEV",
      splitRole: "MODEL_DEVELOPMENT",
    });
    expect(loaded.suite.cases).toHaveLength(100);
    expect(
      loaded.suite.cases.filter(
        ({ scoring }) => scoring.expectation === "ANSWERABLE",
      ),
    ).toHaveLength(50);
    expect(
      loaded.suite.cases.filter(
        ({ scoring }) =>
          scoring.executionClass === "PRE_RETRIEVAL_EMPTY",
      ),
    ).toHaveLength(10);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.suite)).toBe(true);
    expect(Object.isFrozen(loaded.suite.cases[0].runtime)).toBe(true);
    expect(Object.isFrozen(loaded.suite.cases[0].scoring)).toBe(true);
    expect(
      Object.isFrozen(
        loaded.suite.cases[0].scoring.requiredEvidenceGroups,
      ),
    ).toBe(true);
  });

  it("rejects byte drift after structural validation", () => {
    const changed = Buffer.concat([devBytes(), Buffer.from("\n")]);

    expect(() => loadT43EvidenceAdequacySuite(
      changed,
      corpusInput(),
      priorVisibleCases(),
    )).toThrow(/byte sha256 mismatch/);
  });

  it("keeps scoring labels physically outside the runtime object", () => {
    const suite = mutableDevSuite();
    Object.assign(suite.cases[0].runtime, {
      expectation: "ANSWERABLE",
    });

    expect(() => T43EvidenceAdequacySuiteSchema.parse(suite))
      .toThrow();
  });

  it("rejects pack by stratum count drift", () => {
    const suite = mutableDevSuite();
    const direct = suite.cases.find(
      ({ runtime, scoring }) =>
        runtime.coursePackId === "general-design"
        && scoring.stratum === "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    )!;
    direct.scoring.stratum = "ANSWERABLE_PARAPHRASE_ALIAS";

    expect(() => T43EvidenceAdequacySuiteSchema.parse(suite))
      .toThrow(/requires exactly 2 cases/);
  });

  it("requires each pair to share one family and cluster", () => {
    const suite = mutableDevSuite();
    const paired = suite.cases.find(
      ({ scoring }) => scoring.pairId !== null,
    )!;
    paired.scoring.familyId = "t43-family-deliberate-pair-drift";

    expect(() => T43EvidenceAdequacySuiteSchema.parse(suite))
      .toThrow(/one delta kind, family, and cluster/);
  });

  it("requires exact object-reuse and overlap declarations", () => {
    const reuseSuite = mutableDevSuite();
    reuseSuite.reuseManifest[0].caseCount += 1;
    expect(() => T43EvidenceAdequacySuiteSchema.parse(reuseSuite))
      .toThrow(/exactly declare repeated answerable objects/);

    const overlapSuite = mutableDevSuite();
    overlapSuite.priorIntentOverlapManifest[0]
      .requiredEvidenceNodeIds[0] = `node-${"a".repeat(64)}`;
    expect(() => T43EvidenceAdequacySuiteSchema.parse(overlapSuite))
      .toThrow(/declared overlap nodes must exactly equal flattened qrels/);
  });

  it("rejects qrels bound to a different target object", () => {
    const suite = T43EvidenceAdequacySuiteSchema.parse(
      mutableDevSuite(),
    );
    const changed = structuredClone(suite);
    const positives = changed.cases.filter(
      ({ scoring }) => scoring.expectation === "ANSWERABLE",
    );
    positives[0].scoring.requiredEvidenceGroups[0][0] =
      positives[1].scoring.requiredEvidenceGroups[0][0];

    expect(() =>
      assertT43EvidenceAdequacyQrels(changed, corpusInput()))
      .toThrow(/T43_QREL_NODE_OWNER_MISMATCH/);
  });

  it("requires every declared prior control to reference a visible case", () => {
    const referenced = mutableDevSuite()
      .priorIntentOverlapManifest[0].priorSuiteCaseIds[0];
    const incomplete = priorVisibleCases().filter(
      ({ caseId }) => caseId !== referenced,
    );

    expect(() => loadT43EvidenceAdequacySuite(
      devBytes(),
      corpusInput(),
      incomplete,
    )).toThrow(/T43_PRIOR_INTENT_CASE_MISSING/);
  });

  it("rejects exact prior question, family, and cluster reuse", () => {
    const suite = mutableDevSuite();
    const current = suite.cases[0];
    const visible = priorVisibleCases();

    expect(() => loadT43EvidenceAdequacySuite(
      devBytes(),
      corpusInput(),
      [
        ...visible,
        {
          caseId: "synthetic-visible-question",
          familyId: null,
          clusterId: null,
          question: current.runtime.question,
        },
      ],
    )).toThrow(/T43_PRIOR_NORMALIZED_QUESTION_REUSED/);

    expect(() => loadT43EvidenceAdequacySuite(
      devBytes(),
      corpusInput(),
      [
        ...visible,
        {
          caseId: "synthetic-visible-intent",
          familyId: current.scoring.familyId.replace(
            "t43-family-",
            "t42-family-",
          ),
          clusterId: current.scoring.clusterId.replace(
            "t43-cluster-",
            "t42-cluster-",
          ),
          question: "synthetic prior question",
        },
      ],
    )).toThrow(/T43_PRIOR_FAMILY_REUSED/);
  });
});
