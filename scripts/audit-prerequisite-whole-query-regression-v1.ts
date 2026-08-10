import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createLocalMixedRuntimeV2,
  type LocalMixedRuntimeV2,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import {
  fuseObligationRrfV1,
} from "@/lib/knowledge/obligation-rrf-v1";
import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  createRetrievalQueryV2,
} from "@/lib/knowledge/retrieval-query-v2";
import type {
  CompiledDirectQueryV1,
} from "@/lib/knowledge/retrieval-plan-v1";
import {
  buildT44ObligationCandidateCaseV1,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  obligationRuntimeOptionsV1,
} from "@/tools/mixed-retrieval/t45-obligation-runtime-port";

export const T5_ENTRY_ORIGINAL_QUESTION_V1 =
  "我的标题、图片和亮色都很抢，第一眼不知道看哪儿，先怎么判断冲突？";

const COURSE_PACK_ID = "layout-design";
const COURSE_PACK_VERSION = "1" as const;
const BASELINE_LIMIT = 8;
const EXPECTED_CHANNELS = [
  "LEXICAL",
  "TEXT_VECTOR",
  "VISUAL_VECTOR",
] as const;

type T5EntryGateInputV1 = {
  prerequisiteDecision: string;
  prerequisiteFailClosed: boolean;
  querySource: string;
  probeStatus: string;
  channelNames: readonly string[];
  expectedProviderCalls: number;
  actualProviderCalls: number;
  rrfCandidateObjectIds: readonly string[];
  candidateNodeCount: number;
  candidateCoursePackIds: readonly string[];
  baselineObjectIds: readonly string[];
};

export function evaluateT5EntryGateV1(
  input: T5EntryGateInputV1,
) {
  const candidateObjectIds = new Set(
    input.rrfCandidateObjectIds,
  );
  const checks = {
    prerequisiteStatic:
      input.prerequisiteDecision
        === "STATIC_CORPUS_ELIGIBLE"
      && input.prerequisiteFailClosed === false,
    wholeQueryExecuted:
      input.querySource === "WHOLE_QUERY"
      && input.probeStatus !== "SKIPPED_NON_STATIC",
    allLocalChannelsCalled:
      JSON.stringify([...input.channelNames].sort())
        === JSON.stringify([...EXPECTED_CHANNELS].sort())
      && input.expectedProviderCalls
        === EXPECTED_CHANNELS.length
      && input.actualProviderCalls
        === input.expectedProviderCalls,
    probeSucceeded: input.probeStatus === "SUCCESS",
    rrfCandidatesPresent:
      input.rrfCandidateObjectIds.length > 0
      && candidateObjectIds.size
        === input.rrfCandidateObjectIds.length,
    candidateNodesPresentAndScoped:
      input.candidateNodeCount > 0
      && input.candidateCoursePackIds.length > 0
      && input.candidateCoursePackIds.every(
        (coursePackId) =>
          coursePackId === COURSE_PACK_ID,
      ),
    boundedBaselineSelection:
      input.baselineObjectIds.length >= 1
      && input.baselineObjectIds.length
        <= BASELINE_LIMIT
      && new Set(input.baselineObjectIds).size
        === input.baselineObjectIds.length
      && input.baselineObjectIds.every(
        (objectId) =>
          candidateObjectIds.has(objectId),
      ),
  };
  return {
    checks,
    decision: Object.values(checks).every(Boolean)
      ? "T5_ENTRY_GO" as const
      : "T5_ENTRY_NO_GO" as const,
  };
}

function sha256Text(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

async function loadCorpus(
  workspaceRoot: string,
): Promise<KnowledgeCorpusBundleV2> {
  return verifyKnowledgeCorpusBundleV2(
    JSON.parse(await readFile(
      path.resolve(
        workspaceRoot,
        "data/knowledge-v2/knowledge-corpus.v2.json",
      ),
      "utf8",
    )) as unknown,
  );
}

export type T5EntryWholeQueryDependenciesV1 = {
  loadCorpus(
    workspaceRoot: string,
  ): Promise<KnowledgeCorpusBundleV2>;
  createRuntime(
    workspaceRoot: string,
    device: "cuda" | "cpu",
  ): Promise<LocalMixedRuntimeV2>;
};

const DEFAULT_DEPENDENCIES: T5EntryWholeQueryDependenciesV1 = {
  loadCorpus,
  createRuntime(workspaceRoot, device) {
    return createLocalMixedRuntimeV2(
      obligationRuntimeOptionsV1(
        workspaceRoot,
        device,
      ),
    );
  },
};

export async function runT5EntryWholeQueryRegressionV1(
  input: {
    workspaceRoot?: string;
    device?: "cuda" | "cpu";
  } = {},
  dependencies:
    T5EntryWholeQueryDependenciesV1 =
      DEFAULT_DEPENDENCIES,
) {
  const workspaceRoot = path.resolve(
    input.workspaceRoot ?? process.cwd(),
  );
  const device = input.device ?? "cuda";
  const corpus =
    await dependencies.loadCorpus(workspaceRoot);
  const parentQuery = createRetrievalQueryV2({
    mode: "TEXT_TO_TEXT",
    text: T5_ENTRY_ORIGINAL_QUESTION_V1,
    scope: {
      corpusBundleHash: corpus.bundleHash,
      sourceCoursePack: {
        id: COURSE_PACK_ID,
        version: COURSE_PACK_VERSION,
      },
    },
  });
  if (parentQuery.normalizedText === null) {
    throw new Error(
      "T5_ENTRY_WHOLE_QUERY_TEXT_REQUIRED",
    );
  }
  const compiledQuery: CompiledDirectQueryV1 = {
    queryId:
      `query-${sha256Text(
        parentQuery.normalizedText,
      ).slice(0, 16)}`,
    normalizedText: parentQuery.normalizedText,
    source: "WHOLE_QUERY" as const,
    obligationIds: [],
    modalities: ["TEXT", "IMAGE"],
  };

  const runtime =
    await dependencies.createRuntime(
      workspaceRoot,
      device,
    );
  try {
    const beforeCalls =
      runtime.providerSpy().entryCount;
    const batch =
      await runtime.probeDirectEvidenceBatch(
        [compiledQuery],
        { staticParentQuery: parentQuery },
      );
    const afterCalls =
      runtime.providerSpy().entryCount;
    const actualProviderCalls =
      afterCalls - beforeCalls;
    const rrf = fuseObligationRrfV1(
      batch.results,
    );
    const candidateCase =
      buildT44ObligationCandidateCaseV1({
        caseId:
          "t5-entry-original-visual-attention",
        coursePackId: COURSE_PACK_ID,
        coursePackVersion:
          COURSE_PACK_VERSION,
        normalizedQuestionHash:
          sha256Text(parentQuery.normalizedText),
        obligationSetHash:
          sha256StableJsonV2({
            kind: "T5_ENTRY_WHOLE_QUERY_ONLY",
            questionHash:
              sha256Text(
                parentQuery.normalizedText,
              ),
          }),
        retrievalPlanHash:
          sha256StableJsonV2({
            physicalQueries: [compiledQuery],
          }),
        aDirectEvidenceBatchHash:
          sha256StableJsonV2(batch),
        aRrfResult: rrf,
        bDirectEvidenceBatchHash: null,
        bRrfResult: null,
        corpus,
      });
    const probe = batch.results[0]!;
    const candidateArm =
      candidateCase.arms.A_WHOLE_QUERY;
    const baselineObjectIds =
      candidateArm.objectRanking
        .slice(0, BASELINE_LIMIT)
        .map(({ objectId }) => objectId);
    const channelNames =
      Object.keys(probe.channels).sort();
    const channelResults =
      Object.fromEntries(
        Object.entries(probe.channels)
          .map(([channel, result]) => [
            channel,
            {
              status: result!.summary.status,
              hitCount: result!.hits.length,
              identity:
                result!.summary.identity,
            },
          ]),
      );
    const gate = evaluateT5EntryGateV1({
      prerequisiteDecision:
        probe.prerequisite.decision,
      prerequisiteFailClosed:
        probe.prerequisite.failClosedEligible,
      querySource: probe.query.source,
      probeStatus: probe.status,
      channelNames,
      expectedProviderCalls:
        batch.expectedProviderCalls,
      actualProviderCalls,
      rrfCandidateObjectIds:
        candidateArm.objectRanking.map(
          ({ objectId }) => objectId,
        ),
      candidateNodeCount:
        candidateArm.candidateNodes.length,
      candidateCoursePackIds:
        candidateArm.candidateNodes.map(
          ({ coursePackId }) => coursePackId,
        ),
      baselineObjectIds,
    });
    return {
      schemaVersion: 1 as const,
      kind:
        "T5_ENTRY_WHOLE_QUERY_REGRESSION" as const,
      caseId:
        "t5-entry-original-visual-attention",
      device,
      questionSha256:
        sha256Text(
          T5_ENTRY_ORIGINAL_QUESTION_V1,
        ),
      corpusBundleHash: corpus.bundleHash,
      activeIndexBundleHash:
        runtime.provenance.activeIndexBundleHash,
      prerequisite: {
        decision:
          probe.prerequisite.decision,
        failClosedEligible:
          probe.prerequisite
            .failClosedEligible,
        basis: probe.prerequisiteBasis,
        featureIds:
          probe.prerequisite.features.map(
            ({ featureId }) => featureId,
          ),
      },
      retrieval: {
        querySource: probe.query.source,
        probeStatus: probe.status,
        expectedProviderCalls:
          batch.expectedProviderCalls,
        actualProviderCalls,
        channels: channelResults,
        rrfCandidateObjectCount:
          candidateArm.objectRanking.length,
        candidateNodeCount:
          candidateArm.candidateNodes.length,
        candidateNodeIdsSha256:
          candidateArm
            .candidateNodeIdsSha256,
        baselineObjectIds,
      },
      ...gate,
    };
  } finally {
    await runtime.dispose();
  }
}

function parseDevice(argv: readonly string[]) {
  const value = argv.find(
    (argument) =>
      argument.startsWith("--device="),
  )?.slice("--device=".length);
  if (value === undefined || value === "cuda") {
    return "cuda" as const;
  }
  if (value === "cpu") return "cpu" as const;
  throw new Error(
    "T5_ENTRY_DEVICE_MUST_BE_CUDA_OR_CPU",
  );
}

async function main() {
  const report =
    await runT5EntryWholeQueryRegressionV1({
      device: parseDevice(
        process.argv.slice(2),
      ),
    });
  process.stdout.write(
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (report.decision !== "T5_ENTRY_GO") {
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (
  entryPoint
  && import.meta.url
    === pathToFileURL(path.resolve(entryPoint)).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.message
        : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
