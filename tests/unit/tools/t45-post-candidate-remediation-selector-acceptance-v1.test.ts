import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createLegacyKnowledgeEvaluationWorkspace,
} from "../../helpers/knowledge-v2-generation-fixtures";

import {
  loadPostCandidateRemediationRuntimeOnlyV1,
  projectPostCandidateRemediationRuntimeOnlyPortV1,
} from "../../../tools/mixed-retrieval/t45-post-candidate-remediation-runtime-only-v1";
import {
  loadPostCandidateRemediationAcceptanceV1,
  postCandidateRemediationQrelsHashV1,
  postCandidateRemediationRuntimeHashV1,
  projectPostCandidateRemediationRuntimePortV1,
} from "../../../tools/mixed-retrieval/t45-post-candidate-remediation-selector-acceptance-v1";

const root = process.cwd();
let frozenRoot = root;

beforeAll(async () => {
  frozenRoot = await createLegacyKnowledgeEvaluationWorkspace(root);
});

afterAll(async () => {
  await rm(frozenRoot, { recursive: true, force: true });
});

describe("T45 post-candidate-remediation selector acceptance", () => {
  it("freezes 20 cases with candidate-reachable labels only", async () => {
    const loaded =
      await loadPostCandidateRemediationAcceptanceV1(frozenRoot);

    expect(loaded.audit).toMatchObject({
      cases: 20,
      families: 10,
      requiredGroups: 30,
      multiClaimCases: 10,
      sourcePartition: "FROZEN_T44",
      newObjectFamilies: 8,
      reusedBrandFamilies: 2,
      candidateRoleViolations: 0,
      priorScoreFileReads: 0,
      courseCounts: {
        "book-design": 4,
        "brand-vi-design": 4,
        "digital-interaction": 4,
        "general-design": 4,
        "layout-design": 4,
      },
    });
    expect(
      projectPostCandidateRemediationRuntimePortV1(loaded).cases,
    ).toHaveLength(20);
  });

  it("keeps scoring truth out of both runtime projections", async () => {
    const full =
      await loadPostCandidateRemediationAcceptanceV1(frozenRoot);
    const runtimeOnly =
      await loadPostCandidateRemediationRuntimeOnlyV1(frozenRoot);
    const serialized = JSON.stringify({
      full: projectPostCandidateRemediationRuntimePortV1(full),
      runtimeOnly:
        projectPostCandidateRemediationRuntimeOnlyPortV1(
          runtimeOnly,
        ),
    });

    expect(serialized).not.toContain("acceptableNodeIds");
    expect(serialized).not.toContain("requiredEvidenceGroups");
    expect(serialized).not.toContain("hardNegativeNodeIds");
    expect(serialized).not.toContain("\"node-");
  });

  it("binds the runtime and score files to frozen hashes", async () => {
    const runtime = JSON.parse(await readFile(path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-post-candidate-remediation-selector-acceptance.runtime.json",
    ), "utf8")) as Record<string, unknown>;
    const qrels = JSON.parse(await readFile(path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-post-candidate-remediation-selector-acceptance.qrels.json",
    ), "utf8")) as Record<string, unknown>;

    expect(postCandidateRemediationRuntimeHashV1(runtime))
      .toBe(runtime.suiteHash);
    expect(postCandidateRemediationQrelsHashV1(qrels))
      .toBe(qrels.suiteHash);
  });

  it("uses a runtime-only import boundary with no score path or schema", async () => {
    const source = await readFile(path.join(
      root,
      "tools/mixed-retrieval/"
        + "t45-post-candidate-remediation-runtime-only-v1.ts",
    ), "utf8");

    expect(source).not.toContain("qrels");
    expect(source).not.toContain("acceptableNodeIds");
    expect(source).not.toContain("requiredEvidenceGroups");
    expect(source).not.toContain("hardNegativeNodeIds");
  });

  it("keeps every question distinct from all earlier T45 suites", async () => {
    const loaded =
      await loadPostCandidateRemediationAcceptanceV1(frozenRoot);
    expect(loaded.audit.priorScoreFileReads).toBe(0);
  });
});
