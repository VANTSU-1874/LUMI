import { z } from "zod";

/**
 * Configuration contract only. It deliberately contains no scheduler, fetcher,
 * browser automation, or credential handling: activating an intake remains a
 * separate, explicitly approved operation.
 */
export const InspirationSourceIdSchema = z
  .string()
  .regex(/^inspiration-source:[a-z0-9][a-z0-9-]{0,63}$/)
  .max(96);

const UrlSchema = z.string().url().max(2_048);
const IsoDateTimeSchema = z.string().datetime();
const ReviewedPublicHostSchema = z.string().trim().min(1).max(253)
  .regex(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i);

export const CurationMetadataFieldSchema = z.enum([
  "curationSourceUrl",
  "collection",
  "type",
  "title",
  "description",
  "impressions",
  "outboundCount",
  "originalSourceDisplay",
  "originalSourceUrl",
  "category",
  "styles",
  "colors",
  "previewAssetRef",
]);

export const InspirationSourceRegistrySchema = z.object({
  id: InspirationSourceIdSchema,
  displayName: z.string().trim().min(1).max(120),
  adapterId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).max(64),
  entrypoints: z.array(UrlSchema).min(1).max(12),
  intakeModes: z.array(z.enum(["INCREMENTAL_PULL", "MANUAL_BATCH"])).min(1).max(2),
  scope: z.literal("PRIVATE_CANDIDATE_ONLY"),
  operationalState: z.enum(["DISABLED", "READY", "PAUSED", "FAULTED"]),
  schedule: z.object({
    enabled: z.boolean(),
    frequencyMinutes: z.number().int().min(15).max(43_200).nullable(),
    nextRunAt: IsoDateTimeSchema.nullable(),
  }).strict(),
  rateLimit: z.object({
    maxRequests: z.number().int().min(1).max(100).default(1),
    perSeconds: z.number().int().min(1).max(3_600).default(60),
    maxItemsPerRun: z.number().int().min(1).max(100).default(20),
  }).strict(),
  fieldMapping: z.object({
    extractorVersion: z.string().trim().min(1).max(80),
    fields: z.array(CurationMetadataFieldSchema).min(1).max(14),
  }).strict(),
  checkpoint: z.object({
    lastSuccessfulCursor: z.string().trim().min(1).max(512).nullable(),
    lastSuccessfulContentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    lastSuccessAt: IsoDateTimeSchema.nullable(),
  }).strict(),
  health: z.object({
    status: z.enum(["UNKNOWN", "HEALTHY", "DEGRADED", "FAULTED", "DISABLED"]),
    consecutiveFailures: z.number().int().min(0).max(1_000),
    lastCheckedAt: IsoDateTimeSchema.nullable(),
    lastFailureCode: z.string().trim().min(1).max(80).nullable(),
  }).strict(),
  withdrawalSync: z.object({
    enabled: z.boolean(),
    strategy: z.enum(["ENTRY_RECHECK", "CONTENT_HASH_RECHECK", "MANUAL_ONLY"]),
  }).strict(),
  studentPublication: z.object({
    publicLinkReview: z.enum(["NOT_REVIEWED", "REVIEWED"]),
    allowedPublicHosts: z.array(ReviewedPublicHostSchema).max(24),
  }).strict().superRefine((value, context) => {
    if (value.publicLinkReview === "NOT_REVIEWED" && value.allowedPublicHosts.length > 0) {
      context.addIssue({ code: "custom", message: "Unreviewed sources cannot declare public-link hosts." });
    }
  }),
}).strict();

export type InspirationSourceRegistry = z.infer<typeof InspirationSourceRegistrySchema>;

export const InspirationIntakeRunSchema = z.object({
  id: z.string().regex(/^inspiration-intake-run:[a-z0-9][a-z0-9-]{0,63}$/).max(112),
  sourceId: InspirationSourceIdSchema,
  trigger: z.enum(["SCHEDULED", "MANUAL_BATCH", "MANUAL_RETRY", "WITHDRAWAL_SYNC"]),
  status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "PAUSED"]),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
  cursorBefore: z.string().trim().min(1).max(512).nullable(),
  cursorAfter: z.string().trim().min(1).max(512).nullable(),
  discovered: z.number().int().min(0),
  createdCandidates: z.number().int().min(0),
  updatedCandidates: z.number().int().min(0),
  duplicateCandidates: z.number().int().min(0),
  withdrawnCandidates: z.number().int().min(0),
  errorCode: z.string().trim().min(1).max(80).nullable(),
}).strict();

export type InspirationIntakeRun = z.infer<typeof InspirationIntakeRunSchema>;

export function assertSourceCanRunIntake(source: InspirationSourceRegistry, trigger: InspirationIntakeRun["trigger"]) {
  if (source.scope !== "PRIVATE_CANDIDATE_ONLY") throw new Error("Source registry scope must remain PRIVATE_CANDIDATE_ONLY.");
  if (source.operationalState !== "READY") throw new Error("Source is not enabled for intake.");
  if (trigger === "SCHEDULED" && (!source.schedule.enabled || !source.schedule.frequencyMinutes)) {
    throw new Error("Scheduled intake has not been explicitly enabled.");
  }
  if (!source.intakeModes.includes(trigger === "MANUAL_BATCH" ? "MANUAL_BATCH" : "INCREMENTAL_PULL")) {
    throw new Error("Source does not support this intake mode.");
  }
}

/** A disabled proposal; not an instruction to fetch recent.design. */
export const recentDesignSourceAdapterCandidate = InspirationSourceRegistrySchema.parse({
  id: "inspiration-source:recent-design",
  displayName: "Recent Design",
  adapterId: "recent-design-public-entry-v1",
  entrypoints: ["https://recent.design/"],
  intakeModes: ["INCREMENTAL_PULL", "MANUAL_BATCH"],
  scope: "PRIVATE_CANDIDATE_ONLY",
  operationalState: "DISABLED",
  schedule: { enabled: false, frequencyMinutes: null, nextRunAt: null },
  rateLimit: { maxRequests: 1, perSeconds: 60, maxItemsPerRun: 20 },
  fieldMapping: {
    extractorVersion: "recent-ui-curation-metadata-v1",
    fields: [
      "curationSourceUrl", "collection", "type", "title", "description", "impressions", "outboundCount",
      "originalSourceDisplay", "originalSourceUrl", "category", "styles", "colors", "previewAssetRef",
    ],
  },
  checkpoint: { lastSuccessfulCursor: null, lastSuccessfulContentHash: null, lastSuccessAt: null },
  health: { status: "DISABLED", consecutiveFailures: 0, lastCheckedAt: null, lastFailureCode: null },
  withdrawalSync: { enabled: false, strategy: "ENTRY_RECHECK" },
  studentPublication: { publicLinkReview: "NOT_REVIEWED", allowedPublicHosts: [] },
});
