import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadLegacyKnowledgeCorpusV2,
} from "../../helpers/knowledge-v2-generation-fixtures";

import {
  sha256StableJsonV2,
} from "../../../lib/knowledge/knowledge-object-v2";
import {
  buildT45CapabilityArtifacts,
  serializeT45CapabilityArtifact,
} from "../../../tools/mixed-retrieval/t45-capability-authoring";
import {
  loadT45CapabilityArtifacts,
  projectT45RuntimeCases,
} from "../../../tools/mixed-retrieval/t45-capability-loader";

const workspaceRoot = process.cwd();
const retrievalQualityRoot = path.join(
  workspaceRoot,
  "tests",
  "retrieval-quality",
);
const frozenT44QrelsPath = path.join(
  retrievalQualityRoot,
  "t44-support-dev.qrels.json",
);

const artifactPaths = {
  inventory: path.join(
    retrievalQualityRoot,
    "t45-capability-inventory.json",
  ),
  calibrationRuntime: path.join(
    retrievalQualityRoot,
    "t45-capability-calibration.runtime.json",
  ),
  calibrationQrels: path.join(
    retrievalQualityRoot,
    "t45-capability-calibration.qrels.json",
  ),
  validationRuntime: path.join(
    retrievalQualityRoot,
    "t45-capability-validation.runtime.json",
  ),
  validationQrels: path.join(
    retrievalQualityRoot,
    "t45-capability-validation.qrels.json",
  ),
} as const;

// Mutation tests intentionally treat parsed JSON as writable fixture data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MutableRecord = Record<string, any>;

function reseal(
  value: MutableRecord,
  hashField: "inventoryHash" | "suiteHash",
) {
  const unhashed = { ...value };
  delete unhashed[hashField];
  value[hashField] = sha256StableJsonV2(unhashed);
}

function bindInventory(
  qrels: MutableRecord,
  inventory: MutableRecord,
) {
  qrels.capabilityInventory.inventoryHash =
    inventory.inventoryHash;
  reseal(qrels, "suiteHash");
}

function bindRuntime(
  qrels: MutableRecord,
  runtime: MutableRecord,
) {
  qrels.runtimeSuite.suiteHash = runtime.suiteHash;
  reseal(qrels, "suiteHash");
}

async function readFixture() {
  const [
    corpusText,
    frozenT44QrelsText,
    inventoryText,
    calibrationRuntimeText,
    calibrationQrelsText,
    validationRuntimeText,
    validationQrelsText,
  ] = await Promise.all([
    Promise.resolve(JSON.stringify(loadLegacyKnowledgeCorpusV2())),
    readFile(frozenT44QrelsPath, "utf8"),
    readFile(artifactPaths.inventory, "utf8"),
    readFile(artifactPaths.calibrationRuntime, "utf8"),
    readFile(artifactPaths.calibrationQrels, "utf8"),
    readFile(artifactPaths.validationRuntime, "utf8"),
    readFile(artifactPaths.validationQrels, "utf8"),
  ]);
  return {
    corpus: JSON.parse(corpusText) as MutableRecord,
    frozenT44Qrels:
      JSON.parse(frozenT44QrelsText) as MutableRecord,
    texts: {
      inventory: inventoryText,
      calibrationRuntime: calibrationRuntimeText,
      calibrationQrels: calibrationQrelsText,
      validationRuntime: validationRuntimeText,
      validationQrels: validationQrelsText,
    },
    inventory: JSON.parse(inventoryText) as MutableRecord,
    calibrationRuntime:
      JSON.parse(calibrationRuntimeText) as MutableRecord,
    calibrationQrels:
      JSON.parse(calibrationQrelsText) as MutableRecord,
    validationRuntime:
      JSON.parse(validationRuntimeText) as MutableRecord,
    validationQrels:
      JSON.parse(validationQrelsText) as MutableRecord,
  };
}

const fixturePromise = readFixture();

describe("T4.5 capability inventory authoring", () => {
  it("keeps the no-context international-style compound question self-contained", async () => {
    const fixture = await fixturePromise;
    const built = buildT45CapabilityArtifacts({
      corpusInput: fixture.corpus,
      frozenT44QrelsInput: fixture.frozenT44Qrels,
    });
    const testCase =
      built.calibration.runtime.cases.find(
        ({ caseId }) =>
          caseId
            === "t45-cal-international-compose",
      );

    expect(testCase?.question).toContain(
      "国际主义风格",
    );
  });

  it("partitions every canonical object exactly once", async () => {
    const fixture = await fixturePromise;
    const built = buildT45CapabilityArtifacts({
      corpusInput: fixture.corpus,
      frozenT44QrelsInput: fixture.frozenT44Qrels,
    });
    const counts = Object.groupBy(
      built.inventory.objects,
      ({ partition }) => partition,
    );

    expect(built.inventory.objects).toHaveLength(116);
    expect(
      new Set(
        built.inventory.objects.map(({ objectId }) => objectId),
      ).size,
    ).toBe(116);
    expect(counts.FROZEN_T44).toHaveLength(42);
    expect(counts.DEV_CAL).toHaveLength(11);
    expect(counts.VALIDATION).toHaveLength(13);
    expect(counts.VISUAL_RESERVE).toHaveLength(50);
    expect(
      new Set(
        built.inventory.families
          .filter(({ partition }) => partition === "DEV_CAL")
          .map(({ familyId }) => familyId),
      ).size,
    ).toBe(10);
    expect(
      new Set(
        built.inventory.families
          .filter(
            ({ partition }) => partition === "VALIDATION",
          )
          .map(({ familyId }) => familyId),
      ).size,
    ).toBe(10);
    expect(
      built.inventory.families.filter(
        ({ partition }) => partition === "VISUAL_RESERVE",
      ),
    ).toEqual([
      expect.objectContaining({
        familyId: "poster-analysis-template",
        objectIds: expect.arrayContaining([
          "layout-101-poster-01-analysis",
          "layout-150-poster-50-analysis",
        ]),
      }),
    ]);
  });

  it("clusters all poster templates under one exact fingerprint", async () => {
    const fixture = await fixturePromise;
    const built = buildT45CapabilityArtifacts({
      corpusInput: fixture.corpus,
      frozenT44QrelsInput: fixture.frozenT44Qrels,
    });
    const posters = built.inventory.objects.filter(
      ({ partition }) => partition === "VISUAL_RESERVE",
    );

    expect(posters).toHaveLength(50);
    expect(
      new Set(
        posters.map(({ capabilityFingerprint }) =>
          capabilityFingerprint),
      ).size,
    ).toBe(1);
    expect(
      new Set(posters.map(({ familyId }) => familyId)),
    ).toEqual(new Set(["poster-analysis-template"]));
  });

  it("keeps calibration and validation capabilities isolated", async () => {
    const fixture = await fixturePromise;
    const { inventory } = buildT45CapabilityArtifacts({
      corpusInput: fixture.corpus,
      frozenT44QrelsInput: fixture.frozenT44Qrels,
    });
    const calibration = inventory.objects.filter(
      ({ partition }) => partition === "DEV_CAL",
    );
    const validation = inventory.objects.filter(
      ({ partition }) => partition === "VALIDATION",
    );

    for (const key of [
      "objectId",
      "familyId",
      "capabilityFingerprint",
    ] as const) {
      const calibrationValues = new Set(
        calibration.map((entry) => entry[key]),
      );
      expect(
        validation.filter((entry) =>
          calibrationValues.has(entry[key])),
      ).toEqual([]);
    }
  });

  it("rebuilds all five committed artifacts byte for byte", async () => {
    const fixture = await fixturePromise;
    const built = buildT45CapabilityArtifacts({
      corpusInput: fixture.corpus,
      frozenT44QrelsInput: fixture.frozenT44Qrels,
    });

    expect(serializeT45CapabilityArtifact(built.inventory))
      .toBe(fixture.texts.inventory);
    expect(
      serializeT45CapabilityArtifact(
        built.calibration.runtime,
      ),
    ).toBe(fixture.texts.calibrationRuntime);
    expect(
      serializeT45CapabilityArtifact(
        built.calibration.qrels,
      ),
    ).toBe(fixture.texts.calibrationQrels);
    expect(
      serializeT45CapabilityArtifact(
        built.validation.runtime,
      ),
    ).toBe(fixture.texts.validationRuntime);
    expect(
      serializeT45CapabilityArtifact(
        built.validation.qrels,
      ),
    ).toBe(fixture.texts.validationQrels);
  });
});

describe("T4.5 capability suite loading", () => {
  it.each([
    ["CALIBRATION", "calibrationRuntime", "calibrationQrels"],
    ["VALIDATION", "validationRuntime", "validationQrels"],
  ] as const)(
    "loads the %s split with the frozen balance",
    async (split, runtimeKey, qrelsKey) => {
      const fixture = await fixturePromise;
      const loaded = loadT45CapabilityArtifacts({
        inventoryInput: fixture.inventory,
        runtimeInput: fixture[runtimeKey],
        qrelsInput: fixture[qrelsKey],
        corpusInput: fixture.corpus,
        expectedSplit: split,
      });
      const familyStrata = new Map<string, Set<string>>();
      for (const testCase of loaded.runtime.cases) {
        const strata =
          familyStrata.get(testCase.familyId) ?? new Set();
        strata.add(testCase.stratum);
        familyStrata.set(testCase.familyId, strata);
      }

      expect(loaded.runtime.cases).toHaveLength(20);
      expect(loaded.qrels.cases).toHaveLength(20);
      expect(
        loaded.qrels.cases.reduce(
          (sum, testCase) =>
            sum + testCase.requiredEvidenceGroups.length,
          0,
        ),
      ).toBe(30);
      expect(
        loaded.qrels.cases.filter(
          ({ multiClaim }) => multiClaim,
        ),
      ).toHaveLength(10);
      expect(familyStrata.size).toBe(10);
      expect(
        [...familyStrata.values()].every(
          (strata) =>
            strata.size === 2
            && strata.has("DIRECT_PARAPHRASE")
            && strata.has("COMPOSITION_HARD_DISTRACTOR"),
        ),
      ).toBe(true);
      expect(Object.isFrozen(loaded)).toBe(true);
      expect(Object.isFrozen(loaded.inventory.objects)).toBe(
        true,
      );
      expect(Object.isFrozen(loaded.runtime.cases)).toBe(true);
      expect(Object.isFrozen(loaded.qrels.cases)).toBe(true);
    },
  );

  it("keeps runtime questions and qrel labels physically separate", async () => {
    const fixture = await fixturePromise;

    for (const runtimeText of [
      fixture.texts.calibrationRuntime,
      fixture.texts.validationRuntime,
    ]) {
      expect(runtimeText).not.toContain(
        "requiredEvidenceGroups",
      );
      expect(runtimeText).not.toContain(
        "hardNegativeNodeIds",
      );
      expect(runtimeText).not.toContain("\"multiClaim\"");
    }
    for (const qrelsText of [
      fixture.texts.calibrationQrels,
      fixture.texts.validationQrels,
    ]) {
      expect(qrelsText).not.toContain("\"question\"");
      expect(qrelsText).not.toContain(
        "我这个小册子总是先排了再返工",
      );
      expect(qrelsText).not.toContain(
        "GLSL TOP 黑屏了",
      );
    }
  });

  it("projects only runtime-visible fields", async () => {
    const fixture = await fixturePromise;
    const loaded = loadT45CapabilityArtifacts({
      inventoryInput: fixture.inventory,
      runtimeInput: fixture.calibrationRuntime,
      qrelsInput: fixture.calibrationQrels,
      corpusInput: fixture.corpus,
      expectedSplit: "CALIBRATION",
    });
    const projected = projectT45RuntimeCases(loaded.runtime);

    expect(Object.keys(projected[0] ?? {}).sort()).toEqual([
      "caseId",
      "coursePackId",
      "coursePackVersion",
      "familyId",
      "mode",
      "question",
      "stratum",
    ]);
    expect(JSON.stringify(projected)).not.toContain(
      "acceptableNodeIds",
    );
    expect(JSON.stringify(projected)).not.toContain(
      "hardNegativeNodeIds",
    );
  });

  it("rejects object content hash drift", async () => {
    const fixture = await fixturePromise;
    const inventory = structuredClone(fixture.inventory);
    inventory.objects[0].objectContentHash = "f".repeat(64);
    reseal(inventory, "inventoryHash");
    const qrels = structuredClone(fixture.calibrationQrels);
    bindInventory(qrels, inventory);

    expect(() =>
      loadT45CapabilityArtifacts({
        inventoryInput: inventory,
        runtimeInput: fixture.calibrationRuntime,
        qrelsInput: qrels,
        corpusInput: fixture.corpus,
        expectedSplit: "CALIBRATION",
      }),
    ).toThrow(/OBJECT_CONTENT_HASH_MISMATCH/);
  });

  it("rejects a missing corpus object", async () => {
    const fixture = await fixturePromise;
    const corpus = structuredClone(fixture.corpus);
    corpus.objects = corpus.objects.slice(1);

    expect(() =>
      loadT45CapabilityArtifacts({
        inventoryInput: fixture.inventory,
        runtimeInput: fixture.calibrationRuntime,
        qrelsInput: fixture.calibrationQrels,
        corpusInput: corpus,
        expectedSplit: "CALIBRATION",
      }),
    ).toThrow(/KNOWLEDGE_BUNDLE_HASH_DRIFT/);
  });

  it("rejects one fingerprint reused across partitions", async () => {
    const fixture = await fixturePromise;
    const inventory = structuredClone(fixture.inventory);
    const calibration = inventory.objects.find(
      ({ partition }: MutableRecord) =>
        partition === "DEV_CAL",
    );
    const validation = inventory.objects.find(
      ({ partition }: MutableRecord) =>
        partition === "VALIDATION",
    );
    validation.capabilityFingerprint =
      calibration.capabilityFingerprint;
    reseal(inventory, "inventoryHash");
    const qrels = structuredClone(fixture.calibrationQrels);
    bindInventory(qrels, inventory);

    expect(() =>
      loadT45CapabilityArtifacts({
        inventoryInput: inventory,
        runtimeInput: fixture.calibrationRuntime,
        qrelsInput: qrels,
        corpusInput: fixture.corpus,
        expectedSplit: "CALIBRATION",
      }),
    ).toThrow(/FINGERPRINT_CROSSES_PARTITIONS/);
  });

  it("rejects one family reused across partitions", async () => {
    const fixture = await fixturePromise;
    const inventory = structuredClone(fixture.inventory);
    const calibration = inventory.objects.find(
      ({ partition }: MutableRecord) =>
        partition === "DEV_CAL",
    );
    const validation = inventory.objects.find(
      ({ partition }: MutableRecord) =>
        partition === "VALIDATION",
    );
    validation.familyId = calibration.familyId;
    const validationFamily = inventory.families.find(
      ({ familyId }: MutableRecord) =>
        familyId
        === "book-layout-reading-evidence",
    );
    validationFamily.familyId = calibration.familyId;
    reseal(inventory, "inventoryHash");
    const qrels = structuredClone(fixture.calibrationQrels);
    bindInventory(qrels, inventory);

    expect(() =>
      loadT45CapabilityArtifacts({
        inventoryInput: inventory,
        runtimeInput: fixture.calibrationRuntime,
        qrelsInput: qrels,
        corpusInput: fixture.corpus,
        expectedSplit: "CALIBRATION",
      }),
    ).toThrow(/FAMILY_CROSSES_PARTITIONS/);
  });

  it("rejects moving a composition group to the direct case while preserving the suite total", async () => {
    const fixture = await fixturePromise;
    const qrels = structuredClone(
      fixture.calibrationQrels,
    );
    const movedGroup =
      qrels.cases[1].requiredEvidenceGroups.pop();
    qrels.cases[0].requiredEvidenceGroups.push(
      movedGroup,
    );
    reseal(qrels, "suiteHash");

    expect(() =>
      loadT45CapabilityArtifacts({
        inventoryInput: fixture.inventory,
        runtimeInput: fixture.calibrationRuntime,
        qrelsInput: qrels,
        corpusInput: fixture.corpus,
        expectedSplit: "CALIBRATION",
      }),
    ).toThrow(
      /T45_CAPABILITY_GROUP_COUNT_STRATUM_MISMATCH:t45-cal-book-microtask-direct:2/,
    );
  });

  it("rejects a validation family injected into calibration", async () => {
    const fixture = await fixturePromise;
    const runtime = structuredClone(
      fixture.calibrationRuntime,
    );
    const qrels = structuredClone(fixture.calibrationQrels);
    runtime.cases[0].familyId =
      "book-layout-reading-evidence";
    qrels.cases[0].familyId =
      "book-layout-reading-evidence";
    reseal(runtime, "suiteHash");
    bindRuntime(qrels, runtime);

    expect(() =>
      loadT45CapabilityArtifacts({
        inventoryInput: fixture.inventory,
        runtimeInput: runtime,
        qrelsInput: qrels,
        corpusInput: fixture.corpus,
        expectedSplit: "CALIBRATION",
      }),
    ).toThrow(/CASE_FAMILY_OUTSIDE_SPLIT/);
  });

  it("rejects a hard negative from another course", async () => {
    const fixture = await fixturePromise;
    const qrels = structuredClone(fixture.calibrationQrels);
    qrels.cases[0].hardNegativeNodeIds[0] =
      fixture.calibrationQrels.cases[4]
        .hardNegativeNodeIds[0];
    reseal(qrels, "suiteHash");

    expect(() =>
      loadT45CapabilityArtifacts({
        inventoryInput: fixture.inventory,
        runtimeInput: fixture.calibrationRuntime,
        qrelsInput: qrels,
        corpusInput: fixture.corpus,
        expectedSplit: "CALIBRATION",
      }),
    ).toThrow(/HARD_NEGATIVE_SCOPE_INVALID/);
  });

  it("rejects a hard negative from another split", async () => {
    const fixture = await fixturePromise;
    const qrels = structuredClone(fixture.calibrationQrels);
    qrels.cases[0].hardNegativeNodeIds[0] =
      fixture.validationQrels.cases[0]
        .requiredEvidenceGroups[0]
        .acceptableNodeIds[0];
    reseal(qrels, "suiteHash");

    expect(() =>
      loadT45CapabilityArtifacts({
        inventoryInput: fixture.inventory,
        runtimeInput: fixture.calibrationRuntime,
        qrelsInput: qrels,
        corpusInput: fixture.corpus,
        expectedSplit: "CALIBRATION",
      }),
    ).toThrow(/HARD_NEGATIVE_SCOPE_INVALID/);
  });

  it("rejects a hard negative that is required evidence", async () => {
    const fixture = await fixturePromise;
    const qrels = structuredClone(fixture.calibrationQrels);
    qrels.cases[0].hardNegativeNodeIds[0] =
      qrels.cases[0].requiredEvidenceGroups[0]
        .acceptableNodeIds[0];
    reseal(qrels, "suiteHash");

    expect(() =>
      loadT45CapabilityArtifacts({
        inventoryInput: fixture.inventory,
        runtimeInput: fixture.calibrationRuntime,
        qrelsInput: qrels,
        corpusInput: fixture.corpus,
        expectedSplit: "CALIBRATION",
      }),
    ).toThrow(/HARD_NEGATIVE_IS_REQUIRED/);
  });

  it("rejects a changed question without a matching hash", async () => {
    const fixture = await fixturePromise;
    const runtime = structuredClone(
      fixture.calibrationRuntime,
    );
    runtime.cases[0].question += "？";

    expect(() =>
      loadT45CapabilityArtifacts({
        inventoryInput: fixture.inventory,
        runtimeInput: runtime,
        qrelsInput: fixture.calibrationQrels,
        corpusInput: fixture.corpus,
        expectedSplit: "CALIBRATION",
      }),
    ).toThrow(/RUNTIME_HASH_MISMATCH/);
  });

  it("rejects qrels bound to another runtime hash", async () => {
    const fixture = await fixturePromise;
    const qrels = structuredClone(fixture.calibrationQrels);
    qrels.runtimeSuite.suiteHash = "f".repeat(64);
    reseal(qrels, "suiteHash");

    expect(() =>
      loadT45CapabilityArtifacts({
        inventoryInput: fixture.inventory,
        runtimeInput: fixture.calibrationRuntime,
        qrelsInput: qrels,
        corpusInput: fixture.corpus,
        expectedSplit: "CALIBRATION",
      }),
    ).toThrow(/RUNTIME_QRELS_BINDING_MISMATCH/);
  });

  it.each([
    [
      "acceptableNodeIds",
      "T45_CAPABILITY_RUNTIME_ACCEPTABLE_NODE_IDS_FORBIDDEN",
    ],
    [
      "hardNegativeNodeIds",
      "T45_CAPABILITY_RUNTIME_HARD_NEGATIVE_NODE_IDS_FORBIDDEN",
    ],
    [
      "requiredGroups",
      "T45_CAPABILITY_RUNTIME_REQUIRED_GROUPS_FORBIDDEN",
    ],
  ] as const)(
    "rejects the %s label field injected into runtime with a stable code",
    async (field, errorCode) => {
      const fixture = await fixturePromise;
      const runtime = structuredClone(
        fixture.calibrationRuntime,
      );
      const qrels = structuredClone(
        fixture.calibrationQrels,
      );
      runtime.cases[0][field] =
        field === "requiredGroups"
          ? structuredClone(
              fixture.calibrationQrels.cases[0]
                .requiredEvidenceGroups,
            )
          : [
              fixture.calibrationQrels.cases[0]
                .hardNegativeNodeIds[0],
            ];
      reseal(runtime, "suiteHash");
      bindRuntime(qrels, runtime);

      expect(() =>
        loadT45CapabilityArtifacts({
          inventoryInput: fixture.inventory,
          runtimeInput: runtime,
          qrelsInput: qrels,
          corpusInput: fixture.corpus,
          expectedSplit: "CALIBRATION",
        }),
      ).toThrow(new RegExp(`${errorCode}$`));
    },
  );
});
