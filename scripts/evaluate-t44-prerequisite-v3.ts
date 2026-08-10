import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  createAuditedCapabilityEntityManifestV2,
} from "@/lib/knowledge/capability-entity-registry-v2";
import {
  verifyKnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  QUERY_PREREQUISITE_CONFIG_HASH_V3,
} from "@/lib/knowledge/query-prerequisite-router-v3";
import {
  evaluateT44PrerequisiteDev,
} from "@/tools/mixed-retrieval/t44-prerequisite-evaluator";
import {
  loadT44PrerequisiteSuite,
} from "@/tools/mixed-retrieval/t44-prerequisite-loader";

const SUITE_PATH =
  "tests/retrieval-quality/t44-prerequisite-dev.json";
const CORPUS_PATH =
  "data/knowledge-v2/knowledge-corpus.v2.json";
const OUTPUT_ROOT =
  ".runtime/mixed-retrieval";

const VALUE_ARGUMENTS = new Set([
  "--output",
  "--candidate",
  "--split",
]);

function required(
  values: ReadonlyMap<string, string>,
  key: string,
) {
  const value = values.get(key);
  if (!value) {
    throw new Error(
      `T44_PREREQUISITE_CLI_REQUIRED_ARGUMENT_MISSING:${key}`,
    );
  }
  return value;
}

export function parseT44PrerequisiteArguments(
  argv: readonly string[],
) {
  const values = new Map<string, string>();
  let index = argv[0] === "--" ? 1 : 0;
  while (index < argv.length) {
    const argument = argv[index]!;
    if (!VALUE_ARGUMENTS.has(argument)) {
      throw new Error(
        `T44_PREREQUISITE_CLI_UNKNOWN_ARGUMENT:${argument}`,
      );
    }
    if (values.has(argument)) {
      throw new Error(
        `T44_PREREQUISITE_CLI_DUPLICATE_ARGUMENT:${argument}`,
      );
    }
    const value = argv[index + 1];
    if (!value || value === "--" || value.startsWith("--")) {
      throw new Error(
        `T44_PREREQUISITE_CLI_ARGUMENT_VALUE_MISSING:${argument}`,
      );
    }
    values.set(argument, value);
    index += 2;
  }
  const split = values.get("--split") ?? "DEV";
  if (split !== "DEV") {
    throw new Error(
      "T44_PREREQUISITE_CLI_ONLY_VISIBLE_DEV_IS_AUTHORIZED",
    );
  }
  return {
    output: required(values, "--output"),
    candidateId: z
      .enum([
        "route-candidate-1",
        "route-candidate-2",
        "route-candidate-3",
      ])
      .parse(required(values, "--candidate")),
    split: "DEV" as const,
  };
}

function assertOutputPath(output: string) {
  const root = path.resolve(OUTPUT_ROOT);
  const resolved = path.resolve(output);
  const relative = path.relative(root, resolved);
  if (
    relative === ""
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
    || path.extname(resolved).toLowerCase() !== ".json"
  ) {
    throw new Error(
      "T44_PREREQUISITE_CLI_OUTPUT_MUST_BE_LOCAL_RUNTIME_JSON",
    );
  }
  return resolved;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
) {
  const options = parseT44PrerequisiteArguments(argv);
  const output = assertOutputPath(options.output);
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(await readFile(CORPUS_PATH, "utf8")),
  );
  const manifest =
    createAuditedCapabilityEntityManifestV2(corpus);
  const suite = await loadT44PrerequisiteSuite(SUITE_PATH);

  console.error([
    `[t44-prerequisite] corpus hash=${corpus.bundleHash}`,
    "[t44-prerequisite] index hash=NOT_USED",
    "[t44-prerequisite] model id=NOT_USED revision=NOT_USED device=NOT_USED",
    `[t44-prerequisite] route policy hash=${QUERY_PREREQUISITE_CONFIG_HASH_V3}`,
    "[t44-prerequisite] support policy hash=NOT_USED",
    "[t44-prerequisite] sufficiency policy hash=NOT_USED",
    "[t44-prerequisite] serviceDatabase=NOT_USED",
    "[t44-prerequisite] projectDatabase=NOT_USED",
    "[t44-prerequisite] agentRuntime=NOT_USED",
    "[t44-prerequisite] webService=NOT_STARTED",
    "[t44-prerequisite] deployment=NOT_PERFORMED",
  ].join("\n"));

  const report = await evaluateT44PrerequisiteDev({
    candidateId: options.candidateId,
    suite,
    capabilityEntityManifest: manifest,
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({
    output,
    decision: report.decision,
    reportHash: report.reportHash,
    suiteHash: report.suiteHash,
    corpusBundleHash: report.corpusBundleHash,
    candidateId: report.candidateId,
    aggregate: report.aggregate,
    gateResults: report.gateResults,
    providerInvocationAudit:
      report.providerInvocationAudit,
  }));
  if (report.decision !== "GO") process.exitCode = 1;
  return report;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
