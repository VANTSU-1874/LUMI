import { asc, desc, eq } from "drizzle-orm";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { inspirationWikiCurrentPageEvents, inspirationWikiFormalReleases, inspirationWikiP2ActiveChannelSnapshots, inspirationWikiP2ChannelSnapshots } from "@/lib/db/schema";
import { P2ActiveChannelSnapshotSchema, type P2ActiveChannelSnapshot } from "@/lib/domain/inspiration-wiki/formal-release-contracts";
import {
  P2StudentChannelShadowSnapshotSchema,
  p2StudentChannelShadowSnapshotMaterial,
  type P2StudentChannelShadowSnapshot,
} from "@/lib/domain/inspiration-wiki/p2-student-channel-contracts";
import { hashWikiValue } from "@/lib/domain/inspiration-wiki/integrity";
import { readTeacherReleaseReadiness } from "./inspiration-wiki-release-readiness";

export class P2StudentChannelShadowConflictError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "P2StudentChannelShadowConflictError";
  }
}

function isoSeconds(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("P2 Shadow 时间无效");
  return new Date(Math.floor(date.getTime() / 1_000) * 1_000).toISOString();
}

function assertSnapshotHash(snapshot: P2StudentChannelShadowSnapshot) {
  const { snapshotHash, ...material } = snapshot;
  if (hashWikiValue(p2StudentChannelShadowSnapshotMaterial(material)) !== snapshotHash) {
    throw new P2StudentChannelShadowConflictError("P2_SHADOW_HASH_MISMATCH");
  }
}

function assertActiveSnapshotHash(snapshot: P2ActiveChannelSnapshot) {
  const { snapshotHash, ...material } = snapshot;
  if (hashWikiValue(material) !== snapshotHash) throw new P2StudentChannelShadowConflictError("P2_ACTIVE_HASH_MISMATCH");
}

export function readLatestP2StudentChannelShadowSnapshot(
  db: DatabaseConnection["db"],
): P2StudentChannelShadowSnapshot | null {
  const row = db.select({ snapshotJson: inspirationWikiP2ChannelSnapshots.snapshotJson })
    .from(inspirationWikiP2ChannelSnapshots)
    .orderBy(desc(inspirationWikiP2ChannelSnapshots.createdAt), desc(inspirationWikiP2ChannelSnapshots.snapshotId))
    .limit(1)
    .get();
  if (!row) return null;
  const snapshot = P2StudentChannelShadowSnapshotSchema.parse(row.snapshotJson);
  assertSnapshotHash(snapshot);
  return snapshot;
}

/** Shadow blocks all student reads; Active opens only an integrity-checked exact Current Page release set. */
export function p2StudentChannelBlocksStudentRead(db: DatabaseConnection["db"]) {
  try {
    const shadow = readLatestP2StudentChannelShadowSnapshot(db);
    if (!shadow) return false;
    const events = db.select({
      canonicalPageId: inspirationWikiCurrentPageEvents.canonicalPageId,
      eventType: inspirationWikiCurrentPageEvents.eventType,
      createdAt: inspirationWikiCurrentPageEvents.createdAt,
      eventId: inspirationWikiCurrentPageEvents.eventId,
    }).from(inspirationWikiCurrentPageEvents)
      .orderBy(desc(inspirationWikiCurrentPageEvents.createdAt), desc(inspirationWikiCurrentPageEvents.eventId)).all();
    const latest = new Map<string, "ACTIVATED" | "WITHDRAWN">();
    for (const event of events) if (!latest.has(event.canonicalPageId)) latest.set(event.canonicalPageId, event.eventType);
    const expected = db.select({ releaseId: inspirationWikiFormalReleases.releaseId, canonicalPageId: inspirationWikiFormalReleases.canonicalPageId })
      .from(inspirationWikiFormalReleases).orderBy(asc(inspirationWikiFormalReleases.releaseId)).all()
      .filter((release) => latest.get(release.canonicalPageId) === "ACTIVATED");
    if (expected.length === 0) return true;
    const releaseIds = expected.map((release) => release.releaseId);
    const canonicalPageIds = expected.map((release) => release.canonicalPageId);
    const expectedHash = hashWikiValue({ releaseIds, canonicalPageIds });
    const snapshots = db.select({ snapshotJson: inspirationWikiP2ActiveChannelSnapshots.snapshotJson })
      .from(inspirationWikiP2ActiveChannelSnapshots).all();
    return !snapshots.some((row) => {
      try {
        const snapshot = P2ActiveChannelSnapshotSchema.parse(row.snapshotJson);
        assertActiveSnapshotHash(snapshot);
        return snapshot.releaseSetHash === expectedHash
          && JSON.stringify(releaseIds) === JSON.stringify(snapshot.releaseIds)
          && JSON.stringify(canonicalPageIds) === JSON.stringify(snapshot.canonicalPageIds);
      } catch { return false; }
    });
  } catch {
    return true;
  }
}

export function persistP2StudentChannelShadowSnapshot(
  connection: DatabaseConnection,
  input: unknown,
) {
  const snapshot = P2StudentChannelShadowSnapshotSchema.parse(input);
  assertSnapshotHash(snapshot);
  const existing = connection.db.select({
    snapshotHash: inspirationWikiP2ChannelSnapshots.snapshotHash,
    snapshotJson: inspirationWikiP2ChannelSnapshots.snapshotJson,
  }).from(inspirationWikiP2ChannelSnapshots)
    .where(eq(inspirationWikiP2ChannelSnapshots.snapshotId, snapshot.snapshotId))
    .get();
  if (existing) {
    if (existing.snapshotHash !== snapshot.snapshotHash) {
      throw new P2StudentChannelShadowConflictError("P2_SHADOW_ID_CONFLICT");
    }
    const persisted = P2StudentChannelShadowSnapshotSchema.parse(existing.snapshotJson);
    assertSnapshotHash(persisted);
    return { snapshot: persisted, replayed: true as const };
  }

  connection.db.insert(inspirationWikiP2ChannelSnapshots).values({
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
    sourceReadinessHash: snapshot.sourceReadinessHash,
    sourceSetHash: snapshot.sourceSetHash,
    schemaVersion: snapshot.schemaVersion,
    mode: snapshot.mode,
    browseRelease: snapshot.channels.BROWSE_RELEASE,
    studentSearch: snapshot.channels.STUDENT_SEARCH,
    wikiRetrieval: snapshot.channels.WIKI_RETRIEVAL,
    totalCount: snapshot.source.total,
    eligibleCount: snapshot.source.eligible,
    blockedCount: snapshot.source.blocked,
    rightsUnknownCount: snapshot.source.rightsUnknown,
    eligiblePageIdsJson: [...snapshot.eligiblePageIds],
    restrictedPageIdsJson: [...snapshot.restrictedPageIds],
    snapshotJson: snapshot,
    studentVisible: false,
    productionDeployment: "DISABLED",
    formalRelease: "DISABLED",
    currentPage: "DISABLED",
    r2: "DISABLED",
    embedding: "DISABLED",
    lumiRetrieval: "DISABLED",
    createdAt: new Date(snapshot.createdAt),
  }).run();
  return { snapshot, replayed: false as const };
}

export function buildAndPersistP2StudentChannelShadowSnapshot(
  connection: DatabaseConnection,
  actor: SessionPayload,
  createdAt: string | Date = new Date(),
) {
  const readiness = readTeacherReleaseReadiness(connection, actor, createdAt);
  if (readiness.meta.eligible !== 0) {
    throw new P2StudentChannelShadowConflictError("P2_SHADOW_REQUIRES_ZERO_ELIGIBLE_PAGES");
  }
  const restrictedPageIds = readiness.items.map((item) => item.pageId)
    .sort((left, right) => left.localeCompare(right));
  const sourceSetHash = hashWikiValue(readiness.items.map((item) => ({
    entryId: item.entryId,
    pageId: item.pageId,
    revision: item.revision,
    rightsScope: item.rightsScope,
  })).sort((left, right) => left.pageId.localeCompare(right.pageId)));
  const sourceReadinessHash = hashWikiValue({
    sourceSetHash,
    schemaVersion: readiness.schemaVersion,
    total: readiness.meta.total,
    eligible: readiness.meta.eligible,
    blocked: readiness.meta.blocked,
    rightsUnknown: readiness.meta.rightsUnknown,
    states: readiness.items.map((item) => ({ pageId: item.pageId, state: item.state }))
      .sort((left, right) => left.pageId.localeCompare(right.pageId)),
  });
  const existing = connection.db.select({ snapshotJson: inspirationWikiP2ChannelSnapshots.snapshotJson })
    .from(inspirationWikiP2ChannelSnapshots)
    .where(eq(inspirationWikiP2ChannelSnapshots.sourceReadinessHash, sourceReadinessHash))
    .get();
  if (existing) {
    const snapshot = P2StudentChannelShadowSnapshotSchema.parse(existing.snapshotJson);
    assertSnapshotHash(snapshot);
    return { snapshot, replayed: true as const };
  }
  const material: Omit<P2StudentChannelShadowSnapshot, "snapshotHash"> = {
    schemaVersion: "lumi-inspiration-p2-channel-shadow-snapshot/v1",
    snapshotId: `p2-channel-shadow:${sourceReadinessHash.slice(7, 39)}`,
    sourceReadinessHash,
    sourceSetHash,
    mode: "SHADOW",
    channels: {
      BROWSE_RELEASE: "SHADOW",
      STUDENT_SEARCH: "SHADOW",
      WIKI_RETRIEVAL: "DISABLED",
    },
    source: {
      releaseReadinessSchemaVersion: readiness.schemaVersion,
      total: readiness.meta.total,
      eligible: 0,
      blocked: readiness.meta.blocked,
      rightsUnknown: readiness.meta.rightsUnknown,
    },
    eligiblePageIds: [],
    restrictedPageIds,
    exposure: {
      browsePageIds: [],
      searchablePageIds: [],
      previewPageIds: [],
      lumiContextPageIds: [],
    },
    boundary: {
      studentVisible: false,
      productionDeployment: "DISABLED",
      formalRelease: "DISABLED",
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
    },
    createdAt: isoSeconds(createdAt),
  };
  return persistP2StudentChannelShadowSnapshot(connection, {
    ...material,
    snapshotHash: hashWikiValue(p2StudentChannelShadowSnapshotMaterial(material)),
  });
}
