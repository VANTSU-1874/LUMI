import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import { rankKnowledge } from "@/lib/knowledge/retrieve";
import { pairedClusterBootstrap } from "@/lib/knowledge/retrieval-bootstrap";
import {
  RetrievalEvaluationResultSchema,
  RetrievalGoldenSuiteSchema,
  scoreRetrievalCase,
  summarizeRetrievalScores,
  type RetrievalEvaluationResult,
  type RetrievalGoldenCase,
} from "@/lib/knowledge/retrieval-quality";
import {
  VisualIndexIdentitySchema,
  VisualRetrieverCapabilitiesSchema,
  type VisualIndexIdentity,
  type VisualRetrievalResponse,
  type VisualRetriever,
  type VisualRetrieverCapabilities,
} from "@/lib/knowledge/visual-retriever";
import { startVisualSidecar } from "@/lib/knowledge/visual-retriever-client";
import {
  buildVisualEvaluationBindings,
  composeTextualVisualFallback,
  composeVisualEvaluationResult,
  visualQueryForCase,
} from "@/lib/knowledge/visual-evaluation";
import { evaluateCaptionLexicalBaseline } from "@/scripts/evaluate-retrieval-quality";

const IndexManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: VisualIndexIdentitySchema,
    adapter: z
      .object({
        name: z.enum(["siglip2", "colqwen2"]),
        capabilities: z.array(z.string().min(1)).min(1),
      })
      .passthrough(),
    entries: z.array(z.object({
      assetId: z.string().regex(/^asset-[0-9a-f]{64}$/),
      coursePackId: z.string().min(1),
    }).passthrough()).min(1),
  })
  .passthrough();

type EvaluateVisualOptions = {
  workspaceRoot: string;
  suitePath?: string;
  retriever: VisualRetriever;
  expectedIndex: VisualIndexIdentity;
  capabilities: VisualRetrieverCapabilities;
  timeoutMs?: number;
};

function normalizePath(value: string) {
  return value.replaceAll("\\", "/");
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function lexicalEvidenceFallback(
  testCase: RetrievalGoldenCase,
  bundle: KnowledgeCorpusBundleV2,
): RetrievalEvaluationResult {
  const candidates = bundle.objects
    .filter((object) =>
      testCase.query.coursePackId === null
      || object.sourceCoursePack.id === testCase.query.coursePackId)
    .map(({ legacyItem }) => legacyItem);
  const ranked = rankKnowledge(testCase.query.text ?? "", candidates);
  const hits = ranked.map((item, index) => ({
    kind: "NODE" as const,
    key: item.id,
    rank: index + 1,
    score: item.score,
  }));
  return RetrievalEvaluationResultSchema.parse({
    caseId: testCase.id,
    status: hits.length > 0 ? "SUCCESS" : "EMPTY",
    channel: "LEXICAL",
    hits,
    parentLocators: unique(ranked.flatMap((item) =>
      item.source.localDocument
        && /^data\/courses\/[^/]+\/[^/]+\.md$/.test(
          normalizePath(item.source.localDocument),
        )
        ? [normalizePath(item.source.localDocument)]
        : [])),
    latencyMs: 0,
    degradedFrom: null,
    degradationSucceeded: null,
  });
}

function failedVisualResponse(): VisualRetrievalResponse {
  return {
    status: "ERROR",
    reason: "PROVIDER_UNAVAILABLE",
    hits: [],
    index: null,
    timing: { queueMs: 0, inferenceMs: 0, totalMs: 0 },
  };
}

function visualTaskCompleted(
  testCase: RetrievalGoldenCase,
  score: ReturnType<typeof scoreRetrievalCase>,
) {
  if (score.status !== "SUCCESS" && score.status !== "EMPTY") return 0;
  if (testCase.mode === "IMAGE_TEXT_TO_EVIDENCE") {
    return score.combinedEvidencePass ? 1 : 0;
  }
  return score.primaryMetrics?.recallAt5 === 1 && !score.forbiddenHit ? 1 : 0;
}

function pairedVisualBootstrap(
  suite: z.infer<typeof RetrievalGoldenSuiteSchema>,
  baselineScores: readonly ReturnType<typeof scoreRetrievalCase>[],
  candidateScores: readonly ReturnType<typeof scoreRetrievalCase>[],
) {
  const baselineByCase = new Map(baselineScores.map((score) => [score.caseId, score]));
  const candidateByCase = new Map(candidateScores.map((score) => [score.caseId, score]));
  const answerableVisualCases = suite.cases.filter((testCase) =>
    testCase.expectation === "ANSWERABLE"
    && (
      testCase.mode === "TEXT_TO_IMAGE"
      || testCase.mode === "IMAGE_TO_IMAGE"
      || testCase.mode === "IMAGE_TEXT_TO_EVIDENCE"
    ));
  if (
    answerableVisualCases.length === 0
    || answerableVisualCases.some((testCase) =>
      testCase.tags.filter((tag) => tag.startsWith("cluster-")).length !== 1)
  ) {
    return null;
  }
  const bootstrapScores = (
    cases: readonly RetrievalGoldenCase[],
    scores: ReadonlyMap<string, ReturnType<typeof scoreRetrievalCase>>,
    metric: (testCase: RetrievalGoldenCase, score: ReturnType<typeof scoreRetrievalCase>) => number,
  ) => cases.map((testCase) => {
    const score = scores.get(testCase.id);
    if (!score) throw new Error(`VISUAL_BOOTSTRAP_SCORE_MISSING:${testCase.id}`);
    return {
      caseId: testCase.id,
      tags: testCase.tags,
      value: metric(testCase, score),
    };
  });
  const textToImageCases = answerableVisualCases.filter(
    ({ mode }) => mode === "TEXT_TO_IMAGE",
  );
  return {
    textToImageRecallAt5: pairedClusterBootstrap(
      bootstrapScores(textToImageCases, baselineByCase, (_testCase, score) =>
        score.primaryMetrics?.recallAt5 ?? 0),
      bootstrapScores(textToImageCases, candidateByCase, (_testCase, score) =>
        score.primaryMetrics?.recallAt5 ?? 0),
    ),
    visualTaskCompletion: pairedClusterBootstrap(
      bootstrapScores(answerableVisualCases, baselineByCase, visualTaskCompleted),
      bootstrapScores(answerableVisualCases, candidateByCase, visualTaskCompleted),
    ),
  };
}

export async function evaluateVisualRetriever(options: EvaluateVisualOptions) {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const suitePath = path.resolve(
    options.suitePath
      ?? path.join(workspaceRoot, "tests", "retrieval-quality", "golden-suite.json"),
  );
  const [suiteBytes, corpusBytes, baseline] = await Promise.all([
    readFile(suitePath),
    readFile(path.join(workspaceRoot, "data", "knowledge-v2", "knowledge-corpus.v2.json")),
    evaluateCaptionLexicalBaseline({ workspaceRoot, suitePath }),
  ]);
  const suite = RetrievalGoldenSuiteSchema.parse(JSON.parse(suiteBytes.toString("utf8")));
  const bundle = verifyKnowledgeCorpusBundleV2(JSON.parse(corpusBytes.toString("utf8")));
  const expectedIndex = VisualIndexIdentitySchema.parse(options.expectedIndex);
  const capabilities = VisualRetrieverCapabilitiesSchema.parse(options.capabilities);
  if (expectedIndex.corpusBundleHash !== bundle.bundleHash) {
    throw new Error("VISUAL_EVALUATION_CORPUS_INDEX_MISMATCH");
  }
  if (
    JSON.stringify(options.retriever.capabilities())
    !== JSON.stringify(capabilities)
  ) {
    throw new Error("VISUAL_EVALUATION_CAPABILITY_MISMATCH");
  }
  const bindings = buildVisualEvaluationBindings(bundle);
  const baselineByCase = new Map(
    baseline.results.map((result) => [result.caseId, result]),
  );
  const results: RetrievalEvaluationResult[] = [];
  const visualResponses: Array<{
    caseId: string;
    query: NonNullable<ReturnType<typeof visualQueryForCase>>;
    response: VisualRetrievalResponse;
  }> = [];

  for (const testCase of suite.cases) {
    const query = visualQueryForCase(testCase, bindings);
    if (!query) {
      const baselineResult = baselineByCase.get(testCase.id);
      if (!baselineResult) throw new Error(`VISUAL_EVALUATION_BASELINE_MISSING:${testCase.id}`);
      results.push(baselineResult);
      continue;
    }
    let response: VisualRetrievalResponse;
    try {
      response = await options.retriever.retrieve(query, {
        topK: 5,
        timeoutMs: options.timeoutMs ?? 30_000,
      });
    } catch {
      response = failedVisualResponse();
    }
    visualResponses.push({ caseId: testCase.id, query, response });
    if (
      testCase.query.text
      && !["SUCCESS", "EMPTY"].includes(response.status)
    ) {
      const fallback = testCase.mode === "TEXT_TO_IMAGE"
        ? baselineByCase.get(testCase.id)
        : lexicalEvidenceFallback(testCase, bundle);
      if (!fallback) throw new Error(`VISUAL_EVALUATION_FALLBACK_MISSING:${testCase.id}`);
      results.push(composeTextualVisualFallback(testCase, fallback));
      continue;
    }
    results.push(composeVisualEvaluationResult(testCase, response, bindings));
  }

  const scores = suite.cases.map((testCase, index) =>
    scoreRetrievalCase(testCase, results[index]!));
  return {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    evaluator: "SELF_HOSTED_VISUAL_POC" as const,
    suiteVersion: suite.suiteVersion,
    suiteHash: createHash("sha256").update(suiteBytes).digest("hex"),
    snapshot: baseline.snapshot,
    visualIndex: expectedIndex,
    capabilities,
    sources: {
      ...baseline.sources,
      visualCorpus: "data/knowledge-v2/knowledge-corpus.v2.json",
      visualIndexSource: "LOCAL_IMMUTABLE_BUNDLE",
      serviceDatabase: "NOT_USED",
      groundTruthSentToRetriever: false,
    },
    baselineSummary: baseline.summary,
    results,
    visualResponses,
    scores,
    summary: summarizeRetrievalScores(scores),
    pairedBootstrap: pairedVisualBootstrap(suite, baseline.scores, scores),
  };
}

function capabilitiesFromManifest(reported: readonly string[]) {
  const supports = (name: string) =>
    reported.some((capability) =>
      capability === name || capability === `${name}_EXPERIMENTAL`);
  return VisualRetrieverCapabilitiesSchema.parse({
    textToImage: supports("TEXT_TO_IMAGE"),
    imageToImage: supports("IMAGE_TO_IMAGE"),
    imageTextToImage: supports("IMAGE_TEXT_TO_IMAGE"),
    normalizedRegions: true,
  });
}

async function createQueryImageResolver(
  workspaceRoot: string,
  bundle: KnowledgeCorpusBundleV2,
) {
  const courseRoot = path.join(workspaceRoot, "data", "courses");
  const realCourseRoot = await realpath(courseRoot);
  const assetsById = new Map(bundle.assets.map((asset) => [asset.id, asset]));
  return async (assetId: string) => {
    const asset = assetsById.get(assetId);
    if (!asset) throw new Error(`VISUAL_QUERY_ASSET_NOT_IN_CORPUS:${assetId}`);
    const candidate = path.resolve(courseRoot, asset.locator.path);
    const realCandidate = await realpath(candidate);
    const relative = path.relative(realCourseRoot, realCandidate);
    if (
      relative === ".."
      || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)
    ) {
      throw new Error("VISUAL_QUERY_ASSET_PATH_ESCAPE");
    }
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size !== asset.sizeBytes) {
      throw new Error(`VISUAL_QUERY_ASSET_PHYSICAL_DRIFT:${assetId}`);
    }
    const pngBytes = await readFile(candidate);
    const sha256 = createHash("sha256").update(pngBytes).digest("hex");
    if (sha256 !== asset.sha256) {
      throw new Error(`VISUAL_QUERY_ASSET_HASH_DRIFT:${assetId}`);
    }
    return { sha256, pngBytes };
  };
}

export function parseVisualRetrievalArguments(argv: readonly string[]) {
  const values = new Map<string, string>();
  const allowed = new Set([
    "--python",
    "--adapter",
    "--model-dir",
    "--model-seal",
    "--index-dir",
    "--offload-dir",
    "--device",
    "--gpu-memory-gib",
    "--suite",
    "--output",
    "--timeout-ms",
  ]);
  let index = argv[0] === "--" ? 1 : 0;
  while (index < argv.length) {
    const key = argv[index];
    if (!key || !allowed.has(key)) throw new Error(`unknown argument: ${key}`);
    if (values.has(key)) throw new Error(`duplicate argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for argument: ${key}`);
    values.set(key, value);
    index += 2;
  }
  for (const required of [
    "--python",
    "--adapter",
    "--model-dir",
    "--model-seal",
    "--index-dir",
    "--offload-dir",
  ]) {
    if (!values.has(required)) throw new Error(`missing required argument: ${required}`);
  }
  const adapter = z.enum(["siglip2", "colqwen2"]).parse(values.get("--adapter"));
  const device = z.enum(["cuda", "cpu"]).parse(values.get("--device") ?? "cuda");
  const gpuMemoryGiB = z.coerce.number().positive().max(128)
    .parse(values.get("--gpu-memory-gib") ?? "3.5");
  const timeoutMs = z.coerce.number().int().min(1).max(30_000)
    .parse(values.get("--timeout-ms") ?? "30000");
  return {
    python: values.get("--python")!,
    adapter,
    modelDir: values.get("--model-dir")!,
    modelSeal: values.get("--model-seal")!,
    indexDir: values.get("--index-dir")!,
    offloadDir: values.get("--offload-dir")!,
    device,
    gpuMemoryGiB,
    timeoutMs,
    suitePath: values.get("--suite"),
    outputPath: values.get("--output"),
  };
}

export async function runVisualRetrievalCli(argv = process.argv.slice(2)) {
  const parsed = parseVisualRetrievalArguments(argv);
  const workspaceRoot = process.cwd();
  const indexDir = path.resolve(parsed.indexDir);
  const manifest = IndexManifestSchema.parse(JSON.parse(
    await readFile(path.join(indexDir, "manifest.json"), "utf8"),
  ));
  if (manifest.adapter.name !== parsed.adapter) {
    throw new Error("VISUAL_EVALUATION_ADAPTER_INDEX_MISMATCH");
  }
  const capabilities = capabilitiesFromManifest(manifest.adapter.capabilities);
  const corpus = verifyKnowledgeCorpusBundleV2(JSON.parse(
    await readFile(
      path.join(workspaceRoot, "data", "knowledge-v2", "knowledge-corpus.v2.json"),
      "utf8",
    ),
  ));
  const bindings = buildVisualEvaluationBindings(corpus);
  const manifestAssetCoursePacks = new Map(
    manifest.entries.map(({ assetId, coursePackId }) => [assetId, coursePackId]),
  );
  if (
    manifestAssetCoursePacks.size !== bindings.byAssetId.size
    || [...bindings.byAssetId.values()].some((binding) =>
      manifestAssetCoursePacks.get(binding.assetId) !== binding.coursePackId)
  ) {
    throw new Error("VISUAL_EVALUATION_INDEX_ASSET_SCOPE_MISMATCH");
  }
  const resolveQueryImage = await createQueryImageResolver(workspaceRoot, corpus);
  await mkdir(path.resolve(parsed.offloadDir), { recursive: true });
  const handle = await startVisualSidecar({
    executable: path.resolve(parsed.python),
    args: [
      "-u",
      path.join(workspaceRoot, "tools", "visual-retrieval", "poc.py"),
      "serve",
      "--adapter",
      parsed.adapter,
      "--model-dir",
      path.resolve(parsed.modelDir),
      "--model-seal",
      path.resolve(parsed.modelSeal),
      "--index-dir",
      indexDir,
      "--offload-dir",
      path.resolve(parsed.offloadDir),
      "--device",
      parsed.device,
      "--gpu-memory-gib",
      String(parsed.gpuMemoryGiB),
    ],
    cwd: workspaceRoot,
    env: {
      PYTHONHASHSEED: "0",
      CUBLAS_WORKSPACE_CONFIG: ":4096:8",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    },
    expectedIndex: manifest.identity,
    capabilities,
    allowedAssetCoursePacks: manifestAssetCoursePacks,
    resolveQueryImage,
  });
  try {
    const report = await evaluateVisualRetriever({
      workspaceRoot,
      ...(parsed.suitePath ? { suitePath: path.resolve(parsed.suitePath) } : {}),
      retriever: handle.retriever,
      expectedIndex: manifest.identity,
      capabilities,
      timeoutMs: parsed.timeoutMs,
    });
    const outputPath = path.resolve(
      parsed.outputPath
        ?? path.join(
          workspaceRoot,
          ".runtime",
          "retrieval-quality",
          `t3-${parsed.adapter}-visual.json`,
        ),
    );
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stderr.write(`${JSON.stringify({
      event: "effective-visual-retrieval-source",
      serviceDatabase: "NOT_USED",
      corpusBundleHash: report.visualIndex.corpusBundleHash,
      indexBundleHash: report.visualIndex.indexBundleHash,
      modelId: report.visualIndex.modelId,
      modelRevision: report.visualIndex.modelRevision,
      groundTruthSentToRetriever: false,
    })}\n`);
    return {
      reportPath: normalizePath(path.relative(workspaceRoot, outputPath)),
      suiteHash: report.suiteHash,
      visualIndex: report.visualIndex,
      summary: report.summary,
    };
  } finally {
    await handle.dispose();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  runVisualRetrievalCli()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
