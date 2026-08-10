import { z } from "zod";

import { sha256StableJsonV2 } from "./knowledge-object-v2";
import { normalizeRetrievalTextV2 } from "./retrieval-query-v2";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);

export const QUERY_CLAIM_DECOMPOSER_CONFIG_V1 =
  Object.freeze({
    id: "lumi-query-claim-decomposer-v1",
    version: "2026-07-29.1",
    minimumCodePoints: 2,
    maximumCodePoints: 120,
    maximumSupportClaims: 4,
    maximumProbes: 5,
    clauseSeparators: "，,；;。！？?!",
    conjunctions: [
      "以及",
      "并且",
      "同时",
      "还是",
      "和",
      "与",
      "或",
      "、",
      "/",
    ],
    ordering:
      "SOURCE_START_THEN_CONJUNCT_BEFORE_CLAUSE_THEN_SHORTER_TEXT",
    duplicatePolicy: "NORMALIZED_TEXT_FIRST_OCCURRENCE",
  } as const);

export const QUERY_CLAIM_DECOMPOSER_CONFIG_HASH_V1 =
  sha256StableJsonV2(QUERY_CLAIM_DECOMPOSER_CONFIG_V1);

export const RetrievalSupportClaimV1Schema = z
  .object({
    claimId: IdSchema,
    text: z.string().min(1).max(120),
    textHash: HashSchema,
    sourceRule: z.enum([
      "CLAUSE",
      "CONJUNCT",
      "WHOLE_FALLBACK",
    ]),
    sourceSpan: z
      .object({
        startCodePoint: z.number().int().nonnegative(),
        endCodePoint: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine((claim, context) => {
    if (
      claim.sourceSpan.endCodePoint
      <= claim.sourceSpan.startCodePoint
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceSpan"],
        message: "claim source span must be non-empty",
      });
    }
    if (claim.textHash !== sha256StableJsonV2(claim.text)) {
      context.addIssue({
        code: "custom",
        path: ["textHash"],
        message: "claim text hash mismatch",
      });
    }
  });

export const RetrievalProbeV1Schema = z
  .object({
    probeId: IdSchema,
    kind: z.enum(["WHOLE_QUERY", "SUPPORT_CLAIM"]),
    text: z.string().min(1).max(500),
    textHash: HashSchema,
    claimIds: z.array(IdSchema).max(1),
  })
  .strict()
  .superRefine((probe, context) => {
    if (probe.textHash !== sha256StableJsonV2(probe.text)) {
      context.addIssue({
        code: "custom",
        path: ["textHash"],
        message: "probe text hash mismatch",
      });
    }
    if (
      probe.kind === "SUPPORT_CLAIM"
      && probe.claimIds.length !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["claimIds"],
        message: "support-claim probes bind exactly one claim",
      });
    }
  });

export const QueryClaimDecompositionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("QUERY_CLAIM_DECOMPOSITION"),
    decomposerId: z.literal(
      QUERY_CLAIM_DECOMPOSER_CONFIG_V1.id,
    ),
    decomposerVersion: z.literal(
      QUERY_CLAIM_DECOMPOSER_CONFIG_V1.version,
    ),
    configHash: z.literal(
      QUERY_CLAIM_DECOMPOSER_CONFIG_HASH_V1,
    ),
    wholeQuery: z.string().min(1).max(500),
    wholeQueryHash: HashSchema,
    claims: z
      .array(RetrievalSupportClaimV1Schema)
      .min(1)
      .max(
        QUERY_CLAIM_DECOMPOSER_CONFIG_V1
          .maximumSupportClaims,
      ),
    probes: z
      .array(RetrievalProbeV1Schema)
      .min(1)
      .max(QUERY_CLAIM_DECOMPOSER_CONFIG_V1.maximumProbes),
  })
  .strict()
  .superRefine((trace, context) => {
    if (
      trace.wholeQueryHash
      !== sha256StableJsonV2(trace.wholeQuery)
    ) {
      context.addIssue({
        code: "custom",
        path: ["wholeQueryHash"],
        message: "whole-query hash mismatch",
      });
    }
    const claimIds = trace.claims.map(({ claimId }) =>
      claimId);
    const probeIds = trace.probes.map(({ probeId }) =>
      probeId);
    if (new Set(claimIds).size !== claimIds.length) {
      context.addIssue({
        code: "custom",
        path: ["claims"],
        message: "claim ids must be unique",
      });
    }
    if (new Set(probeIds).size !== probeIds.length) {
      context.addIssue({
        code: "custom",
        path: ["probes"],
        message: "probe ids must be unique",
      });
    }
    const knownClaimIds = new Set(claimIds);
    if (
      trace.probes.some(({ claimIds: ids }) =>
        ids.some((claimId) => !knownClaimIds.has(claimId)))
    ) {
      context.addIssue({
        code: "custom",
        path: ["probes"],
        message: "probe claim binding must exist",
      });
    }
    const uniqueProbeTexts = new Set(
      trace.probes.map(({ text }) => text),
    );
    if (uniqueProbeTexts.size !== trace.probes.length) {
      context.addIssue({
        code: "custom",
        path: ["probes"],
        message: "probe texts must be unique",
      });
    }
  });

export type RetrievalSupportClaimV1 = z.infer<
  typeof RetrievalSupportClaimV1Schema
>;
export type QueryClaimDecompositionV1 = z.infer<
  typeof QueryClaimDecompositionV1Schema
>;

type Candidate = {
  text: string;
  startCodePoint: number;
  endCodePoint: number;
  sourceRule: "CLAUSE" | "CONJUNCT";
};

const CLAUSE_SEPARATOR_PATTERN = /[，,；;。！？?!]+/gu;
const CONJUNCTION_PATTERN =
  /(?:以及|并且|同时|还是|和|与|或|、|\/)/gu;
const EDGE_PUNCTUATION_PATTERN =
  /^[\s，,；;。！？?!、/：:（）()[\]【】"'“”‘’]+|[\s，,；;。！？?!、/：:（）()[\]【】"'“”‘’]+$/gu;
const LEADING_FUNCTION_WORD_PATTERN =
  /^(?:(?:那么|然后|并且|以及|同时|分别|各自|怎样|怎么|如何|为什么|是否|应该|还要)\s*)+/u;
const TRAILING_FUNCTION_WORD_PATTERN =
  /(?:呢|吗|嘛|吧)$/u;
const CONTENT_PATTERN = /[\p{L}\p{N}]/u;

function codePointLength(value: string) {
  return Array.from(value).length;
}

function codePointOffset(value: string, utf16Offset: number) {
  return codePointLength(value.slice(0, utf16Offset));
}

function cleanCandidateText(value: string) {
  return value
    .replace(EDGE_PUNCTUATION_PATTERN, "")
    .replace(LEADING_FUNCTION_WORD_PATTERN, "")
    .replace(TRAILING_FUNCTION_WORD_PATTERN, "")
    .trim();
}

function splitWithSpans(
  value: string,
  pattern: RegExp,
  baseCodePointOffset: number,
) {
  const output: Array<{
    text: string;
    startCodePoint: number;
    endCodePoint: number;
  }> = [];
  pattern.lastIndex = 0;
  let startUtf16 = 0;
  for (
    let match = pattern.exec(value);
    match !== null;
    match = pattern.exec(value)
  ) {
    const raw = value.slice(startUtf16, match.index);
    output.push({
      text: raw,
      startCodePoint:
        baseCodePointOffset
        + codePointOffset(value, startUtf16),
      endCodePoint:
        baseCodePointOffset
        + codePointOffset(value, match.index),
    });
    startUtf16 = match.index + match[0].length;
  }
  output.push({
    text: value.slice(startUtf16),
    startCodePoint:
      baseCodePointOffset
      + codePointOffset(value, startUtf16),
    endCodePoint:
      baseCodePointOffset + codePointLength(value),
  });
  return output;
}

function normalizeCandidate(
  candidate: Candidate,
): Candidate | null {
  const text = cleanCandidateText(candidate.text);
  const length = codePointLength(text);
  if (
    length
      < QUERY_CLAIM_DECOMPOSER_CONFIG_V1.minimumCodePoints
    || length
      > QUERY_CLAIM_DECOMPOSER_CONFIG_V1.maximumCodePoints
    || !CONTENT_PATTERN.test(text)
  ) {
    return null;
  }
  const rawCodePoints = Array.from(candidate.text);
  const cleanedCodePoints = Array.from(text);
  const first = rawCodePoints.findIndex(
    (_, index) =>
      rawCodePoints.slice(index).join("").startsWith(text),
  );
  const startShift = first < 0 ? 0 : first;
  return {
    ...candidate,
    text,
    startCodePoint: candidate.startCodePoint + startShift,
    endCodePoint:
      candidate.startCodePoint
      + startShift
      + cleanedCodePoints.length,
  };
}

function compareCandidates(left: Candidate, right: Candidate) {
  if (left.startCodePoint !== right.startCodePoint) {
    return left.startCodePoint - right.startCodePoint;
  }
  if (left.sourceRule !== right.sourceRule) {
    return left.sourceRule === "CONJUNCT" ? -1 : 1;
  }
  const lengthDifference =
    codePointLength(left.text) - codePointLength(right.text);
  if (lengthDifference !== 0) return lengthDifference;
  return left.text < right.text
    ? -1
    : left.text > right.text
      ? 1
      : 0;
}

export function decomposeRetrievalClaimsV1(
  normalizedTextInput: string,
): QueryClaimDecompositionV1 {
  const normalizedText = z.string().min(2).max(500)
    .parse(normalizedTextInput);
  if (
    normalizedText
    !== normalizeRetrievalTextV2(normalizedText)
  ) {
    throw new Error(
      "QUERY_CLAIM_DECOMPOSER_INPUT_NOT_NORMALIZED",
    );
  }

  const clauseParts = splitWithSpans(
    normalizedText,
    CLAUSE_SEPARATOR_PATTERN,
    0,
  );
  const candidates: Candidate[] = [];
  for (const clause of clauseParts) {
    const conjuncts = splitWithSpans(
      clause.text,
      CONJUNCTION_PATTERN,
      clause.startCodePoint,
    );
    const validConjuncts = conjuncts
      .map((conjunct) =>
        normalizeCandidate({
          ...conjunct,
          sourceRule: "CONJUNCT",
        }))
      .filter((value): value is Candidate =>
        value !== null);
    if (validConjuncts.length >= 2) {
      candidates.push(...validConjuncts);
    } else {
      candidates.push({
        ...clause,
        sourceRule: "CLAUSE",
      });
    }
  }

  const wholeComparable = cleanCandidateText(normalizedText);
  const unique = new Map<string, Candidate>();
  for (
    const candidate of candidates
      .map(normalizeCandidate)
      .filter((value): value is Candidate => value !== null)
      .sort(compareCandidates)
  ) {
    if (candidate.text === wholeComparable) continue;
    if (!unique.has(candidate.text)) {
      unique.set(candidate.text, candidate);
    }
  }
  const selected = [...unique.values()].slice(
    0,
    QUERY_CLAIM_DECOMPOSER_CONFIG_V1
      .maximumSupportClaims,
  );
  const fallback = selected.length === 0;
  const claims: RetrievalSupportClaimV1[] = (
    fallback
      ? [{
          text: normalizedText,
          startCodePoint: 0,
          endCodePoint: codePointLength(normalizedText),
          sourceRule: "WHOLE_FALLBACK" as const,
        }]
      : selected
  ).map((candidate, index) => ({
    claimId: `claim-${index + 1}`,
    text: candidate.text,
    textHash: sha256StableJsonV2(candidate.text),
    sourceRule: candidate.sourceRule,
    sourceSpan: {
      startCodePoint: candidate.startCodePoint,
      endCodePoint: candidate.endCodePoint,
    },
  }));

  const probes = fallback
    ? [{
        probeId: "probe-whole",
        kind: "WHOLE_QUERY" as const,
        text: normalizedText,
        textHash: sha256StableJsonV2(normalizedText),
        claimIds: [claims[0]!.claimId],
      }]
    : [
        {
          probeId: "probe-whole",
          kind: "WHOLE_QUERY" as const,
          text: normalizedText,
          textHash: sha256StableJsonV2(normalizedText),
          claimIds: [] as string[],
        },
        ...claims.map((claim, index) => ({
          probeId: `probe-claim-${index + 1}`,
          kind: "SUPPORT_CLAIM" as const,
          text: claim.text,
          textHash: claim.textHash,
          claimIds: [claim.claimId],
        })),
      ];

  return QueryClaimDecompositionV1Schema.parse({
    schemaVersion: 1,
    kind: "QUERY_CLAIM_DECOMPOSITION",
    decomposerId:
      QUERY_CLAIM_DECOMPOSER_CONFIG_V1.id,
    decomposerVersion:
      QUERY_CLAIM_DECOMPOSER_CONFIG_V1.version,
    configHash:
      QUERY_CLAIM_DECOMPOSER_CONFIG_HASH_V1,
    wholeQuery: normalizedText,
    wholeQueryHash: sha256StableJsonV2(normalizedText),
    claims,
    probes,
  });
}
