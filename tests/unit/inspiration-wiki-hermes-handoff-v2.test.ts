import { describe, expect, it } from "vitest";

import {
  createHermesHandoffV2Candidate,
  createHermesHandoffV2Manifest,
  parseImmutableHermesHandoffV2Candidate,
  parseImmutableHermesHandoffV2Manifest,
} from "@/lib/domain/inspiration-wiki/hermes-handoff-v2";
import {
  createVisualAnalysisDraft,
  createVisualAnalysisRequest,
  parseVisualAnalysisDraftAgainstRequest,
  parseVisualAnalysisRequestAgainstCandidate,
} from "@/lib/domain/inspiration-wiki/visual-analysis";
import type {
  HermesHandoffV2CandidateSeed,
  HermesHandoffV2ManifestInput,
} from "@/lib/domain/inspiration-wiki/hermes-handoff-v2-contracts";
import type { VisualAnalysisDraftSeed } from "@/lib/domain/inspiration-wiki/visual-analysis-contracts";
import { hashWikiValue } from "@/lib/domain/inspiration-wiki/integrity";

const H1 = `sha256:${"1".repeat(64)}`;
const H2 = `sha256:${"2".repeat(64)}`;

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function staticCandidateSeed(): Mutable<HermesHandoffV2CandidateSeed> {
  return {
    schemaVersion: "lumi-hermes-inspiration-handoff/v2",
    batchId: "hermes-batch:web-mass-002",
    candidateId: "candidate:web-static-001",
    reviewStatus: "PENDING_REVIEW",
    scope: "PRIVATE_CANDIDATE",
    studentVisible: false,
    source: {
      sourceId: "source:recent-design",
      platform: "RECENT_DESIGN",
      pageUrl: "https://recent.design/projects/packaging-one",
      canonicalUrl: "https://recent.design/projects/packaging-one",
      externalId: "packaging-one",
      discoveredAt: "2026-08-11T05:00:00.000Z",
      taxonomyPaths: [{
        pathId: "taxonomy:path-packaging",
        labels: ["Design", "Packaging", "Food"],
        sourceUrl: "https://recent.design/categories/packaging",
        observedAt: "2026-08-11T05:00:00.000Z",
      }],
      sourceStyleRaw: [{
        termId: "source-style:minimal",
        raw: "Minimal",
        sourceUrl: "https://recent.design/projects/packaging-one",
        observedAt: "2026-08-11T05:00:00.000Z",
      }],
      mediumOrTechnologyRaw: [{
        termId: "source-medium:paperboard",
        raw: "Paperboard",
        sourceUrl: "https://recent.design/projects/packaging-one",
        observedAt: "2026-08-11T05:00:00.000Z",
      }],
    },
    content: {
      title: "Packaging One",
      description: "A public project description.",
      authorOrStudio: "Example Studio",
      publishedAt: "2026-07-01T00:00:00.000Z",
    },
    sourceStatements: [{
      statementId: "source-statement:packaging-medium",
      text: "The project page identifies paperboard as the packaging material.",
      sourceUrl: "https://recent.design/projects/packaging-one",
      observedAt: "2026-08-11T05:00:00.000Z",
    }],
    designCategories: ["PACKAGING", "BRANDING"],
    workModalities: ["STATIC"],
    media: [{
      mediaId: "media:packaging-hero",
      kind: "IMAGE",
      role: "HERO",
      sourceUrl: "https://cdn.recent.design/packaging-one.jpg",
      declaredMimeType: "image/jpeg",
      width: 1600,
      height: 1200,
      durationMs: null,
      asset: {
        path: "assets/packaging-one.jpg",
        sha256: H1,
        bytes: 123_456,
        mimeType: "image/jpeg",
      },
    }],
    dynamicEvidence: [],
    rightsStatus: "UNKNOWN",
    dedupeFingerprint: H2,
  };
}

function dynamicCandidateSeed(): Mutable<HermesHandoffV2CandidateSeed> {
  const seed = staticCandidateSeed();
  seed.candidateId = "candidate:web-interactive-001";
  seed.content.title = "Interactive Light Field";
  seed.designCategories = ["INTERACTION_DESIGN", "MOTION", "IMMERSIVE_EXPERIENCE"];
  seed.workModalities = ["TIME_BASED", "INTERACTIVE"];
  seed.sourceStatements = [{
    statementId: "source-statement:interaction",
    text: "The project page describes a responsive interactive installation.",
    sourceUrl: "https://recent.design/projects/packaging-one",
    observedAt: "2026-08-11T05:00:00.000Z",
  }];
  seed.media.push({
    mediaId: "media:interaction-demo",
    kind: "VIDEO",
    role: "INTERACTION_DEMO",
    sourceUrl: "https://cdn.recent.design/interaction-demo.mp4",
    declaredMimeType: "video/mp4",
    width: 1920,
    height: 1080,
    durationMs: 60_000,
    asset: null,
  });
  seed.dynamicEvidence = [
    {
      evidenceId: "dynamic-evidence:motion",
      modality: "TIME_BASED",
      evidenceKind: "DIRECT_MOTION",
      mediaIds: ["media:interaction-demo"],
      sourceStatementIds: ["source-statement:interaction"],
      coverage: "DIRECT",
    },
    {
      evidenceId: "dynamic-evidence:interaction",
      modality: "INTERACTIVE",
      evidenceKind: "DIRECT_INTERACTION",
      mediaIds: ["media:interaction-demo"],
      sourceStatementIds: ["source-statement:interaction"],
      coverage: "DIRECT",
    },
  ];
  return seed;
}

function manifestInput(): Mutable<HermesHandoffV2ManifestInput> {
  return {
    schemaVersion: "lumi-hermes-inspiration-handoff-manifest/v2",
    batchId: "hermes-batch:web-mass-002",
    producer: { name: "Hermes", version: "1.0.0" },
    producedAt: "2026-08-11T06:00:00.000Z",
    reviewStatus: "PENDING_REVIEW",
    importTarget: "LUMI_TEACHER_PRIVATE_CANDIDATE",
    containsStudentData: false,
    containsCredentials: false,
  };
}

function draftSeedFor(
  request: ReturnType<typeof createVisualAnalysisRequest>,
): Mutable<VisualAnalysisDraftSeed> {
  return {
    schemaVersion: "lumi-inspiration-visual-analysis-draft/v1",
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    candidateId: request.candidateId,
    candidateMaterialDigest: request.candidateMaterialDigest,
    authorship: "MODEL_DRAFT",
    createdAt: "2026-08-11T06:10:00.000Z",
    claims: [{
      claimId: "visual-claim:composition",
      claimType: "VISIBLE_OBSERVATION",
      dimension: "COMPOSITION",
      text: "The central object is surrounded by a wide field of negative space.",
      confidence: "HIGH",
      mediaAnchors: [{
        mediaId: "media:packaging-hero",
        region: { x: 0, y: 0, width: 1, height: 1 },
        timeRangeMs: null,
      }],
      sourceStatementIds: [],
    }],
    keywordProposals: [{
      proposalId: "visual-keyword:minimal-composition",
      dimension: "STYLE",
      proposedTerm: "minimal composition",
      supportClaimIds: ["visual-claim:composition"],
      state: "MODEL_DRAFT",
    }],
  };
}

describe("Hermes handoff v2 static and dynamic project material", () => {
  it("keeps source taxonomy, style, and technology dimensions separate without mutating caller input", () => {
    const input = staticCandidateSeed();
    const candidate = createHermesHandoffV2Candidate(input);

    expect(candidate.source.taxonomyPaths[0].labels).toEqual(["Design", "Packaging", "Food"]);
    expect(candidate.source.sourceStyleRaw[0].raw).toBe("Minimal");
    expect(candidate.source.mediumOrTechnologyRaw[0].raw).toBe("Paperboard");
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);

    input.content.title = "Caller changed title";
    input.source.sourceStyleRaw[0].raw = "Caller changed style";
    expect(candidate.content.title).toBe("Packaging One");
    expect(candidate.source.sourceStyleRaw[0].raw).toBe("Minimal");
  });

  it("accepts exact video evidence for time-based and interactive behavior", () => {
    const candidate = createHermesHandoffV2Candidate(dynamicCandidateSeed());
    expect(candidate.workModalities).toEqual(["TIME_BASED", "INTERACTIVE"]);
    expect(candidate.dynamicEvidence).toHaveLength(2);
  });

  it("accepts source-attested partial documentation without claiming direct interaction", () => {
    const seed = dynamicCandidateSeed();
    seed.workModalities = ["INTERACTIVE"];
    seed.media = [seed.media[0]];
    seed.dynamicEvidence = [{
      evidenceId: "dynamic-evidence:source-attested",
      modality: "INTERACTIVE",
      evidenceKind: "SOURCE_ATTESTED",
      mediaIds: ["media:packaging-hero"],
      sourceStatementIds: ["source-statement:interaction"],
      coverage: "SOURCE_ATTESTED_PARTIAL",
    }];

    const candidate = createHermesHandoffV2Candidate(seed);
    expect(candidate.dynamicEvidence[0].coverage).toBe("SOURCE_ATTESTED_PARTIAL");
  });

  it("rejects a dynamic modality with no exact evidence", () => {
    const seed = dynamicCandidateSeed();
    seed.dynamicEvidence = seed.dynamicEvidence.filter((item) => item.modality !== "INTERACTIVE");
    expect(() => createHermesHandoffV2Candidate(seed))
      .toThrow("DYNAMIC_MODALITY_EVIDENCE_MISSING:INTERACTIVE");
  });

  it("rejects a static poster frame masquerading as direct motion", () => {
    const seed = dynamicCandidateSeed();
    seed.workModalities = ["TIME_BASED"];
    seed.dynamicEvidence = [{
      evidenceId: "dynamic-evidence:counterfeit-motion",
      modality: "TIME_BASED",
      evidenceKind: "DIRECT_MOTION",
      mediaIds: ["media:packaging-hero"],
      sourceStatementIds: ["source-statement:interaction"],
      coverage: "DIRECT",
    }];
    expect(() => createHermesHandoffV2Candidate(seed))
      .toThrow("DYNAMIC_EVIDENCE_MEDIA_KIND_MISMATCH");
  });

  it("rejects an uncredentialed-looking URL when an access token is embedded", () => {
    const seed = staticCandidateSeed();
    seed.source.pageUrl = "https://recent.design/projects/packaging-one?access_token=secret";
    expect(() => createHermesHandoffV2Candidate(seed))
      .toThrow("HERMES_SOURCE_URL_ACCESS_QUERY_FORBIDDEN");
  });

  it("binds a manifest to the exact candidate material set", () => {
    const candidate = createHermesHandoffV2Candidate(staticCandidateSeed());
    const manifest = createHermesHandoffV2Manifest(manifestInput(), [candidate]);
    const counterfeit = structuredClone(candidate) as Record<string, unknown> & {
      content: { title: string };
      materialDigest: string;
    };
    counterfeit.content.title = "Counterfeit title";
    const counterfeitSeed = Object.fromEntries(
      Object.entries(counterfeit).filter(([key]) => key !== "materialDigest"),
    );
    counterfeit.materialDigest = hashWikiValue(counterfeitSeed);

    expect(() => parseImmutableHermesHandoffV2Manifest(manifest, [counterfeit]))
      .toThrow("HERMES_MANIFEST_CANDIDATE_SET_MISMATCH");
  });

  it("rejects two different materials reusing the same candidate identity", () => {
    const first = createHermesHandoffV2Candidate(staticCandidateSeed());
    const secondSeed = staticCandidateSeed();
    secondSeed.content.title = "Different material, same candidate id";
    const second = createHermesHandoffV2Candidate(secondSeed);

    expect(() => createHermesHandoffV2Manifest(manifestInput(), [first, second]))
      .toThrow("HERMES_MANIFEST_CANDIDATE_ID_DUPLICATE");
  });

  it("rejects a stale candidate material digest after any media field changes", () => {
    const candidate = createHermesHandoffV2Candidate(dynamicCandidateSeed());
    const stale = structuredClone(candidate) as unknown as { media: Array<{ role: string }> };
    stale.media[1].role = "SCREEN_RECORDING";
    expect(() => parseImmutableHermesHandoffV2Candidate(stale))
      .toThrow("STALE_HERMES_CANDIDATE_MATERIAL_DIGEST");
  });
});

describe("visual analysis draft evidence boundary", () => {
  it("derives an immutable request from exact candidate source and media material", () => {
    const candidate = createHermesHandoffV2Candidate(staticCandidateSeed());
    const request = createVisualAnalysisRequest(candidate, { requestedAt: "2026-08-11T06:05:00.000Z" });
    expect(request.candidateMaterialDigest).toBe(candidate.materialDigest);
    expect(request.mediaBindings[0].mediaId).toBe("media:packaging-hero");
    expect(Object.isFrozen(request)).toBe(true);
  });

  it("accepts a visible style proposal supported by an exact image observation", () => {
    const candidate = createHermesHandoffV2Candidate(staticCandidateSeed());
    const request = createVisualAnalysisRequest(candidate, { requestedAt: "2026-08-11T06:05:00.000Z" });
    const input = draftSeedFor(request);
    const draft = createVisualAnalysisDraft(input, request, candidate);
    input.claims[0].text = "Caller changed claim";

    expect(draft.keywordProposals[0].dimension).toBe("STYLE");
    expect(draft.claims[0].text).toContain("negative space");
  });

  it("accepts motion and interaction observations only with time-addressed behavior media", () => {
    const candidate = createHermesHandoffV2Candidate(dynamicCandidateSeed());
    const request = createVisualAnalysisRequest(candidate, { requestedAt: "2026-08-11T06:05:00.000Z" });
    const seed = draftSeedFor(request);
    seed.claims = [
      {
        claimId: "visual-claim:motion",
        claimType: "VISIBLE_OBSERVATION",
        dimension: "MOTION",
        text: "Light bands accelerate across the display.",
        confidence: "HIGH",
        mediaAnchors: [{ mediaId: "media:interaction-demo", region: null, timeRangeMs: { startMs: 2_000, endMs: 8_000 } }],
        sourceStatementIds: [],
      },
      {
        claimId: "visual-claim:interaction",
        claimType: "VISIBLE_OBSERVATION",
        dimension: "INTERACTION",
        text: "The display changes after a documented participant gesture.",
        confidence: "MEDIUM",
        mediaAnchors: [{ mediaId: "media:interaction-demo", region: null, timeRangeMs: { startMs: 10_000, endMs: 18_000 } }],
        sourceStatementIds: [],
      },
    ];
    seed.keywordProposals = [
      {
        proposalId: "visual-keyword:responsive-motion",
        dimension: "MOTION",
        proposedTerm: "responsive motion",
        supportClaimIds: ["visual-claim:motion"],
        state: "MODEL_DRAFT",
      },
      {
        proposalId: "visual-keyword:gesture-interaction",
        dimension: "INTERACTION",
        proposedTerm: "gesture interaction",
        supportClaimIds: ["visual-claim:interaction"],
        state: "MODEL_DRAFT",
      },
    ];

    expect(createVisualAnalysisDraft(seed, request, candidate).claims).toHaveLength(2);
  });

  it("rejects a motion observation derived only from a static cover", () => {
    const candidate = createHermesHandoffV2Candidate(staticCandidateSeed());
    const request = createVisualAnalysisRequest(candidate, { requestedAt: "2026-08-11T06:05:00.000Z" });
    const seed = draftSeedFor(request);
    seed.claims[0].dimension = "MOTION";
    expect(() => createVisualAnalysisDraft(seed, request, candidate))
      .toThrow("VISUAL_MOTION_CLAIM_REQUIRES_DYNAMIC_MEDIA");
  });

  it("rejects an interaction observation from source-attested static documentation", () => {
    const seedCandidate = dynamicCandidateSeed();
    seedCandidate.workModalities = ["INTERACTIVE"];
    seedCandidate.media = [seedCandidate.media[0]];
    seedCandidate.dynamicEvidence = [{
      evidenceId: "dynamic-evidence:source-attested",
      modality: "INTERACTIVE",
      evidenceKind: "SOURCE_ATTESTED",
      mediaIds: ["media:packaging-hero"],
      sourceStatementIds: ["source-statement:interaction"],
      coverage: "SOURCE_ATTESTED_PARTIAL",
    }];
    const candidate = createHermesHandoffV2Candidate(seedCandidate);
    const request = createVisualAnalysisRequest(candidate, { requestedAt: "2026-08-11T06:05:00.000Z" });
    const seed = draftSeedFor(request);
    seed.claims[0].dimension = "INTERACTION";
    expect(() => createVisualAnalysisDraft(seed, request, candidate))
      .toThrow("VISUAL_INTERACTION_CLAIM_REQUIRES_BEHAVIOR_EVIDENCE");
  });

  it("rejects technology inferred from visual appearance instead of source evidence", () => {
    const candidate = createHermesHandoffV2Candidate(staticCandidateSeed());
    const request = createVisualAnalysisRequest(candidate, { requestedAt: "2026-08-11T06:05:00.000Z" });
    const seed = draftSeedFor(request);
    seed.claims[0].dimension = "TECHNOLOGY";
    expect(() => createVisualAnalysisDraft(seed, request, candidate))
      .toThrow("VISUAL_APPEARANCE_CANNOT_PROVE_TECHNOLOGY");
  });

  it("accepts technology only as a source fact bound to the exact statement", () => {
    const candidate = createHermesHandoffV2Candidate(staticCandidateSeed());
    const request = createVisualAnalysisRequest(candidate, { requestedAt: "2026-08-11T06:05:00.000Z" });
    const seed = draftSeedFor(request);
    seed.claims = [{
      claimId: "visual-claim:technology-source",
      claimType: "SOURCE_FACT",
      dimension: "TECHNOLOGY",
      text: "The source identifies paperboard as the material.",
      confidence: "HIGH",
      mediaAnchors: [],
      sourceStatementIds: ["source-statement:packaging-medium"],
    }];
    seed.keywordProposals = [{
      proposalId: "visual-keyword:paperboard",
      dimension: "TECHNOLOGY",
      proposedTerm: "paperboard",
      supportClaimIds: ["visual-claim:technology-source"],
      state: "MODEL_DRAFT",
    }];
    expect(createVisualAnalysisDraft(seed, request, candidate).claims[0].claimType).toBe("SOURCE_FACT");
  });

  it("fails closed on foreign media and stale request/candidate bindings", () => {
    const candidate = createHermesHandoffV2Candidate(staticCandidateSeed());
    const request = createVisualAnalysisRequest(candidate, { requestedAt: "2026-08-11T06:05:00.000Z" });
    const seed = draftSeedFor(request);
    seed.claims[0].mediaAnchors[0].mediaId = "media:foreign-cover";
    expect(() => createVisualAnalysisDraft(seed, request, candidate))
      .toThrow("VISUAL_CLAIM_MEDIA_OUTSIDE_REQUEST");

    const changedSeed = staticCandidateSeed();
    changedSeed.content.title = "Changed exact candidate";
    const changedCandidate = createHermesHandoffV2Candidate(changedSeed);
    expect(() => parseVisualAnalysisRequestAgainstCandidate(request, changedCandidate))
      .toThrow("VISUAL_ANALYSIS_REQUEST_CANDIDATE_BINDING_MISMATCH");
  });

  it("rejects a stale analysis digest after model draft text changes", () => {
    const candidate = createHermesHandoffV2Candidate(staticCandidateSeed());
    const request = createVisualAnalysisRequest(candidate, { requestedAt: "2026-08-11T06:05:00.000Z" });
    const draft = createVisualAnalysisDraft(draftSeedFor(request), request, candidate);
    const stale = structuredClone(draft) as unknown as { claims: Array<{ text: string }> };
    stale.claims[0].text = "Changed after digest";
    expect(() => parseVisualAnalysisDraftAgainstRequest(stale, request, candidate))
      .toThrow("STALE_VISUAL_ANALYSIS_DIGEST");
  });
});
