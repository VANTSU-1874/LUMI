import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  ReleaseInferenceConfig,
} from "./release-source-binding";
import {
  RagAgentHarnessReportSchema,
} from "./rag-harness";
import {
  TutorQualityReportSchema,
  TutorQualityReport,
} from "./tutor-quality-evaluation";
import {
  TUTOR_QUALITY_DIMENSION_IDS,
  TUTOR_QUALITY_HARD_FAILURE_IDS,
  type TutorQualitySuite,
} from "./tutor-quality-suite";

export const TutorQualityKnowledgeArmSchema =
  z.enum([
    "LEGACY_V1",
    "SELF_HOSTED_V2",
  ]);

export type TutorQualityKnowledgeArm = z.infer<
  typeof TutorQualityKnowledgeArmSchema
>;

export type TutorQualityRunArguments = {
  fixture: boolean;
  restart: boolean;
  knowledgeArm:
    TutorQualityKnowledgeArm | null;
};

function armFromCli(value: string) {
  if (value === "legacy-v1") {
    return "LEGACY_V1" as const;
  }
  if (value === "self-hosted-v2") {
    return "SELF_HOSTED_V2" as const;
  }
  throw new Error(
    "TUTOR_QUALITY_KNOWLEDGE_ARM_INVALID",
  );
}

export function parseTutorQualityRunArguments(
  rawArguments: readonly string[],
): TutorQualityRunArguments {
  const argumentsList =
    rawArguments[0] === "--"
      ? rawArguments.slice(1)
      : [...rawArguments];
  let fixture = false;
  let restart = false;
  let knowledgeArm:
    TutorQualityKnowledgeArm | null = null;
  const seen = new Set<string>();
  for (
    let index = 0;
    index < argumentsList.length;
    index += 1
  ) {
    const argument = argumentsList[index]!;
    if (
      argument === "--fixture"
      || argument === "--restart"
    ) {
      if (seen.has(argument)) {
        throw new Error(
          "TUTOR_QUALITY_ARGUMENT_DUPLICATE",
        );
      }
      seen.add(argument);
      if (argument === "--fixture") {
        fixture = true;
      } else {
        restart = true;
      }
      continue;
    }
    if (argument === "--knowledge-arm") {
      if (seen.has(argument)) {
        throw new Error(
          "TUTOR_QUALITY_ARGUMENT_DUPLICATE",
        );
      }
      seen.add(argument);
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(
          "TUTOR_QUALITY_KNOWLEDGE_ARM_MISSING",
        );
      }
      knowledgeArm = armFromCli(value);
      index += 1;
      continue;
    }
    throw new Error(
      "TUTOR_QUALITY_ARGUMENT_UNKNOWN",
    );
  }
  return {
    fixture,
    restart,
    knowledgeArm,
  };
}

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (
    value !== null
    && typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) =>
          left.localeCompare(right))
        .map(([key, item]) => [
          key,
          canonicalize(item),
        ]),
    );
  }
  return value;
}

const HashSchema =
  z.string().regex(/^[0-9a-f]{64}$/);

export const TutorQualityArmAttestationSchema =
  z.object({
    schemaVersion: z.literal(1),
    knowledgeArm:
      TutorQualityKnowledgeArmSchema,
    knowledgeObjectV2Enabled: z.boolean(),
    reportSha256: HashSchema,
    sourceCommit:
      z.string().regex(/^[0-9a-f]{40}$/),
    sourceStatusHash: HashSchema,
    suiteHash: HashSchema,
    inferenceConfigHash: HashSchema,
    runtimeProfile: z.object({
      id: z.string().trim().min(1).max(100),
      hash: HashSchema,
      verification: z.enum([
        "LEGACY",
        "FIXTURE",
        "PREWARMED",
      ]),
    }).strict(),
  })
  .strict()
  .superRefine((attestation, context) => {
    if (
      attestation.knowledgeObjectV2Enabled
      !== (
        attestation.knowledgeArm
          === "SELF_HOSTED_V2"
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["knowledgeObjectV2Enabled"],
        message:
          "knowledge arm and V2 flag must agree",
      });
    }
  });

export type TutorQualityArmAttestation =
  z.infer<
    typeof TutorQualityArmAttestationSchema
  >;

export function buildTutorQualityArmAttestation(
  input: {
    knowledgeArm: TutorQualityKnowledgeArm;
    reportText: string;
    report: TutorQualityReport;
    inferenceConfig: ReleaseInferenceConfig;
    runtimeProfile: {
      id: string;
      hash: string;
      verification:
        | "LEGACY"
        | "FIXTURE"
        | "PREWARMED";
    };
  },
) {
  return TutorQualityArmAttestationSchema.parse({
    schemaVersion: 1,
    knowledgeArm: input.knowledgeArm,
    knowledgeObjectV2Enabled:
      input.knowledgeArm === "SELF_HOSTED_V2",
    reportSha256: sha256(input.reportText),
    sourceCommit: input.report.sourceCommit,
    sourceStatusHash:
      input.report.sourceStatusHash,
    suiteHash: input.report.suiteHash,
    inferenceConfigHash: sha256(
      JSON.stringify(canonicalize(
        input.inferenceConfig,
      )),
    ),
    runtimeProfile: input.runtimeProfile,
  });
}

export function verifyTutorQualityArmAttestation(
  input: {
    rawAttestation: unknown;
    reportText: string;
    report: TutorQualityReport;
    inferenceConfig: ReleaseInferenceConfig;
    expectedArm: TutorQualityKnowledgeArm;
  },
) {
  const attestation =
    TutorQualityArmAttestationSchema.parse(
      input.rawAttestation,
    );
  const reasons: string[] = [];
  if (
    attestation.knowledgeArm
      !== input.expectedArm
  ) {
    reasons.push("ARM_MISMATCH");
  }
  if (
    attestation.reportSha256
      !== sha256(input.reportText)
  ) {
    reasons.push("REPORT_HASH_MISMATCH");
  }
  if (
    attestation.sourceCommit
      !== input.report.sourceCommit
    || attestation.sourceStatusHash
      !== input.report.sourceStatusHash
    || attestation.suiteHash
      !== input.report.suiteHash
  ) {
    reasons.push("REPORT_BINDING_MISMATCH");
  }
  const inferenceConfigHash = sha256(
    JSON.stringify(canonicalize(
      input.inferenceConfig,
    )),
  );
  if (
    attestation.inferenceConfigHash
      !== inferenceConfigHash
  ) {
    reasons.push("INFERENCE_BINDING_MISMATCH");
  }
  return {
    passed: reasons.length === 0,
    reasons,
    attestation,
  };
}

export const TUTOR_QUALITY_AB_THRESHOLDS =
  Object.freeze({
    maximumOverallDimensionRegression:
      -0.1,
    minimumAutomatedPositiveSignal: 0.1,
    blindMinimumV2PreferenceRate: 0.6,
    blindCaseCount: 20,
  } as const);

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function average(values: readonly number[]) {
  return values.length === 0
    ? 0
    : round(
        values.reduce(
          (sum, value) => sum + value,
          0,
        ) / values.length,
      );
}

function sameJson(
  left: unknown,
  right: unknown,
) {
  return JSON.stringify(canonicalize(left))
    === JSON.stringify(canonicalize(right));
}

function reportBinding(
  report: TutorQualityReport,
) {
  return {
    suiteVersion: report.suiteVersion,
    suiteHash: report.suiteHash,
    rubricVersion: report.rubricVersion,
    sourceCommit: report.sourceCommit,
    sourceStatusHash: report.sourceStatusHash,
    runtime: report.runtime,
    inferenceConfig: report.inferenceConfig,
    answerModel: report.answerModel,
    judgeModel: report.judgeModel,
    caseIds: report.results.map(
      ({ caseId }) => caseId,
    ),
  };
}

function metricsForCases(
  report: TutorQualityReport,
  caseIds: ReadonlySet<string>,
) {
  const results = report.results.filter(
    ({ caseId }) => caseIds.has(caseId),
  );
  return {
    caseCount: results.length,
    passedCaseCount:
      results.filter(({ passed }) => passed)
        .length,
    passRate:
      results.length === 0
        ? 0
        : round(
            results.filter(
              ({ passed }) => passed,
            ).length / results.length,
          ),
    dimensions: Object.fromEntries(
      TUTOR_QUALITY_DIMENSION_IDS.map(
        (dimension) => [
          dimension,
          average(results.map(
            ({ judgment }) =>
              judgment?.scores[dimension] ?? 0,
          )),
        ],
      ),
    ),
    hardFailures: Object.fromEntries(
      TUTOR_QUALITY_HARD_FAILURE_IDS.map(
        (failure) => [
          failure,
          results.filter(
            ({ judgment }) =>
              judgment?.hardFailures[failure]
                .occurred,
          ).length,
        ],
      ),
    ),
  };
}

function deltaMetrics(
  legacy: ReturnType<typeof metricsForCases>,
  v2: ReturnType<typeof metricsForCases>,
) {
  return {
    caseCount: legacy.caseCount,
    legacy,
    v2,
    delta: {
      passedCaseCount:
        v2.passedCaseCount
        - legacy.passedCaseCount,
      passRate:
        round(v2.passRate - legacy.passRate),
      dimensions: Object.fromEntries(
        TUTOR_QUALITY_DIMENSION_IDS.map(
          (dimension) => [
            dimension,
            round(
              v2.dimensions[dimension]
              - legacy.dimensions[dimension],
            ),
          ],
        ),
      ),
      hardFailures: Object.fromEntries(
        TUTOR_QUALITY_HARD_FAILURE_IDS.map(
          (failure) => [
            failure,
            v2.hardFailures[failure]
            - legacy.hardFailures[failure],
          ],
        ),
      ),
    },
  };
}

function blindCaseIds(
  suite: TutorQualitySuite,
  suiteHash: string,
) {
  const focus = suite.cases.filter(
    ({ coursePackId }) =>
      coursePackId === "layout-design"
      || coursePackId === "brand-vi-design",
  );
  const controls = suite.cases
    .filter(({ id }) =>
      !focus.some(
        (candidate) => candidate.id === id,
      ))
    .map((qualityCase) => ({
      qualityCase,
      key: sha256(
        `${suiteHash}:${qualityCase.id}`,
      ),
    }))
    .sort((left, right) =>
      left.key.localeCompare(right.key))
    .slice(
      0,
      TUTOR_QUALITY_AB_THRESHOLDS
        .blindCaseCount - focus.length,
    )
    .map(({ qualityCase }) => qualityCase);
  const selected = [...focus, ...controls];
  if (
    selected.length
      !== TUTOR_QUALITY_AB_THRESHOLDS
        .blindCaseCount
  ) {
    throw new Error(
      "TUTOR_QUALITY_AB_BLIND_SAMPLE_SIZE",
    );
  }
  return selected.map(({ id }) => id);
}

function answerMarkdown(
  answer:
    TutorQualityReport["results"][number]["answer"],
) {
  if (!answer) return "_本臂没有形成可评分回答。_";
  const sources = answer.sources.length > 0
    ? [
        "",
        "来源：",
        ...answer.sources.map(
          ({ title, authority }) =>
            `- ${title}（${authority}）`,
        ),
      ].join("\n")
    : "";
  return [
    `**${answer.title}**`,
    "",
    answer.message,
    ...(answer.uncertainty
      ? ["", `不确定性：${answer.uncertainty}`]
      : []),
    sources,
  ].join("\n");
}

function blindArtifacts(input: {
  suite: TutorQualitySuite;
  suiteHash: string;
  legacy: TutorQualityReport;
  v2: TutorQualityReport;
}) {
  const selectedIds = blindCaseIds(
    input.suite,
    input.suiteHash,
  );
  const legacyById = new Map(
    input.legacy.results.map((result) => [
      result.caseId,
      result,
    ]),
  );
  const v2ById = new Map(
    input.v2.results.map((result) => [
      result.caseId,
      result,
    ]),
  );
  const casesById = new Map(
    input.suite.cases.map((qualityCase) => [
      qualityCase.id,
      qualityCase,
    ]),
  );
  const mapping = selectedIds.map(
    (caseId, index) => {
      const legacyIsX =
        Number.parseInt(
          sha256(
            `${input.suiteHash}:${caseId}:arm-order`,
          ).slice(0, 2),
          16,
        ) % 2 === 0;
      return {
        pairId:
          `blind-${String(index + 1).padStart(2, "0")}`,
        caseId,
        xArm: legacyIsX
          ? "LEGACY_V1" as const
          : "SELF_HOSTED_V2" as const,
        yArm: legacyIsX
          ? "SELF_HOSTED_V2" as const
          : "LEGACY_V1" as const,
      };
    },
  );
  const markdown = [
    "# T6 导师回答专业性匿名复核包",
    "",
    "本复核包只比较两份匿名回答。请勿打开映射文件，也不要参考自动评分。",
    "每题分别给回答 X、Y 的五个维度打 1–5 分，再选择总体偏好 X、Y 或 TIE。",
    "",
    "维度：具体有用、专业正确、可执行首步、后续判断、来源与不确定性。",
    "",
    ...mapping.flatMap((entry) => {
      const qualityCase =
        casesById.get(entry.caseId)!;
      const legacy =
        legacyById.get(entry.caseId)!;
      const v2 = v2ById.get(entry.caseId)!;
      const x = entry.xArm === "LEGACY_V1"
        ? legacy
        : v2;
      const y = entry.yArm === "LEGACY_V1"
        ? legacy
        : v2;
      return [
        `## ${entry.pairId}`,
        "",
        `课程包：${qualityCase.coursePackId}`,
        "",
        `问题：${qualityCase.question}`,
        "",
        "### 回答 X",
        "",
        answerMarkdown(x.answer),
        "",
        "### 回答 Y",
        "",
        answerMarkdown(y.answer),
        "",
        "### 评分",
        "",
        "| 维度 | X（1–5） | Y（1–5） |",
        "|---|---:|---:|",
        "| 具体有用 |  |  |",
        "| 专业正确 |  |  |",
        "| 可执行首步 |  |  |",
        "| 后续判断 |  |  |",
        "| 来源与不确定性 |  |  |",
        "",
        "总体偏好（X / Y / TIE）：",
        "",
        "主要依据：",
        "",
      ];
    }),
  ].join("\n");
  return {
    markdown: `${markdown}\n`,
    mapping: {
      schemaVersion: 1,
      suiteHash: input.suiteHash,
      caseCount: mapping.length,
      cases: mapping,
    },
  };
}

export function compareTutorQualityArms(
  input: {
    suite: TutorQualitySuite;
    suiteHash: string;
    legacyReportText: string;
    v2ReportText: string;
    rawLegacyAttestation: unknown;
    rawV2Attestation: unknown;
    rawRagReport: unknown;
  },
) {
  const legacy =
    TutorQualityReportSchema.parse(
      JSON.parse(input.legacyReportText),
    );
  const v2 = TutorQualityReportSchema.parse(
    JSON.parse(input.v2ReportText),
  );
  const legacyAttestation =
    verifyTutorQualityArmAttestation({
      rawAttestation:
        input.rawLegacyAttestation,
      reportText: input.legacyReportText,
      report: legacy,
      inferenceConfig:
        legacy.inferenceConfig,
      expectedArm: "LEGACY_V1",
    });
  const v2Attestation =
    verifyTutorQualityArmAttestation({
      rawAttestation: input.rawV2Attestation,
      reportText: input.v2ReportText,
      report: v2,
      inferenceConfig: v2.inferenceConfig,
      expectedArm: "SELF_HOSTED_V2",
    });
  if (
    !legacyAttestation.passed
    || !v2Attestation.passed
  ) {
    throw new Error(
      "TUTOR_QUALITY_AB_ATTESTATION_INVALID",
    );
  }
  if (
    !sameJson(
      reportBinding(legacy),
      reportBinding(v2),
    )
    || legacy.suiteHash !== input.suiteHash
    || v2.suiteHash !== input.suiteHash
  ) {
    throw new Error(
      "TUTOR_QUALITY_AB_BINDING_MISMATCH",
    );
  }
  const rag =
    RagAgentHarnessReportSchema.parse(
      input.rawRagReport,
    );
  const allCaseIds = new Set(
    input.suite.cases.map(({ id }) => id),
  );
  const overall = deltaMetrics(
    metricsForCases(legacy, allCaseIds),
    metricsForCases(v2, allCaseIds),
  );
  const coursePacks = Object.fromEntries(
    [...new Set(
      input.suite.cases.map(
        ({ coursePackId }) => coursePackId,
      ),
    )].sort().map((coursePackId) => {
      const ids = new Set(
        input.suite.cases
          .filter((qualityCase) =>
            qualityCase.coursePackId
              === coursePackId)
          .map(({ id }) => id),
      );
      return [
        coursePackId,
        deltaMetrics(
          metricsForCases(legacy, ids),
          metricsForCases(v2, ids),
        ),
      ];
    }),
  );
  const categories = Object.fromEntries(
    [...new Set(
      input.suite.cases.map(
        ({ category }) => category,
      ),
    )].sort().map((category) => {
      const ids = new Set(
        input.suite.cases
          .filter((qualityCase) =>
            qualityCase.category === category)
          .map(({ id }) => id),
      );
      return [
        category,
        deltaMetrics(
          metricsForCases(legacy, ids),
          metricsForCases(v2, ids),
        ),
      ];
    }),
  );
  const legacyById = new Map(
    legacy.results.map((result) => [
      result.caseId,
      result,
    ]),
  );
  const transitions = {
    failToPass: v2.results
      .filter((result) =>
        result.passed
        && !legacyById.get(result.caseId)?.passed)
      .map(({ caseId }) => caseId),
    passToFail: v2.results
      .filter((result) =>
        !result.passed
        && legacyById.get(result.caseId)?.passed)
      .map(({ caseId }) => caseId),
  };
  const requiredGroups =
    rag.results.flatMap(
      ({ requiredGroupResults }) =>
        requiredGroupResults,
    );
  const knowledgeChain = {
    ragMode: rag.mode,
    caseCount: rag.caseCount,
    passedCaseCount: rag.passedCaseCount,
    hardFailureCount: rag.hardFailureCount,
    requiredGroupCount:
      requiredGroups.length,
    requiredGroupsInjected:
      requiredGroups.filter(
        ({ injected }) => injected,
      ).length,
    requiredGroupsUsed:
      requiredGroups.filter(
        ({ used }) => used,
      ).length,
    persistedEqualsUsed:
      rag.results.every((result) =>
        sameJson(
          result.persistedSourceIds,
          result.usedSourceIds,
        )),
  };
  const operationalGate =
    legacy.invalidJudgeCount === 0
    && v2.invalidJudgeCount === 0
    && legacy.operationalFailureCaseCount === 0
    && v2.operationalFailureCaseCount === 0;
  const hardFailureGate =
    TUTOR_QUALITY_HARD_FAILURE_IDS.every(
      (failure) =>
        v2.hardFailureCounts[failure]
        <= legacy.hardFailureCounts[failure],
    );
  const nonRegressionGate =
    TUTOR_QUALITY_DIMENSION_IDS.every(
      (dimension) =>
        overall.delta.dimensions[dimension]
        >= TUTOR_QUALITY_AB_THRESHOLDS
          .maximumOverallDimensionRegression,
    );
  const ragGate =
    rag.mode === (
      legacy.comparisonMode
        === "FIXTURE_VALIDATION"
        ? "deterministic"
        : "real-model"
    )
    && rag.sourceCommit === legacy.sourceCommit
    && rag.sourceStatusHash
      === legacy.sourceStatusHash
    && rag.passed
    && rag.hardFailureCount === 0
    && requiredGroups.every(
      ({ injected, used }) =>
        injected && used,
    )
    && knowledgeChain.persistedEqualsUsed;
  const automatedPositiveSignal =
    overall.delta.dimensions
      .professionalCorrectness
      >= TUTOR_QUALITY_AB_THRESHOLDS
        .minimumAutomatedPositiveSignal
    && overall.delta.dimensions
      .specificityAndUsefulness
      >= TUTOR_QUALITY_AB_THRESHOLDS
        .minimumAutomatedPositiveSignal;
  const automatedGates = {
    operationalGate,
    hardFailureGate,
    nonRegressionGate,
    ragGate,
    automatedPositiveSignal,
  };
  const readyForBlindReview =
    operationalGate
    && hardFailureGate
    && nonRegressionGate
    && ragGate;
  const artifacts = blindArtifacts({
    suite: input.suite,
    suiteHash: input.suiteHash,
    legacy,
    v2,
  });
  return {
    report: {
      schemaVersion: 1,
      suiteHash: input.suiteHash,
      thresholds:
        TUTOR_QUALITY_AB_THRESHOLDS,
      bindings: {
        sourceCommit: legacy.sourceCommit,
        sourceStatusHash:
          legacy.sourceStatusHash,
        modelId: legacy.answerModel.id,
        endpointHash:
          legacy.answerModel.endpointHash,
        legacyRuntimeProfile:
          legacyAttestation.attestation
            .runtimeProfile,
        v2RuntimeProfile:
          v2Attestation.attestation
            .runtimeProfile,
      },
      overall,
      coursePacks,
      categories,
      transitions,
      knowledgeChain,
      automatedGates,
      decision: readyForBlindReview
        ? "T6_AUTOMATED_READY_FOR_BLIND_REVIEW"
        : "T6_AUTOMATED_NO_GO",
      limitations: [
        "回答与自动评分使用同一模型，自动差值不能替代匿名人工复核。",
        "样本是仿真评测用例，不是真实学生、课堂实证或学习成效。",
        "T6 在人工复核回填前不得记为 GO。",
      ],
    },
    blindReviewMarkdown: artifacts.markdown,
    blindMapping: artifacts.mapping,
  };
}
