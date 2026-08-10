import { createHash } from "node:crypto";

import { z } from "zod";

import {
  AnswerIntentV1Schema,
  AnswerObligationSetV1Schema,
  answerObligationSetHashV1,
  type AnswerIntentV1,
  type AnswerObligationSetV1,
} from "./answer-obligation-v1";
import {
  sha256StableJsonV2,
} from "./knowledge-object-v2";
import { normalizeRetrievalTextV2 } from "./retrieval-query-v2";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const ObligationIdSchema = z.string().regex(/^obligation-[1-4]$/);

export const MODEL_GUIDED_RETRIEVAL_LIMITS_V1 =
  Object.freeze({
    maximumObligations: 4,
    maximumQueriesPerObligation: 2,
    maximumPhysicalQueries: 5,
    maximumCandidateObjects: 16,
    maximumSelectedNodes: 8,
    rrfK: 60,
    minimumObligationConfidence: 0.70,
  });

export const GraphRelationTypeV1Schema = z.enum([
  "CAUSED_BY",
  "FIRST_ACTION",
  "PREREQUISITE_OF",
  "PART_OF",
  "APPLIES_TO_TOOL",
  "CHECK_WITH",
  "EVIDENCE_FOR",
  "NOT_SUFFICIENT_FOR",
  "MITIGATES",
  "TRADEOFF_WITH",
]);

export type GraphRelationTypeV1 = z.infer<
  typeof GraphRelationTypeV1Schema
>;

export const RELATION_ALLOWLIST_BY_INTENT_V1 = {
  DIAGNOSE_CAUSE: ["CAUSED_BY"],
  FIRST_ACTION: [
    "FIRST_ACTION",
    "PREREQUISITE_OF",
  ],
  HOW_TO: [
    "PART_OF",
    "PREREQUISITE_OF",
    "APPLIES_TO_TOOL",
  ],
  CHECK_CRITERIA: ["CHECK_WITH", "EVIDENCE_FOR"],
  EVIDENCE_FOR: [
    "EVIDENCE_FOR",
    "NOT_SUFFICIENT_FOR",
  ],
  RISK_MITIGATION: [
    "MITIGATES",
    "NOT_SUFFICIENT_FOR",
  ],
  COMPARE_TRADEOFF: ["TRADEOFF_WITH"],
  EXPLAIN_CONCEPT: [],
  VERIFY_FACT: [],
} as const satisfies Record<
  AnswerIntentV1,
  readonly GraphRelationTypeV1[]
>;

const RetrievalModalityV1Schema = z.enum([
  "TEXT",
  "IMAGE",
]);

const DirectEvidenceQueryV1Schema = z
  .object({
    obligationId: ObligationIdSchema,
    query: z.string().min(1).max(500),
    modalities: z.array(RetrievalModalityV1Schema)
      .min(1)
      .max(2),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      new Set(query.modalities).size
      !== query.modalities.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["modalities"],
        message: "retrieval modalities must be unique",
      });
    }
  });

const RelationIntentHintV1Schema = z
  .object({
    obligationId: ObligationIdSchema,
    entityMentions: z.array(
      z.string().trim().min(1).max(200),
    ).max(8),
    allowedRelationTypes: z.array(
      GraphRelationTypeV1Schema,
    ).max(3),
  })
  .strict();

export const RetrievalPlanV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    obligationSetHash: HashSchema,
    directEvidenceQueries: z.array(
      DirectEvidenceQueryV1Schema,
    ).max(8),
    relationIntentHints: z.array(
      RelationIntentHintV1Schema,
    ).min(1).max(4),
  })
  .strict();

export const CompiledDirectQueryV1Schema = z
  .object({
    queryId: z.string().regex(/^query-[0-9a-f]{16}$/),
    normalizedText: z.string().min(1).max(500),
    source: z.enum(["WHOLE_QUERY", "OBLIGATION"]),
    obligationIds: z.array(ObligationIdSchema).max(4),
    modalities: z.array(RetrievalModalityV1Schema)
      .min(1).max(2),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      new Set(query.obligationIds).size
      !== query.obligationIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["obligationIds"],
        message: "physical query obligation bindings must be unique",
      });
    }
    if (
      new Set(query.modalities).size
      !== query.modalities.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["modalities"],
        message: "physical query modalities must be unique",
      });
    }
  });

export type RetrievalModalityV1 = z.infer<
  typeof RetrievalModalityV1Schema
>;
export type RetrievalPlanV1 = z.infer<
  typeof RetrievalPlanV1Schema
>;
export type CompiledDirectQueryV1 = z.infer<
  typeof CompiledDirectQueryV1Schema
>;

export type CompiledRetrievalPlanV1 = {
  plan: RetrievalPlanV1;
  physicalQueries: CompiledDirectQueryV1[];
  configHash: string;
  planHash: string;
};

const RETRIEVAL_PLAN_CONFIG_MATERIAL_V1 = {
  schemaVersion: 1,
  limits: MODEL_GUIDED_RETRIEVAL_LIMITS_V1,
  relationAllowlist: RELATION_ALLOWLIST_BY_INTENT_V1,
  queryBudgetOrder: [
    "WHOLE_QUERY",
    "FIRST_QUERY_PER_OBLIGATION",
    "SECOND_QUERY_PER_OBLIGATION",
  ],
  duplicatePolicy:
    "NORMALIZED_TEXT_SINGLE_EXECUTION_ALL_BINDINGS",
  imageSemantics: "TEXT_TO_IMAGE_EVIDENCE_TARGET",
  clarifyPolicy:
    "WHOLE_QUERY_BASELINE_ONLY_POST_RETRIEVAL_DECISION",
} as const;

export const RETRIEVAL_PLAN_CONFIG_HASH_V1 =
  sha256StableJsonV2(
    RETRIEVAL_PLAN_CONFIG_MATERIAL_V1,
  );

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function modalitiesFor(
  evidenceNeeds: readonly string[],
): RetrievalModalityV1[] {
  const modalities: RetrievalModalityV1[] = [];
  if (
    evidenceNeeds.includes("DIRECT_TEXT")
    || evidenceNeeds.includes("RELATION_PATH")
  ) {
    modalities.push("TEXT");
  }
  if (evidenceNeeds.includes("VISUAL_EXAMPLE")) {
    modalities.push("IMAGE");
  }
  return modalities.length > 0 ? modalities : ["TEXT"];
}

function mergeModalities(
  left: readonly RetrievalModalityV1[],
  right: readonly RetrievalModalityV1[],
) {
  const values = new Set([...left, ...right]);
  return (["TEXT", "IMAGE"] as const).filter(
    (modality) => values.has(modality),
  );
}

function mergeObligationIds(
  left: readonly string[],
  right: string,
) {
  return left.includes(right)
    ? [...left]
    : [...left, right].sort(
        (a, b) => a.localeCompare(b, "en"),
      );
}

function queryId(normalizedText: string) {
  return `query-${sha256(normalizedText).slice(0, 16)}`;
}

export function retrievalPlanHashV1(
  value: RetrievalPlanV1,
) {
  return sha256StableJsonV2(
    RetrievalPlanV1Schema.parse(value),
  );
}

export function compileRetrievalPlanV1(
  input: AnswerObligationSetV1,
): CompiledRetrievalPlanV1 {
  const obligationSet =
    AnswerObligationSetV1Schema.parse(input);
  const directEvidenceQueries: z.infer<
    typeof DirectEvidenceQueryV1Schema
  >[] = [];
  const wholeModalities = mergeModalities(
    ["TEXT"],
    obligationSet.obligations.flatMap(
      ({ evidenceNeeds }) =>
        evidenceNeeds.includes("VISUAL_EXAMPLE")
          ? ["IMAGE" as const]
          : [],
    ),
  );
  const physicalByText = new Map<
    string,
    CompiledDirectQueryV1
  >();
  physicalByText.set(obligationSet.normalizedQuestion, {
    queryId: queryId(obligationSet.normalizedQuestion),
    normalizedText: obligationSet.normalizedQuestion,
    source: "WHOLE_QUERY",
    obligationIds: [],
    modalities: wholeModalities,
  });

  const addBinding = (input: {
    obligationId: string;
    text: string;
    modalities: RetrievalModalityV1[];
  }) => {
    const normalizedText = normalizeRetrievalTextV2(
      input.text,
    );
    const existing = physicalByText.get(normalizedText);
    if (existing) {
      physicalByText.set(normalizedText, {
        ...existing,
        obligationIds: mergeObligationIds(
          existing.obligationIds,
          input.obligationId,
        ),
        modalities: mergeModalities(
          existing.modalities,
          input.modalities,
        ),
      });
      return true;
    }
    if (
      physicalByText.size
      >= MODEL_GUIDED_RETRIEVAL_LIMITS_V1
        .maximumPhysicalQueries
    ) {
      return false;
    }
    physicalByText.set(normalizedText, {
      queryId: queryId(normalizedText),
      normalizedText,
      source: "OBLIGATION",
      obligationIds: [input.obligationId],
      modalities: input.modalities,
    });
    return true;
  };

  if (obligationSet.status === "READY") {
    for (const obligation of obligationSet.obligations) {
      const query = obligation.retrievalQueries[0]!;
      const modalities = modalitiesFor(
        obligation.evidenceNeeds,
      );
      if (!addBinding({
        obligationId: obligation.obligationId,
        text: query.text,
        modalities,
      })) {
        throw new Error(
          "RETRIEVAL_PLAN_FIRST_QUERY_BUDGET_EXHAUSTED",
        );
      }
      directEvidenceQueries.push({
        obligationId: obligation.obligationId,
        query: normalizeRetrievalTextV2(query.text),
        modalities,
      });
    }
    for (const obligation of obligationSet.obligations) {
      const query = obligation.retrievalQueries[1];
      if (!query) continue;
      const modalities = modalitiesFor(
        obligation.evidenceNeeds,
      );
      if (!addBinding({
        obligationId: obligation.obligationId,
        text: query.text,
        modalities,
      })) {
        continue;
      }
      directEvidenceQueries.push({
        obligationId: obligation.obligationId,
        query: normalizeRetrievalTextV2(query.text),
        modalities,
      });
    }
  }

  const plan = RetrievalPlanV1Schema.parse({
    schemaVersion: 1,
    obligationSetHash:
      answerObligationSetHashV1(obligationSet),
    directEvidenceQueries,
    relationIntentHints:
      obligationSet.obligations.map((obligation) => ({
        obligationId: obligation.obligationId,
        entityMentions: Array.from(new Set(
          obligation.entityMentions.map(
            ({ normalized }) => normalized,
          ),
        )),
        allowedRelationTypes: [
          ...RELATION_ALLOWLIST_BY_INTENT_V1[
            AnswerIntentV1Schema.parse(obligation.intent)
          ],
        ],
      })),
  });
  const physicalQueries = [...physicalByText.values()]
    .map((query) =>
      CompiledDirectQueryV1Schema.parse(query));
  if (
    physicalQueries.length
    > MODEL_GUIDED_RETRIEVAL_LIMITS_V1
      .maximumPhysicalQueries
  ) {
    throw new Error(
      "RETRIEVAL_PLAN_PHYSICAL_QUERY_LIMIT_EXCEEDED",
    );
  }
  return {
    plan,
    physicalQueries,
    configHash: RETRIEVAL_PLAN_CONFIG_HASH_V1,
    planHash: retrievalPlanHashV1(plan),
  };
}
