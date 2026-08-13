import { z } from "zod";

import { publicSourceUrlHasSafeShape } from "@/lib/domain/inspiration-public-source";

const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const PlainHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const IsoDateSchema = z.string().datetime({ offset: true });

export const FormalReleaseAssetSchema = z.object({
  mediaId: z.string().trim().min(1).max(120),
  role: z.enum(["COVER", "DETAIL", "CONTEXT", "PROCESS", "RAW_CANDIDATE_ASSET"]),
  alt: z.string().trim().min(1).max(500),
  width: z.number().int().positive().max(40_000),
  height: z.number().int().positive().max(40_000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  bytes: z.number().int().positive().max(100_000_000),
  sha256: PlainHashSchema,
  storagePath: z.string().regex(/^inspiration-wiki\/(?:review-packs|evidence-gap-review-packs)\/assets\/[a-z0-9][a-z0-9-]{7,95}\/[a-z0-9][a-z0-9-]{2,95}\.(?:jpg|jpeg|png|webp)$/),
}).strict();

export const CanonicalPublishedMaterialSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-canonical-published-material/v1"),
  publicId: z.string().regex(/^inspiration:[a-f0-9]{24}$/),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1_000),
  tags: z.array(z.string().trim().min(1).max(80)).min(1).max(24),
  courseAssociations: z.array(z.object({
    coursePackId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/i),
    facets: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  }).strict()).max(20),
  source: z.object({
    label: z.string().trim().min(1).max(240),
    url: z.string().url().max(2_048).refine(publicSourceUrlHasSafeShape, "来源链接必须是安全的公开 HTTPS 地址"),
  }).strict(),
  attributionNotice: z.string().trim().min(1).max(280),
  preview: z.object({
    mode: z.literal("CONTROLLED"),
    mediaId: z.string().trim().min(1).max(120),
    previewUrl: z.string().regex(/^\/api\/inspiration\/previews\/inspiration:[a-f0-9]{24}$/),
  }).strict(),
  audience: z.literal("AUTHENTICATED_STUDENT_ONLY"),
  rightsEvidenceRef: z.string().trim().min(1).max(500),
  withdrawalPolicy: z.literal("IMMEDIATE_LOCAL_REVOKE"),
}).strict();

export const CanonicalPageRevisionSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-canonical-page-revision/v1"),
  canonicalPageId: z.string().regex(/^wiki-page:[a-f0-9]{32}$/),
  canonicalRevisionId: z.string().regex(/^wiki-page-revision:[a-f0-9]{32}:[1-9][0-9]*$/),
  revision: z.number().int().positive(),
  revisionHash: HashSchema,
  candidateId: z.string().min(1).max(160),
  sourceCaseId: z.string().regex(/^release-qualification:[a-f0-9]{32}$/),
  sourcePrivatePageId: z.string().min(1).max(180),
  sourcePrivateRevisionId: z.string().min(1).max(200),
  sourceContentHash: PlainHashSchema,
  publicMaterial: CanonicalPublishedMaterialSchema,
  compiledAt: IsoDateSchema,
  boundary: z.object({
    canonicalCompilation: z.literal("ENABLED"),
    formalRelease: z.literal("DISABLED"),
    currentPage: z.literal("DISABLED"),
    studentVisible: z.literal(false),
    r2: z.literal("DISABLED"),
    embedding: z.literal("DISABLED"),
    lumiRetrieval: z.literal("DISABLED"),
    productionDeployment: z.literal("DISABLED"),
  }).strict(),
}).strict();

export const FormalReleaseSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-formal-release/v1"),
  releaseId: z.string().regex(/^wiki-release:[a-f0-9]{32}$/),
  releaseHash: HashSchema,
  canonicalPageId: CanonicalPageRevisionSchema.shape.canonicalPageId,
  canonicalRevisionId: CanonicalPageRevisionSchema.shape.canonicalRevisionId,
  caseId: z.string().regex(/^release-qualification:[a-f0-9]{32}$/),
  caseHash: HashSchema,
  qualificationDecisionIds: z.object({
    STUDENT_DISPLAY_RIGHTS: z.string().min(1).max(180),
    AUDIENCE_POLICY: z.string().min(1).max(180),
    SOURCE_DISCLOSURE: z.string().min(1).max(180),
    WITHDRAWAL_READINESS: z.string().min(1).max(180),
    RELEASE_ROLE_SIGNOFF: z.string().min(1).max(180),
  }).strict(),
  publicMaterial: CanonicalPublishedMaterialSchema,
  status: z.literal("PUBLISHED"),
  publishedBy: z.string().min(1).max(160),
  publishedAt: IsoDateSchema,
  boundary: z.object({
    studentVisible: z.literal(true),
    formalRelease: z.literal("ACTIVE"),
    currentPage: z.literal("ACTIVE"),
    browseRelease: z.literal("ACTIVE"),
    studentSearch: z.literal("ACTIVE"),
    preview: z.literal("ACTIVE"),
    wikiRetrieval: z.literal("DISABLED"),
    r2: z.literal("DISABLED"),
    embedding: z.literal("DISABLED"),
    lumiRetrieval: z.literal("DISABLED"),
    productionDeployment: z.literal("DISABLED"),
  }).strict(),
}).strict();

export const CurrentPageEventSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-current-page-event/v1"),
  eventId: z.string().regex(/^current-page-event:[a-f0-9]{32}$/),
  eventHash: HashSchema,
  idempotencyKey: z.string().uuid(),
  canonicalPageId: CanonicalPageRevisionSchema.shape.canonicalPageId,
  canonicalRevisionId: CanonicalPageRevisionSchema.shape.canonicalRevisionId,
  releaseId: FormalReleaseSchema.shape.releaseId,
  eventType: z.enum(["ACTIVATED", "WITHDRAWN"]),
  reason: z.string().trim().min(1).max(500),
  actorId: z.string().min(1).max(160),
  createdAt: IsoDateSchema,
}).strict();

export const P2ActiveChannelSnapshotSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-p2-active-channel-snapshot/v1"),
  snapshotId: z.string().regex(/^p2-channel-active:[a-f0-9]{32}$/),
  snapshotHash: HashSchema,
  releaseSetHash: HashSchema,
  releaseIds: z.array(FormalReleaseSchema.shape.releaseId).max(500),
  canonicalPageIds: z.array(CanonicalPageRevisionSchema.shape.canonicalPageId).max(500),
  mode: z.literal("ACTIVE"),
  channels: z.object({
    BROWSE_RELEASE: z.literal("ACTIVE"),
    STUDENT_SEARCH: z.literal("ACTIVE"),
    PREVIEW: z.literal("ACTIVE"),
    WIKI_RETRIEVAL: z.literal("DISABLED"),
  }).strict(),
  boundary: z.object({
    studentVisible: z.literal(true),
    formalRelease: z.literal("ACTIVE"),
    currentPage: z.literal("ACTIVE"),
    r2: z.literal("DISABLED"),
    embedding: z.literal("DISABLED"),
    lumiRetrieval: z.literal("DISABLED"),
    productionDeployment: z.literal("DISABLED"),
  }).strict(),
  createdAt: IsoDateSchema,
}).strict();

export const FormalReleaseActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PUBLISH"), caseId: FormalReleaseSchema.shape.caseId, idempotencyKey: z.string().uuid() }).strict(),
  z.object({ action: z.literal("WITHDRAW"), releaseId: FormalReleaseSchema.shape.releaseId, reason: z.string().trim().min(1).max(500), idempotencyKey: z.string().uuid() }).strict(),
]);

export const TeacherFormalReleaseQueueSchema = z.object({
  schemaVersion: z.literal("lumi-teacher-formal-release-queue/v1"),
  meta: z.object({ total: z.number().int().nonnegative(), active: z.number().int().nonnegative(), withdrawn: z.number().int().nonnegative(), qualifiedUnreleased: z.number().int().nonnegative() }).strict(),
  items: z.array(z.object({
    release: FormalReleaseSchema,
    currentState: z.enum(["ACTIVE", "WITHDRAWN"]),
    currentEvent: CurrentPageEventSchema,
  }).strict()),
}).strict();

export type FormalReleaseAsset = z.infer<typeof FormalReleaseAssetSchema>;
export type CanonicalPublishedMaterial = z.infer<typeof CanonicalPublishedMaterialSchema>;
export type CanonicalPageRevision = z.infer<typeof CanonicalPageRevisionSchema>;
export type FormalRelease = z.infer<typeof FormalReleaseSchema>;
export type CurrentPageEvent = z.infer<typeof CurrentPageEventSchema>;
export type P2ActiveChannelSnapshot = z.infer<typeof P2ActiveChannelSnapshotSchema>;
export type FormalReleaseAction = z.infer<typeof FormalReleaseActionSchema>;
export type TeacherFormalReleaseQueue = z.infer<typeof TeacherFormalReleaseQueueSchema>;
