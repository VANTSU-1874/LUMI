import { z } from "zod";

import { ReviewedWikiLinkSchema, WikiOpaqueIdSchema, WikiPageIdSchema } from "./core-contracts";
import {
  StudentCurrentReleaseEligibilityInputSchema,
  WikiChannelStatesSchema,
  WikiReleaseStateSchema,
} from "./governance-contracts";
import { evaluateStudentCurrentReleaseEligibility } from "./governance";
import { deepFreezeWikiValue } from "./integrity";

export const StudentExposureSurfaceSchema = z.enum([
  "BROWSE",
  "SEARCH",
  "TOOL",
  "PROMPT",
  "RENDER",
  "RETRY",
  "PREVIEW",
]);

const ExposureProjectionSchema = z.object({
  BROWSE: z.array(WikiPageIdSchema).readonly(),
  SEARCH: z.array(WikiPageIdSchema).readonly(),
  TOOL: z.array(WikiPageIdSchema).readonly(),
  PROMPT: z.array(WikiPageIdSchema).readonly(),
  RENDER: z.array(WikiPageIdSchema).readonly(),
  RETRY: z.array(WikiPageIdSchema).readonly(),
  PREVIEW: z.array(WikiPageIdSchema).readonly(),
}).strict().readonly();

const StudentExposureProjectionSchema = z.object({
  pageId: WikiPageIdSchema,
  eligibility: StudentCurrentReleaseEligibilityInputSchema,
  historicalReferences: z.array(z.object({
    kind: z.enum(["MESSAGE_SNAPSHOT", "RUN_SNAPSHOT"]),
    referenceId: WikiOpaqueIdSchema,
    pageId: WikiPageIdSchema,
    releaseId: WikiOpaqueIdSchema,
    recordedAt: z.string().datetime(),
  }).strict().readonly()).max(20).optional().readonly(),
}).strict().superRefine((value, context) => {
  if (value.pageId !== value.eligibility.page.pageId
    || value.pageId !== value.eligibility.releaseGate.current.pageId) {
    context.addIssue({ code: "custom", message: "Exposure pageId must match the evaluated current Page" });
  }
}).readonly();

const ACCESS_BY_SURFACE = {
  BROWSE: "BROWSE",
  SEARCH: "SEARCH",
  TOOL: "WIKI_CONTEXT",
  PROMPT: "WIKI_CONTEXT",
  RENDER: "WIKI_CONTEXT",
  RETRY: "WIKI_CONTEXT",
  PREVIEW: "PREVIEW",
} as const;

type ExposureSurface = z.infer<typeof StudentExposureSurfaceSchema>;
type MutableExposure = Record<ExposureSurface, string[]>;

function emptyExposure(): MutableExposure {
  return {
    BROWSE: [], SEARCH: [], TOOL: [], PROMPT: [], RENDER: [], RETRY: [], PREVIEW: [],
  };
}

export function projectStudentExposureSurfaces(rawProjections: unknown) {
  const parsed = z.array(StudentExposureProjectionSchema).max(200).safeParse(rawProjections);
  if (!parsed.success) return deepFreezeWikiValue(ExposureProjectionSchema.parse(emptyExposure()));
  const output = emptyExposure();
  for (const surface of StudentExposureSurfaceSchema.options) {
    for (const projection of parsed.data) {
      const gate = evaluateStudentCurrentReleaseEligibility({
        ...projection.eligibility,
        accessKind: ACCESS_BY_SURFACE[surface],
      });
      if (gate.eligible) output[surface].push(projection.pageId);
    }
    output[surface].sort((left, right) => left.localeCompare(right));
  }
  return deepFreezeWikiValue(ExposureProjectionSchema.parse(output));
}

export const WikiProjectionSnapshotSchema = z.object({
  releaseId: WikiOpaqueIdSchema,
  releaseState: WikiReleaseStateSchema,
  effectiveChannelStates: WikiChannelStatesSchema,
  eligiblePageIds: z.array(WikiPageIdSchema).max(500).readonly(),
  links: z.array(ReviewedWikiLinkSchema).max(2_000).readonly(),
  exposure: ExposureProjectionSchema,
  restrictedPageIds: z.array(WikiPageIdSchema).max(500).readonly(),
}).strict().readonly();

export const WikiRestrictionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("PAGE_RESTRICTION"),
    pageId: WikiPageIdSchema,
    state: z.enum([
      "RIGHTS_HOLD",
      "SAFETY_HOLD",
      "WITHDRAWAL_HOLD",
      "WITHDRAWN",
      "REVOKED",
      "REVIEW_HOLD",
    ]),
  }).strict(),
  z.object({
    kind: z.literal("REVIEWER_REVOCATION"),
    actorId: WikiOpaqueIdSchema,
  }).strict(),
]);

const WikiRestrictionPropagationSchema = z.object({
  snapshot: WikiProjectionSnapshotSchema,
  cause: WikiRestrictionSchema,
  invalidatedSurfaces: z.array(StudentExposureSurfaceSchema).readonly(),
}).strict().readonly();

export function propagateWikiRestriction(rawSnapshot: unknown, rawCause: unknown) {
  const snapshot = WikiProjectionSnapshotSchema.parse(rawSnapshot);
  const cause = WikiRestrictionSchema.parse(rawCause);
  if (cause.kind === "REVIEWER_REVOCATION") {
    return deepFreezeWikiValue(WikiRestrictionPropagationSchema.parse({
      snapshot: {
        ...snapshot,
        releaseState: "REVIEW_HOLD",
        effectiveChannelStates: {
          BROWSE_RELEASE: "DISABLED",
          STUDENT_SEARCH: "DISABLED",
          WIKI_RETRIEVAL: "DISABLED",
        },
        eligiblePageIds: [],
        links: [],
        exposure: emptyExposure(),
      },
      cause,
      invalidatedSurfaces: StudentExposureSurfaceSchema.options,
    }));
  }
  const invalidatedSurfaces = StudentExposureSurfaceSchema.options.filter(
    (surface) => snapshot.exposure[surface].includes(cause.pageId),
  );
  const exposure = Object.fromEntries(StudentExposureSurfaceSchema.options.map((surface) => [
    surface,
    snapshot.exposure[surface].filter((pageId) => pageId !== cause.pageId),
  ]));
  return deepFreezeWikiValue(WikiRestrictionPropagationSchema.parse({
    snapshot: {
      ...snapshot,
      eligiblePageIds: snapshot.eligiblePageIds.filter((pageId) => pageId !== cause.pageId),
      links: snapshot.links.filter((link) => link.fromPageId !== cause.pageId && link.toPageId !== cause.pageId),
      exposure,
      restrictedPageIds: [...new Set([...snapshot.restrictedPageIds, cause.pageId])],
    },
    cause,
    invalidatedSurfaces,
  }));
}
