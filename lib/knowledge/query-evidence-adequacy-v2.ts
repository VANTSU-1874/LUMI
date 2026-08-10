import { createHash } from "node:crypto";

import { z } from "zod";

import { extractExplicitTechnicalAnchorsV2 } from "./capability-anchor-coverage-v2";
import {
  EVIDENCE_LIMITS_V2,
  EvidenceExpansionV2Schema,
  emptyEvidenceExpansionV2,
  type EvidenceExpansionV2,
} from "./evidence-bundle-v2";
import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeNodeV2,
  type KnowledgeObjectV2,
} from "./knowledge-object-v2";
import {
  FusedCandidateV2Schema,
  type FusedCandidateV2,
} from "./rank-fusion-v2";
import {
  RetrievalQueryV2Schema,
  type RetrievalQueryV2,
} from "./retrieval-query-v2";
import {
  ActionClassV2Schema,
  QueryEvidenceAdequacyIdentityV2Schema,
  QueryEvidenceAdequacyTraceV2Schema,
  QueryEvidenceObligationKindV2Schema,
  QueryEvidenceRetrievalAttestationV2Schema,
  TextualNodeKindV2Schema,
  type ActionClassV2,
  type QueryEvidenceAdequacyIdentityV2,
  type QueryEvidenceAdequacyTraceV2,
  type QueryEvidenceRetrievalAttestationV2,
} from "./query-evidence-adequacy-trace-v2";

export {
  ActionClassV2Schema,
  QueryEvidenceAdequacyIdentityV2Schema,
  QueryEvidenceAdequacyTraceV2Schema,
  QueryEvidenceObligationKindV2Schema,
  QueryEvidenceObligationV2Schema,
  QueryEvidencePrimaryBindingV2Schema,
  QueryEvidenceRetrievalAttestationV2Schema,
  TextualNodeKindV2Schema,
} from "./query-evidence-adequacy-trace-v2";
export type {
  ActionClassV2,
  QueryEvidenceAdequacyIdentityV2,
  QueryEvidenceAdequacyTraceV2,
  QueryEvidenceRetrievalAttestationV2,
} from "./query-evidence-adequacy-trace-v2";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);
const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

const ACTION_CLASSES = {
  CREATE: ["创建", "生成", "制作", "添加", "实现"],
  CONFIGURE: ["设置", "设定", "配置", "调整", "修改", "控制", "切换", "校准"],
  CONNECT: ["连接", "同步", "绑定", "对齐", "合并", "分组"],
  INSPECT: ["检查", "排查", "验证", "测量"],
  TRANSFER: ["导入", "导出", "转换", "输出", "应用"],
  COMPUTE: ["计算"],
  ORDER: ["重排", "选择", "拆分", "删除"],
  AUTHOR: ["编写"],
} as const;

const WRAPPER_TOKENS = [
  "我",
  "我们",
  "你",
  "你们",
  "帮我",
  "请",
  "想",
  "想要",
  "要",
  "需要",
  "应该",
  "可以",
  "能不能",
  "能否",
  "怎么",
  "如何",
  "具体",
  "一下",
  "先",
  "再",
  "还",
  "也",
  "都",
  "就",
  "把",
  "给",
  "用",
  "在",
  "里",
  "中",
  "的",
  "了",
  "吗",
  "呢",
  "吧",
  "呀",
  "让",
  "该",
  "这",
  "这个",
  "那",
  "那个",
  "到",
] as const;

const QUOTE_PAIRS = [
  { opener: "\"", closer: "\"" },
  { opener: "“", closer: "”" },
  { opener: "'", closer: "'" },
  { opener: "‘", closer: "’" },
  { opener: "`", closer: "`" },
] as const;

const CLAUSE_BOUNDARIES = new Set(Array.from("，。！？；：,.!?;:\r\n"));
const QUOTE_TRIM_PATTERN = /^[\s，。！？；：,.!?;:]+|[\s，。！？；：,.!?;:]+$/gu;
const HAN_ONLY_PATTERN = /^\p{Script=Han}+$/u;
const HAN_RUN_PATTERN = /\p{Script=Han}+/gu;
const MEANINGFUL_QUOTED_TERM_PATTERN = /[\p{Script=Han}A-Za-z0-9]/u;

export const QUERY_EVIDENCE_ADEQUACY_POLICY_V2 = Object.freeze({
  schemaVersion: 2,
  id: "lumi-local-explicit-obligation-gate-v2",
  version: "1.0.0",
  applicableMode: "TEXT_TO_TEXT",
  seedDecision: "ALL_OR_NOTHING_KEEP_OR_EMPTY",
  unicode: "NFKC",
  caseFold: "LOWERCASE",
  dashNormalization: "UNICODE_DASH_TO_ASCII_HYPHEN",
  latinAnchorWords: Object.freeze({ min: 1, max: 6 }),
  hanObjectSpanCharacters: Object.freeze({ min: 2, max: 8 }),
  operationWindowCharacters: 12,
  rarePhraseMaxObjectDf: 2,
  maxPrimarySeeds: EVIDENCE_LIMITS_V2.primary,
  maxObligations: 32,
  actionClasses: Object.freeze(
    Object.fromEntries(
      Object.entries(ACTION_CLASSES).map(([key, values]) => [
        key,
        Object.freeze([...values]),
      ]),
    ),
  ),
  wrapperTokens: Object.freeze([...WRAPPER_TOKENS]),
  quotePairs: Object.freeze(
    QUOTE_PAIRS.map((pair) => Object.freeze({ ...pair })),
  ),
  dfProjection: Object.freeze([
    "OBJECT_TITLE",
    "OBJECT_TAG",
    "DOCUMENT_TITLE",
    "SECTION_TITLE",
    "TEXT_TEXT",
    "TABLE_PLAIN_TEXT",
  ]),
  keepSupport: "VISIBLE_CANONICAL_PRIMARY_TEXT_ONLY",
  operationSupport: "SAME_PRIMARY_ACTION_CLASS_AND_OBJECT_EXACT",
  ambiguousExtraction: "KEEP",
  noHighConfidenceObligation: "KEEP",
} as const);

const ActionClassesSchema = z
  .record(
    ActionClassV2Schema,
    z.array(z.string().min(2).max(8)).min(1).max(16),
  )
  .superRefine((classes, context) => {
    const tokens = Object.values(classes).flat();
    if (new Set(tokens).size !== tokens.length) {
      context.addIssue({
        code: "custom",
        message: "adequacy action tokens must be globally unique",
      });
    }
  });

const QueryEvidenceAdequacyPolicyInputV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: IdSchema,
    version: SemverSchema,
    applicableMode: z.literal("TEXT_TO_TEXT"),
    seedDecision: z.literal("ALL_OR_NOTHING_KEEP_OR_EMPTY"),
    unicode: z.literal("NFKC"),
    caseFold: z.literal("LOWERCASE"),
    dashNormalization: z.literal("UNICODE_DASH_TO_ASCII_HYPHEN"),
    latinAnchorWords: z
      .object({
        min: z.literal(1),
        max: z.literal(6),
      })
      .strict(),
    hanObjectSpanCharacters: z
      .object({
        min: z.literal(2),
        max: z.literal(8),
      })
      .strict(),
    operationWindowCharacters: z.literal(12),
    rarePhraseMaxObjectDf: z.literal(2),
    maxPrimarySeeds: z.literal(EVIDENCE_LIMITS_V2.primary),
    maxObligations: z.literal(32),
    actionClasses: ActionClassesSchema,
    wrapperTokens: z.array(z.string().min(1).max(8)).min(1).max(64),
    quotePairs: z.array(z
      .object({
        opener: z.string().length(1),
        closer: z.string().length(1),
      })
      .strict()).length(5),
    dfProjection: z.tuple([
      z.literal("OBJECT_TITLE"),
      z.literal("OBJECT_TAG"),
      z.literal("DOCUMENT_TITLE"),
      z.literal("SECTION_TITLE"),
      z.literal("TEXT_TEXT"),
      z.literal("TABLE_PLAIN_TEXT"),
    ]),
    keepSupport: z.literal("VISIBLE_CANONICAL_PRIMARY_TEXT_ONLY"),
    operationSupport: z.literal(
      "SAME_PRIMARY_ACTION_CLASS_AND_OBJECT_EXACT",
    ),
    ambiguousExtraction: z.literal("KEEP"),
    noHighConfidenceObligation: z.literal("KEEP"),
  })
  .strict();

export const QueryEvidenceAdequacyPolicyV2Schema =
  QueryEvidenceAdequacyPolicyInputV2Schema
    .extend({ configHash: HashSchema })
    .strict();

export type QueryEvidenceAdequacyPolicyV2 = z.infer<
  typeof QueryEvidenceAdequacyPolicyV2Schema
>;

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export { sha256StableJsonV2 } from "./knowledge-object-v2";

const parsedPolicyInput =
  QueryEvidenceAdequacyPolicyInputV2Schema.parse(
    QUERY_EVIDENCE_ADEQUACY_POLICY_V2,
  );

export const DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2 =
  QueryEvidenceAdequacyPolicyV2Schema.parse({
    ...parsedPolicyInput,
    configHash: sha256StableJsonV2(parsedPolicyInput),
  });

export const QUERY_EVIDENCE_FEATURE_ALGORITHM_HASH_V2 =
  sha256StableJsonV2({
    normalization:
      "NFKC_DASH_CONTROL_WHITESPACE_LOWERCASE_CODE_POINT_OFFSETS",
    latinExtractor: "lumi-explicit-technical-anchor-v2@1.8.0",
    quoteScanner:
      "LEFT_TO_RIGHT_NON_NESTED_MATCHED_PAIR_UNCLOSED_IGNORED",
    actionScanner:
      "LONGEST_THEN_CODEPOINT_NON_OVERLAPPING_LEFT_TO_RIGHT",
    clauseWindow:
      "SAME_CLAUSE_NEAREST_HAN_RUN_BOTH_SIDES_MAX_12_CODEPOINTS",
    wrapperTrim: "REPEATED_WHOLE_TOKEN_BOTH_ENDS",
    sideDecision:
      "ONE_SIDE_OR_IDENTICAL_KEEP_DIFFERENT_SIDES_AMBIGUOUS",
    obligationOrder:
      "START_KIND_NORMALIZED_TEXT_FIRST_DEDUP",
    overflow: "AMBIGUOUS_KEEP_FIRST_32_FOR_TRACE",
    policyHash: DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2.configHash,
  });

export const PRIMARY_EVIDENCE_BINDING_ALGORITHM_HASH_V2 =
  sha256StableJsonV2({
    nodeKinds: TextualNodeKindV2Schema.options,
    relation: "PRIMARY",
    ownerBinding:
      "SEED_CANDIDATE_OBJECT_NODE_COURSE_CONTENT_HASH_CANONICAL_EXCERPT",
    visibleBudgetCharacters: EVIDENCE_LIMITS_V2.excerptCharacters,
    budgetOrder: "FUSED_RANK_THEN_CANDIDATE_ID",
    integrityFailure: "THROW",
  });

export const QueryEvidenceAdequacyRuntimeContextV2Schema = z
  .object({
    normalizerConfigHash: HashSchema,
    rrfConfigHash: HashSchema,
    acceptancePolicyHash: HashSchema,
    objectConsensusConfigHash: HashSchema,
    lexicalConfigHash: HashSchema,
    textProviderIndexBundleHash: HashSchema,
    textModelId: z.string().trim().min(1).max(300),
    textModelRevision: z.string().trim().min(1).max(300),
  })
  .strict();

export type QueryEvidenceAdequacyRuntimeContextV2 = z.infer<
  typeof QueryEvidenceAdequacyRuntimeContextV2Schema
>;

type TextualNodeV2 = Extract<
  KnowledgeNodeV2,
  { kind: "DOCUMENT" | "SECTION" | "TEXT" | "TABLE" }
>;

type CanonicalNodeOwnerV2 = {
  object: KnowledgeObjectV2;
  node: TextualNodeV2;
};

type CorpusStatsV2 = {
  objectDfByPack: Map<string, Map<string, number>>;
  hash: string;
};

export type QueryEvidenceAdequacyRuntimeV2 = {
  identity: QueryEvidenceAdequacyIdentityV2;
  policy: QueryEvidenceAdequacyPolicyV2;
  corpus: KnowledgeCorpusBundleV2;
  canonicalTextNodeById: ReadonlyMap<string, CanonicalNodeOwnerV2>;
  objectDfByPack: ReadonlyMap<string, ReadonlyMap<string, number>>;
};

function normalizeAdequacyText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("zh-CN");
}

function textForNode(node: TextualNodeV2) {
  switch (node.kind) {
    case "DOCUMENT":
    case "SECTION":
      return node.title;
    case "TEXT":
      return node.text;
    case "TABLE":
      return node.plainText;
  }
}

function objectProjectionTexts(object: KnowledgeObjectV2) {
  return [
    object.title,
    ...object.tags,
    ...object.nodes.flatMap((node) => {
      if (
        node.kind === "DOCUMENT"
        || node.kind === "SECTION"
        || node.kind === "TEXT"
        || node.kind === "TABLE"
      ) {
        return [textForNode(node)];
      }
      return [];
    }),
  ];
}

function hanGrams(value: string) {
  const grams = new Set<string>();
  for (const match of normalizeAdequacyText(value).matchAll(
    HAN_RUN_PATTERN,
  )) {
    const characters = Array.from(match[0]);
    for (let size = 2; size <= Math.min(8, characters.length); size += 1) {
      for (let start = 0; start <= characters.length - size; start += 1) {
        grams.add(characters.slice(start, start + size).join(""));
      }
    }
  }
  return grams;
}

function createCorpusStats(corpus: KnowledgeCorpusBundleV2): CorpusStatsV2 {
  const objectDfByPack = new Map<string, Map<string, number>>();
  for (const object of corpus.objects) {
    const packId = object.sourceCoursePack.id;
    const packDf = objectDfByPack.get(packId) ?? new Map<string, number>();
    const objectGrams = new Set<string>();
    for (const text of objectProjectionTexts(object)) {
      for (const gram of hanGrams(text)) objectGrams.add(gram);
    }
    for (const gram of objectGrams) {
      packDf.set(gram, (packDf.get(gram) ?? 0) + 1);
    }
    objectDfByPack.set(packId, packDf);
  }
  const stableStats = Array.from(objectDfByPack.entries())
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([coursePackId, frequencies]) => ({
      coursePackId,
      frequencies: Array.from(frequencies.entries())
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([phrase, objectDf]) => ({ phrase, objectDf })),
    }));
  return {
    objectDfByPack,
    hash: sha256StableJsonV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      projection:
        DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2.dfProjection,
      gramCharacters:
        DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2
          .hanObjectSpanCharacters,
      coursePacks: stableStats,
    }),
  };
}

export function createQueryEvidenceAdequacyRuntimeV2(input: {
  corpus: unknown;
  context: QueryEvidenceAdequacyRuntimeContextV2;
  policy?: QueryEvidenceAdequacyPolicyV2;
}): QueryEvidenceAdequacyRuntimeV2 {
  const corpus = verifyKnowledgeCorpusBundleV2(input.corpus);
  const context = QueryEvidenceAdequacyRuntimeContextV2Schema.parse(
    input.context,
  );
  const policy = QueryEvidenceAdequacyPolicyV2Schema.parse(
    input.policy ?? DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2,
  );
  const { configHash, ...policyInput } = policy;
  if (sha256StableJsonV2(policyInput) !== configHash) {
    throw new Error("QUERY_EVIDENCE_ADEQUACY_POLICY_HASH_MISMATCH");
  }
  const canonicalTextNodeById = new Map<
    string,
    CanonicalNodeOwnerV2
  >();
  for (const object of corpus.objects) {
    for (const node of object.nodes) {
      if (
        node.kind !== "DOCUMENT"
        && node.kind !== "SECTION"
        && node.kind !== "TEXT"
        && node.kind !== "TABLE"
      ) continue;
      if (canonicalTextNodeById.has(node.id)) {
        throw new Error(
          `QUERY_EVIDENCE_ADEQUACY_DUPLICATE_NODE:${node.id}`,
        );
      }
      canonicalTextNodeById.set(node.id, { object, node });
    }
  }
  const stats = createCorpusStats(corpus);
  const identity = QueryEvidenceAdequacyIdentityV2Schema.parse({
    corpusBundleHash: corpus.bundleHash,
    queryEvidenceAdequacyPolicyHash: policy.configHash,
    queryEvidenceFeatureAlgorithmHash:
      QUERY_EVIDENCE_FEATURE_ALGORITHM_HASH_V2,
    queryAnchorCorpusStatsHash: stats.hash,
    primaryEvidenceBindingAlgorithmHash:
      PRIMARY_EVIDENCE_BINDING_ALGORITHM_HASH_V2,
    ...context,
  });
  return {
    identity,
    policy,
    corpus,
    canonicalTextNodeById,
    objectDfByPack: stats.objectDfByPack,
  };
}

type DraftObligationV2 = {
  kind: z.infer<typeof QueryEvidenceObligationKindV2Schema>;
  normalizedText: string;
  start: number;
  end: number;
  actionClass: ActionClassV2 | null;
  objectDf: number | null;
};

type ActionMatchV2 = {
  start: number;
  end: number;
  token: string;
  actionClass: ActionClassV2;
};

function codePointLength(value: string) {
  return Array.from(value).length;
}

function codePointOffset(value: string, codeUnitOffset: number) {
  return Array.from(value.slice(0, codeUnitOffset)).length;
}

function actionTokens() {
  return Object.entries(ACTION_CLASSES)
    .flatMap(([actionClass, tokens]) =>
      tokens.map((token) => ({
        actionClass: ActionClassV2Schema.parse(actionClass),
        token,
      })))
    .sort((left, right) =>
      codePointLength(right.token) - codePointLength(left.token)
      || compareCodePoints(left.token, right.token));
}

const ORDERED_ACTION_TOKENS = actionTokens();
const ORDERED_WRAPPERS = [...WRAPPER_TOKENS].sort((left, right) =>
  codePointLength(right) - codePointLength(left)
  || compareCodePoints(left, right));

function selectActionMatches(normalizedQuery: string) {
  const matches: ActionMatchV2[] = [];
  let codeUnitOffset = 0;
  while (codeUnitOffset < normalizedQuery.length) {
    const winner = ORDERED_ACTION_TOKENS.find(({ token }) =>
      normalizedQuery.startsWith(token, codeUnitOffset));
    if (winner) {
      const start = codePointOffset(normalizedQuery, codeUnitOffset);
      const end = start + codePointLength(winner.token);
      matches.push({
        start,
        end,
        token: winner.token,
        actionClass: winner.actionClass,
      });
      codeUnitOffset += winner.token.length;
      continue;
    }
    const point = normalizedQuery.codePointAt(codeUnitOffset);
    codeUnitOffset += point !== undefined && point > 0xffff ? 2 : 1;
  }
  return matches;
}

function stripWrappers(value: string) {
  let current = value;
  let changed = true;
  while (changed && current.length > 0) {
    changed = false;
    for (const wrapper of ORDERED_WRAPPERS) {
      if (current.startsWith(wrapper)) {
        current = current.slice(wrapper.length);
        changed = true;
        break;
      }
      if (current.endsWith(wrapper)) {
        current = current.slice(0, -wrapper.length);
        changed = true;
        break;
      }
    }
  }
  return current;
}

function lastClauseBoundary(
  characters: readonly string[],
  before: number,
) {
  for (let index = before - 1; index >= 0; index -= 1) {
    if (CLAUSE_BOUNDARIES.has(characters[index]!)) return index + 1;
  }
  return 0;
}

function nextClauseBoundary(
  characters: readonly string[],
  after: number,
) {
  for (let index = after; index < characters.length; index += 1) {
    if (CLAUSE_BOUNDARIES.has(characters[index]!)) return index;
  }
  return characters.length;
}

function nearestHanRun(
  value: string,
  side: "LEFT" | "RIGHT",
) {
  const runs = [...value.matchAll(HAN_RUN_PATTERN)];
  const run = side === "LEFT" ? runs.at(-1) : runs[0];
  return run?.[0] ?? null;
}

function normalizedOperationCandidate(value: string | null) {
  if (value === null) return null;
  const candidate = stripWrappers(value);
  const length = codePointLength(candidate);
  if (
    length
      < DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2
        .hanObjectSpanCharacters.min
    || length
      > DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2
        .hanObjectSpanCharacters.max
    || !HAN_ONLY_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function nearestCandidateStart(input: {
  characters: readonly string[];
  candidate: string;
  action: ActionMatchV2;
  leftBoundary: number;
  rightBoundary: number;
}) {
  const candidateCharacters = Array.from(input.candidate);
  let best:
    | {
        start: number;
        distance: number;
      }
    | null = null;
  const lastStart = input.rightBoundary - candidateCharacters.length;
  for (
    let start = input.leftBoundary;
    start <= lastStart;
    start += 1
  ) {
    if (
      candidateCharacters.some(
        (character, offset) =>
          input.characters[start + offset] !== character,
      )
    ) {
      continue;
    }
    const end = start + candidateCharacters.length;
    const distance =
      end <= input.action.start
        ? input.action.start - end
        : start >= input.action.end
          ? start - input.action.end
          : 0;
    if (
      best === null
      || distance < best.distance
      || (distance === best.distance && start < best.start)
    ) {
      best = { start, distance };
    }
  }
  return best?.start ?? input.action.start;
}

function operationObligations(input: {
  normalizedQuery: string;
  objectDf: ReadonlyMap<string, number>;
}) {
  const characters = Array.from(input.normalizedQuery);
  const matches = selectActionMatches(input.normalizedQuery);
  const obligations: DraftObligationV2[] = [];
  let ambiguous = false;
  for (const [index, match] of matches.entries()) {
    const previousActionEnd = matches[index - 1]?.end ?? 0;
    const nextActionStart = matches[index + 1]?.start
      ?? characters.length;
    const leftBoundary = Math.max(
      previousActionEnd,
      lastClauseBoundary(characters, match.start),
      match.start
        - DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2
          .operationWindowCharacters,
    );
    const rightBoundary = Math.min(
      nextActionStart,
      nextClauseBoundary(characters, match.end),
      match.end
        + DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2
          .operationWindowCharacters,
    );
    const left = normalizedOperationCandidate(nearestHanRun(
      characters.slice(leftBoundary, match.start).join(""),
      "LEFT",
    ));
    const right = normalizedOperationCandidate(nearestHanRun(
      characters.slice(match.end, rightBoundary).join(""),
      "RIGHT",
    ));
    const candidates = [...new Set([left, right].filter(
      (value): value is string => value !== null,
    ))].filter((value) =>
      (input.objectDf.get(value) ?? 0)
        <= DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2
          .rarePhraseMaxObjectDf);
    if (candidates.length > 1) {
      ambiguous = true;
      continue;
    }
    const candidate = candidates[0];
    if (!candidate) continue;
    const start = nearestCandidateStart({
      characters,
      candidate,
      action: match,
      leftBoundary,
      rightBoundary,
    });
    obligations.push({
      kind: "OPERATION_OBJECT",
      normalizedText: candidate,
      start,
      end: start + codePointLength(candidate),
      actionClass: match.actionClass,
      objectDf: input.objectDf.get(candidate) ?? 0,
    });
  }
  return { obligations, ambiguous };
}

function quotedObligations(normalizedQuery: string) {
  const characters = Array.from(normalizedQuery);
  const pairs = new Map<string, string>(
    QUOTE_PAIRS.map(({ opener, closer }) => [opener, closer]),
  );
  const obligations: DraftObligationV2[] = [];
  let index = 0;
  while (index < characters.length) {
    const opener = characters[index]!;
    const closer = pairs.get(opener);
    if (!closer) {
      index += 1;
      continue;
    }
    let closeIndex = index + 1;
    while (
      closeIndex < characters.length
      && characters[closeIndex] !== closer
    ) {
      closeIndex += 1;
    }
    if (closeIndex >= characters.length) {
      index += 1;
      continue;
    }
    const normalizedText = characters
      .slice(index + 1, closeIndex)
      .join("")
      .replace(QUOTE_TRIM_PATTERN, "");
    const length = codePointLength(normalizedText);
    if (
      length >= 2
      && length <= 80
      && MEANINGFUL_QUOTED_TERM_PATTERN.test(normalizedText)
    ) {
      obligations.push({
        kind: "QUOTED_TERM",
        normalizedText,
        start: index + 1,
        end: closeIndex,
        actionClass: null,
        objectDf: null,
      });
    }
    index = closeIndex + 1;
  }
  return obligations;
}

function latinObligations(
  sourceQuery: string,
  normalizedQuery: string,
) {
  return extractExplicitTechnicalAnchorsV2(sourceQuery).map(
    (normalizedText): DraftObligationV2 => {
      const codeUnitOffset = normalizedQuery.indexOf(normalizedText);
      const start = codeUnitOffset < 0
        ? 0
        : codePointOffset(normalizedQuery, codeUnitOffset);
      return {
        kind: "LATIN_TECHNICAL",
        normalizedText,
        start,
        end: start + codePointLength(normalizedText),
        actionClass: null,
        objectDf: null,
      };
    },
  );
}

function extractObligations(input: {
  queryText: string;
  objectDf: ReadonlyMap<string, number>;
}) {
  const normalizedQuery = normalizeAdequacyText(input.queryText);
  const operation = operationObligations({
    normalizedQuery,
    objectDf: input.objectDf,
  });
  const ordered = [
    ...latinObligations(input.queryText, normalizedQuery),
    ...quotedObligations(normalizedQuery),
    ...operation.obligations,
  ].sort((left, right) =>
    left.start - right.start
    || compareCodePoints(left.kind, right.kind)
    || compareCodePoints(left.normalizedText, right.normalizedText));
  const unique = new Map<string, DraftObligationV2>();
  for (const obligation of ordered) {
    const key = [
      obligation.kind,
      obligation.normalizedText,
      obligation.actionClass ?? "",
    ].join("\u0000");
    if (!unique.has(key)) unique.set(key, obligation);
  }
  const all = [...unique.values()];
  const overflow =
    all.length
      > DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2.maxObligations;
  return {
    normalizedQuery,
    obligations: all.slice(
      0,
      DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2.maxObligations,
    ),
    ambiguous: operation.ambiguous || overflow,
    overflow,
  };
}

function bindCanonicalPrimaries(input: {
  runtime: QueryEvidenceAdequacyRuntimeV2;
  query: RetrievalQueryV2;
  seeds: readonly FusedCandidateV2[];
  expansion: EvidenceExpansionV2;
}) {
  const sourceCoursePack = input.query.scope.sourceCoursePack;
  if (!sourceCoursePack) {
    throw new Error("QUERY_EVIDENCE_ADEQUACY_SCOPE_REQUIRED");
  }
  let remainingCharacters = EVIDENCE_LIMITS_V2.excerptCharacters;
  return input.seeds.map((seed) => {
    const owners = input.expansion.nodes.filter((node) =>
      node.relation === "PRIMARY"
      && node.seedCandidateId === seed.candidateId
      && node.objectId === seed.objectId);
    if (owners.length !== 1) {
      throw new Error(
        "QUERY_EVIDENCE_ADEQUACY_PRIMARY_BINDING_INVALID",
      );
    }
    const primary = owners[0]!;
    const canonical = input.runtime.canonicalTextNodeById.get(
      primary.nodeId,
    );
    if (
      !canonical
      || canonical.object.id !== seed.objectId
      || canonical.node.id !== seed.candidateId
      || canonical.object.sourceCoursePack.id !== sourceCoursePack.id
      || canonical.object.sourceCoursePack.version
        !== sourceCoursePack.version
      || primary.sourceCoursePack.id !== sourceCoursePack.id
      || primary.sourceCoursePack.version !== sourceCoursePack.version
    ) {
      throw new Error(
        "QUERY_EVIDENCE_ADEQUACY_PRIMARY_BINDING_INVALID",
      );
    }
    const canonicalText = textForNode(canonical.node);
    if (primary.excerpt !== canonicalText) {
      throw new Error(
        "QUERY_EVIDENCE_ADEQUACY_PRIMARY_EXCERPT_INVALID",
      );
    }
    const visibleText = canonicalText.slice(0, remainingCharacters);
    remainingCharacters -= visibleText.length;
    return {
      seedCandidateId: seed.candidateId,
      objectId: canonical.object.id,
      nodeId: canonical.node.id,
      nodeKind: canonical.node.kind,
      contentHash: canonical.node.contentHash,
      sourceId: primary.sourceId,
      sourceCoursePack: canonical.object.sourceCoursePack,
      canonicalCharacters: canonicalText.length,
      visibleCharacters: visibleText.length,
      visibleTextHash: createHash("sha256")
        .update(visibleText)
        .digest("hex"),
      normalizedVisibleText: normalizeAdequacyText(visibleText),
    };
  });
}

function supportedPrimaryNodeIds(
  obligation: DraftObligationV2,
  bindings: readonly ReturnType<typeof bindCanonicalPrimaries>[number][],
) {
  return bindings
    .filter((binding) => {
      const text = binding.normalizedVisibleText;
      if (!text.includes(obligation.normalizedText)) return false;
      if (
        obligation.kind !== "OPERATION_OBJECT"
        || obligation.actionClass === null
      ) {
        return true;
      }
      return ACTION_CLASSES[obligation.actionClass].some((action) =>
        text.includes(action));
    })
    .map(({ nodeId }) => nodeId)
    .sort(compareCodePoints);
}

export function applyQueryEvidenceAdequacyV2(input: {
  runtime: QueryEvidenceAdequacyRuntimeV2;
  query: RetrievalQueryV2;
  seeds: readonly FusedCandidateV2[];
  expansion: EvidenceExpansionV2;
  retrievalAttestation: QueryEvidenceRetrievalAttestationV2;
  signal?: AbortSignal;
}): {
  seeds: FusedCandidateV2[];
  expansion: EvidenceExpansionV2;
  trace: QueryEvidenceAdequacyTraceV2;
} {
  input.signal?.throwIfAborted();
  const query = RetrievalQueryV2Schema.parse(input.query);
  if (
    query.mode !== "TEXT_TO_TEXT"
    || query.scope.sourceCoursePack === null
  ) {
    throw new Error("QUERY_EVIDENCE_ADEQUACY_INAPPLICABLE_QUERY");
  }
  if (query.scope.corpusBundleHash !== input.runtime.corpus.bundleHash) {
    throw new Error("QUERY_EVIDENCE_ADEQUACY_CORPUS_MISMATCH");
  }
  const seeds = z.array(FusedCandidateV2Schema)
    .min(1)
    .max(EVIDENCE_LIMITS_V2.primary)
    .parse(input.seeds);
  if (seeds.some(({ fusedRank }, index) => fusedRank !== index + 1)) {
    throw new Error("QUERY_EVIDENCE_ADEQUACY_SEED_ORDER_INVALID");
  }
  const expansion = EvidenceExpansionV2Schema.parse(input.expansion);
  const retrievalAttestation =
    QueryEvidenceRetrievalAttestationV2Schema.parse(
      input.retrievalAttestation,
    );
  const preGateSeedsHash = sha256StableJsonV2(seeds);
  if (retrievalAttestation.finalSeedsHash !== preGateSeedsHash) {
    throw new Error(
      "QUERY_EVIDENCE_ADEQUACY_SEED_ATTESTATION_MISMATCH",
    );
  }
  const bindings = bindCanonicalPrimaries({
    runtime: input.runtime,
    query,
    seeds,
    expansion,
  });
  const packDf = input.runtime.objectDfByPack.get(
    query.scope.sourceCoursePack.id,
  );
  if (!packDf) {
    throw new Error("QUERY_EVIDENCE_ADEQUACY_PACK_STATS_MISSING");
  }
  const extracted = extractObligations({
    queryText: query.originalText,
    objectDf: packDf,
  });
  const obligations = extracted.obligations.map((obligation) => ({
    ...obligation,
    supportedPrimaryNodeIds: supportedPrimaryNodeIds(
      obligation,
      bindings,
    ),
  }));
  const unsupportedObligationCount = obligations.filter(
    ({ supportedPrimaryNodeIds: supported }) => supported.length === 0,
  ).length;
  const reason = extracted.ambiguous
    ? "AMBIGUOUS_EXTRACTION" as const
    : obligations.length === 0
      ? "NO_HIGH_CONFIDENCE_OBLIGATION" as const
      : unsupportedObligationCount > 0
        ? "UNSUPPORTED_EXPLICIT_OBLIGATION" as const
        : "ALL_OBLIGATIONS_SUPPORTED" as const;
  const decision = reason === "UNSUPPORTED_EXPLICIT_OBLIGATION"
    ? "EMPTY" as const
    : "KEEP" as const;
  const postGateSeeds = decision === "KEEP" ? structuredClone(seeds) : [];
  const trace = QueryEvidenceAdequacyTraceV2Schema.parse({
    schemaVersion: 2,
    decision,
    reason,
    sourceCoursePack: query.scope.sourceCoursePack,
    normalizedQueryHash: createHash("sha256")
      .update(extracted.normalizedQuery)
      .digest("hex"),
    identity: input.runtime.identity,
    retrievalAttestation,
    preGateSeeds: structuredClone(seeds),
    postGateSeeds,
    preGateSeedsHash,
    postGateSeedsHash: sha256StableJsonV2(postGateSeeds),
    primaryBindings: bindings.map(
      ({ normalizedVisibleText: _normalizedVisibleText, ...binding }) =>
        binding,
    ),
    obligations,
    ambiguousExtraction: extracted.ambiguous,
    extractionOverflow: extracted.overflow,
    unsupportedObligationCount,
  });
  input.signal?.throwIfAborted();
  return {
    seeds: structuredClone(postGateSeeds),
    expansion: decision === "KEEP"
      ? structuredClone(expansion)
      : emptyEvidenceExpansionV2(),
    trace,
  };
}

export function verifyQueryEvidenceAdequacyTraceV2(
  input: QueryEvidenceAdequacyTraceV2,
) {
  return QueryEvidenceAdequacyTraceV2Schema.parse(input);
}
