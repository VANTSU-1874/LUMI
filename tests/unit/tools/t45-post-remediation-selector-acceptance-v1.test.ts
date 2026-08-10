import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createLegacyKnowledgeEvaluationWorkspace,
} from "../../helpers/knowledge-v2-generation-fixtures";

import {
  loadPostRemediationSelectorAcceptanceV1,
  postRemediationQrelsHashV1,
  postRemediationRuntimeHashV1,
  projectPostRemediationRuntimePortV1,
} from "../../../tools/mixed-retrieval/t45-post-remediation-selector-acceptance-v1";

const root = process.cwd();
let frozenRoot = root;

beforeAll(async () => {
  frozenRoot = await createLegacyKnowledgeEvaluationWorkspace(root);
});

afterAll(async () => {
  await rm(frozenRoot, { recursive: true, force: true });
});

describe("T45 post-remediation selector acceptance", () => {
  it("loads a 20-case, 10-family, five-course migration suite", async () => {
    const loaded =
      await loadPostRemediationSelectorAcceptanceV1(frozenRoot);

    expect(loaded.audit).toMatchObject({
      cases: 20,
      families: 10,
      requiredGroups: 30,
      multiClaimCases: 10,
      sourcePartition: "FROZEN_T44",
      validationQrelsReads: 0,
      courseCounts: {
        "book-design": 4,
        "brand-vi-design": 4,
        "digital-interaction": 4,
        "general-design": 4,
        "layout-design": 4,
      },
    });
    expect(projectPostRemediationRuntimePortV1(loaded).cases)
      .toHaveLength(20);
  });

  it("keeps scoring truth out of runtime-visible cases", async () => {
    const loaded =
      await loadPostRemediationSelectorAcceptanceV1(frozenRoot);
    const serialized = JSON.stringify(
      projectPostRemediationRuntimePortV1(loaded),
    );

    expect(serialized).not.toContain("acceptableNodeIds");
    expect(serialized).not.toContain("requiredEvidenceGroups");
    expect(serialized).not.toContain("hardNegativeNodeIds");
    expect(serialized).not.toContain("\"node-");
  });

  it("binds both frozen files to their declared hashes", async () => {
    const runtime = JSON.parse(await readFile(path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-post-remediation-selector-acceptance.runtime.json",
    ), "utf8")) as Record<string, unknown>;
    const qrels = JSON.parse(await readFile(path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-post-remediation-selector-acceptance.qrels.json",
    ), "utf8")) as Record<string, unknown>;

    expect(postRemediationRuntimeHashV1(runtime))
      .toBe(runtime.suiteHash);
    expect(postRemediationQrelsHashV1(qrels))
      .toBe(qrels.suiteHash);
  });

  it("does not reference the consumed validation qrels path", async () => {
    const source = await readFile(path.join(
      root,
      "tools/mixed-retrieval/"
        + "t45-post-remediation-selector-acceptance-v1.ts",
    ), "utf8");

    expect(source).not.toContain(
      "t45-capability-validation.qrels.json",
    );
  });
});
