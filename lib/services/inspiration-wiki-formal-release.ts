import { createHash } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  CanonicalPageRevisionSchema,
  CurrentPageEventSchema,
  FormalReleaseActionSchema,
  FormalReleaseAssetSchema,
  FormalReleaseSchema,
  P2ActiveChannelSnapshotSchema,
  TeacherFormalReleaseQueueSchema,
  type CanonicalPageRevision,
  type CanonicalPublishedMaterial,
  type CurrentPageEvent,
  type FormalRelease,
  type FormalReleaseAsset,
  type P2ActiveChannelSnapshot,
} from "@/lib/domain/inspiration-wiki/formal-release-contracts";
import { ReleaseQualificationCaseSchema, ReleaseQualificationGateValues, type ReleaseQualificationCase, type ReleaseQualificationGate } from "@/lib/domain/inspiration-wiki/release-qualification-contracts";
import { hashWikiValue } from "@/lib/domain/inspiration-wiki/integrity";
import { inspirationPublicId } from "@/lib/domain/inspiration-public-id";
import { assertTeacherInspirationReviewAccess } from "@/lib/services/inspiration-review-access";

export class FormalReleaseConflictError extends Error {
  constructor(code: string) { super(code); this.name = "FormalReleaseConflictError"; }
}

export class FormalReleaseGateError extends Error {
  constructor(code = "FORMAL_RELEASE_REQUIRES_FIVE_SATISFIED_GATES") { super(code); this.name = "FormalReleaseGateError"; }
}

type JsonRecord = Record<string, unknown>;
type DecisionRow = { decision_id: string; gate: ReleaseQualificationGate; status: "SATISFIED" | "BLOCKED"; evidence_ref: string | null; revision: number };

function isoSeconds(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("正式发布时间无效");
  return new Date(Math.floor(date.getTime() / 1_000) * 1_000).toISOString();
}

function unixSeconds(value: string) { return Math.floor(new Date(value).getTime() / 1_000); }
function asRecord(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function asStrings(value: unknown, limit = 24) { return asArray(value).filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, limit); }
function suffix(candidateId: string) {
  const match = /^hermes-candidate:([a-f0-9]{32})$/.exec(candidateId);
  if (!match) throw new FormalReleaseConflictError("FORMAL_RELEASE_CANDIDATE_ID_INVALID");
  return match[1]!;
}
function hashId(prefix: string, value: unknown) { return `${prefix}${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`; }

function latestQualificationDecisions(connection: DatabaseConnection, caseId: string) {
  const rows = connection.sqlite.prepare(
    `SELECT decision_id,gate,status,evidence_ref,revision
     FROM inspiration_wiki_release_qualification_decisions
     WHERE case_id=? ORDER BY gate,revision DESC,decided_at DESC`,
  ).all(caseId) as DecisionRow[];
  const latest = new Map<ReleaseQualificationGate, DecisionRow>();
  for (const row of rows) if (!latest.has(row.gate)) latest.set(row.gate, row);
  return latest;
}

function qualifiedDecisionIds(connection: DatabaseConnection, caseId: string) {
  const latest = latestQualificationDecisions(connection, caseId);
  const result = {} as Record<ReleaseQualificationGate, string>;
  for (const gate of ReleaseQualificationGateValues) {
    const decision = latest.get(gate);
    if (!decision || decision.status !== "SATISFIED") throw new FormalReleaseGateError();
    if (gate === "STUDENT_DISPLAY_RIGHTS" && !decision.evidence_ref?.trim()) throw new FormalReleaseGateError("FORMAL_RELEASE_RIGHTS_EVIDENCE_REQUIRED");
    result[gate] = decision.decision_id;
  }
  return { ids: result, rightsEvidenceRef: latest.get("STUDENT_DISPLAY_RIGHTS")!.evidence_ref!.trim() };
}

function readCase(connection: DatabaseConnection, caseId: string) {
  const row = connection.sqlite.prepare("SELECT case_hash,case_json FROM inspiration_wiki_release_qualification_cases WHERE case_id=?").get(caseId) as { case_hash: string; case_json: string } | undefined;
  if (!row) throw new FormalReleaseConflictError("FORMAL_RELEASE_CASE_NOT_FOUND");
  const releaseCase = ReleaseQualificationCaseSchema.parse(JSON.parse(row.case_json));
  if (releaseCase.caseHash !== row.case_hash) throw new FormalReleaseConflictError("FORMAL_RELEASE_CASE_HASH_MISMATCH");
  return releaseCase;
}

function buildCanonicalMaterial(connection: DatabaseConnection, releaseCase: ReleaseQualificationCase, rightsEvidenceRef: string) {
  const pageRow = connection.sqlite.prepare("SELECT page_json FROM inspiration_wiki_private_pages WHERE page_id=?").get(releaseCase.pageId) as { page_json: string } | undefined;
  const candidateId = pageRow ? asRecord(JSON.parse(pageRow.page_json)).candidateId : null;
  if (typeof candidateId !== "string") throw new FormalReleaseConflictError("FORMAL_RELEASE_CANDIDATE_ID_MISSING");
  const row = connection.sqlite.prepare(
    `SELECT revision_id,content_hash,content_json FROM inspiration_wiki_private_page_revisions
     WHERE revision_id=? AND page_id=?`,
  ).get(releaseCase.pageRevisionId, releaseCase.pageId) as { revision_id: string; content_hash: string; content_json: string } | undefined;
  if (!row || row.content_hash !== releaseCase.contentHash) throw new FormalReleaseConflictError("FORMAL_RELEASE_PRIVATE_REVISION_CHANGED");
  const content = asRecord(JSON.parse(row.content_json));
  const work = asRecord(content.work);
  const classification = asRecord(content.classification);
  const style = asRecord(content.artisticStyle);
  const source = asRecord(asArray(content.sourceRecords)[0]);
  const media = asArray(content.media).map(asRecord);
  const selectedMedia = media.find((item) => item.previewUrl === releaseCase.primaryPreviewUrl) ?? media.find((item) => item.role === "COVER") ?? media[0];
  if (!selectedMedia || typeof selectedMedia.mediaId !== "string") throw new FormalReleaseConflictError("FORMAL_RELEASE_PRIMARY_MEDIA_MISSING");
  const pack = connection.sqlite.prepare(
    "SELECT pack_json,media_assets_json FROM inspiration_wiki_review_packs WHERE candidate_id=(SELECT candidate_id FROM inspiration_wiki_private_pages WHERE page_id=?)",
  ).get(releaseCase.pageId) as { pack_json: string; media_assets_json: string } | undefined;
  if (!pack) throw new FormalReleaseConflictError("FORMAL_RELEASE_STRICT_MEDIA_REQUIRED");
  const assetRaw = asArray(JSON.parse(pack.media_assets_json)).map(asRecord).find((asset) => asset.mediaId === selectedMedia.mediaId);
  if (!assetRaw) throw new FormalReleaseConflictError("FORMAL_RELEASE_ASSET_BINDING_MISSING");
  const asset = FormalReleaseAssetSchema.parse({
    mediaId: selectedMedia.mediaId,
    role: selectedMedia.role,
    alt: selectedMedia.alt,
    width: selectedMedia.width,
    height: selectedMedia.height,
    mimeType: assetRaw.mimeType,
    bytes: assetRaw.bytes,
    sha256: assetRaw.sha256,
    storagePath: assetRaw.storagePath,
  });
  if (asset.sha256 !== selectedMedia.sha256) throw new FormalReleaseConflictError("FORMAL_RELEASE_ASSET_HASH_MISMATCH");
  const creators = asStrings(work.creators, 12);
  const creatorLabel = creators.length ? creators.join("、") : (typeof source.creatorName === "string" ? source.creatorName : "创作者未注明");
  const platform = typeof source.platform === "string" ? source.platform : "公开来源";
  const curator = typeof source.curatorName === "string" && source.curatorName.trim() ? `；策展来源：${source.curatorName.trim()}` : "";
  const pageUrl = typeof source.pageUrl === "string" ? source.pageUrl : null;
  if (!pageUrl?.startsWith("https://")) throw new FormalReleaseConflictError("FORMAL_RELEASE_PUBLIC_SOURCE_MISSING");
  const primary = typeof classification.primary === "string" ? classification.primary : releaseCase.primaryCategory;
  const secondary = asStrings(classification.secondary, 16);
  const styles = asStrings(style.labels, 8);
  const tags = [...new Set([primary, ...secondary, ...styles])].slice(0, 24);
  const publicId = inspirationPublicId(candidateId);
  const publicMaterial: CanonicalPublishedMaterial = {
    schemaVersion: "lumi-inspiration-canonical-published-material/v1",
    publicId,
    title: typeof content.title === "string" ? content.title : releaseCase.title,
    description: typeof content.summary === "string" && content.summary.trim() ? content.summary.trim().slice(0, 1_000) : `该案例展示${primary}中的视觉组织与教学观察。`,
    tags: tags.length ? tags : [primary],
    courseAssociations: [],
    source: { label: `${creatorLabel} · ${platform}`, url: pageUrl },
    attributionNotice: `创作者：${creatorLabel}${curator}；来源：${platform}。仅向已登录学生展示。`.slice(0, 280),
    preview: { mode: "CONTROLLED", mediaId: asset.mediaId, previewUrl: `/api/inspiration/previews/${publicId}` },
    audience: "AUTHENTICATED_STUDENT_ONLY",
    rightsEvidenceRef,
    withdrawalPolicy: "IMMEDIATE_LOCAL_REVOKE",
  };
  return { content, publicMaterial, assets: [asset] as FormalReleaseAsset[], candidateId };
}

function activeReleaseRows(connection: DatabaseConnection) {
  return connection.sqlite.prepare(
    `SELECT r.release_id releaseId,r.canonical_page_id canonicalPageId
     FROM inspiration_wiki_formal_releases r
     WHERE (SELECT e.event_type FROM inspiration_wiki_current_page_events e
            WHERE e.canonical_page_id=r.canonical_page_id
            ORDER BY e.created_at DESC,e.rowid DESC LIMIT 1)='ACTIVATED'
     ORDER BY r.release_id`,
  ).all() as Array<{ releaseId: string; canonicalPageId: string }>;
}

function persistActiveSnapshot(connection: DatabaseConnection, createdAt: string) {
  const active = activeReleaseRows(connection);
  const releaseIds = active.map((row) => row.releaseId);
  const canonicalPageIds = active.map((row) => row.canonicalPageId);
  const releaseSetHash = hashWikiValue({ releaseIds, canonicalPageIds });
  const material: Omit<P2ActiveChannelSnapshot, "snapshotHash"> = {
    schemaVersion: "lumi-inspiration-p2-active-channel-snapshot/v1",
    snapshotId: `p2-channel-active:${releaseSetHash.slice(7, 39)}`,
    releaseSetHash,
    releaseIds,
    canonicalPageIds,
    mode: "ACTIVE",
    channels: { BROWSE_RELEASE: "ACTIVE", STUDENT_SEARCH: "ACTIVE", PREVIEW: "ACTIVE", WIKI_RETRIEVAL: "DISABLED" },
    boundary: { studentVisible: true, formalRelease: "ACTIVE", currentPage: "ACTIVE", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED", productionDeployment: "DISABLED" },
    createdAt,
  };
  const snapshot = P2ActiveChannelSnapshotSchema.parse({ ...material, snapshotHash: hashWikiValue(material) });
  connection.sqlite.prepare(
    `INSERT OR IGNORE INTO inspiration_wiki_p2_active_channel_snapshots
      (snapshot_id,snapshot_hash,release_set_hash,schema_version,mode,release_ids_json,canonical_page_ids_json,
       browse_release,student_search,preview,wiki_retrieval,snapshot_json,student_visible,formal_release,current_page,
       r2,embedding,lumi_retrieval,production_deployment,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'ACTIVE','ACTIVE','DISABLED','DISABLED','DISABLED','DISABLED',?)`,
  ).run(snapshot.snapshotId, snapshot.snapshotHash, snapshot.releaseSetHash, snapshot.schemaVersion, snapshot.mode, JSON.stringify(snapshot.releaseIds), JSON.stringify(snapshot.canonicalPageIds), snapshot.channels.BROWSE_RELEASE, snapshot.channels.STUDENT_SEARCH, snapshot.channels.PREVIEW, snapshot.channels.WIKI_RETRIEVAL, JSON.stringify(snapshot), unixSeconds(createdAt));
  return snapshot;
}

export function publishQualifiedInspirationCase(connection: DatabaseConnection, actor: SessionPayload, rawInput: unknown, publishedAt: string | Date = new Date()) {
  assertTeacherInspirationReviewAccess(connection.db, actor);
  const input = FormalReleaseActionSchema.safeParse(rawInput);
  if (!input.success || input.data.action !== "PUBLISH") throw new FormalReleaseConflictError("FORMAL_RELEASE_ACTION_INVALID");
  const at = isoSeconds(publishedAt);
  const requestHash = hashWikiValue(input.data);
  const replay = connection.sqlite.prepare("SELECT request_hash,release_json FROM inspiration_wiki_formal_releases WHERE idempotency_key=?").get(input.data.idempotencyKey) as { request_hash: string; release_json: string } | undefined;
  if (replay) {
    if (replay.request_hash !== requestHash) throw new FormalReleaseConflictError("FORMAL_RELEASE_IDEMPOTENCY_CONFLICT");
    return { release: FormalReleaseSchema.parse(JSON.parse(replay.release_json)), replayed: true as const };
  }
  const releaseCase = readCase(connection, input.data.caseId);
  const qualified = qualifiedDecisionIds(connection, releaseCase.caseId);
  const { publicMaterial, assets, candidateId } = buildCanonicalMaterial(connection, releaseCase, qualified.rightsEvidenceRef);
  const idSuffix = suffix(candidateId);
  const canonicalPageId = `wiki-page:${idSuffix}`;
  const canonicalRevisionId = `wiki-page-revision:${idSuffix}:1`;
  const revisionMaterial: Omit<CanonicalPageRevision, "revisionHash"> = {
    schemaVersion: "lumi-inspiration-canonical-page-revision/v1",
    canonicalPageId,
    canonicalRevisionId,
    revision: 1,
    candidateId,
    sourceCaseId: releaseCase.caseId,
    sourcePrivatePageId: releaseCase.pageId,
    sourcePrivateRevisionId: releaseCase.pageRevisionId,
    sourceContentHash: releaseCase.contentHash,
    publicMaterial,
    compiledAt: at,
    boundary: { canonicalCompilation: "ENABLED", formalRelease: "DISABLED", currentPage: "DISABLED", studentVisible: false, r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED", productionDeployment: "DISABLED" },
  };
  const revision = CanonicalPageRevisionSchema.parse({ ...revisionMaterial, revisionHash: hashWikiValue(revisionMaterial) });
  const releaseId = hashId("wiki-release:", { caseHash: releaseCase.caseHash, revisionHash: revision.revisionHash, qualificationDecisionIds: qualified.ids });
  const releaseMaterial: Omit<FormalRelease, "releaseHash"> = {
    schemaVersion: "lumi-inspiration-formal-release/v1",
    releaseId,
    canonicalPageId,
    canonicalRevisionId,
    caseId: releaseCase.caseId,
    caseHash: releaseCase.caseHash,
    qualificationDecisionIds: qualified.ids,
    publicMaterial,
    status: "PUBLISHED",
    publishedBy: actor.userId,
    publishedAt: at,
    boundary: { studentVisible: true, formalRelease: "ACTIVE", currentPage: "ACTIVE", browseRelease: "ACTIVE", studentSearch: "ACTIVE", preview: "ACTIVE", wikiRetrieval: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED", productionDeployment: "DISABLED" },
  };
  const release = FormalReleaseSchema.parse({ ...releaseMaterial, releaseHash: hashWikiValue(releaseMaterial) });
  const eventMaterial: Omit<CurrentPageEvent, "eventHash"> = {
    schemaVersion: "lumi-inspiration-current-page-event/v1",
    eventId: hashId("current-page-event:", { releaseId, action: "ACTIVATED" }),
    idempotencyKey: input.data.idempotencyKey,
    canonicalPageId,
    canonicalRevisionId,
    releaseId,
    eventType: "ACTIVATED",
    reason: "教师正式发布",
    actorId: actor.userId,
    createdAt: at,
  };
  const event = CurrentPageEventSchema.parse({ ...eventMaterial, eventHash: hashWikiValue(eventMaterial) });
  connection.sqlite.transaction(() => {
    const existing = connection.sqlite.prepare("SELECT case_id FROM inspiration_wiki_formal_releases WHERE case_id=?").get(releaseCase.caseId);
    if (existing) throw new FormalReleaseConflictError("FORMAL_RELEASE_CASE_ALREADY_PUBLISHED");
    connection.sqlite.prepare("INSERT INTO inspiration_wiki_canonical_pages (canonical_page_id,candidate_id,page_type,page_json,canonical,student_visible,current_page,formal_release,created_at) VALUES (?,?, 'INSPIRATION_CASE',?,1,0,'DISABLED','DISABLED',?)")
      .run(canonicalPageId, candidateId, JSON.stringify({ canonicalPageId, candidateId, pageType: "INSPIRATION_CASE", createdAt: at }), unixSeconds(at));
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_canonical_page_revisions
        (canonical_revision_id,canonical_page_id,revision,revision_hash,case_id,source_private_page_id,source_private_revision_id,source_content_hash,material_json,assets_json,student_visible,formal_release,current_page,r2,embedding,lumi_retrieval,production_deployment,compiled_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,'DISABLED','DISABLED','DISABLED','DISABLED','DISABLED','DISABLED',?)`,
    ).run(canonicalRevisionId, canonicalPageId, 1, revision.revisionHash, releaseCase.caseId, releaseCase.pageId, releaseCase.pageRevisionId, releaseCase.contentHash, JSON.stringify(revision), JSON.stringify(assets), unixSeconds(at));
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_formal_releases
        (release_id,release_hash,request_hash,idempotency_key,case_id,case_hash,canonical_page_id,canonical_revision_id,qualification_decision_ids_json,release_json,status,published_by,student_visible,formal_release,current_page,browse_release,student_search,preview,wiki_retrieval,r2,embedding,lumi_retrieval,production_deployment,published_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'PUBLISHED',?,1,'ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE','DISABLED','DISABLED','DISABLED','DISABLED','DISABLED',?)`,
    ).run(releaseId, release.releaseHash, requestHash, input.data.idempotencyKey, releaseCase.caseId, releaseCase.caseHash, canonicalPageId, canonicalRevisionId, JSON.stringify(qualified.ids), JSON.stringify(release), actor.userId, unixSeconds(at));
    connection.sqlite.prepare("INSERT INTO inspiration_wiki_current_page_events (event_id,event_hash,request_hash,idempotency_key,canonical_page_id,canonical_revision_id,release_id,event_type,reason,actor_id,event_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(event.eventId, event.eventHash, requestHash, event.idempotencyKey, canonicalPageId, canonicalRevisionId, releaseId, event.eventType, event.reason, actor.userId, JSON.stringify(event), unixSeconds(at));
    persistActiveSnapshot(connection, at);
  }).immediate();
  return { release, replayed: false as const };
}

export function withdrawFormalInspirationRelease(connection: DatabaseConnection, actor: SessionPayload, rawInput: unknown, withdrawnAt: string | Date = new Date()) {
  assertTeacherInspirationReviewAccess(connection.db, actor);
  const parsed = FormalReleaseActionSchema.safeParse(rawInput);
  if (!parsed.success || parsed.data.action !== "WITHDRAW") throw new FormalReleaseConflictError("FORMAL_RELEASE_ACTION_INVALID");
  const at = isoSeconds(withdrawnAt);
  const requestHash = hashWikiValue(parsed.data);
  const replay = connection.sqlite.prepare("SELECT request_hash,event_json FROM inspiration_wiki_current_page_events WHERE idempotency_key=?").get(parsed.data.idempotencyKey) as { request_hash: string; event_json: string } | undefined;
  if (replay) {
    if (replay.request_hash !== requestHash) throw new FormalReleaseConflictError("FORMAL_RELEASE_IDEMPOTENCY_CONFLICT");
    return { event: CurrentPageEventSchema.parse(JSON.parse(replay.event_json)), replayed: true as const };
  }
  const releaseRow = connection.sqlite.prepare("SELECT release_json FROM inspiration_wiki_formal_releases WHERE release_id=?").get(parsed.data.releaseId) as { release_json: string } | undefined;
  if (!releaseRow) throw new FormalReleaseConflictError("FORMAL_RELEASE_NOT_FOUND");
  const release = FormalReleaseSchema.parse(JSON.parse(releaseRow.release_json));
  const latest = connection.sqlite.prepare("SELECT event_type FROM inspiration_wiki_current_page_events WHERE canonical_page_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(release.canonicalPageId) as { event_type: string } | undefined;
  if (latest?.event_type !== "ACTIVATED") throw new FormalReleaseConflictError("FORMAL_RELEASE_NOT_CURRENT");
  const material: Omit<CurrentPageEvent, "eventHash"> = {
    schemaVersion: "lumi-inspiration-current-page-event/v1",
    eventId: hashId("current-page-event:", { releaseId: release.releaseId, action: "WITHDRAWN", idempotencyKey: parsed.data.idempotencyKey }),
    idempotencyKey: parsed.data.idempotencyKey,
    canonicalPageId: release.canonicalPageId,
    canonicalRevisionId: release.canonicalRevisionId,
    releaseId: release.releaseId,
    eventType: "WITHDRAWN",
    reason: parsed.data.reason,
    actorId: actor.userId,
    createdAt: at,
  };
  const event = CurrentPageEventSchema.parse({ ...material, eventHash: hashWikiValue(material) });
  connection.sqlite.transaction(() => {
    connection.sqlite.prepare("INSERT INTO inspiration_wiki_current_page_events (event_id,event_hash,request_hash,idempotency_key,canonical_page_id,canonical_revision_id,release_id,event_type,reason,actor_id,event_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(event.eventId, event.eventHash, requestHash, event.idempotencyKey, event.canonicalPageId, event.canonicalRevisionId, event.releaseId, event.eventType, event.reason, event.actorId, JSON.stringify(event), unixSeconds(at));
    persistActiveSnapshot(connection, at);
  }).immediate();
  return { event, replayed: false as const };
}

export function readTeacherFormalReleaseQueue(connection: DatabaseConnection, actor: SessionPayload) {
  assertTeacherInspirationReviewAccess(connection.db, actor);
  const rows = connection.sqlite.prepare("SELECT release_json FROM inspiration_wiki_formal_releases ORDER BY published_at,release_id").all() as Array<{ release_json: string }>;
  const items = rows.map(({ release_json }) => {
    const release = FormalReleaseSchema.parse(JSON.parse(release_json));
    const eventRow = connection.sqlite.prepare("SELECT event_json FROM inspiration_wiki_current_page_events WHERE canonical_page_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(release.canonicalPageId) as { event_json: string };
    const currentEvent = CurrentPageEventSchema.parse(JSON.parse(eventRow.event_json));
    return { release, currentState: currentEvent.eventType === "ACTIVATED" ? "ACTIVE" as const : "WITHDRAWN" as const, currentEvent };
  });
  const qualified = connection.sqlite.prepare(
    `SELECT count(*) count FROM inspiration_wiki_release_qualification_cases c
     WHERE NOT EXISTS (SELECT 1 FROM inspiration_wiki_formal_releases r WHERE r.case_id=c.case_id)
       AND 5=(SELECT count(*) FROM (
         SELECT d.gate FROM inspiration_wiki_release_qualification_decisions d
         WHERE d.case_id=c.case_id AND d.status='SATISFIED'
           AND d.revision=(SELECT max(d2.revision) FROM inspiration_wiki_release_qualification_decisions d2 WHERE d2.case_id=d.case_id AND d2.gate=d.gate)
         GROUP BY d.gate
       ))`,
  ).get() as { count: number };
  return TeacherFormalReleaseQueueSchema.parse({
    schemaVersion: "lumi-teacher-formal-release-queue/v1",
    meta: { total: items.length, active: items.filter((item) => item.currentState === "ACTIVE").length, withdrawn: items.filter((item) => item.currentState === "WITHDRAWN").length, qualifiedUnreleased: qualified.count },
    items,
  });
}

export function readActiveFormalReleaseByPublicId(connection: DatabaseConnection, publicId: string) {
  const rows = connection.sqlite.prepare(
    `SELECT r.release_json,rev.assets_json FROM inspiration_wiki_formal_releases r
     JOIN inspiration_wiki_canonical_page_revisions rev ON rev.canonical_revision_id=r.canonical_revision_id
     WHERE (SELECT e.event_type FROM inspiration_wiki_current_page_events e WHERE e.canonical_page_id=r.canonical_page_id ORDER BY e.created_at DESC,e.rowid DESC LIMIT 1)='ACTIVATED'`,
  ).all() as Array<{ release_json: string; assets_json: string }>;
  return rows.flatMap((row) => {
    const release = FormalReleaseSchema.parse(JSON.parse(row.release_json));
    return release.publicMaterial.publicId === publicId ? [{ release, assets: asArray(JSON.parse(row.assets_json)).map((asset) => FormalReleaseAssetSchema.parse(asset)) }] : [];
  })[0] ?? null;
}
