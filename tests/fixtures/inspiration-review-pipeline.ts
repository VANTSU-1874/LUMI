import type {
  InspirationCasePrivateAnalysis,
  InspirationCasePrivateCandidate,
  InspirationCaseTeacherReviewPackage,
} from "@/lib/agent/inspiration-case-intake";
import { InspirationSourceRegistrySchema, recentDesignSourceAdapterCandidate } from "@/lib/agent/inspiration-source-registry";
import type { FormalWikiStudentPublicationInput } from "@/lib/domain/inspiration-eligibility";
import { privateCandidateAnalysis, privateCandidateIntake, teacherReviewPackage } from "@/tests/fixtures/inspiration-case-intake";

export const reviewPipelineSourceFixture = InspirationSourceRegistrySchema.parse({
  ...recentDesignSourceAdapterCandidate,
  id: "inspiration-source:synthetic-review-fixture",
  displayName: "Synthetic reviewed source fixture",
  entrypoints: ["https://example.org/"],
  studentPublication: { publicLinkReview: "REVIEWED", allowedPublicHosts: ["example.org"] },
});

export function formalStudentPublicationFixture(
  publicSource: FormalWikiStudentPublicationInput["publicSource"] = { label: "审核公开来源", url: "https://example.org/source" },
): FormalWikiStudentPublicationInput {
  return {
    publicationScope: "AUTHENTICATED_STUDENT_ONLY",
    studentVisible: true,
    studentDisplayDecision: "ALLOW",
    sourceDisclosureDecision: "ALLOW",
    teachingDecision: "ALLOW",
    safetyDecision: "ALLOW",
    qualityDecision: "ALLOW",
    withdrawalReadiness: "READY",
    browserChannel: "ACTIVE",
    bridgeChannel: "ACTIVE",
    publicSource,
  };
}

export type ReviewPipelineFixture = {
  candidate: InspirationCasePrivateCandidate;
  analysis: InspirationCasePrivateAnalysis;
  reviewPackage: InspirationCaseTeacherReviewPackage;
};

function fixture(id: string, title: string, index: number, metadataOnly = false): ReviewPipelineFixture {
  const template = privateCandidateIntake();
  const curation = {
    ...template.curation,
    title,
    curationSourceUrl: null,
    originalSourceDisplay: null,
    originalSourceUrl: null,
  };
  const candidate = privateCandidateIntake({
    id,
    curation,
    withdrawal: { status: "READY", complaintLocator: null },
    rights: {
      ...template.rights,
      decisions: { ...template.rights.decisions, STUDENT_DISPLAY: "ALLOW" },
    },
    asset: metadataOnly
      ? { mode: "METADATA_ONLY", privateAssetRef: null, contentHash: null }
      : {
        mode: "PRIVATE_COPY",
        privateAssetRef: `private-candidate://fixture/recent-${index}.webp`,
        contentHash: `sha256:${String(index).repeat(64)}`,
      },
  });
  const analysis = privateCandidateAnalysis({
    candidateId: id,
    processing: { requestedChannel: "NONE", actualChannel: "NONE", providerLabel: null, transmittedToThirdParty: false, recordedAt: "2026-08-09T00:00:00.000Z" },
  });
  const reviewPackage = teacherReviewPackage({
    candidateId: id,
    preview: metadataOnly ? { mode: "METADATA_ONLY", privateAssetRef: null } : { mode: "PRIVATE_PREVIEW", privateAssetRef: candidate.asset.privateAssetRef },
    processingLog: analysis.processing,
  });
  return { candidate, analysis, reviewPackage };
}

/** Synthetic, path-free equivalents of five Recent previews plus Fin metadata. */
export const recentReviewPipelineFixtures = [
  fixture("inspiration-intake:recent-grid-rhythm", "Recent grid rhythm", 1),
  fixture("inspiration-intake:recent-token-contrast", "Recent token contrast", 2),
  fixture("inspiration-intake:recent-motion-window", "Recent motion window", 3),
  fixture("inspiration-intake:recent-portrait-labels", "Recent portrait labels", 4),
  fixture("inspiration-intake:recent-operational-type", "Recent operational type", 5),
  (() => {
    const value = fixture("inspiration-intake:recent-fin-metadata", "Fin", 6, true);
    value.candidate.curation = {
      ...value.candidate.curation,
      collection: "OG Images", type: "OG Images", originalSourceDisplay: "fin.ai", category: "SaaS",
      styles: ["Typographic", "Minimal", "Clean", "3D", "3D Illustration"], colors: ["Black & White", "Muted"],
    };
    return value;
  })(),
] as const;
