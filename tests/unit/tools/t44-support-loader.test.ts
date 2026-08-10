import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadLegacyKnowledgeCorpusV2,
} from "../../helpers/knowledge-v2-generation-fixtures";

import {
  buildT44SupportDevArtifacts,
  serializeT44SupportArtifact,
} from "../../../tools/mixed-retrieval/t44-support-authoring";
import {
  assertT44SupportDevBindings,
  loadT44SupportDevArtifacts,
  projectT44SupportRuntimeCases,
  T44SupportQrelsSuiteSchema,
  T44SupportRuntimeSuiteSchema,
  t44SupportQrelsSuiteHash,
  t44SupportRuntimeSuiteHash,
} from "../../../tools/mixed-retrieval/t44-support-loader";

const workspaceRoot = process.cwd();
const runtimePath = path.join(
  workspaceRoot,
  "tests",
  "retrieval-quality",
  "t44-support-dev.runtime.json",
);
const qrelsPath = path.join(
  workspaceRoot,
  "tests",
  "retrieval-quality",
  "t44-support-dev.qrels.json",
);
async function readFixture() {
  const [runtimeText, qrelsText] =
    await Promise.all([
      readFile(runtimePath, "utf8"),
      readFile(qrelsPath, "utf8"),
    ]);
  return {
    runtimeText,
    qrelsText,
    corpus: loadLegacyKnowledgeCorpusV2(),
    runtime: JSON.parse(runtimeText) as unknown,
    qrels: JSON.parse(qrelsText) as unknown,
  };
}

const fixturePromise = readFixture();

describe("T4.4 support DEV artifacts", () => {
  it("loads 50 frozen cases with balanced packs and strata", async () => {
    const fixture = await fixturePromise;
    const loaded = loadT44SupportDevArtifacts(
      fixture.runtime,
      fixture.qrels,
      fixture.corpus,
    );

    expect(loaded.runtime.cases).toHaveLength(50);
    expect(loaded.qrels.cases).toHaveLength(50);
    expect(
      loaded.qrels.cases.filter(
        ({ multiClaim }) => multiClaim,
      ),
    ).toHaveLength(10);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.runtime.cases)).toBe(true);
  });

  it("rebuilds both committed artifacts byte for byte", async () => {
    const fixture = await fixturePromise;
    const built =
      buildT44SupportDevArtifacts(fixture.corpus);

    expect(serializeT44SupportArtifact(built.runtime))
      .toBe(fixture.runtimeText);
    expect(serializeT44SupportArtifact(built.qrels))
      .toBe(fixture.qrelsText);
  });

  it("keeps questions and qrels in physically separate files", async () => {
    const fixture = await fixturePromise;

    expect(fixture.runtimeText).not.toContain(
      "requiredEvidenceGroups",
    );
    expect(fixture.runtimeText).not.toContain(
      "hardNegativeNodeIds",
    );
    expect(fixture.qrelsText).not.toContain("\"question\"");
    expect(fixture.qrelsText).not.toContain(
      "双钻做项目时",
    );
  });

  it("projects only runtime-visible fields for a retriever", async () => {
    const fixture = await fixturePromise;
    const runtime =
      T44SupportRuntimeSuiteSchema.parse(fixture.runtime);
    const projection =
      projectT44SupportRuntimeCases(runtime);

    expect(Object.keys(projection[0] ?? {}).sort()).toEqual([
      "caseId",
      "coursePackId",
      "coursePackVersion",
      "mode",
      "question",
    ]);
    expect(JSON.stringify(projection)).not.toContain(
      "acceptableNodeIds",
    );
    expect(JSON.stringify(projection)).not.toContain(
      "hardNegativeNodeIds",
    );
  });

  it("rejects a missing canonical evidence node", async () => {
    const fixture = await fixturePromise;
    const runtime =
      T44SupportRuntimeSuiteSchema.parse(fixture.runtime);
    const qrels = structuredClone(
      T44SupportQrelsSuiteSchema.parse(fixture.qrels),
    );
    qrels.cases[0]!.requiredEvidenceGroups[0]!
      .acceptableNodeIds[0] = `node-${"0".repeat(64)}`;

    expect(() =>
      assertT44SupportDevBindings(
        runtime,
        qrels,
        fixture.corpus,
      ))
      .toThrow(/T44_SUPPORT_QREL_NODE_MISSING/);
  });

  it("rejects cross-pack evidence even when the node exists", async () => {
    const fixture = await fixturePromise;
    const runtime =
      T44SupportRuntimeSuiteSchema.parse(fixture.runtime);
    const qrels = structuredClone(
      T44SupportQrelsSuiteSchema.parse(fixture.qrels),
    );
    const digitalNode = qrels.cases[10]!
      .requiredEvidenceGroups[0]!
      .acceptableNodeIds[0]!;
    qrels.cases[0]!.requiredEvidenceGroups[0]!
      .acceptableNodeIds[0] = digitalNode;

    expect(() =>
      assertT44SupportDevBindings(
        runtime,
        qrels,
        fixture.corpus,
      ))
      .toThrow(
        /T44_SUPPORT_QREL_NODE_SCOPE_OR_ROLE_INVALID/,
      );
  });

  it("rejects a hard negative that is also required", async () => {
    const fixture = await fixturePromise;
    const runtime =
      T44SupportRuntimeSuiteSchema.parse(fixture.runtime);
    const qrels = structuredClone(
      T44SupportQrelsSuiteSchema.parse(fixture.qrels),
    );
    qrels.cases[0]!.hardNegativeNodeIds[0] =
      qrels.cases[0]!.requiredEvidenceGroups[0]!
        .acceptableNodeIds[0]!;

    expect(() =>
      assertT44SupportDevBindings(
        runtime,
        qrels,
        fixture.corpus,
      ))
      .toThrow(/T44_SUPPORT_HARD_NEGATIVE_IS_REQUIRED/);
  });

  it("binds qrels to the exact runtime suite hash", async () => {
    const fixture = await fixturePromise;
    const runtime =
      T44SupportRuntimeSuiteSchema.parse(fixture.runtime);
    const qrels = structuredClone(
      T44SupportQrelsSuiteSchema.parse(fixture.qrels),
    );
    qrels.runtimeSuite.suiteHash = "f".repeat(64);

    expect(() =>
      assertT44SupportDevBindings(
        runtime,
        qrels,
        fixture.corpus,
      ))
      .toThrow(
        /T44_SUPPORT_RUNTIME_QRELS_BINDING_MISMATCH/,
      );
  });

  it("changes the runtime hash when a question changes", async () => {
    const fixture = await fixturePromise;
    const runtime = structuredClone(
      T44SupportRuntimeSuiteSchema.parse(fixture.runtime),
    );
    runtime.cases[0]!.question += "？";

    expect(t44SupportRuntimeSuiteHash(runtime)).not.toBe(
      runtime.suiteHash,
    );
  });

  it("changes the qrels hash when evidence changes", async () => {
    const fixture = await fixturePromise;
    const qrels = structuredClone(
      T44SupportQrelsSuiteSchema.parse(fixture.qrels),
    );
    qrels.cases[0]!.multiClaim = true;

    expect(t44SupportQrelsSuiteHash(qrels)).not.toBe(
      qrels.suiteHash,
    );
  });
});
