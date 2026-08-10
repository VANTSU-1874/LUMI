import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createLegacyKnowledgeEvaluationWorkspace,
} from "../../helpers/knowledge-v2-generation-fixtures";

import {
  loadPostCompletionRuntimeOnlyV1,
  projectPostCompletionRuntimeOnlyPortV1,
} from "../../../tools/mixed-retrieval/t45-post-completion-runtime-only-v1";
import {
  loadPostCompletionSelectorAcceptanceV1,
  postCompletionQrelsHashV1,
  postCompletionRuntimeHashV1,
  projectPostCompletionRuntimePortV1,
} from "../../../tools/mixed-retrieval/t45-post-completion-selector-acceptance-v1";

const root = process.cwd();
let frozenRoot = root;

beforeAll(async () => {
  frozenRoot = await createLegacyKnowledgeEvaluationWorkspace(root);
});

afterAll(async () => {
  await rm(frozenRoot, { recursive: true, force: true });
});

describe("T45 post-completion selector acceptance", () => {
  it("freezes 20 cases with eight new and two brand-reused families", async () => {
    const loaded =
      await loadPostCompletionSelectorAcceptanceV1(frozenRoot);

    expect(loaded.audit).toMatchObject({
      cases: 20,
      families: 10,
      requiredGroups: 30,
      multiClaimCases: 10,
      sourcePartition: "FROZEN_T44",
      newObjectFamilies: 8,
      reusedBrandFamilies: 2,
      priorScoreFileReads: 0,
      courseCounts: {
        "book-design": 4,
        "brand-vi-design": 4,
        "digital-interaction": 4,
        "general-design": 4,
        "layout-design": 4,
      },
    });
    expect(projectPostCompletionRuntimePortV1(loaded).cases)
      .toHaveLength(20);
  });

  it("keeps scoring truth out of both runtime projections", async () => {
    const full =
      await loadPostCompletionSelectorAcceptanceV1(frozenRoot);
    const runtimeOnly =
      await loadPostCompletionRuntimeOnlyV1(frozenRoot);
    const serialized = JSON.stringify({
      full: projectPostCompletionRuntimePortV1(full),
      runtimeOnly: projectPostCompletionRuntimeOnlyPortV1(
        runtimeOnly,
      ),
    });

    expect(serialized).not.toContain("acceptableNodeIds");
    expect(serialized).not.toContain("requiredEvidenceGroups");
    expect(serialized).not.toContain("hardNegativeNodeIds");
    expect(serialized).not.toContain("\"node-");
  });

  it("binds the new runtime and score files to frozen hashes", async () => {
    const runtime = JSON.parse(await readFile(path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-post-completion-selector-acceptance.runtime.json",
    ), "utf8")) as Record<string, unknown>;
    const qrels = JSON.parse(await readFile(path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-post-completion-selector-acceptance.qrels.json",
    ), "utf8")) as Record<string, unknown>;

    expect(postCompletionRuntimeHashV1(runtime))
      .toBe(runtime.suiteHash);
    expect(postCompletionQrelsHashV1(qrels))
      .toBe(qrels.suiteHash);
  });

  it("uses a runtime-only import boundary with no score path or schema", async () => {
    const source = await readFile(path.join(
      root,
      "tools/mixed-retrieval/"
        + "t45-post-completion-runtime-only-v1.ts",
    ), "utf8");

    expect(source).not.toContain("qrels");
    expect(source).not.toContain("acceptableNodeIds");
    expect(source).not.toContain("requiredEvidenceGroups");
    expect(source).not.toContain("hardNegativeNodeIds");
  });

  it("keeps every new question distinct from all earlier T45 suites", async () => {
    const current = JSON.parse(await readFile(path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-post-completion-selector-acceptance.runtime.json",
    ), "utf8")) as {
      cases: Array<{ caseId: string; question: string }>;
    };
    const priorNames = [
      "t45-capability-calibration.runtime.json",
      "t45-capability-validation.runtime.json",
      "t45-post-remediation-selector-acceptance.runtime.json",
    ];
    const prior = (await Promise.all(priorNames.map(
      async (name) =>
        JSON.parse(await readFile(path.join(
          root,
          "tests/retrieval-quality",
          name,
        ), "utf8")) as {
          cases: Array<{ caseId: string; question: string }>;
        },
    ))).flatMap(({ cases }) => cases);
    const ids = new Set(prior.map(({ caseId }) => caseId));
    const questions = new Set(prior.map(({ question }) => question));

    expect(current.cases.every(({ caseId, question }) =>
      !ids.has(caseId) && !questions.has(question)
    )).toBe(true);
  });
});
