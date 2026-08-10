const CLUSTER_TAG = /^cluster-[a-z0-9][a-z0-9-]*$/;
const DEFAULT_ITERATIONS = 10_000;
const DEFAULT_SEED = 0x5eed_c0de;
const MAX_UINT32 = 0xffff_ffff;

export type ClusteredBootstrapScore = {
  caseId: string;
  tags: readonly string[];
  value: number;
};

export type PairedClusterBootstrapOptions = {
  iterations?: number;
  seed?: number;
};

export type PairedClusterBootstrapResult = {
  pairedCaseCount: number;
  clusterCount: number;
  iterations: number;
  seed: number;
  meanDifference: number;
  confidenceInterval95: {
    lower: number;
    upper: number;
  };
};

type IndexedScore = {
  clusterId: string;
  value: number;
};

function clusterIdFor(score: ClusteredBootstrapScore, arm: "baseline" | "candidate") {
  const clusterTags = score.tags.filter((tag) => tag.startsWith("cluster-"));
  if (clusterTags.length !== 1 || !CLUSTER_TAG.test(clusterTags[0]!)) {
    throw new Error(
      `${arm} case ${score.caseId} must contain exactly one valid cluster-* tag`,
    );
  }
  return clusterTags[0]!;
}

function indexScores(
  scores: readonly ClusteredBootstrapScore[],
  arm: "baseline" | "candidate",
) {
  const indexed = new Map<string, IndexedScore>();
  for (const score of scores) {
    if (score.caseId.trim().length === 0) {
      throw new Error(`${arm} caseId must not be empty`);
    }
    if (!Number.isFinite(score.value)) {
      throw new Error(`${arm} case ${score.caseId} must have a finite value`);
    }
    if (indexed.has(score.caseId)) {
      throw new Error(`${arm} contains duplicate caseId ${score.caseId}`);
    }
    indexed.set(score.caseId, {
      clusterId: clusterIdFor(score, arm),
      value: score.value,
    });
  }
  return indexed;
}

function mean(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(sortedValues: readonly number[], probability: number) {
  const index = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sortedValues[lowerIndex]!;
  const upper = sortedValues[upperIndex]!;
  return lower + (upper - lower) * (index - lowerIndex);
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function validateOptions(options: PairedClusterBootstrapOptions) {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const seed = options.seed ?? DEFAULT_SEED;
  if (!Number.isSafeInteger(iterations) || iterations <= 0) {
    throw new Error("iterations must be a positive safe integer");
  }
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_UINT32) {
    throw new Error("seed must be an unsigned 32-bit integer");
  }
  return { iterations, seed };
}

/**
 * Estimates candidate minus baseline with a paired cluster bootstrap.
 *
 * Cases are paired by caseId before their differences are averaged inside each
 * cluster. Clusters then receive equal weight and are sampled with replacement,
 * so multiple correlated cases in one cluster cannot masquerade as independent
 * evidence.
 */
export function pairedClusterBootstrap(
  baseline: readonly ClusteredBootstrapScore[],
  candidate: readonly ClusteredBootstrapScore[],
  options: PairedClusterBootstrapOptions = {},
): PairedClusterBootstrapResult {
  if (baseline.length === 0 || candidate.length === 0) {
    throw new Error("paired cluster bootstrap requires non-empty baseline and candidate scores");
  }
  const { iterations, seed } = validateOptions(options);
  const baselineByCase = indexScores(baseline, "baseline");
  const candidateByCase = indexScores(candidate, "candidate");
  const allCaseIds = new Set([...baselineByCase.keys(), ...candidateByCase.keys()]);
  const unpairedCaseIds = [...allCaseIds]
    .filter((caseId) => !baselineByCase.has(caseId) || !candidateByCase.has(caseId))
    .sort();
  if (unpairedCaseIds.length > 0) {
    throw new Error(`unpaired caseIds: ${unpairedCaseIds.join(", ")}`);
  }

  const differencesByCluster = new Map<string, number[]>();
  for (const caseId of [...allCaseIds].sort()) {
    const baselineScore = baselineByCase.get(caseId)!;
    const candidateScore = candidateByCase.get(caseId)!;
    if (baselineScore.clusterId !== candidateScore.clusterId) {
      throw new Error(
        `paired case ${caseId} has mismatched cluster identities: `
        + `${baselineScore.clusterId} !== ${candidateScore.clusterId}`,
      );
    }
    const differences = differencesByCluster.get(baselineScore.clusterId) ?? [];
    differences.push(candidateScore.value - baselineScore.value);
    differencesByCluster.set(baselineScore.clusterId, differences);
  }

  const clusterDifferences = [...differencesByCluster.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, differences]) => mean(differences));
  const random = mulberry32(seed);
  const bootstrapMeans = Array.from({ length: iterations }, () => {
    let total = 0;
    for (let draw = 0; draw < clusterDifferences.length; draw += 1) {
      total += clusterDifferences[Math.floor(random() * clusterDifferences.length)]!;
    }
    return total / clusterDifferences.length;
  }).sort((left, right) => left - right);

  return {
    pairedCaseCount: allCaseIds.size,
    clusterCount: clusterDifferences.length,
    iterations,
    seed,
    meanDifference: mean(clusterDifferences),
    confidenceInterval95: {
      lower: percentile(bootstrapMeans, 0.025),
      upper: percentile(bootstrapMeans, 0.975),
    },
  };
}
