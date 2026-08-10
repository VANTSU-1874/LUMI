import { z } from "zod";

import {
  DIAGNOSTIC_DIMENSIONS,
  QUESTION_SETS,
  type DiagnosticDimension,
} from "@/data/diagnostic/questions";
import {
  DiagnosticAnswersSchema,
  DiagnosticDimensionScoreSchema,
} from "@/lib/domain/diagnostic";

export type { DiagnosticDimension } from "@/data/diagnostic/questions";

const dimensionSchema = z.enum(DIAGNOSTIC_DIMENSIONS);
const dimensionScoreSchema = z
  .array(
    z
      .object({
        dimension: dimensionSchema,
        score: DiagnosticDimensionScoreSchema,
      })
      .strict(),
  )
  .length(DIAGNOSTIC_DIMENSIONS.length)
  .superRefine((values, context) => {
    const seen = new Set(values.map(({ dimension }) => dimension));
    if (seen.size !== DIAGNOSTIC_DIMENSIONS.length) {
      context.addIssue({
        code: "custom",
        message: "每个诊断维度必须且只能出现一次",
      });
    }
  });

export type { DiagnosticAnswer } from "@/lib/domain/diagnostic";
export type DiagnosticLevel = "L1" | "L2" | "L3" | "L4";
export type DiagnosticResult = Record<DiagnosticDimension, number> & {
  average: number;
  level: DiagnosticLevel;
};

export class DiagnosticAnswerError extends Error {
  constructor() {
    super("诊断答案无效");
    this.name = "DiagnosticAnswerError";
  }
}

export class DiagnosticVersionConflictError extends Error {
  constructor() {
    super("诊断题库已更新，请重新开始");
    this.name = "DiagnosticVersionConflictError";
  }
}

export function scoreDiagnostic(input: unknown): DiagnosticResult {
  const values = dimensionScoreSchema.parse(input);
  const dimensions = Object.fromEntries(
    values.map(({ dimension, score }) => [dimension, score]),
  ) as Record<DiagnosticDimension, number>;
  const rawAverage =
    DIAGNOSTIC_DIMENSIONS.reduce(
      (total, dimension) => total + dimensions[dimension],
      0,
    ) / DIAGNOSTIC_DIMENSIONS.length;
  const average = Number(rawAverage.toFixed(2));

  let level: DiagnosticLevel = "L1";
  if (rawAverage >= 3.8 && dimensions.transfer >= 4) {
    level = "L4";
  } else if (rawAverage >= 3.2 && dimensions.transfer >= 3) {
    level = "L3";
  } else if (rawAverage >= 2.2) {
    level = "L2";
  }

  return { ...dimensions, average, level };
}

export function gradeDiagnosticAnswers(
  version: string,
  input: unknown,
): DiagnosticResult {
  if (!Object.hasOwn(QUESTION_SETS, version)) {
    throw new DiagnosticVersionConflictError();
  }
  const questions = QUESTION_SETS[version as keyof typeof QUESTION_SETS];
  const parsed = DiagnosticAnswersSchema.safeParse(input);
  if (!parsed.success || parsed.data.length !== questions.length) {
    throw new DiagnosticAnswerError();
  }
  const answers = parsed.data;
  if (new Set(answers.map(({ questionId }) => questionId)).size !== questions.length) {
    throw new DiagnosticAnswerError();
  }

  const totals = new Map<DiagnosticDimension, number>();
  const counts = new Map<DiagnosticDimension, number>();
  for (const answer of answers) {
    const question = questions.find(({ id }) => id === answer.questionId);
    if (!question) throw new DiagnosticAnswerError();
    const option = question.options.find(({ id }) => id === answer.optionId);
    if (!option) throw new DiagnosticAnswerError();
    totals.set(question.dimension, (totals.get(question.dimension) ?? 0) + option.score);
    counts.set(question.dimension, (counts.get(question.dimension) ?? 0) + 1);
  }

  const normalized = DIAGNOSTIC_DIMENSIONS.map((dimension) => {
    const count = counts.get(dimension);
    if (count !== 2) throw new DiagnosticAnswerError();
    return {
      dimension,
      score: (totals.get(dimension) ?? 0) / count,
    };
  });

  return scoreDiagnostic(normalized);
}
