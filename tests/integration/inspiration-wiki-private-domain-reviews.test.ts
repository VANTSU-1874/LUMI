// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { privateDraftCompletion, PrivateWikiDraftSchema, type PrivateWikiDraft } from "@/lib/domain/inspiration-wiki/private-draft-contracts";
import {
  approveTeacherPrivateNonTeachingDomains,
  decideTeacherPrivateTeachingBatch,
  decideTeacherPrivateDomainReview,
  preparePrivateDomainReviewCases,
  readTeacherPrivateDomainReviewCase,
  readTeacherPrivateDomainReviewQueue,
} from "@/lib/services/inspiration-wiki-private-domain-reviews";
import {
  compileEligiblePrivateWikiPages,
  readTeacherPrivateWikiPage,
  readTeacherPrivateWikiPageQueue,
} from "@/lib/services/inspiration-wiki-private-compilation";
import {
  admitApprovedPrivatePagesToInternalCatalog,
  readTeacherPrivateInternalCatalog,
} from "@/lib/services/inspiration-wiki-private-catalog-governance";
import { readTeacherReleaseReadiness } from "@/lib/services/inspiration-wiki-release-readiness";

const teacher = { userId: "teacher", role: "TEACHER" as const };
const candidateId = `hermes-candidate:${"1".repeat(32)}`;
let connection: DatabaseConnection;
let directory: string;

function stableJson(value: unknown) { return JSON.stringify(value); }

function seedReadyDraft() {
  connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','Test teacher',1700000000);");
  connection.sqlite.prepare(`INSERT INTO inspiration_wiki_hermes_batches(
    batch_id,contract_version,package_digest,manifest_json,done_json,candidate_count,failure_count,
    intake_state,student_visible,current_page,r2,embedding,lumi_retrieval,imported_at
  ) VALUES('domain-review-batch','LEGACY_V1',?,'{}','{}',1,0,'VALIDATED_PRIVATE',0,'DISABLED','DISABLED','DISABLED','DISABLED',1700000000)`).run("a".repeat(64));
  connection.sqlite.prepare(`INSERT INTO inspiration_wiki_hermes_candidates(
    id,batch_id,source_candidate_id,revision,contract_state,review_state,source_id,source_platform,
    page_url,canonical_url,title,description,author_json,license_json,media_json,design_categories_json,
    screening_json,raw_candidate_json,raw_digest,dedupe_fingerprint,scope,student_visible,wiki_draft,
    current_page,r2,embedding,lumi_retrieval,created_at,updated_at
  ) VALUES(?,'domain-review-batch','source-domain-review',1,'V1_UPGRADE_REQUIRED','PENDING_REVIEW','source-1','BEHANCE',
    'https://www.behance.net/gallery/123456789/domain-review',NULL,'测试视觉项目',NULL,NULL,NULL,
    '[{"kind":"IMAGE","asset":null}]','["OTHER"]','{"totalScore":0,"evidence":[]}','{}',?,?,
    'PRIVATE_CANDIDATE',0,'NOT_CREATED','DISABLED','DISABLED','DISABLED','DISABLED',1700000000,1700000000)`).run(candidateId, "b".repeat(64), "c".repeat(64));
  const editable: PrivateWikiDraft["editable"] = {
    title: "测试视觉项目",
    summary: "以高对比几何构成组织标题和阅读层级。",
    classification: { primary: "海报设计", secondary: ["字体设计"] },
    artisticStyle: { labels: ["几何抽象"], rationale: "由几何色块和高对比字形构成。" },
    curation: { recommendation: "RECOMMEND", rationale: "具备清晰的构成比较价值。" },
    teaching: { recommendation: "RECOMMEND", rationale: "适合分析信息层级。", prompts: ["如何建立层级？"], cautions: ["不推断商业效果。"] },
    media: [{ mediaId: "media-cover", previewUrl: "/api/teacher/inspiration-wiki/review-packs/review-pack:test/media/media-cover", role: "COVER", alt: "测试海报", width: 800, height: 1000, sha256: "d".repeat(64) }],
    editorialNote: "",
  };
  const draft = PrivateWikiDraftSchema.parse({
    schemaVersion: "lumi-inspiration-private-working-draft/v1",
    draftId: `private-wiki-draft:${"1".repeat(32)}`,
    candidateId,
    sourceReview: { contractKind: "STRICT_REVIEW_PACK", reviewPackId: "review-pack:test", reviewPackRevision: 1, decisionId: "decision-test", decisionAction: "ENTER_PRIVATE_WIKIDRAFT", acceptedGapKeys: [] },
    revision: 2,
    stage: "READY_FOR_DOMAIN_REVIEW",
    contentHash: "e".repeat(64),
    updatedAt: "2026-08-12T16:20:00.000Z",
    editable,
    work: { creators: ["测试作者"], year: "2026" },
    sourceRecords: [{ sourceId: "source-1", platform: "BEHANCE", pageUrl: "https://www.behance.net/gallery/123456789/domain-review", role: "CREATOR_WORK_PAGE", creatorName: "测试作者", curatorName: null }],
    rights: { status: "UNKNOWN", evidenceSummaries: ["权利状态未知"], formalRepublicationAllowed: false },
    visualObservations: [{ observation: "高对比几何构成。", mediaIds: ["media-cover"] }],
    duplicateRelationship: { status: "DISTINCT", relatedCandidateIds: [], explanation: "未发现重复。" },
    safety: { status: "READY_FOR_TEACHER_DECISION", evidence: ["不含学生数据。"] },
    evidenceGaps: [],
    completion: privateDraftCompletion(editable),
    capabilityBoundary: { teacherPrivate: true, studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" },
  });
  connection.sqlite.prepare(`INSERT INTO inspiration_wiki_private_working_drafts(
    draft_id,candidate_id,source_review_pack_id,source_contract_kind,source_review_revision,
    source_decision_id,revision,stage,content_hash,draft_json,title,primary_category,
    completion_count,primary_preview_url,rights_status,teacher_private,student_visible,
    current_page,r2,embedding,lumi_retrieval,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,'DISABLED','DISABLED','DISABLED','DISABLED',1700000000,1700000000)`).run(
    draft.draftId, draft.candidateId, draft.sourceReview.reviewPackId, draft.sourceReview.contractKind,
    draft.sourceReview.reviewPackRevision, draft.sourceReview.decisionId, draft.revision, draft.stage,
    draft.contentHash, stableJson(draft), draft.editable.title, draft.editable.classification.primary,
    draft.completion.completedCount, draft.editable.media[0]!.previewUrl, draft.rights.status,
  );
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lumi-private-domain-review-"));
  const databasePath = path.join(directory, "domain.sqlite");
  runMigrations(databasePath);
  connection = createDb(databasePath);
  seedReadyDraft();
});

afterEach(async () => { connection.sqlite.close(); await rm(directory, { recursive: true, force: true }); });

describe("private domain review service", () => {
  it("prepares exactly one current case and keeps every release capability disabled", () => {
    expect(preparePrivateDomainReviewCases(connection, "2026-08-12T16:30:00.000Z")).toEqual({ total: 1, imported: 1, replayed: 0 });
    expect(preparePrivateDomainReviewCases(connection, "2026-08-12T16:30:00.000Z")).toEqual({ total: 1, imported: 0, replayed: 1 });
    expect(readTeacherPrivateDomainReviewQueue(connection, teacher).meta).toMatchObject({ total: 1, pending: 1, reviewedDomains: 0, totalDomains: 4, rightsUnknown: 1, teachingPending: 1, teachingApproved: 0, nonTeachingApproved: 0, nonTeachingTotal: 3 });
    expect(connection.sqlite.prepare("SELECT student_visible,current_page,r2,embedding,lumi_retrieval,canonical_compilation FROM inspiration_wiki_private_domain_review_cases").get()).toEqual({ student_visible: 0, current_page: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumi_retrieval: "DISABLED", canonical_compilation: "DISABLED" });
  });

  it("confirms three non-teaching domains in bulk and leaves teaching as the only pending domain", () => {
    preparePrivateDomainReviewCases(connection, "2026-08-12T16:30:00.000Z");
    expect(approveTeacherPrivateNonTeachingDomains(connection, teacher, { scope: "CURRENT_PRIVATE_REVIEW_QUEUE", idempotencyKey: "baseline-confirm-001" }, "2026-08-12T16:31:00.000Z")).toMatchObject({ totalCases: 1, decisionsCreated: 3, alreadyDecided: 0, remainingPendingDomains: 0 });
    const queue = readTeacherPrivateDomainReviewQueue(connection, teacher);
    expect(queue.meta).toMatchObject({ teachingPending: 1, teachingApproved: 0, nonTeachingApproved: 3, nonTeachingTotal: 3 });
    expect(queue.items[0]!.domains).toMatchObject({ CURATION: { status: "APPROVED" }, TEACHING: { status: "PENDING" }, RIGHTS: { status: "APPROVED" }, SAFETY: { status: "APPROVED" } });
    expect(approveTeacherPrivateNonTeachingDomains(connection, teacher, { scope: "CURRENT_PRIVATE_REVIEW_QUEUE", idempotencyKey: "baseline-confirm-002" }, "2026-08-12T16:32:00.000Z")).toMatchObject({ decisionsCreated: 0, alreadyDecided: 3, remainingPendingDomains: 0 });
  });

  it("submits teaching decisions in a bounded batch and completes a baseline-confirmed case", () => {
    preparePrivateDomainReviewCases(connection, "2026-08-12T16:30:00.000Z");
    approveTeacherPrivateNonTeachingDomains(connection, teacher, { scope: "CURRENT_PRIVATE_REVIEW_QUEUE", idempotencyKey: "baseline-batch-001" }, "2026-08-12T16:31:00.000Z");
    const item = readTeacherPrivateDomainReviewQueue(connection, teacher).items[0]!;
    expect(decideTeacherPrivateTeachingBatch(connection, teacher, { items: [{ reviewCaseId: item.reviewCaseId, expectedRevision: item.revision, expectedStateHash: item.stateHash, decision: "APPROVE", issueKeys: [], note: "" }], idempotencyKey: "teaching-submit-001" }, "2026-08-12T16:32:00.000Z").summary).toEqual({ total: 1, approved: 1, held: 0, rejected: 0, replayed: 0 });
    expect(readTeacherPrivateDomainReviewQueue(connection, teacher).meta).toMatchObject({ teachingPending: 0, teachingApproved: 1, complete: 1 });
    expect(connection.sqlite.prepare("SELECT count(*) AS count FROM inspiration_wiki_private_domain_review_decisions").get()).toEqual({ count: 4 });
  });

  it("appends revisable domain decisions and completes only after all four approvals", () => {
    preparePrivateDomainReviewCases(connection, "2026-08-12T16:30:00.000Z");
    const reviewCaseId = readTeacherPrivateDomainReviewQueue(connection, teacher).items[0]!.reviewCaseId;
    const assessments = {
      CURATION: { domain: "CURATION", representativeValue: "YES", redundancyAcceptable: "YES" },
      TEACHING: { domain: "TEACHING", teachingValue: "YES", promptsUsable: "YES", cautionsClear: "YES" },
      RIGHTS: { domain: "RIGHTS", rightsState: "UNKNOWN", privateUseOnlyAcknowledged: true, formalRepublicationAllowed: false },
      SAFETY: { domain: "SAFETY", privacyRisk: "CLEAR", sensitiveContent: "CLEAR" },
    } as const;
    for (const domain of ["CURATION", "TEACHING", "RIGHTS", "SAFETY"] as const) {
      const current = readTeacherPrivateDomainReviewCase(connection, teacher, reviewCaseId).reviewCase;
      decideTeacherPrivateDomainReview(connection, teacher, reviewCaseId, {
        expectedRevision: current.revision,
        expectedStateHash: current.stateHash,
        reviewDomain: domain,
        decision: "APPROVE",
        assessment: assessments[domain],
        note: "",
        idempotencyKey: `domain-${domain.toLowerCase()}-001`,
      }, "2026-08-12T16:35:00.000Z");
    }
    expect(readTeacherPrivateDomainReviewCase(connection, teacher, reviewCaseId).reviewCase).toMatchObject({ revision: 5, reviewedDomainCount: 4, stage: "DOMAIN_REVIEW_COMPLETE", rightsScope: "UNKNOWN_PRIVATE_ONLY" });
    const complete = readTeacherPrivateDomainReviewCase(connection, teacher, reviewCaseId).reviewCase;
    decideTeacherPrivateDomainReview(connection, teacher, reviewCaseId, {
      expectedRevision: complete.revision,
      expectedStateHash: complete.stateHash,
      reviewDomain: "CURATION",
      decision: "HOLD",
      assessment: { domain: "CURATION", representativeValue: "UNCERTAIN", redundancyAcceptable: "YES" },
      note: "需要补充同类案例比较",
      idempotencyKey: "domain-curation-revise-001",
    }, "2026-08-12T16:40:00.000Z");
    expect(readTeacherPrivateDomainReviewCase(connection, teacher, reviewCaseId).reviewCase).toMatchObject({ revision: 6, reviewedDomainCount: 4, stage: "DOMAIN_REVIEW_HOLD" });
    expect(connection.sqlite.prepare("SELECT count(*) AS count FROM inspiration_wiki_private_domain_review_decisions").get()).toEqual({ count: 5 });
    expect(connection.sqlite.prepare("SELECT count(*) AS count FROM inspiration_wiki_domain_review_decisions").get()).toEqual({ count: 0 });
    expect(() => connection.sqlite.prepare("DELETE FROM inspiration_wiki_private_domain_review_decisions").run()).toThrow("PRIVATE_DOMAIN_REVIEW_DECISION_APPEND_ONLY");
  });

  it("compiles only a four-domain-complete case into append-only private Page material", () => {
    preparePrivateDomainReviewCases(connection, "2026-08-12T16:30:00.000Z");
    approveTeacherPrivateNonTeachingDomains(connection, teacher, { scope: "CURRENT_PRIVATE_REVIEW_QUEUE", idempotencyKey: "baseline-compile-001" }, "2026-08-12T16:31:00.000Z");
    const item = readTeacherPrivateDomainReviewQueue(connection, teacher).items[0]!;
    decideTeacherPrivateTeachingBatch(connection, teacher, { items: [{ reviewCaseId: item.reviewCaseId, expectedRevision: item.revision, expectedStateHash: item.stateHash, decision: "APPROVE", issueKeys: [], note: "" }], idempotencyKey: "teaching-compile-001" }, "2026-08-12T16:32:00.000Z");

    expect(compileEligiblePrivateWikiPages(connection, "2026-08-12T16:33:00.000Z")).toMatchObject({ eligible: 1, created: 1, revised: 0, replayed: 0, totalPages: 1, totalRevisions: 1, totalCompiledTruths: 1 });
    expect(compileEligiblePrivateWikiPages(connection, "2026-08-12T16:34:00.000Z")).toMatchObject({ eligible: 1, created: 0, revised: 0, replayed: 1, totalPages: 1, totalRevisions: 1, totalCompiledTruths: 1 });
    const queue = readTeacherPrivateWikiPageQueue(connection, teacher);
    expect(queue.meta).toMatchObject({ total: 1, revisions: 1, compiledTruths: 1, rightsUnknown: 1, strictSource: 1, evidenceGapSource: 0 });
    const detail = readTeacherPrivateWikiPage(connection, teacher, queue.items[0]!.pageId);
    expect(detail).toMatchObject({
      page: { state: "PRIVATE_COMPILED", rightsScope: "UNKNOWN_PRIVATE_ONLY", capabilityBoundary: { studentVisible: false, currentPage: "DISABLED", formalRelease: "DISABLED", canonicalCompilation: "DISABLED" } },
      revision: { compilationState: "PRIVATE_COMPILED_PREVIEW", content: { title: "测试视觉项目", rights: { status: "UNKNOWN", formalRepublicationAllowed: false } } },
      compiledTruth: { state: "PRIVATE_COMPILED_PREVIEW", rightsScope: "UNKNOWN_PRIVATE_ONLY" },
    });
    expect(connection.sqlite.prepare("SELECT (SELECT count(*) FROM inspiration_wiki_draft_revisions) AS drafts,(SELECT count(*) FROM inspiration_wiki_domain_review_decisions) AS decisions,(SELECT count(*) FROM inspiration_wiki_internal_catalog_entries) AS catalog").get()).toEqual({ drafts: 0, decisions: 0, catalog: 0 });
    expect(() => connection.sqlite.prepare("UPDATE inspiration_wiki_private_page_revisions SET content_hash=?").run("f".repeat(64))).toThrow("PRIVATE_PAGE_REVISION_APPEND_ONLY");
    expect(() => connection.sqlite.prepare("DELETE FROM inspiration_wiki_private_compiled_truths").run()).toThrow("PRIVATE_COMPILED_TRUTH_APPEND_ONLY");
  });

  it("binds the real teacher's explicit domain roles and admits only the exact private revision", () => {
    preparePrivateDomainReviewCases(connection, "2026-08-12T16:30:00.000Z");
    approveTeacherPrivateNonTeachingDomains(connection, teacher, { scope: "CURRENT_PRIVATE_REVIEW_QUEUE", idempotencyKey: "baseline-catalog-001" }, "2026-08-12T16:31:00.000Z");
    const item = readTeacherPrivateDomainReviewQueue(connection, teacher).items[0]!;
    decideTeacherPrivateTeachingBatch(connection, teacher, { items: [{ reviewCaseId: item.reviewCaseId, expectedRevision: item.revision, expectedStateHash: item.stateHash, decision: "APPROVE", issueKeys: [], note: "" }], idempotencyKey: "teaching-catalog-001" }, "2026-08-12T16:32:00.000Z");
    compileEligiblePrivateWikiPages(connection, "2026-08-12T16:33:00.000Z");

    expect(admitApprovedPrivatePagesToInternalCatalog(connection, "teacher", "2026-08-12T16:34:00.000Z")).toMatchObject({
      eligible: 1,
      policiesCreated: 1,
      assignmentsCreated: 4,
      casesCreated: 1,
      decisionsCreated: 4,
      entriesCreated: 1,
      replayed: 0,
      totalCases: 1,
      totalDecisions: 4,
      totalEntries: 1,
    });
    expect(admitApprovedPrivatePagesToInternalCatalog(connection, "teacher", "2026-08-12T16:35:00.000Z")).toMatchObject({
      policiesCreated: 0,
      assignmentsCreated: 0,
      casesCreated: 0,
      decisionsCreated: 0,
      entriesCreated: 0,
      replayed: 1,
    });
    const catalog = readTeacherPrivateInternalCatalog(connection, teacher);
    expect(catalog.meta).toMatchObject({ total: 1, rolePolicies: 1, roleAssignments: 4, roleDecisions: 4, distinctActors: 1, strictSource: 1, evidenceGapSource: 0 });
    expect(catalog.items[0]).toMatchObject({ title: "测试视觉项目", reviewerModel: "SINGLE_TEACHER_EXPLICIT_ROLES", rightsScope: "UNKNOWN_PRIVATE_ONLY" });
    const readiness = readTeacherReleaseReadiness(connection, teacher, "2026-08-12T16:35:00.000Z");
    expect(readiness.meta).toMatchObject({ total: 1, eligible: 0, blocked: 1, rightsUnknown: 1, canonicalDrafts: 0, canonicalDomainDecisions: 0, legacyInternalCatalog: 0 });
    expect(readiness.items[0]).toMatchObject({ state: "BLOCKED_FOR_FORMAL_RELEASE", passedGateCount: 1, totalGateCount: 8, rightsScope: "UNKNOWN_PRIVATE_ONLY" });
    expect(readiness.items[0]!.gates.map(({ key, status }) => ({ key, status }))).toContainEqual({ key: "RIGHTS_ALLOW", status: "BLOCKED" });
    expect(readiness.meta.boundary).toEqual({ teacherPrivate: true, readOnlyAudit: true, studentVisible: false, formalRelease: "DISABLED", currentPage: "DISABLED", browseRelease: "DISABLED", studentSearch: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" });
    const roleAssignments = connection.sqlite.prepare("SELECT role,actor_id AS actorId FROM inspiration_wiki_reviewer_assignments ORDER BY role").all() as Array<{ role: string; actorId: string }>;
    expect(roleAssignments.map(({ role }) => role)).toEqual(["CURATION_REVIEWER", "RIGHTS_REVIEWER", "SAFETY_REVIEWER", "TEACHING_REVIEWER"]);
    expect(new Set(roleAssignments.map(({ actorId }) => actorId)).size).toBe(1);
    expect(roleAssignments[0]!.actorId).toMatch(/^teacher-actor:[0-9a-f]{24}$/);
    expect(connection.sqlite.prepare("SELECT count(DISTINCT authenticated_teacher_id) AS count FROM inspiration_wiki_private_catalog_domain_decisions").get()).toEqual({ count: 1 });
    expect(connection.sqlite.prepare("SELECT student_visible AS studentVisible,current_page AS currentPage,formal_release AS formalRelease,r2,embedding,lumi_retrieval AS lumiRetrieval,rights_scope AS rightsScope FROM inspiration_wiki_private_internal_catalog_entries").get()).toEqual({ studentVisible: 0, currentPage: "DISABLED", formalRelease: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED", rightsScope: "UNKNOWN_PRIVATE_ONLY" });
    expect(connection.sqlite.prepare("SELECT (SELECT count(*) FROM inspiration_wiki_draft_revisions) AS drafts,(SELECT count(*) FROM inspiration_wiki_domain_review_decisions) AS decisions,(SELECT count(*) FROM inspiration_wiki_internal_catalog_entries) AS catalog").get()).toEqual({ drafts: 0, decisions: 0, catalog: 0 });
    expect(() => connection.sqlite.prepare("UPDATE inspiration_wiki_private_catalog_domain_decisions SET interpretation='SAFETY_ACCEPTED'").run()).toThrow("PRIVATE_CATALOG_DECISION_APPEND_ONLY");
    expect(() => connection.sqlite.prepare("DELETE FROM inspiration_wiki_private_internal_catalog_entries").run()).toThrow("PRIVATE_INTERNAL_CATALOG_APPEND_ONLY");
  });
});
