export type EvaluationLatencyDistribution = {
  percentileMethod: "NEAREST_RANK";
  count: number;
  minMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  averageMs: number | null;
  totalMs: number;
};

function assertLatencyMs(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("INVALID_EVALUATION_LATENCY_MS");
  }
}

function nearestRank(sortedValues: readonly number[], percentile: number) {
  const rank = Math.ceil(percentile * sortedValues.length);
  return sortedValues[Math.max(0, rank - 1)]!;
}

/**
 * Builds an integer-millisecond distribution without mutating the input.
 * Percentiles use nearest-rank: rank = ceil(percentile * count).
 * The average follows existing evaluation reports and is rounded to the nearest millisecond.
 */
export function summarizeEvaluationLatencies(
  values: readonly number[],
): EvaluationLatencyDistribution {
  values.forEach(assertLatencyMs);

  if (values.length === 0) {
    return {
      percentileMethod: "NEAREST_RANK",
      count: 0,
      minMs: null,
      p50Ms: null,
      p90Ms: null,
      p95Ms: null,
      maxMs: null,
      averageMs: null,
      totalMs: 0,
    };
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const totalMs = sortedValues.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(totalMs)) {
    throw new Error("EVALUATION_LATENCY_TOTAL_EXCEEDS_SAFE_INTEGER");
  }

  return {
    percentileMethod: "NEAREST_RANK",
    count: sortedValues.length,
    minMs: sortedValues[0]!,
    p50Ms: nearestRank(sortedValues, 0.5),
    p90Ms: nearestRank(sortedValues, 0.9),
    p95Ms: nearestRank(sortedValues, 0.95),
    maxMs: sortedValues.at(-1)!,
    averageMs: Math.round(totalMs / sortedValues.length),
    totalMs,
  };
}

export function summarizeAgentEvaluationLatencies(
  results: readonly { observed: { latencyMs: number } }[],
) {
  return summarizeEvaluationLatencies(results.map((result) => result.observed.latencyMs));
}

export function summarizeTutorAnswerLatencies(
  results: readonly { answer: { latencyMs: number } | null }[],
) {
  return summarizeEvaluationLatencies(
    results.flatMap((result) => result.answer === null ? [] : [result.answer.latencyMs]),
  );
}
