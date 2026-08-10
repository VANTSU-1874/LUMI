// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RetrievalGoldenSuiteSchema } from "@/lib/knowledge/retrieval-quality";
import {
  verifyKnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import { createRetrievalQueryV2 } from "@/lib/knowledge/retrieval-query-v2";
import {
  canonicalTextEntriesSha256,
  createFrozenCaptionLexicalFallbackProviderV2,
  evaluateCaptionLexicalBaseline,
  parseRetrievalQualityArguments,
} from "@/scripts/evaluate-retrieval-quality";

describe("caption lexical retrieval baseline", () => {
  it("evaluates text modes and reports image-input modes as unsupported", async () => {
    const report = await evaluateCaptionLexicalBaseline({
      workspaceRoot: process.cwd(),
      suitePath: path.join(
        process.cwd(),
        "tests/retrieval-quality/generations/d1d399c1/golden-suite.json",
      ),
    });

    expect(report.suiteHash)
      .toBe("c0feb7da751352aa0dab17164a2bdca6d37fba00b9ed42d533fed0b8f819c637");
    expect(report.results).toHaveLength(51);
    expect(report.summary.overall).toMatchObject({
      attempted: 51,
      evaluated: 37,
      unsupported: 14,
      errors: 0,
      timeouts: 0,
      errorCount: 0,
    });
    expect(report.captionIndex).toMatchObject({
      assetCount: 156,
      mappingCounts: {
        ROLE_ALIAS: 150,
        DOCUMENT_FALLBACK: 6,
      },
    });
    expect(report.sources).toMatchObject({
      queryScopeInput: "query.coursePackId",
      expectedCourseFieldsUsedForRetrieval: false,
      database: "NOT_USED",
    });
    expect(report.snapshot).toMatchObject({
      runtimeKnowledgeCount: 116,
      sourceDocumentCount: 82,
      assetCount: 156,
    });
    expect(report.results.filter(({ status }) => status === "UNSUPPORTED").map(({ caseId }) => caseId))
      .toEqual([
        "visual-image-poster-07-to-48",
        "visual-image-poster-14-to-17",
        "visual-image-poster-27-to-36",
        "visual-image-poster-33-to-35",
        "visual-image-poster-43-to-39",
        "visual-image-poster-46-to-40",
        "visual-evidence-poster-16",
        "visual-evidence-poster-20",
        "visual-evidence-poster-23",
        "visual-evidence-poster-29",
        "visual-evidence-poster-37",
        "visual-evidence-poster-45",
        "negative-image-brand-poster-22",
        "negative-evidence-digital-poster-34",
      ]);
    expect(report.results.filter(({ channel, status }) =>
      channel === "CAPTION_LEXICAL" && status !== "UNSUPPORTED"))
      .toHaveLength(24);
    expect(report.summary.byMode.TEXT_TO_IMAGE).toMatchObject({
      attempted: 24,
      evaluated: 24,
      recallAt5: 0.291667,
      mrr: 0.324306,
      ndcgAt5: 0.228842,
    });

    const suite = RetrievalGoldenSuiteSchema.parse(JSON.parse(
      await readFile(
        path.join(
          process.cwd(),
          "tests/retrieval-quality/generations/d1d399c1/golden-suite.json",
        ),
        "utf8",
      ),
    ));
    const casesById = new Map(suite.cases.map((testCase) => [testCase.id, testCase]));
    const textImageResults = report.results.filter(({ caseId }) =>
      casesById.get(caseId)?.mode === "TEXT_TO_IMAGE");
    const posterGroupHitsAt5 = textImageResults.filter((result) => {
      const testCase = casesById.get(result.caseId)!;
      const relevantAssets = new Set(testCase.targets.assets.map(({ path: assetPath }) => assetPath));
      return result.hits.some(
        (hit) => hit.kind === "ASSET" && hit.rank <= 5 && relevantAssets.has(hit.key),
      );
    });
    expect(textImageResults).toHaveLength(24);
    expect(posterGroupHitsAt5).toHaveLength(11);

    const corpus = verifyKnowledgeCorpusBundleV2(JSON.parse(await readFile(
      path.join(process.cwd(), "data", "knowledge-v2", "knowledge-corpus.v2.json"),
      "utf8",
    )));
    const objectByAssetId = new Map(corpus.objects.flatMap((object) =>
      object.assetIds.map((assetId) => [assetId, object] as const)));
    const assetBindingsByPath = new Map(corpus.assets.map((asset) => {
      const object = objectByAssetId.get(asset.id)!;
      const imageNode = object.nodes.find((node) =>
        node.kind === "IMAGE" && node.assetId === asset.id)!;
      return [
        asset.locator.path,
        {
          assetId: asset.id,
          objectId: object.id,
          imageNodeId: imageNode.id,
        },
      ] as const;
    }));
    const provider = await createFrozenCaptionLexicalFallbackProviderV2({
      workspaceRoot: process.cwd(),
      corpusBundleHash: corpus.bundleHash,
      assetManifestPath: suite.corpusSnapshot.assetManifest,
      assetBindingsByPath,
      identity: {
        corpusBundleHash: corpus.bundleHash,
        activeIndexBundleHash: "a".repeat(64),
        indexVersionId: "caption-lexical-v1",
        configHash: "b".repeat(64),
        payloadHashes: ["c".repeat(64)],
      },
    });
    const frozenCase = suite.cases.find(({ mode }) => mode === "TEXT_TO_IMAGE")!;
    const providerResult = await provider.retrieve(createRetrievalQueryV2({
      mode: "TEXT_TO_IMAGE",
      text: frozenCase.query.text!,
      scope: {
        corpusBundleHash: corpus.bundleHash,
        sourceCoursePack: {
          id: frozenCase.query.coursePackId!,
          version: frozenCase.coursePackVersion,
        },
      },
    }), {});
    const assetPathById = new Map(corpus.assets.map((asset) => [
      asset.id,
      asset.locator.path,
    ]));
    expect((providerResult as {
      hits: Array<{ assetId: string }>;
    }).hits.map(({ assetId }) => assetPathById.get(assetId))).toEqual(
      report.results.find(({ caseId }) => caseId === frozenCase.id)!
        .hits.map(({ key }) => key),
    );
  }, 15_000);

  it("canonicalizes text line endings when binding the corpus snapshot", () => {
    expect(canonicalTextEntriesSha256([
      { path: "data/knowledge/example.md", text: "alpha\r\nbeta\r\n" },
    ])).toBe(canonicalTextEntriesSha256([
      { path: "data/knowledge/example.md", text: "alpha\nbeta\n" },
    ]));
  });

  it("parses CLI arguments strictly while accepting one leading pnpm separator", () => {
    expect(parseRetrievalQualityArguments([
      "--",
      "--suite",
      "suite.json",
      "--output",
      "report.json",
    ])).toEqual({
      suitePath: "suite.json",
      outputPath: "report.json",
    });
    expect(() => parseRetrievalQualityArguments(["--suite"])).toThrow(
      "missing value for argument: --suite",
    );
    expect(() => parseRetrievalQualityArguments(["--output", "a", "--output", "b"])).toThrow(
      "duplicate argument: --output",
    );
    expect(() => parseRetrievalQualityArguments(["--", "--", "--output", "a"])).toThrow(
      "unknown argument: --",
    );
    expect(() => parseRetrievalQualityArguments(["--output=a"])).toThrow(
      "unknown argument: --output=a",
    );
  });

  it("rejects a custom suite whose targets are not bound to the frozen corpus", async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "lumi-retrieval-suite-"));
    const suitePath = path.join(temporaryDirectory, "invalid-suite.json");
    try {
      const suite = JSON.parse(
        await readFile(
          path.join(
            process.cwd(),
            "tests/retrieval-quality/generations/d1d399c1/golden-suite.json",
          ),
          "utf8",
        ),
      );
      suite.cases[0].targets.nodes[0].id = "missing-knowledge-node";
      await writeFile(suitePath, `${JSON.stringify(suite, null, 2)}\n`, "utf8");

      await expect(evaluateCaptionLexicalBaseline({
        workspaceRoot: process.cwd(),
        suitePath,
      })).rejects.toThrow(
        "RETRIEVAL_SUITE_BINDING_ERROR:text-contrast-low-overlap:NODE_MISSING:missing-knowledge-node",
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
