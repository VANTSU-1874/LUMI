// @vitest-environment node

import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CoursePngManifestSchema } from "@/lib/knowledge/course-png-manifest";
import { loadKnowledgeDirectory } from "@/lib/knowledge/retrieve";
import {
  RetrievalGoldenSuiteSchema,
  RetrievalModeSchema,
} from "@/lib/knowledge/retrieval-quality";

const workspaceRoot = process.cwd();
const suitePath = path.join(workspaceRoot, "tests", "retrieval-quality", "golden-suite.json");

describe("retrieval quality golden suite", () => {
  it("binds every target to the frozen knowledge and asset snapshot", async () => {
    const suite = RetrievalGoldenSuiteSchema.parse(
      JSON.parse(await readFile(suitePath, "utf8")),
    );
    const manifestBytes = await readFile(path.join(workspaceRoot, suite.corpusSnapshot.assetManifest));
    const manifest = CoursePngManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
    const assets = new Map(manifest.assets.map((asset) => [asset.path, asset]));
    const knowledge = await loadKnowledgeDirectory(path.join(workspaceRoot, "data", "knowledge"));
    const knowledgeIds = new Set(knowledge.map(({ id }) => id));

    expect(manifest.assetCount).toBe(suite.corpusSnapshot.assetCount);
    expect(createHash("sha256").update(manifestBytes).digest("hex"))
      .toBe(suite.corpusSnapshot.assetManifestSha256);
    expect(knowledge).toHaveLength(suite.corpusSnapshot.runtimeKnowledgeCount);
    expect(new Set(suite.cases.map(({ mode }) => mode)))
      .toEqual(new Set(RetrievalModeSchema.options));
    expect(suite.cases.every(({ query }) => "coursePackId" in query)).toBe(true);

    for (const testCase of suite.cases) {
      if (testCase.query.assetPath) {
        expect(assets.has(testCase.query.assetPath), testCase.id).toBe(true);
      }
      for (const node of testCase.targets.nodes) {
        expect(knowledgeIds.has(node.id), `${testCase.id}:${node.id}`).toBe(true);
      }
      for (const asset of testCase.targets.assets) {
        expect(assets.get(asset.path)?.sha256, `${testCase.id}:${asset.path}`)
          .toBe(asset.sha256);
      }
      for (const locator of testCase.targets.expectedParentLocators) {
        await expect(access(path.join(workspaceRoot, locator)), `${testCase.id}:${locator}`)
          .resolves.toBeUndefined();
      }
      if (testCase.expectation === "ANSWERABLE") {
        expect(testCase.expectedSourceCoursePackId, testCase.id).not.toBeNull();
      } else {
        expect(testCase.expectedSourceCoursePackId, testCase.id).toBeNull();
      }
    }
  });

  it("records source-course and legacy placement separately for layout evidence", async () => {
    const suite = RetrievalGoldenSuiteSchema.parse(
      JSON.parse(await readFile(suitePath, "utf8")),
    );
    const layoutEvidenceCases = suite.cases.filter(({ targets }) =>
      targets.nodes.some(({ id }) => /^layout-1\d\d-poster-/.test(id)));

    expect(layoutEvidenceCases.length).toBeGreaterThan(0);
    expect(layoutEvidenceCases.every((testCase) =>
      testCase.expectedSourceCoursePackId === "layout-design"
      && testCase.expectedLegacyPlacementCoursePackId === "book-design")).toBe(true);
  });

  it("freezes independent visual clusters and keeps query images out of their own evidence", async () => {
    const suite = RetrievalGoldenSuiteSchema.parse(
      JSON.parse(await readFile(suitePath, "utf8")),
    );
    const countsByMode = Object.fromEntries(
      RetrievalModeSchema.options.map((mode) => [
        mode,
        suite.cases.filter((testCase) => testCase.mode === mode).length,
      ]),
    );
    const answerableVisualCases = suite.cases.filter(
      ({ expectation, mode }) =>
        expectation === "ANSWERABLE"
        && ["TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_TEXT_TO_EVIDENCE"].includes(mode),
    );
    const noAnswerCases = suite.cases.filter(({ expectation }) => expectation === "NO_ANSWER");
    const clusteredCases = suite.cases.filter(({ mode }) => mode !== "TEXT_TO_TEXT");
    const clusterTags = clusteredCases.map((testCase) => {
      const matches = testCase.tags.filter((tag) => tag.startsWith("cluster-"));
      expect(matches, testCase.id).toHaveLength(1);
      return matches[0]!;
    });

    expect(suite.suiteVersion).toBe("2026-07-28.4");
    expect(suite.cases).toHaveLength(51);
    expect(countsByMode).toEqual({
      TEXT_TO_TEXT: 5,
      TEXT_TO_IMAGE: 24,
      IMAGE_TO_IMAGE: 7,
      IMAGE_TEXT_TO_EVIDENCE: 7,
      NEGATIVE: 8,
    });
    expect(answerableVisualCases).toHaveLength(36);
    expect(noAnswerCases).toHaveLength(10);
    expect(clusterTags).toHaveLength(46);
    expect(new Set(clusterTags).size).toBe(46);

    for (const testCase of suite.cases.filter(({ mode }) => mode === "IMAGE_TO_IMAGE")) {
      const exclusions = testCase.query.excludeAssetPaths!;
      expect(exclusions, testCase.id).toHaveLength(3);
      expect(testCase.targets.forbiddenAssetPaths, testCase.id).toEqual(exclusions);
      expect(
        testCase.targets.assets.some(({ path: assetPath }) => exclusions.includes(assetPath)),
        testCase.id,
      ).toBe(false);
      const queryPoster = testCase.query.assetPath!.match(/poster-(\d{2})-/)?.[1];
      for (const target of testCase.targets.assets) {
        expect(target.path, testCase.id).not.toContain(`/poster-${queryPoster}-`);
      }
    }

    for (const testCase of suite.cases.filter(
      ({ mode, expectation }) =>
        mode === "IMAGE_TEXT_TO_EVIDENCE" && expectation === "ANSWERABLE",
    )) {
      expect(testCase.query.excludeAssetPaths, testCase.id)
        .toEqual([testCase.query.assetPath]);
      expect(testCase.targets.forbiddenAssetPaths, testCase.id)
        .toContain(testCase.query.assetPath);
      expect(
        testCase.targets.assets.some(({ path: assetPath }) =>
          assetPath === testCase.query.assetPath),
        testCase.id,
      ).toBe(false);
      expect(
        testCase.targets.nodes.some(({ required }) => required),
        testCase.id,
      ).toBe(true);
      expect(
        testCase.targets.assets.some(({ required }) => required),
        testCase.id,
      ).toBe(true);
      expect(testCase.targets.expectedParentLocators, testCase.id).toHaveLength(1);
    }
  });
});
