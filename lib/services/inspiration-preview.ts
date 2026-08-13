import { desc, eq } from "drizzle-orm";

import type { DatabaseConnection } from "@/lib/db/client";
import { inspirationAdmissions, inspirationCandidates, inspirationWikiCurrentPageEvents, inspirationWikiFormalReleases, inspirationWikiCanonicalPageRevisions, type JsonRecord } from "@/lib/db/schema";
import { FormalReleaseAssetSchema, FormalReleaseSchema } from "@/lib/domain/inspiration-wiki/formal-release-contracts";
import { isFormalWikiStudentEligible, studentPreviewAllowed } from "@/lib/domain/inspiration-eligibility";
import { inspirationPublicId, isInspirationPublicId } from "@/lib/domain/inspiration-public-id";
import { readTeacherReviewableInspirationCandidate } from "@/lib/services/inspiration-review-access";
import { p2StudentChannelBlocksStudentRead } from "@/lib/services/inspiration-wiki-p2-student-channels";

type Actor = { userId: string; role: "STUDENT" | "TEACHER" };
type PreviewRecord = { kind: "SYNTHETIC"; svg: string } | { kind: "ASSET"; asset: { storagePath: string; mimeType: string; bytes: number; sha256: string } };

/** Only local, version-controlled synthetic sample keys can produce preview bytes in this slice. */
export function controlledSyntheticPreview(privateAssetRef: unknown, contentHash: unknown): PreviewRecord | null {
  if (typeof privateAssetRef !== "string" || typeof contentHash !== "string") return null;
  if (!/^local-synthetic:\/\/inspiration-preview\/[a-z0-9-]{1,80}$/.test(privateAssetRef) || !/^sha256:[a-f0-9]{64}$/.test(contentHash)) return null;
  const hue = Number.parseInt(contentHash.slice(7, 13), 16) % 360;
  return { kind: "SYNTHETIC", svg: `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720" role="img" aria-label="Lumi 合规 synthetic 灵感预览"><rect width="960" height="720" fill="hsl(${hue} 18% 93%)"/><rect x="76" y="64" width="808" height="592" rx="26" fill="hsl(${hue} 21% 84%)"/><path d="M154 522V198h196v324zM392 198h156v170H392zM392 404h354v118H392zM586 198h160v150H586z" fill="hsl(${hue} 24% 22%)"/><circle cx="757" cy="528" r="78" fill="hsl(${(hue + 36) % 360} 62% 48%)"/><path d="M136 578h658" stroke="hsl(${hue} 18% 48%)" stroke-width="7"/></svg>` };
}

function formalPreview(db: DatabaseConnection["db"], publicId: string): PreviewRecord | null {
  const events = db.select({ canonicalPageId: inspirationWikiCurrentPageEvents.canonicalPageId, eventType: inspirationWikiCurrentPageEvents.eventType })
    .from(inspirationWikiCurrentPageEvents).orderBy(desc(inspirationWikiCurrentPageEvents.createdAt), desc(inspirationWikiCurrentPageEvents.eventId)).all();
  const latest = new Map<string, "ACTIVATED" | "WITHDRAWN">();
  for (const event of events) if (!latest.has(event.canonicalPageId)) latest.set(event.canonicalPageId, event.eventType);
  const rows = db.select({
    canonicalPageId: inspirationWikiFormalReleases.canonicalPageId,
    releaseJson: inspirationWikiFormalReleases.releaseJson,
    assetsJson: inspirationWikiCanonicalPageRevisions.assetsJson,
  }).from(inspirationWikiFormalReleases)
    .innerJoin(inspirationWikiCanonicalPageRevisions, eq(inspirationWikiFormalReleases.canonicalRevisionId, inspirationWikiCanonicalPageRevisions.canonicalRevisionId)).all();
  for (const row of rows) {
    if (latest.get(row.canonicalPageId) !== "ACTIVATED") continue;
    const release = FormalReleaseSchema.parse(row.releaseJson);
    if (release.publicMaterial.publicId !== publicId) continue;
    const asset = (row.assetsJson as JsonRecord[]).map((value) => FormalReleaseAssetSchema.parse(value))
      .find((value) => value.mediaId === release.publicMaterial.preview.mediaId);
    return asset ? { kind: "ASSET", asset } : null;
  }
  return null;
}

function safePreview(row: { assetJson: JsonRecord; contentHash: string | null }) {
  const asset = row.assetJson as Record<string, unknown>;
  return controlledSyntheticPreview(asset.privateAssetRef, row.contentHash);
}

/** A URL is issued only when the same server-side predicate can resolve preview bytes. */
export function controlledPreviewUrl(candidateId: string, assetJson: JsonRecord, contentHash: string | null) {
  return safePreview({ assetJson, contentHash }) ? `/api/inspiration/previews/${inspirationPublicId(candidateId)}` : null;
}

/** Resolves an opaque/public ref internally; callers must never serialize this ID. */
export function resolveCandidateIdByPublicId(db: DatabaseConnection["db"], publicId: string) {
  if (!isInspirationPublicId(publicId)) return null;
  return db.select({ id: inspirationCandidates.id }).from(inspirationCandidates).all()
    .find((candidate) => inspirationPublicId(candidate.id) === publicId)?.id ?? null;
}

export function resolveInspirationPreview(
  db: DatabaseConnection["db"],
  actor: Actor,
  publicId: string,
) {
  if (!isInspirationPublicId(publicId)) return null;
  if (actor.role === "STUDENT" && p2StudentChannelBlocksStudentRead(db)) return null;
  if (actor.role === "STUDENT") {
    const published = formalPreview(db, publicId);
    if (published) return published;
  }
  const candidateId = resolveCandidateIdByPublicId(db, publicId);
  if (!candidateId) return null;
  if (actor.role === "TEACHER") {
    const candidate = readTeacherReviewableInspirationCandidate(db, actor, candidateId);
    return candidate ? safePreview({ assetJson: candidate.assetJson, contentHash: candidate.contentHash }) : null;
  }
  const rows = db.select({
    id: inspirationCandidates.id, state: inspirationCandidates.state, rights: inspirationCandidates.rightsJson,
    asset: inspirationCandidates.assetJson, contentHash: inspirationCandidates.contentHash,
    withdrawalStatus: inspirationCandidates.withdrawalStatus, admissionStatus: inspirationAdmissions.status,
    publicationScope: inspirationAdmissions.publicationScope,
    studentVisible: inspirationAdmissions.studentVisible,
    studentDisplayDecision: inspirationAdmissions.studentDisplayDecision,
    sourceDisclosureDecision: inspirationAdmissions.sourceDisclosureDecision,
    teachingDecision: inspirationAdmissions.teachingDecision,
    safetyDecision: inspirationAdmissions.safetyDecision,
    qualityDecision: inspirationAdmissions.qualityDecision,
    withdrawalReadiness: inspirationAdmissions.withdrawalReadiness,
    browserChannel: inspirationAdmissions.browserChannel,
    bridgeChannel: inspirationAdmissions.bridgeChannel,
    formalWikiActivationRecorded: inspirationAdmissions.formalWikiActivationRecorded,
  }).from(inspirationCandidates).leftJoin(inspirationAdmissions, eq(inspirationAdmissions.candidateId, inspirationCandidates.id))
    .where(eq(inspirationCandidates.id, candidateId)).all();
  const row = rows[0];
  if (!row) return null;
  if (!isFormalWikiStudentEligible({
    candidateState: row.state,
    admissionStatus: row.admissionStatus,
    withdrawalStatus: row.withdrawalStatus,
    rights: row.rights,
    publicationScope: row.publicationScope,
    studentVisible: row.studentVisible,
    studentDisplayDecision: row.studentDisplayDecision,
    sourceDisclosureDecision: row.sourceDisclosureDecision,
    teachingDecision: row.teachingDecision,
    safetyDecision: row.safetyDecision,
    qualityDecision: row.qualityDecision,
    withdrawalReadiness: row.withdrawalReadiness,
    browserChannel: row.browserChannel,
    bridgeChannel: row.bridgeChannel,
    formalWikiActivationRecorded: row.formalWikiActivationRecorded,
  })) return null;
  if (!studentPreviewAllowed(row.rights)) return null;
  return safePreview({ assetJson: row.asset, contentHash: row.contentHash });
}
