import { z } from "zod";

import {
  sha256StableJsonV2,
} from "../../lib/knowledge/knowledge-object-v2";

const IdSchema = z.string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const SelectionSchema = z.object({
  nodeId: IdSchema,
  evidenceRole: z.enum([
    "DIRECT",
    "COMPLEMENT",
    "CONTEXT",
  ]),
}).passthrough();

export const T45_ANSWER_EVIDENCE_PROJECTION_CONFIG_V1 =
  Object.freeze({
    id: "lumi-t45-answer-evidence-projection-v1",
    version: "1.0.0",
    answerEvidenceRole: "DIRECT",
    supplementalEvidenceRoles: [
      "COMPLEMENT",
      "CONTEXT",
    ],
    topK: 8,
    answerEvidencePolicy:
      "DIRECT_ONLY_VARIABLE_COUNT_TOP_K_IS_MAXIMUM",
    supplementalEvidencePolicy:
      "PRESERVE_SEPARATELY_NOT_ELIGIBLE_FOR_ANSWER_CITATION_OR_HARD_NEGATIVE_SELECTION_SCORE",
    graphifyPolicy: "NOT_USED",
  } as const);

export const T45_ANSWER_EVIDENCE_PROJECTION_CONFIG_HASH_V1 =
  sha256StableJsonV2(
    T45_ANSWER_EVIDENCE_PROJECTION_CONFIG_V1,
  );

export function projectT45AnswerEvidenceV1<
  T extends {
    nodeId: string;
    evidenceRole:
      | "DIRECT"
      | "COMPLEMENT"
      | "CONTEXT";
  },
>(
  rawSelected: readonly T[],
) {
  const selected = rawSelected.map((entry) => {
    SelectionSchema.parse(entry);
    return entry;
  });
  if (
    selected.length < 1
    || selected.length
      > T45_ANSWER_EVIDENCE_PROJECTION_CONFIG_V1
        .topK
    || new Set(selected.map(({ nodeId }) => nodeId))
      .size !== selected.length
  ) {
    throw new Error(
      "T45_ANSWER_EVIDENCE_PROJECTION_INPUT_INVALID",
    );
  }
  const answerEvidence = selected.filter(
    ({ evidenceRole }) =>
      evidenceRole === "DIRECT",
  );
  const supplementalEvidence = selected.filter(
    ({ evidenceRole }) =>
      evidenceRole !== "DIRECT",
  );
  if (answerEvidence.length < 1) {
    throw new Error(
      "T45_ANSWER_EVIDENCE_PROJECTION_DIRECT_EMPTY",
    );
  }
  return Object.freeze({
    answerEvidence: Object.freeze(
      answerEvidence.map((entry) =>
        Object.freeze({ ...entry })),
    ),
    supplementalEvidence: Object.freeze(
      supplementalEvidence.map((entry) =>
        Object.freeze({ ...entry })),
    ),
  });
}
