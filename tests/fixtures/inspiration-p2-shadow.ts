import {
  p2StudentChannelShadowSnapshotMaterial,
  type P2StudentChannelShadowSnapshot,
} from "@/lib/domain/inspiration-wiki/p2-student-channel-contracts";
import { hashWikiValue } from "@/lib/domain/inspiration-wiki/integrity";

export function p2StudentChannelShadowFixture(
  pageIds = [`private-wiki-page:${"1".repeat(32)}`],
): P2StudentChannelShadowSnapshot {
  const sourceSetHash = hashWikiValue(pageIds);
  const sourceReadinessHash = hashWikiValue({ sourceSetHash, total: pageIds.length, eligible: 0 });
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
      releaseReadinessSchemaVersion: "lumi-inspiration-release-readiness-audit/v1",
      total: pageIds.length,
      eligible: 0,
      blocked: pageIds.length,
      rightsUnknown: pageIds.length,
    },
    eligiblePageIds: [],
    restrictedPageIds: pageIds,
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
    createdAt: "2026-08-13T00:00:00.000Z",
  };
  return {
    ...material,
    snapshotHash: hashWikiValue(p2StudentChannelShadowSnapshotMaterial(material)),
  };
}
