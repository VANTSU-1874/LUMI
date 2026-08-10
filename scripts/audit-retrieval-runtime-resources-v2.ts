import {
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  fixedAgentEvidenceRuntimeOptionsV2,
} from "@/lib/knowledge/agent-evidence-runtime-v2";
import {
  createLocalMixedRuntimeV2,
  RetrievalRuntimeResourceReportV2Schema,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import { createRetrievalQueryV2 } from "@/lib/knowledge/retrieval-query-v2";

const OutputSchema = z
  .object({
    schemaVersion: z.literal(2),
    audit: z
      .object({
        visualHealthyEmptyCount: z.number().int().nonnegative(),
        visualFailureCount: z.number().int().nonnegative(),
        visualBlockedCount: z.number().int().nonnegative(),
        textFailureCount: z.number().int().nonnegative(),
        allSidecarsExited: z.boolean(),
      })
      .strict(),
    beforeDispose: RetrievalRuntimeResourceReportV2Schema,
    afterDispose: RetrievalRuntimeResourceReportV2Schema,
  })
  .strict();

export function parseRetrievalResourceAuditArguments(
  input: readonly string[],
) {
  if (
    input.length !== 2
    || input[0] !== "--output-name"
    || !input[1]
    || !/^[a-z0-9][a-z0-9.-]{0,100}\.json$/.test(input[1])
  ) {
    throw new Error(
      "usage: audit-retrieval-runtime-resources-v2.ts "
      + "--output-name <safe-name.json>",
    );
  }
  return { outputName: input[1] };
}

export async function runRetrievalResourceAuditV2(input: {
  workspaceRoot?: string;
  outputName: string;
  dependencies?: {
    createRuntime: typeof createLocalMixedRuntimeV2;
    fixedOptions: typeof fixedAgentEvidenceRuntimeOptionsV2;
  };
}) {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
  const outputRoot = path.join(
    workspaceRoot,
    ".runtime",
    "retrieval-observability",
  );
  await mkdir(outputRoot, { recursive: true });
  const realOutputRoot = await realpath(outputRoot);
  if (
    path.resolve(realOutputRoot).toLowerCase()
    !== path.resolve(outputRoot).toLowerCase()
  ) {
    throw new Error("RETRIEVAL_RESOURCE_OUTPUT_ROOT_SYMLINK");
  }
  const outputPath = path.join(outputRoot, input.outputName);
  const dependencies = input.dependencies ?? {
    createRuntime: createLocalMixedRuntimeV2,
    fixedOptions: fixedAgentEvidenceRuntimeOptionsV2,
  };
  const options = {
    ...dependencies.fixedOptions(workspaceRoot),
    circuitBreaker: {
      failureThreshold: 2,
      cooldownMs: 30_000,
      latencySampleLimit: 32,
    },
  };
  const runtime = await dependencies.createRuntime(options);
  let disposed = false;
  try {
    const query = createRetrievalQueryV2({
      mode: "TEXT_TO_IMAGE",
      text: "检查版式层级",
      scope: {
        corpusBundleHash:
          runtime.t41CandidateIdentity.corpusBundleHash,
        sourceCoursePack: {
          id: "layout-design",
          version: "1",
        },
      },
    });
    await runtime.retrieve(query, "VISUAL_EMPTY");
    await runtime.retrieve(query, "VISUAL_UNAVAILABLE");
    await runtime.retrieve(query, "VISUAL_UNAVAILABLE");
    await runtime.retrieve(query, "NONE");
    const beforeDispose = runtime.resourceReport();
    await runtime.dispose();
    disposed = true;
    const afterDispose = runtime.resourceReport();
    const visual = beforeDispose.channels.VISUAL_VECTOR;
    if (!visual) {
      throw new Error("RETRIEVAL_RESOURCE_VISUAL_CHANNEL_REQUIRED");
    }
    const output = OutputSchema.parse({
      schemaVersion: 2,
      audit: {
        visualHealthyEmptyCount: visual.counters.empty,
        visualFailureCount: visual.counters.failures,
        visualBlockedCount: visual.counters.blocked,
        textFailureCount:
          beforeDispose.channels.TEXT_VECTOR.counters.failures,
        allSidecarsExited:
          !afterDispose.sidecars.text.processRunning
          && !afterDispose.sidecars.visual?.processRunning,
      },
      beforeDispose,
      afterDispose,
    });
    if (
      output.audit.visualHealthyEmptyCount !== 1
      || output.audit.visualFailureCount !== 2
      || output.audit.visualBlockedCount < 1
      || output.audit.textFailureCount !== 0
      || !output.audit.allSidecarsExited
    ) {
      throw new Error("RETRIEVAL_RESOURCE_AUDIT_GATE_FAILED");
    }
    const draft = path.join(
      outputRoot,
      `.${input.outputName}.${process.pid}.tmp`,
    );
    try {
      await writeFile(
        draft,
        `${JSON.stringify(output, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      await rename(draft, outputPath);
    } finally {
      await rm(draft, { force: true });
    }
    process.stdout.write(`${JSON.stringify({
      output: path.posix.join(
        ".runtime",
        "retrieval-observability",
        input.outputName,
      ),
      audit: output.audit,
    }, null, 2)}\n`);
    return output;
  } finally {
    if (!disposed) {
      await runtime.dispose();
    }
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (invokedPath === import.meta.url) {
  runRetrievalResourceAuditV2({
    ...parseRetrievalResourceAuditArguments(
      process.argv.slice(2),
    ),
  }).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
