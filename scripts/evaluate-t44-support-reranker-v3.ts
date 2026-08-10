import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  createLocalMixedRuntimeV2,
  type LocalMixedRuntimeV2Options,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  createRetrievalQueryV2,
} from "@/lib/knowledge/retrieval-query-v2";
import {
  evaluateT44SupportReranker,
  T44_SUPPORT_RERANKER_CONFIG_V1,
  T44SupportRerankerSidecarOutputSchema,
} from "@/tools/mixed-retrieval/t44-support-reranker-evaluator";
import {
  loadT44SupportDevArtifacts,
  T44SupportRuntimeSuiteSchema,
  t44SupportRuntimeSuiteHash,
  T44_SUPPORT_RUNTIME_SUITE_SHA256,
  type T44SupportRuntimeSuite,
} from "@/tools/mixed-retrieval/t44-support-loader";

const execFileAsync = promisify(execFile);
const RUNTIME_SUITE_PATH =
  "tests/retrieval-quality/t44-support-dev.runtime.json";
const QRELS_PATH =
  "tests/retrieval-quality/t44-support-dev.qrels.json";
const CORPUS_PATH =
  "data/knowledge-v2/knowledge-corpus.v2.json";
const TEXT_MANIFEST_NAME = "index-manifest.json";

const DEFAULT_PATHS = Object.freeze({
  pythonExecutable:
    ".runtime/visual-retrieval/python312/python.exe",
  rerankerTool: "tools/reranker/t44_reranker.py",
  rerankerModelDir:
    ".runtime/reranker/hf/models--BAAI--bge-reranker-base/" +
    "snapshots/2cfc18c9415c912f9d8155881c133215df768a70",
  rerankerModelSeal:
    ".runtime/reranker/seals/bge-reranker-base.json",
  textModelDir:
    ".runtime/text-retrieval/hf/models--BAAI--bge-small-zh-v1.5/" +
    "snapshots/7999e1d3359715c523056ef9478215996d62a620",
  textModelSeal:
    ".runtime/text-retrieval/seals/bge-small-zh-v1.5.json",
  textIndexDir:
    ".runtime/text-retrieval/indexes/" +
    "b3119e9a942497f731d6c8ee063c00fe2793e859cf47d7cbaa6101a2771b1122",
  visualModelDir:
    ".runtime/visual-retrieval/hf/models--google--" +
    "siglip2-base-patch16-224/snapshots/" +
    "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
  visualModelSeal:
    ".runtime/visual-retrieval/seals/siglip2.json",
  visualIndexDir:
    ".runtime/visual-retrieval/indexes/siglip2/" +
    "1f2a354c755b498240108583d10ad5f0f5d2a3ad9c9f2cee2c3110d07f05125a",
  visualOffloadDir:
    ".runtime/visual-retrieval/offload",
  controlDir:
    ".runtime/knowledge-index/control/" +
    "cad61822cf3e4d95e984b08c66fa6427c5adf182fc305329291f8eb9aad1be5d",
} as const);

const VALUE_ARGUMENTS = new Set([
  "--output",
  "--split",
  "--python",
  "--reranker-tool",
  "--reranker-model-dir",
  "--reranker-model-seal",
  "--text-model-dir",
  "--text-model-seal",
  "--text-index-dir",
  "--visual-model-dir",
  "--visual-model-seal",
  "--visual-index-dir",
  "--visual-offload-dir",
  "--control-dir",
  "--device",
  "--gpu-memory-gib",
  "--timeout-ms",
]);

function required(
  values: ReadonlyMap<string, string>,
  key: string,
) {
  const value = values.get(key);
  if (!value) {
    throw new Error(
      `T44_RERANKER_CLI_REQUIRED_ARGUMENT_MISSING:${key}`,
    );
  }
  return value;
}

function rejectHeldoutPath(value: string) {
  if (value.toLocaleLowerCase("en-US").includes("heldout")) {
    throw new Error(
      "T44_RERANKER_CLI_HELDOUT_PATH_NOT_AUTHORIZED",
    );
  }
  return value;
}

export function parseT44SupportRerankerArguments(
  argv: readonly string[],
) {
  const values = new Map<string, string>();
  let index = argv[0] === "--" ? 1 : 0;
  while (index < argv.length) {
    const argument = argv[index]!;
    if (!VALUE_ARGUMENTS.has(argument)) {
      throw new Error(
        `T44_RERANKER_CLI_UNKNOWN_ARGUMENT:${argument}`,
      );
    }
    if (values.has(argument)) {
      throw new Error(
        `T44_RERANKER_CLI_DUPLICATE_ARGUMENT:${argument}`,
      );
    }
    const value = argv[index + 1];
    if (!value || value === "--" || value.startsWith("--")) {
      throw new Error(
        `T44_RERANKER_CLI_ARGUMENT_VALUE_MISSING:${argument}`,
      );
    }
    values.set(argument, rejectHeldoutPath(value));
    index += 2;
  }
  const split = values.get("--split") ?? "DEV";
  if (split !== "DEV") {
    throw new Error(
      "T44_RERANKER_CLI_ONLY_VISIBLE_DEV_IS_AUTHORIZED",
    );
  }
  const number = (key: string, fallback: number) =>
    z.coerce.number().finite().parse(
      values.get(key) ?? fallback,
    );
  const integer = (key: string, fallback: number) =>
    z.coerce.number().int().parse(
      values.get(key) ?? fallback,
    );
  return {
    output: required(values, "--output"),
    split: "DEV" as const,
    pythonExecutable:
      values.get("--python")
      ?? DEFAULT_PATHS.pythonExecutable,
    rerankerTool:
      values.get("--reranker-tool")
      ?? DEFAULT_PATHS.rerankerTool,
    rerankerModelDir:
      values.get("--reranker-model-dir")
      ?? DEFAULT_PATHS.rerankerModelDir,
    rerankerModelSeal:
      values.get("--reranker-model-seal")
      ?? DEFAULT_PATHS.rerankerModelSeal,
    textModelDir:
      values.get("--text-model-dir")
      ?? DEFAULT_PATHS.textModelDir,
    textModelSeal:
      values.get("--text-model-seal")
      ?? DEFAULT_PATHS.textModelSeal,
    textIndexDir:
      values.get("--text-index-dir")
      ?? DEFAULT_PATHS.textIndexDir,
    visualModelDir:
      values.get("--visual-model-dir")
      ?? DEFAULT_PATHS.visualModelDir,
    visualModelSeal:
      values.get("--visual-model-seal")
      ?? DEFAULT_PATHS.visualModelSeal,
    visualIndexDir:
      values.get("--visual-index-dir")
      ?? DEFAULT_PATHS.visualIndexDir,
    visualOffloadDir:
      values.get("--visual-offload-dir")
      ?? DEFAULT_PATHS.visualOffloadDir,
    controlDir:
      values.get("--control-dir")
      ?? DEFAULT_PATHS.controlDir,
    device: z.enum(["cuda", "cpu"]).parse(
      values.get("--device") ?? "cuda",
    ),
    gpuMemoryGiB: z.number().positive().max(64).parse(
      number("--gpu-memory-gib", 3.5),
    ),
    timeoutMs: z.number().int().min(1).max(30_000).parse(
      integer("--timeout-ms", 10_000),
    ),
  };
}

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const TextManifestSchema = z
  .object({
    identity: z
      .object({
        corpusBundleHash: HashSchema,
        indexBundleHash: HashSchema,
      })
      .passthrough(),
    entries: z.array(z
      .object({
        nodeId: z.string(),
        objectId: z.string(),
        coursePackId: z.string(),
        sourceKind: z.string(),
        nodeKind: z.string(),
        role: z.string().nullable(),
        contentHash: HashSchema,
        tensorOffset: z.number().int().nonnegative(),
      })
      .passthrough()).min(1),
  })
  .passthrough();

type TextManifest = z.infer<typeof TextManifestSchema>;

function sha256Bytes(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function serialize(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function canonicalPath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLowerCase()
    : resolved;
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function assertOutputPath(
  workspaceRoot: string,
  value: string,
) {
  const runtimeRoot = path.resolve(workspaceRoot, ".runtime");
  const allowedRoot = path.join(runtimeRoot, "mixed-retrieval");
  const output = path.resolve(workspaceRoot, value);
  if (
    !isWithin(allowedRoot, output)
    || path.extname(output).toLowerCase() !== ".json"
  ) {
    throw new Error(
      "T44_RERANKER_CLI_OUTPUT_MUST_BE_RUNTIME_JSON",
    );
  }
  const runtimeStats = await lstat(runtimeRoot);
  if (
    runtimeStats.isSymbolicLink()
    || !runtimeStats.isDirectory()
    || canonicalPath(await realpath(runtimeRoot))
      !== canonicalPath(runtimeRoot)
  ) {
    throw new Error(
      "T44_RERANKER_CLI_RUNTIME_ROOT_INVALID",
    );
  }
  try {
    await lstat(output);
    throw new Error(
      "T44_RERANKER_CLI_OUTPUT_ALREADY_EXISTS",
    );
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return output;
    }
    throw error;
  }
}

function representationText(
  object: KnowledgeCorpusBundleV2["objects"][number],
  node: KnowledgeCorpusBundleV2["objects"][number]["nodes"][number],
) {
  const nodeById = new Map(
    object.nodes.map((candidate) => [
      candidate.id,
      candidate,
    ]),
  );
  const hierarchy: string[] = [];
  const visited = new Set<string>();
  let parentId = node.parentId;
  while (parentId !== null) {
    if (visited.has(parentId)) {
      throw new Error("T44_RERANKER_CORPUS_GRAPH_CYCLE");
    }
    visited.add(parentId);
    const parent = nodeById.get(parentId);
    if (!parent) {
      throw new Error(
        "T44_RERANKER_CORPUS_PARENT_MISSING",
      );
    }
    if (
      parent.kind === "DOCUMENT"
      || parent.kind === "SECTION"
    ) {
      hierarchy.push(parent.title);
    }
    parentId = parent.parentId;
  }
  hierarchy.reverse();
  const body = node.kind === "TABLE"
    ? node.plainText
    : node.kind === "TEXT"
      ? node.text
      : null;
  if (body === null) {
    throw new Error("T44_RERANKER_NODE_BODY_INVALID");
  }
  return [...new Set([
    object.title.trim(),
    ...hierarchy.map((value) => value.trim()),
    body.trim(),
  ].filter(Boolean))].join("\n");
}

function isAtomicNode(
  node: KnowledgeCorpusBundleV2["objects"][number]["nodes"][number],
) {
  return (
    node.kind === "TABLE"
    || (
      node.kind === "TEXT"
      && (node.role === "FACT" || node.role === "ACTION")
    )
  );
}

export async function buildT44RerankerRuntimeInput(input: {
  runtimeSuite: T44SupportRuntimeSuite;
  corpus: KnowledgeCorpusBundleV2;
  textManifest: TextManifest;
  retrieve: (
    query: ReturnType<typeof createRetrievalQueryV2>,
  ) => Promise<{
    channels: Array<{
      channel: string;
      status: string;
    }>;
    evidence: {
      objectConsensus?: {
        objectRanking: Array<{
          objectId: string;
          rank: number;
        }>;
      };
    };
  }>;
}) {
  const runtimeSuite = T44SupportRuntimeSuiteSchema.parse(
    input.runtimeSuite,
  );
  const corpus = verifyKnowledgeCorpusBundleV2(input.corpus);
  const manifest = TextManifestSchema.parse(input.textManifest);
  if (
    manifest.identity.corpusBundleHash !== corpus.bundleHash
    || runtimeSuite.corpusSnapshot.bundleHash
      !== corpus.bundleHash
  ) {
    throw new Error("T44_RERANKER_CORPUS_BINDING_DRIFT");
  }
  const objectById = new Map(
    corpus.objects.map((object) => [object.id, object]),
  );
  const entriesByNodeId = new Map(
    manifest.entries.map((entry) => [
      entry.nodeId,
      entry,
    ]),
  );
  const cases = [];
  for (const testCase of runtimeSuite.cases) {
    const query = createRetrievalQueryV2({
      mode: testCase.mode,
      text: testCase.question,
      scope: {
        corpusBundleHash: corpus.bundleHash,
        sourceCoursePack: {
          id: testCase.coursePackId,
          version: testCase.coursePackVersion,
        },
      },
    });
    const bundle = await input.retrieve(query);
    const lexicalStatus = bundle.channels.find(
      ({ channel }) => channel === "LEXICAL",
    )?.status;
    const textStatus = bundle.channels.find(
      ({ channel }) => channel === "TEXT_VECTOR",
    )?.status;
    const healthyStatuses = new Set(["SUCCESS", "EMPTY"]);
    const consensus = bundle.evidence.objectConsensus;
    if (
      consensus === undefined
      && (
        lexicalStatus === undefined
        || textStatus === undefined
        || !healthyStatuses.has(lexicalStatus)
        || !healthyStatuses.has(textStatus)
        || (
          lexicalStatus === "SUCCESS"
          && textStatus === "SUCCESS"
        )
      )
    ) {
      throw new Error(
        "T44_RERANKER_OBJECT_CONSENSUS_UNAVAILABLE:"
        + `${testCase.caseId}:${lexicalStatus ?? "MISSING"}:`
        + `${textStatus ?? "MISSING"}`,
      );
    }
    const ranking = (
      consensus?.objectRanking ?? []
    )
      .filter(({ rank }) => rank <= 10)
      .sort((left, right) => left.rank - right.rank);
    if (
      ranking.some(
        ({ rank }, index) => rank !== index + 1,
      )
    ) {
      throw new Error(
        `T44_RERANKER_OBJECT_RANKING_INVALID:${testCase.caseId}`,
      );
    }
    const candidates = ranking
      .slice(0, T44_SUPPORT_RERANKER_CONFIG_V1.topM)
      .flatMap(({ objectId }) => {
        const object = objectById.get(objectId);
        if (
          !object
          || object.sourceCoursePack.id
            !== testCase.coursePackId
          || object.sourceCoursePack.version
            !== testCase.coursePackVersion
        ) {
          throw new Error(
            `T44_RERANKER_OBJECT_SCOPE_INVALID:${testCase.caseId}:${objectId}`,
          );
        }
        return object.nodes
          .filter(isAtomicNode)
          .sort((left, right) =>
            left.id.localeCompare(right.id))
          .map((node) => {
            const entry = entriesByNodeId.get(node.id);
            if (
              !entry
              || entry.objectId !== object.id
              || entry.coursePackId !== testCase.coursePackId
              || entry.contentHash !== node.contentHash
              || entry.sourceKind !== "NODE"
              || (
                node.kind === "TEXT"
                && (
                  entry.nodeKind !== "TEXT"
                  || entry.role !== node.role
                )
              )
            ) {
              throw new Error(
                `T44_RERANKER_ATOMIC_NODE_INDEX_DRIFT:${testCase.caseId}:${node.id}`,
              );
            }
            return {
              nodeId: node.id,
              objectId: object.id,
              coursePackId: testCase.coursePackId,
              contentHash: node.contentHash,
              text: representationText(object, node),
              tensorOffset: entry.tensorOffset,
            };
          });
      });
    if (
      candidates.length > 55
      || new Set(candidates.map(({ nodeId }) => nodeId))
        .size !== candidates.length
    ) {
      throw new Error(
        `T44_RERANKER_CANDIDATE_SET_INVALID:${testCase.caseId}`,
      );
    }
    cases.push({
      caseId: testCase.caseId,
      question: testCase.question,
      coursePackId: testCase.coursePackId,
      coursePackVersion: testCase.coursePackVersion,
      objectRanking: ranking.map(({ objectId, rank }) => ({
        objectId,
        rank,
      })),
      candidates,
    });
  }
  return {
    schemaVersion: 1 as const,
    kind: "T44_RERANKER_SHADOW_INPUT" as const,
    config: T44_SUPPORT_RERANKER_CONFIG_V1,
    runtimeSuite: {
      id: runtimeSuite.id,
      version: runtimeSuite.version,
      suiteHash: runtimeSuite.suiteHash,
    },
    corpusBundleHash: corpus.bundleHash,
    cases,
  };
}

function runtimeOptions(
  workspaceRoot: string,
  parsed: ReturnType<
    typeof parseT44SupportRerankerArguments
  >,
): LocalMixedRuntimeV2Options {
  const resolve = (value: string) =>
    path.resolve(workspaceRoot, value);
  return {
    workspaceRoot,
    pythonExecutable: resolve(parsed.pythonExecutable),
    textModelDir: resolve(parsed.textModelDir),
    textModelSeal: resolve(parsed.textModelSeal),
    textIndexDir: resolve(parsed.textIndexDir),
    visualModelDir: resolve(parsed.visualModelDir),
    visualModelSeal: resolve(parsed.visualModelSeal),
    visualIndexDir: resolve(parsed.visualIndexDir),
    visualOffloadDir: resolve(parsed.visualOffloadDir),
    controlDir: resolve(parsed.controlDir),
    assetManifestPath: resolve(
      "data/manifests/course-png-sha256.v1.json",
    ),
    device: parsed.device,
    gpuMemoryGiB: parsed.gpuMemoryGiB,
    timeoutMs: parsed.timeoutMs,
    visualMaxCacheEntries: 8,
    textObjectConsensusEnabled: true,
    queryEvidenceAdequacyEnabled: false,
    queryPrerequisiteStaticBypassEnabled: true,
  };
}

function auditProviderInvocations(
  entries: ReturnType<
    Awaited<ReturnType<typeof createLocalMixedRuntimeV2>>[
      "providerSpy"
    ]
  >["entries"],
) {
  const channelCounts = {
    LEXICAL: 0,
    TEXT_VECTOR: 0,
    VISUAL_VECTOR: 0,
    CAPTION_LEXICAL: 0,
  };
  const keys = new Set<string>();
  let duplicateQueryChannelCalls = 0;
  for (const entry of entries) {
    channelCounts[entry.channel] += 1;
    const key = `${entry.queryFingerprint}:${entry.channel}`;
    if (keys.has(key)) duplicateQueryChannelCalls += 1;
    keys.add(key);
  }
  return {
    observedCalls: entries.length,
    channelCounts,
    duplicateQueryChannelCalls,
    passed:
      entries.length === 100
      && channelCounts.LEXICAL === 50
      && channelCounts.TEXT_VECTOR === 50
      && channelCounts.VISUAL_VECTOR === 0
      && channelCounts.CAPTION_LEXICAL === 0
      && duplicateQueryChannelCalls === 0,
  };
}

function isolatedPythonEnvironment() {
  const allowedExact = new Set([
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
  ]);
  const result: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined
      && (
        allowedExact.has(key.toUpperCase())
        || key.toUpperCase().startsWith("CUDA_PATH")
      )
    ) {
      result[key] = value;
    }
  }
  return {
    ...result,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    TOKENIZERS_PARALLELISM: "false",
  };
}

async function writeNewFileAtomically(
  target: string,
  content: string,
) {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await lstat(target);
    throw new Error(
      `T44_RERANKER_ARTIFACT_ALREADY_EXISTS:${target}`,
    );
  } catch (error) {
    if (
      !(
        error instanceof Error
        && "code" in error
        && error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
  const draft = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.tmp`,
  );
  await writeFile(draft, content, {
    encoding: "utf8",
    flag: "wx",
  });
  await import("node:fs/promises").then(({ rename }) =>
    rename(draft, target));
}

export async function runT44SupportRerankerCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
) {
  const parsed = parseT44SupportRerankerArguments(argv);
  const outputPath = await assertOutputPath(
    workspaceRoot,
    parsed.output,
  );
  const [runtimeBytes, corpusBytes, manifestBytes] =
    await Promise.all([
      readFile(path.resolve(
        workspaceRoot,
        RUNTIME_SUITE_PATH,
      )),
      readFile(path.resolve(workspaceRoot, CORPUS_PATH)),
      readFile(path.join(
        path.resolve(workspaceRoot, parsed.textIndexDir),
        TEXT_MANIFEST_NAME,
      )),
    ]);
  const runtimeSuite = T44SupportRuntimeSuiteSchema.parse(
    JSON.parse(runtimeBytes.toString("utf8")) as unknown,
  );
  if (
    runtimeSuite.suiteHash
      !== t44SupportRuntimeSuiteHash(runtimeSuite)
    || runtimeSuite.suiteHash
      !== T44_SUPPORT_RUNTIME_SUITE_SHA256
  ) {
    throw new Error(
      "T44_RERANKER_RUNTIME_SUITE_HASH_DRIFT",
    );
  }
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(corpusBytes.toString("utf8")) as unknown,
  );
  const textManifest = TextManifestSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")) as unknown,
  );
  let runtime:
    Awaited<ReturnType<typeof createLocalMixedRuntimeV2>>
    | null = null;
  let runtimeInput;
  let providerInvocationAudit;
  let prerequisiteShadowAudit;
  let retrievalIdentitySha256;
  try {
    runtime = await createLocalMixedRuntimeV2(runtimeOptions(
      workspaceRoot,
      parsed,
    ));
    runtimeInput = await buildT44RerankerRuntimeInput({
      runtimeSuite,
      corpus,
      textManifest,
      retrieve: (query) => runtime!.retrieve(query),
    });
    providerInvocationAudit = auditProviderInvocations(
      runtime.providerSpy().entries,
    );
    const rawPrerequisiteAudit =
      runtime.prerequisiteShadowAudit();
    const nonStaticDecisions =
      rawPrerequisiteAudit.entries
        .filter(({ decision }) =>
          decision !== "STATIC_CORPUS_ELIGIBLE")
        .map(({ queryHash, decision }) => ({
          queryHash,
          decision,
        }));
    prerequisiteShadowAudit = {
      enabled: rawPrerequisiteAudit.enabled,
      entryCount: rawPrerequisiteAudit.entryCount,
      staticEligibleCount:
        rawPrerequisiteAudit.entries.filter(
          ({ decision }) =>
            decision === "STATIC_CORPUS_ELIGIBLE",
        ).length,
      staticBypassCount:
        rawPrerequisiteAudit.entries.filter(
          ({ staticBypassApplied }) =>
            staticBypassApplied,
        ).length,
      nonStaticDecisions,
      passed:
        rawPrerequisiteAudit.enabled
        && rawPrerequisiteAudit.entryCount === 50
        && nonStaticDecisions.length === 0,
    };
    retrievalIdentitySha256 = sha256StableJsonV2({
      expectedIdentity: runtime.expectedIdentity,
      candidateIdentity: runtime.t41CandidateIdentity,
      runtimeEnvironment: runtime.runtimeEnvironment,
      runtimeEvidence: runtime.runtimeEvidence(),
      prerequisiteShadowAudit:
        rawPrerequisiteAudit,
    });
  } finally {
    await runtime?.dispose();
  }
  if (
    !runtimeInput
    || !providerInvocationAudit
    || !prerequisiteShadowAudit
    || !retrievalIdentitySha256
  ) {
    throw new Error("T44_RERANKER_RUNTIME_COLLECTION_FAILED");
  }

  const stem = path.basename(
    outputPath,
    path.extname(outputPath),
  );
  const runRoot = path.resolve(
    workspaceRoot,
    ".runtime",
    "reranker",
    "runs",
  );
  const runtimeInputPath = path.join(
    runRoot,
    `${stem}.runtime-input.json`,
  );
  const sidecarOutputPath = path.join(
    runRoot,
    `${stem}.sidecar-output.json`,
  );
  const sidecarStderrPath = path.join(
    runRoot,
    `${stem}.sidecar-stderr.log`,
  );
  const runtimeInputText = serialize(runtimeInput);
  await writeNewFileAtomically(
    runtimeInputPath,
    runtimeInputText,
  );
  const pythonArgs = [
    path.resolve(workspaceRoot, parsed.rerankerTool),
    "evaluate",
    "--input",
    runtimeInputPath,
    "--corpus",
    path.resolve(workspaceRoot, CORPUS_PATH),
    "--model-dir",
    path.resolve(workspaceRoot, parsed.rerankerModelDir),
    "--model-seal",
    path.resolve(workspaceRoot, parsed.rerankerModelSeal),
    "--text-model-dir",
    path.resolve(workspaceRoot, parsed.textModelDir),
    "--text-model-seal",
    path.resolve(workspaceRoot, parsed.textModelSeal),
    "--text-index-dir",
    path.resolve(workspaceRoot, parsed.textIndexDir),
    "--device",
    parsed.device,
  ];
  const { stdout, stderr } = await execFileAsync(
    path.resolve(workspaceRoot, parsed.pythonExecutable),
    pythonArgs,
    {
      cwd: workspaceRoot,
      env: isolatedPythonEnvironment(),
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 20 * 60 * 1000,
    },
  );
  const sidecarOutput =
    T44SupportRerankerSidecarOutputSchema.parse(
      JSON.parse(stdout) as unknown,
    );
  const sidecarOutputText = serialize(sidecarOutput);
  await Promise.all([
    writeNewFileAtomically(
      sidecarOutputPath,
      sidecarOutputText,
    ),
    writeNewFileAtomically(sidecarStderrPath, stderr),
  ]);

  // Scoring labels are intentionally read only after retrieval and both
  // model arms have finished and emitted their label-blind rankings.
  const qrelsBytes = await readFile(path.resolve(
    workspaceRoot,
    QRELS_PATH,
  ));
  const loaded = loadT44SupportDevArtifacts(
    runtimeSuite,
    JSON.parse(qrelsBytes.toString("utf8")) as unknown,
    corpus,
  );
  const report = evaluateT44SupportReranker({
    runtime: loaded.runtime,
    qrels: loaded.qrels,
    corpus,
    sidecarOutput,
    runtimeInputSha256: sha256Bytes(runtimeInputText),
    sidecarOutputSha256: sha256Bytes(sidecarOutputText),
    sidecarStderrSha256: sha256Bytes(stderr),
    sidecarStderrBytes: Buffer.byteLength(stderr),
    retrievalIdentitySha256,
    providerInvocationAudit,
    prerequisiteShadowAudit,
    generatedAt: new Date().toISOString(),
  });
  await writeNewFileAtomically(outputPath, serialize(report));
  return {
    outputPath,
    runtimeInputPath,
    sidecarOutputPath,
    sidecarStderrPath,
    report,
  };
}

async function main() {
  const result = await runT44SupportRerankerCli(
    process.argv.slice(2),
  );
  process.stdout.write(`${JSON.stringify({
    outputPath: result.outputPath,
    runtimeInputPath: result.runtimeInputPath,
    sidecarOutputPath: result.sidecarOutputPath,
    sidecarStderrPath: result.sidecarStderrPath,
    reportHash: result.report.reportHash,
    decision: result.report.decision,
    objectRecall:
      result.report.objectRecall.casesWithAllRequiredOwnersAt10,
    baseline:
      result.report.arms.A_BGE_NODE_SCORE.aggregate,
    reranker:
      result.report.arms.B_BGE_RERANKER_BASE.aggregate,
    latencyComparison: result.report.latencyComparison,
    gateResults: result.report.gateResults,
  }, null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.stack ?? error.message
        : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
