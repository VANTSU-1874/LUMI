import { createHash } from "node:crypto";

import { EvidenceBundleV2Schema, type EvidenceBundleV2 } from "./evidence-bundle-v2";
import {
  T4_MIXED_GATE_VERSION,
  T4_MIXED_SUITE_SHA256,
  T4_MIXED_SUITE_VERSION,
  assertMixedRuntimeQueryAllowlistV2,
  assertMixedSuiteContractV2,
  buildMixedEvaluationBindingsV2,
  createMixedEvaluationQueryV2,
  scoreMixedEvidenceCaseV2,
  type MixedBaselineReportV2,
} from "./mixed-retrieval-evaluation-v2";
import type {
  MixedRuntimeFaultDiagnosticV2,
  MixedRuntimeFaultV2,
} from "./mixed-retrieval-runtime-v2";
import {
  stableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "./knowledge-object-v2";
import {
  RetrievalEvaluationResultSchema,
  type RetrievalEvaluationResult,
  type RetrievalGoldenCase,
} from "./retrieval-quality";
import type { RetrievalQueryV2 } from "./retrieval-query-v2";

const TEXT_FAILURES = [
  "TEXT_TIMEOUT",
  "TEXT_UNAVAILABLE",
  "TEXT_CORRUPT",
] as const satisfies readonly MixedRuntimeFaultV2[];

const VISUAL_FAILURES = [
  "VISUAL_TIMEOUT",
  "VISUAL_UNAVAILABLE",
  "VISUAL_CORRUPT",
  "VISUAL_PROCESS_EXIT",
] as const satisfies readonly MixedRuntimeFaultV2[];

type FaultRetrieveV2 = (
  query: RetrievalQueryV2,
  fault: MixedRuntimeFaultV2,
) => Promise<EvidenceBundleV2>;

type NormalMixedCaseV2 = {
  caseId: string;
  bundle: EvidenceBundleV2;
  result: RetrievalEvaluationResult;
};

export type EvaluateMixedFaultMatrixV2Options = {
  suiteBytes: Uint8Array;
  corpus: KnowledgeCorpusBundleV2;
  captionBaseline: MixedBaselineReportV2;
  normalCases: readonly NormalMixedCaseV2[];
  retrieve: FaultRetrieveV2;
  diagnostics: () => readonly MixedRuntimeFaultDiagnosticV2[];
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalResult(resultInput: RetrievalEvaluationResult) {
  const result = RetrievalEvaluationResultSchema.parse(resultInput);
  return {
    status: result.status,
    hits: result.hits
      .map((hit) => ({
        kind: hit.kind,
        key: hit.key,
        rank: hit.rank,
        ...("region" in hit && hit.region ? { region: hit.region } : {}),
      }))
      .sort((left, right) => left.rank - right.rank),
    parentLocators: [...result.parentLocators],
  };
}

function exactPrimaryRankingParity(
  left: RetrievalEvaluationResult,
  right: RetrievalEvaluationResult,
  kind: "NODE" | "ASSET",
) {
  const project = (input: RetrievalEvaluationResult) => {
    const result = RetrievalEvaluationResultSchema.parse(input);
    return {
      status: result.status,
      hits: result.hits
        .filter((hit) => hit.kind === kind)
        .map((hit) => ({
          kind: hit.kind,
          key: hit.key,
          rank: hit.rank,
          ...("region" in hit && hit.region ? { region: hit.region } : {}),
        }))
        .sort((a, b) => a.rank - b.rank),
    };
  };
  return stableJsonV2(project(left)) === stableJsonV2(project(right));
}

function primaryObjectIds(bundle: EvidenceBundleV2) {
  return [...bundle.evidence.primary]
    .sort((left, right) => left.fusedRank - right.fusedRank)
    .map(({ objectId }) => objectId);
}

function emptyEvidence(bundle: EvidenceBundleV2) {
  return bundle.evidence.primary.length === 0
    && bundle.evidence.nodes.length === 0
    && bundle.evidence.assets.length === 0
    && bundle.evidence.regions.length === 0
    && bundle.sources.length === 0;
}

function answerableWithText(testCase: RetrievalGoldenCase) {
  return testCase.expectation === "ANSWERABLE"
    && testCase.query.text !== undefined
    && testCase.mode !== "IMAGE_TO_IMAGE";
}

function answerableVisualText(testCase: RetrievalGoldenCase) {
  return testCase.expectation === "ANSWERABLE"
    && (
      testCase.mode === "TEXT_TO_IMAGE"
      || testCase.mode === "IMAGE_TEXT_TO_EVIDENCE"
    );
}

async function runFaultCase(
  testCase: RetrievalGoldenCase,
  fault: MixedRuntimeFaultV2,
  bindings: ReturnType<typeof buildMixedEvaluationBindingsV2>,
  retrieve: FaultRetrieveV2,
) {
  const query = createMixedEvaluationQueryV2(testCase, bindings);
  assertMixedRuntimeQueryAllowlistV2(query);
  const bundle = EvidenceBundleV2Schema.parse(await retrieve(query, fault));
  const scored = scoreMixedEvidenceCaseV2(testCase, bundle, bindings);
  return {
    caseId: testCase.id,
    bundle,
    result: scored.result,
    resultFingerprint: sha256(stableJsonV2(canonicalResult(scored.result))),
  };
}

function diagnosticsByFault(
  diagnostics: readonly MixedRuntimeFaultDiagnosticV2[],
) {
  return new Map(diagnostics.map((item) => [item.fault, item]));
}

export async function evaluateMixedFaultMatrixV2(
  options: EvaluateMixedFaultMatrixV2Options,
) {
  const suite = assertMixedSuiteContractV2(options.suiteBytes);
  const corpus = verifyKnowledgeCorpusBundleV2(options.corpus);
  const bindings = buildMixedEvaluationBindingsV2(corpus);
  if (
    options.captionBaseline.suiteVersion !== T4_MIXED_SUITE_VERSION
    || options.captionBaseline.suiteHash !== T4_MIXED_SUITE_SHA256
  ) {
    throw new Error("MIXED_FAULT_CAPTION_BASELINE_SUITE_MISMATCH");
  }
  const captionByCase = new Map(
    options.captionBaseline.results.map((result) => [result.caseId, result]),
  );
  const normalByCase = new Map(
    options.normalCases.map((item) => [item.caseId, item]),
  );
  if (
    captionByCase.size !== 51
    || normalByCase.size !== 51
    || suite.cases.some(({ id }) => !captionByCase.has(id) || !normalByCase.has(id))
  ) {
    throw new Error("MIXED_FAULT_INPUT_CASE_SET_MISMATCH");
  }

  const textCases = suite.cases.filter(answerableWithText);
  const textToTextCases = suite.cases.filter((testCase) =>
    testCase.mode === "TEXT_TO_TEXT" && testCase.expectation === "ANSWERABLE");
  const textToTextBaselineSuccessCases = textToTextCases.filter(({ id }) =>
    captionByCase.get(id)!.status === "SUCCESS");
  const textToTextBaselineEmptyCases = textToTextCases.filter(({ id }) =>
    captionByCase.get(id)!.status === "EMPTY");
  const textDegradationCases = textCases.filter((testCase) =>
    testCase.mode !== "TEXT_TO_TEXT"
    || captionByCase.get(testCase.id)!.status === "SUCCESS");
  const visualCases = suite.cases.filter((testCase) =>
    testCase.mode === "TEXT_TO_IMAGE"
    || testCase.mode === "IMAGE_TO_IMAGE"
    || testCase.mode === "IMAGE_TEXT_TO_EVIDENCE");
  const visualTextCases = suite.cases.filter(answerableVisualText);
  const textToImageCases = suite.cases.filter((testCase) =>
    testCase.mode === "TEXT_TO_IMAGE" && testCase.expectation === "ANSWERABLE");
  const imageTextCases = suite.cases.filter(
    ({ mode }) => mode === "IMAGE_TEXT_TO_EVIDENCE",
  );
  const pureImageCases = suite.cases.filter(({ mode }) => mode === "IMAGE_TO_IMAGE");
  const positiveCases = suite.cases.filter(
    ({ expectation }) => expectation === "ANSWERABLE",
  );

  const textFailureScenarios = [];
  for (const fault of TEXT_FAILURES) {
    const outputs = [];
    for (const testCase of textCases) {
      outputs.push(await runFaultCase(testCase, fault, bindings, options.retrieve));
    }
    const byCase = new Map(outputs.map((item) => [item.caseId, item]));
    const degradedSuccessCaseIds = textDegradationCases
      .filter((testCase) => {
        const output = byCase.get(testCase.id)!;
        return output.bundle.status === "DEGRADED"
          && output.result.status === "SUCCESS"
          && output.bundle.evidence.primary.length > 0;
      })
      .map(({ id }) => id);
    const lexicalParityCaseIds = textToTextBaselineSuccessCases
      .filter((testCase) =>
        exactPrimaryRankingParity(
          byCase.get(testCase.id)!.result,
          captionByCase.get(testCase.id)!,
          "NODE",
        ))
      .map(({ id }) => id);
    const baselineEmptyPreservedCaseIds = textToTextBaselineEmptyCases
      .filter((testCase) => {
        const output = byCase.get(testCase.id)!;
        return output.bundle.status === "EMPTY"
          && output.result.status === "EMPTY"
          && emptyEvidence(output.bundle);
      })
      .map(({ id }) => id);
    textFailureScenarios.push({
      fault,
      mechanism: fault === "TEXT_TIMEOUT"
        ? "REAL_DEADLINE_AND_RESTART"
        : fault === "TEXT_CORRUPT"
          ? "MALFORMED_PROVIDER_PAYLOAD"
          : "SYNTHETIC_PROVIDER_STATUS",
      answerableTextCaseCount: textCases.length,
      degradationEligibleCaseCount: textDegradationCases.length,
      degradedSuccess: degradedSuccessCaseIds.length,
      degradedFailureCaseIds: textDegradationCases
        .filter(({ id }) => !degradedSuccessCaseIds.includes(id))
        .map(({ id }) => id),
      textToTextBaselineSuccessCaseCount: textToTextBaselineSuccessCases.length,
      exactLexicalPrimaryRankingParity: lexicalParityCaseIds.length,
      lexicalParityFailureCaseIds: textToTextBaselineSuccessCases
        .filter(({ id }) => !lexicalParityCaseIds.includes(id))
        .map(({ id }) => id),
      textToTextBaselineEmptyCaseCount: textToTextBaselineEmptyCases.length,
      baselineEmptyPreserved: baselineEmptyPreservedCaseIds.length,
      baselineEmptyFailureCaseIds: textToTextBaselineEmptyCases
        .filter(({ id }) => !baselineEmptyPreservedCaseIds.includes(id))
        .map(({ id }) => id),
    });
  }

  const visualFailureScenarios = [];
  for (const fault of VISUAL_FAILURES) {
    const outputs = [];
    for (const testCase of visualCases) {
      outputs.push(await runFaultCase(testCase, fault, bindings, options.retrieve));
    }
    const byCase = new Map(outputs.map((item) => [item.caseId, item]));
    const degradedSuccessCaseIds = visualTextCases
      .filter((testCase) => {
        const output = byCase.get(testCase.id)!;
        return output.bundle.status === "DEGRADED"
          && output.result.status === "SUCCESS"
          && output.bundle.evidence.primary.length > 0;
      })
      .map(({ id }) => id);
    const captionParityCaseIds = textToImageCases
      .filter((testCase) =>
        exactPrimaryRankingParity(
          byCase.get(testCase.id)!.result,
          captionByCase.get(testCase.id)!,
          "ASSET",
        ))
      .map(({ id }) => id);
    const imageTextSafeCaseIds = imageTextCases
      .filter((testCase) => {
        const bundle = byCase.get(testCase.id)!.bundle;
        return bundle.evidence.assets.length === 0
          && bundle.evidence.regions.length === 0
          && bundle.provenance.capabilitiesLost.includes("ASSET")
          && bundle.provenance.capabilitiesLost.includes("REGION")
          && bundle.provenance.captionFallback === undefined;
      })
      .map(({ id }) => id);
    const pureImageClosedCaseIds = pureImageCases
      .filter((testCase) => {
        const output = byCase.get(testCase.id)!;
        return output.result.status !== "SUCCESS"
          && output.result.parentLocators.length === 0
          && emptyEvidence(output.bundle);
      })
      .map(({ id }) => id);
    visualFailureScenarios.push({
      fault,
      mechanism: fault === "VISUAL_TIMEOUT"
        ? "REAL_DEADLINE_AND_RESTART"
        : fault === "VISUAL_PROCESS_EXIT"
          ? "REAL_PROCESS_EXIT_AND_RESTART"
          : fault === "VISUAL_CORRUPT"
            ? "MALFORMED_PROVIDER_PAYLOAD"
            : "SYNTHETIC_PROVIDER_STATUS",
      answerableVisualTextCaseCount: visualTextCases.length,
      degradedSuccess: degradedSuccessCaseIds.length,
      degradedFailureCaseIds: visualTextCases
        .filter(({ id }) => !degradedSuccessCaseIds.includes(id))
        .map(({ id }) => id),
      textToImageCaseCount: textToImageCases.length,
      exactCaptionPrimaryRankingParity: captionParityCaseIds.length,
      captionParityFailureCaseIds: textToImageCases
        .filter(({ id }) => !captionParityCaseIds.includes(id))
        .map(({ id }) => id),
      imageTextCaseCount: imageTextCases.length,
      imageTextNoInventedVisualEvidence: imageTextSafeCaseIds.length,
      imageTextFailureCaseIds: imageTextCases
        .filter(({ id }) => !imageTextSafeCaseIds.includes(id))
        .map(({ id }) => id),
      pureImageCaseCount: pureImageCases.length,
      pureImageFailClosed: pureImageClosedCaseIds.length,
      pureImageFailureCaseIds: pureImageCases
        .filter(({ id }) => !pureImageClosedCaseIds.includes(id))
        .map(({ id }) => id),
    });
  }

  const healthyEmptyOutputs = [];
  for (const testCase of visualCases) {
    healthyEmptyOutputs.push(
      await runFaultCase(testCase, "VISUAL_EMPTY", bindings, options.retrieve),
    );
  }
  const healthyEmptyPassed = healthyEmptyOutputs.filter(({ bundle, result }) => {
    const visual = bundle.channels.find(({ channel }) => channel === "VISUAL_VECTOR");
    return visual?.status === "EMPTY"
      && visual.reason === null
      && visual.identity !== null
      && bundle.status === "EMPTY"
      && result.status === "EMPTY"
      && emptyEvidence(bundle)
      && bundle.provenance.captionFallback === undefined
      && !bundle.provenance.fallbackTriggers.some((trigger) =>
        trigger.startsWith("CAPTION_LEXICAL_FALLBACK_"));
  });
  const healthyVisualEmpty = {
    semantics: "HEALTHY_NO_MATCH_NOT_A_PROVIDER_FAILURE",
    caseCount: visualCases.length,
    passed: healthyEmptyPassed.length,
    failureCaseIds: healthyEmptyOutputs
      .filter(({ caseId }) => !healthyEmptyPassed.some((item) => item.caseId === caseId))
      .map(({ caseId }) => caseId),
  };

  const relationPrimaryCases = positiveCases.filter(({ id }) =>
    normalByCase.get(id)!.bundle.evidence.primary.length > 0);
  const relationNormalEmptyCases = positiveCases.filter(({ id }) =>
    normalByCase.get(id)!.bundle.evidence.primary.length === 0);
  const relationOutputs = [];
  for (const testCase of positiveCases) {
    relationOutputs.push(
      await runFaultCase(testCase, "RELATION_ERROR", bindings, options.retrieve),
    );
  }
  const relationPassed = relationOutputs.filter(({ caseId, bundle }) => {
    if (!relationPrimaryCases.some(({ id }) => id === caseId)) return false;
    const normal = normalByCase.get(caseId)!;
    return bundle.status === "DEGRADED"
      && stableJsonV2(primaryObjectIds(bundle))
        === stableJsonV2(primaryObjectIds(normal.bundle))
      && bundle.provenance.capabilitiesLost.includes("GRAPH_CONTEXT")
      && bundle.provenance.fallbackTriggers.includes("RELATION_EXPANSION_ERROR")
      && bundle.evidence.nodes.every(({ relation }) => relation === "PRIMARY");
  });
  const relationEmptyPassed = relationOutputs.filter(({ caseId, bundle, result }) =>
    relationNormalEmptyCases.some(({ id }) => id === caseId)
    && bundle.status === "EMPTY"
    && result.status === "EMPTY"
    && emptyEvidence(bundle));
  const relationFailure = {
    fault: "RELATION_ERROR" as const,
    positiveCaseCount: positiveCases.length,
    normalPrimaryCaseCount: relationPrimaryCases.length,
    retainedPrimaryAndFailClosedGraphContext: relationPassed.length,
    primaryRetentionFailureCaseIds: relationOutputs
      .filter(({ caseId }) =>
        relationPrimaryCases.some(({ id }) => id === caseId)
        && !relationPassed.some((item) => item.caseId === caseId))
      .map(({ caseId }) => caseId),
    normalEmptyCaseCount: relationNormalEmptyCases.length,
    normalEmptyPreserved: relationEmptyPassed.length,
    normalEmptyFailureCaseIds: relationOutputs
      .filter(({ caseId }) =>
        relationNormalEmptyCases.some(({ id }) => id === caseId)
        && !relationEmptyPassed.some((item) => item.caseId === caseId))
      .map(({ caseId }) => caseId),
  };

  const diagnostics = options.diagnostics().map((item) => structuredClone(item));
  const diagnosticsMap = diagnosticsByFault(diagnostics);
  const checks = [
    ...textFailureScenarios.flatMap((scenario) => [
      {
        id: `fault.${scenario.fault.toLowerCase()}.degradation-success`,
        observed: `${scenario.degradedSuccess}/${scenario.degradationEligibleCaseCount}`,
        threshold: "34/34 baseline-answerable cases",
        pass: scenario.answerableTextCaseCount === 35
          && scenario.degradationEligibleCaseCount === 34
          && scenario.degradedSuccess === 34,
      },
      {
        id: `fault.${scenario.fault.toLowerCase()}.lexical-primary-ranking-parity`,
        observed:
          `${scenario.exactLexicalPrimaryRankingParity}/`
          + `${scenario.textToTextBaselineSuccessCaseCount}`,
        threshold: "4/4 baseline SUCCESS",
        pass: scenario.textToTextBaselineSuccessCaseCount === 4
          && scenario.exactLexicalPrimaryRankingParity === 4,
      },
      {
        id: `fault.${scenario.fault.toLowerCase()}.lexical-empty-no-fabrication`,
        observed:
          `${scenario.baselineEmptyPreserved}/${scenario.textToTextBaselineEmptyCaseCount}`,
        threshold: "1/1 baseline EMPTY remains EMPTY",
        pass: scenario.textToTextBaselineEmptyCaseCount === 1
          && scenario.baselineEmptyPreserved === 1,
      },
    ]),
    ...visualFailureScenarios.flatMap((scenario) => [
      {
        id: `fault.${scenario.fault.toLowerCase()}.degradation-success`,
        observed: `${scenario.degradedSuccess}/${scenario.answerableVisualTextCaseCount}`,
        threshold: "30/30",
        pass: scenario.answerableVisualTextCaseCount === 30
          && scenario.degradedSuccess === 30,
      },
      {
        id: `fault.${scenario.fault.toLowerCase()}.caption-primary-ranking-parity`,
        observed:
          `${scenario.exactCaptionPrimaryRankingParity}/${scenario.textToImageCaseCount}`,
        threshold: "24/24",
        pass: scenario.textToImageCaseCount === 24
          && scenario.exactCaptionPrimaryRankingParity === 24,
      },
      {
        id: `fault.${scenario.fault.toLowerCase()}.image-text-no-invention`,
        observed:
          `${scenario.imageTextNoInventedVisualEvidence}/${scenario.imageTextCaseCount}`,
        threshold: "7/7",
        pass: scenario.imageTextCaseCount === 7
          && scenario.imageTextNoInventedVisualEvidence === 7,
      },
      {
        id: `fault.${scenario.fault.toLowerCase()}.pure-image-fail-closed`,
        observed: `${scenario.pureImageFailClosed}/${scenario.pureImageCaseCount}`,
        threshold: "7/7",
        pass: scenario.pureImageCaseCount === 7
          && scenario.pureImageFailClosed === 7,
      },
    ]),
    {
      id: "fault.visual-empty.healthy-no-match",
      observed: `${healthyVisualEmpty.passed}/${healthyVisualEmpty.caseCount}`,
      threshold: "38/38 EMPTY with identity; no caption fallback",
      pass: healthyVisualEmpty.caseCount === 38
        && healthyVisualEmpty.passed === 38,
    },
    {
      id: "fault.relation-error.primary-retention",
      observed:
        `${relationFailure.retainedPrimaryAndFailClosedGraphContext}/`
        + `${relationFailure.normalPrimaryCaseCount}`,
      threshold: "100% of normal cases with retained primary evidence",
      pass: relationFailure.positiveCaseCount === 41
        && relationFailure.retainedPrimaryAndFailClosedGraphContext
          === relationFailure.normalPrimaryCaseCount,
    },
    {
      id: "fault.relation-error.normal-empty-no-fabrication",
      observed:
        `${relationFailure.normalEmptyPreserved}/${relationFailure.normalEmptyCaseCount}`,
      threshold: "100% of normal EMPTY cases remain EMPTY",
      pass: relationFailure.normalEmptyPreserved === relationFailure.normalEmptyCaseCount,
    },
    ...(["TEXT_TIMEOUT", "VISUAL_TIMEOUT"] as const).map((fault) => {
      const diagnostic = diagnosticsMap.get(fault);
      return {
        id: `fault.${fault.toLowerCase()}.real-deadline-proof`,
        observed: diagnostic ?? null,
        threshold:
          "deadline=true processExit=true recovery=true lateResultPollutionChecked=true",
        pass: diagnostic?.mechanism === "REAL_DEADLINE_AND_RESTART"
          && diagnostic.injectionCount >= 1
          && diagnostic.deadlineObserved === true
          && diagnostic.processExitObserved === true
          && diagnostic.recoveryProbePassed === true
          && diagnostic.lateResultPollutionChecked === true,
      };
    }),
    {
      id: "fault.visual-process-exit.real-process-proof",
      observed: diagnosticsMap.get("VISUAL_PROCESS_EXIT") ?? null,
      threshold:
        "processExit=true recovery=true lateResultPollutionChecked=true",
      pass:
        diagnosticsMap.get("VISUAL_PROCESS_EXIT")?.mechanism
          === "REAL_PROCESS_EXIT_AND_RESTART"
        && diagnosticsMap.get("VISUAL_PROCESS_EXIT")!.injectionCount >= 1
        && diagnosticsMap.get("VISUAL_PROCESS_EXIT")!.processExitObserved === true
        && diagnosticsMap.get("VISUAL_PROCESS_EXIT")!.recoveryProbePassed === true
        && diagnosticsMap.get("VISUAL_PROCESS_EXIT")!.lateResultPollutionChecked === true,
    },
  ];

  return {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    evaluator: "SELF_HOSTED_MIXED_RETRIEVAL_FAULT_MATRIX_V2" as const,
    gateVersion: T4_MIXED_GATE_VERSION,
    suiteVersion: T4_MIXED_SUITE_VERSION,
    suiteHash: T4_MIXED_SUITE_SHA256,
    corpusBundleHash: corpus.bundleHash,
    sources: {
      serviceDatabase: "NOT_USED",
      projectDatabase: "NOT_USED",
      groundTruthSentToRetriever: false,
      expectedSentToRetriever: false,
      faultCaseIdSentToRetriever: false,
    },
    semantics: {
      frozenFallbackParity:
        "Exact parity means status plus ordered mode-primary retrieval hits (NODE for text-to-text, ASSET for text-to-image), including key/rank/region and excluding channel metadata, scores, graph-added cross-modal nodes, and capped parent context. Parent evidence has separate frozen gates.",
      healthyVisualEmpty:
        "EMPTY with identity/reason=null is a healthy no-match and never triggers caption fallback.",
      providerFailures:
        "Only TIMEOUT, UNAVAILABLE, ERROR/corrupt, and observed process exit trigger visual fallback.",
      baselineEmpty:
        "Fault degradation success is defined only where the frozen baseline has answer evidence; frozen EMPTY cases are a separate no-fabrication invariant.",
      relationFailure:
        "Relation failure retains primaries only for cases that had normal primaries; normal EMPTY cases remain EMPTY without fabricated evidence.",
    },
    textFailureScenarios,
    visualFailureScenarios,
    healthyVisualEmpty,
    relationFailure,
    diagnostics,
    gateEvaluation: {
      gateVersion: T4_MIXED_GATE_VERSION,
      overallPass: checks.every(({ pass }) => pass),
      passed: checks.filter(({ pass }) => pass).length,
      failed: checks.filter(({ pass }) => !pass).length,
      checks,
    },
  };
}
