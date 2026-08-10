import { z } from "zod";

import { LearningEpisodeSchema } from "@/lib/course-packs/contract";
import { StudentMemoryCandidateSchema } from "@/lib/domain/student-memory";

import { AgentActionTypeSchema, AgentResponseStrategySchema } from "../contracts";
import { ProjectBriefPatchSchema } from "../project-brief-memory";
import {
  CRITIQUE_FRAMEWORK_ID,
  CRITIQUE_FRAMEWORK_VERSION,
  CritiqueDimensionsSchema,
} from "../critique-contract";
import { getCritiqueFramework } from "../critique-framework";
import { matchTutorSidecar } from "../tutor-sidecar-marker";

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

const TutorSidecarMetadataSchema = z.object({
  episode: nullable(LearningEpisodeSchema),
  decisionCode: nullable(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/)),
  responseStrategy: nullable(AgentResponseStrategySchema),
  sourceIds: nullable(z.array(z.string().trim().min(1).max(160)).max(8)),
  actionType: nullable(AgentActionTypeSchema),
  title: nullable(z.string().trim().min(1).max(100)),
  whyThisStep: nullable(z.string().trim().min(1).max(500)),
  uncertainty: nullable(z.string().trim().min(1).max(500)),
  briefPatch: nullable(ProjectBriefPatchSchema),
}).strict();

export type TutorSidecar = z.infer<typeof TutorSidecarMetadataSchema> & {
  memoryCandidates?: Array<z.infer<typeof StudentMemoryCandidateSchema>>;
  critique?: TutorCritiqueDraft;
};
export type TutorSidecarStatus = "ABSENT" | "PARSED" | "INVALID";
export type TutorCritiqueStatus = "ABSENT" | "PARSED" | "INVALID" | "INELIGIBLE";

const TutorCritiqueDraftSchema = z.object({
  frameworkId: z.literal(CRITIQUE_FRAMEWORK_ID),
  frameworkVersion: z.literal(CRITIQUE_FRAMEWORK_VERSION),
  dimensions: CritiqueDimensionsSchema,
  closure: z.object({
    established: z.string().trim().min(1).max(1_200),
    nextStep: z.string().trim().min(1).max(1_200),
    historyComparison: z.string().trim().min(1).max(1_200).optional(),
  }).strict(),
}).strict();

export type TutorCritiqueDraft = z.infer<typeof TutorCritiqueDraftSchema>;

export type TutorCritiqueParseOptions = {
  enabled: boolean;
  courseId?: string;
  studentMessage?: string;
  artworkSourceId?: string;
  allowedCourseSourceIds?: ReadonlySet<string>;
  allowedHistoryRecordIds?: ReadonlySet<string>;
};

function normalizedEvidenceText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/gu, "").trim();
}

function critiqueEvidenceIsBound(
  critique: TutorCritiqueDraft,
  options: TutorCritiqueParseOptions,
) {
  const framework = getCritiqueFramework(options.courseId ?? "");
  if (!framework || critique.dimensions.some((dimension, index) => (
    dimension.label !== framework.dimensions[index]?.label
  ))) return false;
  if (
    critique.closure.historyComparison
    && (!options.allowedHistoryRecordIds || options.allowedHistoryRecordIds.size === 0)
  ) return false;
  return critique.dimensions.every(({ evidence }) => evidence.every((item) => {
    if (item.kind === "ARTWORK_REGION") {
      return Boolean(options.artworkSourceId) && item.reference === options.artworkSourceId;
    }
    if (item.kind === "COURSE_REFERENCE") {
      return Boolean(item.reference && options.allowedCourseSourceIds?.has(item.reference));
    }
    if (item.kind === "HISTORY_RECORD") {
      return Boolean(item.reference && options.allowedHistoryRecordIds?.has(item.reference));
    }
    const statement = normalizedEvidenceText(item.label);
    const studentMessage = normalizedEvidenceText(options.studentMessage ?? "");
    return item.reference === "student-message"
      && statement.length > 0
      && studentMessage.includes(statement);
  }));
}

export function parseTutorSidecar(
  raw: string,
  critiqueOptions: TutorCritiqueParseOptions = { enabled: false },
): {
  text: string;
  sidecar: TutorSidecar | null;
  status: TutorSidecarStatus;
  critiqueStatus: TutorCritiqueStatus;
} {
  const match = matchTutorSidecar(raw);
  if (!match) {
    return { text: raw.trim(), sidecar: null, status: "ABSENT", critiqueStatus: "ABSENT" };
  }
  const text = raw.replace(match[0], "").trim();
  try {
    const decoded = JSON.parse(match[1].trim()) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return { text, sidecar: null, status: "INVALID", critiqueStatus: "ABSENT" };
    }
    const {
      memoryCandidates: rawCandidates,
      critique: rawCritique,
      ...metadata
    } = decoded as Record<string, unknown>;
    const parsed = TutorSidecarMetadataSchema.safeParse(metadata);
    if (!parsed.success) {
      return { text, sidecar: null, status: "INVALID", critiqueStatus: "ABSENT" };
    }
    const memoryCandidates = Array.isArray(rawCandidates)
      ? rawCandidates.slice(0, 3).flatMap((candidate) => {
          const result = StudentMemoryCandidateSchema.safeParse(candidate);
          return result.success ? [result.data] : [];
        })
      : [];
    const parsedCritique = rawCritique === undefined
      ? null
      : TutorCritiqueDraftSchema.safeParse(rawCritique);
    const critiqueStatus: TutorCritiqueStatus = rawCritique === undefined
      ? "ABSENT"
      : !critiqueOptions.enabled
        ? "INELIGIBLE"
        : parsedCritique?.success
          && critiqueEvidenceIsBound(parsedCritique.data, critiqueOptions)
          ? "PARSED"
          : "INVALID";
    const critique = critiqueStatus === "PARSED" && parsedCritique?.success
      ? parsedCritique.data
      : undefined;
    return {
      text,
      sidecar: {
        ...parsed.data,
        ...(memoryCandidates.length > 0 ? { memoryCandidates } : {}),
        ...(critique ? { critique } : {}),
      },
      status: "PARSED",
      critiqueStatus,
    };
  } catch {
    return { text, sidecar: null, status: "INVALID", critiqueStatus: "ABSENT" };
  }
}
