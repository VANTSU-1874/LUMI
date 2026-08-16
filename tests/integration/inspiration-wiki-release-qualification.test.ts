// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { privateDraftCompletion, PrivateWikiDraftSchema, type PrivateWikiDraft } from "@/lib/domain/inspiration-wiki/private-draft-contracts";
import { hashWikiValue } from "@/lib/domain/inspiration-wiki/integrity";
import { WIKI_MULTIMODAL_ENCODER_VERSION, WIKI_MULTIMODAL_INDEX_ID, WIKI_MULTIMODAL_SCHEMA_VERSION, WikiMultimodalIndexSchema } from "@/lib/domain/inspiration-wiki/multimodal-retrieval-contracts";
import { compileEligiblePrivateWikiPages } from "@/lib/services/inspiration-wiki-private-compilation";
import { readPublishedInspirationBrowser } from "@/lib/services/inspiration-browser";
import { resolveInspirationPreview } from "@/lib/services/inspiration-preview";
import { FormalReleaseGateError, publishQualifiedInspirationCase, readTeacherFormalReleaseQueue, withdrawFormalInspirationRelease } from "@/lib/services/inspiration-wiki-formal-release";
import { buildAndPersistP2StudentChannelShadowSnapshot } from "@/lib/services/inspiration-wiki-p2-student-channels";
import { activeWikiMultimodalReleaseIdentity, searchWikiMultimodal, studentItemText, textFeatureVector, TEXT_VECTOR_DIMENSIONS, VISUAL_VECTOR_DIMENSIONS } from "@/lib/services/inspiration-wiki-multimodal";
import { admitApprovedPrivatePagesToInternalCatalog } from "@/lib/services/inspiration-wiki-private-catalog-governance";
import {
  approveTeacherPrivateNonTeachingDomains,
  decideTeacherPrivateTeachingBatch,
  preparePrivateDomainReviewCases,
  readTeacherPrivateDomainReviewQueue,
} from "@/lib/services/inspiration-wiki-private-domain-reviews";
import {
  decideReleaseQualificationGate,
  prepareReleaseQualificationPilots,
  readTeacherReleaseQualificationQueue,
  ReleaseQualificationConflictError,
} from "@/lib/services/inspiration-wiki-release-qualification";

const teacher = { userId: "teacher", role: "TEACHER" as const };
const categories = ["海报设计", "品牌视觉识别", "包装设计", "书籍与编辑设计", "导视与环境图形"];
let connection: DatabaseConnection;
let directory: string;

function seedReadyDrafts() {
  connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','Test teacher',1700000000);");
  connection.sqlite.prepare(`INSERT INTO inspiration_wiki_hermes_batches(
    batch_id,contract_version,package_digest,manifest_json,done_json,candidate_count,failure_count,
    intake_state,student_visible,current_page,r2,embedding,lumi_retrieval,imported_at
  ) VALUES('d25-test-batch','LEGACY_V1',?,'{}','{}',5,0,'VALIDATED_PRIVATE',0,'DISABLED','DISABLED','DISABLED','DISABLED',1700000000)`).run("a".repeat(64));

  for (let index = 1; index <= 5; index += 1) {
    const suffix = String(index).repeat(32);
    const candidateId = `hermes-candidate:${suffix}`;
    connection.sqlite.prepare(`INSERT INTO inspiration_wiki_hermes_candidates(
      id,batch_id,source_candidate_id,revision,contract_state,review_state,source_id,source_platform,
      page_url,canonical_url,title,description,author_json,license_json,media_json,design_categories_json,
      screening_json,raw_candidate_json,raw_digest,dedupe_fingerprint,scope,student_visible,wiki_draft,
      current_page,r2,embedding,lumi_retrieval,created_at,updated_at
    ) VALUES(?,'d25-test-batch',?,1,'V1_UPGRADE_REQUIRED','PENDING_REVIEW',?,'BEHANCE',
      ?,NULL,?,NULL,NULL,NULL,'[{"kind":"IMAGE","asset":null}]','["OTHER"]',
      '{"totalScore":0,"evidence":[]}','{}',?,?,'PRIVATE_CANDIDATE',0,'NOT_CREATED',
      'DISABLED','DISABLED','DISABLED','DISABLED',1700000000,1700000000)`).run(
      candidateId,
      `source-d25-${index}`,
      `source-${index}`,
      `https://www.behance.net/gallery/12345678${index}/d25-${index}`,
      `D-25 试点作品 ${index}`,
      String(index).repeat(64),
      String(9 - index).repeat(64),
    );
    const editable: PrivateWikiDraft["editable"] = {
      title: `D-25 试点作品 ${index}`,
      summary: "以受控视觉材料组织形式、信息与教学观察。",
      classification: { primary: categories[index - 1]!, secondary: ["视觉系统"] },
      artisticStyle: { labels: [`风格 ${index}`], rationale: "基于可见构图、字体与色彩关系归纳。" },
      curation: { recommendation: "RECOMMEND", rationale: "具有清楚的比较与策展价值。" },
      teaching: { recommendation: "RECOMMEND", rationale: "适合课堂形式分析。", prompts: ["如何建立视觉层级？"], cautions: ["不推断商业效果。"] },
      media: [{
        mediaId: "media-cover",
        previewUrl: `/api/teacher/inspiration-wiki/review-packs/review-pack:d25-${index}/media/media-cover`,
        role: "COVER",
        alt: `试点作品 ${index}`,
        width: 800,
        height: 1000,
        sha256: String(index).repeat(64),
      }],
      editorialNote: "",
    };
    const draft = PrivateWikiDraftSchema.parse({
      schemaVersion: "lumi-inspiration-private-working-draft/v1",
      draftId: `private-wiki-draft:${suffix}`,
      candidateId,
      sourceReview: { contractKind: "STRICT_REVIEW_PACK", reviewPackId: `review-pack:d25-${index}`, reviewPackRevision: 1, decisionId: `decision-d25-${index}`, decisionAction: "ENTER_PRIVATE_WIKIDRAFT", acceptedGapKeys: [] },
      revision: 2,
      stage: "READY_FOR_DOMAIN_REVIEW",
      contentHash: String(index + 1).repeat(64),
      updatedAt: "2026-08-13T02:00:00.000Z",
      editable,
      work: { creators: [`作者 ${index}`], year: "2026" },
      sourceRecords: [{ sourceId: `source-${index}`, platform: "BEHANCE", pageUrl: `https://www.behance.net/gallery/12345678${index}/d25-${index}`, role: "CREATOR_WORK_PAGE", creatorName: `作者 ${index}`, curatorName: null }],
      rights: { status: "UNKNOWN", evidenceSummaries: ["权利状态未知"], formalRepublicationAllowed: false },
      visualObservations: [{ observation: "构图与字体层级清楚。", mediaIds: ["media-cover"] }],
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
      draft.draftId,
      draft.candidateId,
      draft.sourceReview.reviewPackId,
      draft.sourceReview.contractKind,
      draft.sourceReview.reviewPackRevision,
      draft.sourceReview.decisionId,
      draft.revision,
      draft.stage,
      draft.contentHash,
      JSON.stringify(draft),
      draft.editable.title,
      draft.editable.classification.primary,
      draft.completion.completedCount,
      draft.editable.media[0]!.previewUrl,
      draft.rights.status,
    );
  }
}

function buildCatalog() {
  preparePrivateDomainReviewCases(connection, "2026-08-13T02:01:00.000Z");
  approveTeacherPrivateNonTeachingDomains(connection, teacher, { scope: "CURRENT_PRIVATE_REVIEW_QUEUE", idempotencyKey: "d25-baseline" }, "2026-08-13T02:02:00.000Z");
  const queue = readTeacherPrivateDomainReviewQueue(connection, teacher);
  decideTeacherPrivateTeachingBatch(connection, teacher, {
    items: queue.items.map((item) => ({ reviewCaseId: item.reviewCaseId, expectedRevision: item.revision, expectedStateHash: item.stateHash, decision: "APPROVE" as const, issueKeys: [], note: "" })),
    idempotencyKey: "d25-teaching",
  }, "2026-08-13T02:03:00.000Z");
  compileEligiblePrivateWikiPages(connection, "2026-08-13T02:04:00.000Z");
  admitApprovedPrivatePagesToInternalCatalog(connection, "teacher", "2026-08-13T02:05:00.000Z");
}

function seedStrictAssets() {
  for (let index = 1; index <= 5; index += 1) {
    const candidateId = `hermes-candidate:${String(index).repeat(32)}`;
    connection.sqlite.prepare(`INSERT INTO inspiration_wiki_review_packs(
      review_pack_id,candidate_id,revision,stage,material_hash,pack_json,media_assets_json,
      primary_preview_url,title,source_summary,teacher_private,student_visible,current_page,
      r2,embedding,lumi_retrieval,created_at,updated_at
    ) VALUES(?,?,1,'READY_FOR_TEACHER_REVIEW',?,'{}',?,?,?,'source',1,0,'DISABLED','DISABLED','DISABLED','DISABLED',1700000000,1700000000)`).run(
      `review-pack:d25-${index}`,
      candidateId,
      String(index).repeat(64),
      JSON.stringify([{ mediaId: "media-cover", mimeType: "image/jpeg", bytes: 100 + index, sha256: String(index).repeat(64), storagePath: `inspiration-wiki/review-packs/assets/d25-pilot-${index}/media-cover.jpg` }]),
      `/api/teacher/inspiration-wiki/review-packs/review-pack:d25-${index}/media/media-cover`,
      `D-25 试点作品 ${index}`,
    );
  }
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lumi-d25-test-"));
  const databasePath = path.join(directory, "d25.sqlite");
  runMigrations(databasePath);
  connection = createDb(databasePath);
  seedReadyDrafts();
  buildCatalog();
  seedStrictAssets();
});

afterEach(async () => {
  connection.sqlite.close();
  await rm(directory, { recursive: true, force: true });
});

describe("D-25 release qualification service", () => {
  it("creates five diverse private qualification cases without activating students", () => {
    expect(prepareReleaseQualificationPilots(connection, teacher, "2026-08-13T02:06:00.000Z")).toMatchObject({ created: 5, replayed: 0 });
    expect(prepareReleaseQualificationPilots(connection, teacher, "2026-08-13T02:06:00.000Z")).toMatchObject({ created: 0, replayed: 5 });
    const queue = readTeacherReleaseQualificationQueue(connection, teacher);
    expect(queue.meta).toMatchObject({ total: 5, inProgress: 5, qualified: 0, boundary: { studentVisible: false, formalRelease: "DISABLED", browseRelease: "SHADOW", studentSearch: "SHADOW" } });
    expect(new Set(queue.items.map((item) => item.releaseCase.primaryCategory)).size).toBe(5);
    expect(connection.sqlite.prepare("SELECT count(*) AS count FROM inspiration_admissions").get()).toEqual({ count: 0 });
    expect(() => connection.sqlite.prepare("UPDATE inspiration_wiki_release_qualification_cases SET primary_category='changed'").run()).toThrow("D25_RELEASE_QUALIFICATION_CASE_APPEND_ONLY");
  });

  it("records evidence-bound decisions idempotently and never creates a release", () => {
    prepareReleaseQualificationPilots(connection, teacher, "2026-08-13T02:06:00.000Z");
    const releaseCase = readTeacherReleaseQualificationQueue(connection, teacher).items[0]!.releaseCase;
    const input = {
      caseId: releaseCase.caseId,
      gate: "STUDENT_DISPLAY_RIGHTS" as const,
      status: "SATISFIED" as const,
      evidenceRef: "rights-evidence:d25-test",
      note: "授权范围覆盖学生正式展示。",
      idempotencyKey: randomUUID(),
    };
    expect(decideReleaseQualificationGate(connection, teacher, input, "2026-08-13T02:07:00.000Z")).toMatchObject({ replayed: false, decision: { revision: 1 } });
    expect(decideReleaseQualificationGate(connection, teacher, input, "2026-08-13T02:07:00.000Z")).toMatchObject({ replayed: true, decision: { revision: 1 } });
    expect(() => decideReleaseQualificationGate(connection, teacher, { ...input, note: "changed" }, "2026-08-13T02:07:00.000Z")).toThrow(ReleaseQualificationConflictError);
    expect(readTeacherReleaseQualificationQueue(connection, teacher).items[0]!.satisfiedGateCount).toBe(1);
    expect(() => connection.sqlite.prepare("DELETE FROM inspiration_wiki_release_qualification_decisions").run()).toThrow("D25_RELEASE_QUALIFICATION_DECISION_APPEND_ONLY");
    expect(connection.sqlite.prepare("SELECT count(*) AS count FROM inspiration_admissions").get()).toEqual({ count: 0 });
  });

  it("publishes only after five gates, exposes the exact active set, and withdraws append-only", async () => {
    prepareReleaseQualificationPilots(connection, teacher, "2026-08-13T02:06:00.000Z");
    buildAndPersistP2StudentChannelShadowSnapshot(connection, teacher, "2026-08-13T02:06:30.000Z");
    const initial = readTeacherReleaseQualificationQueue(connection, teacher);
    expect(() => publishQualifiedInspirationCase(connection, teacher, { action: "PUBLISH", caseId: initial.items[0]!.releaseCase.caseId, idempotencyKey: randomUUID() }, "2026-08-13T02:07:00.000Z")).toThrow(FormalReleaseGateError);
    for (const item of initial.items) {
      for (const gate of ["STUDENT_DISPLAY_RIGHTS", "AUDIENCE_POLICY", "SOURCE_DISCLOSURE", "WITHDRAWAL_READINESS", "RELEASE_ROLE_SIGNOFF"] as const) {
        decideReleaseQualificationGate(connection, teacher, {
          caseId: item.releaseCase.caseId,
          gate,
          status: "SATISFIED",
          evidenceRef: gate === "STUDENT_DISPLAY_RIGHTS" ? "USER_RIGHTS_ATTESTATION:test" : null,
          note: "测试范围内确认满足。",
          idempotencyKey: randomUUID(),
        }, "2026-08-13T02:07:00.000Z");
      }
      publishQualifiedInspirationCase(connection, teacher, { action: "PUBLISH", caseId: item.releaseCase.caseId, idempotencyKey: randomUUID() }, "2026-08-13T02:08:00.000Z");
    }
    expect(readTeacherFormalReleaseQueue(connection, teacher).meta).toEqual({ total: 5, active: 5, withdrawn: 0, qualifiedUnreleased: 0 });
    expect(readPublishedInspirationBrowser(connection.db, { limit: 30 }).items).toHaveLength(5);
    expect(connection.sqlite.prepare("SELECT count(*) count FROM inspiration_admissions").get()).toEqual({ count: 0 });
    expect(() => connection.sqlite.prepare("UPDATE inspiration_wiki_formal_releases SET status='PUBLISHED'").run()).toThrow("INSPIRATION_WIKI_FORMAL_RELEASE_APPEND_ONLY");
    const first = readTeacherFormalReleaseQueue(connection, teacher).items[0]!.release;
    expect(resolveInspirationPreview(connection.db, teacher, first.publicMaterial.publicId)?.kind).toBe("ASSET");
    const browserItems = readPublishedInspirationBrowser(connection.db, { limit: 30 }).items;
    const identities = activeWikiMultimodalReleaseIdentity(connection.db);
    const indexRoot = path.join(directory, "multimodal-index");
    await mkdir(indexRoot);
    const material = {
      schemaVersion: WIKI_MULTIMODAL_SCHEMA_VERSION,
      indexId: WIKI_MULTIMODAL_INDEX_ID,
      encoderVersion: WIKI_MULTIMODAL_ENCODER_VERSION,
      sourceReleaseBundleId: "test-release-bundle",
      sourceReleaseBundleDigest: "a".repeat(64),
      releaseSetHash: identities.releaseSetHash,
      visualDimensions: VISUAL_VECTOR_DIMENSIONS,
      textDimensions: TEXT_VECTOR_DIMENSIONS,
      itemCount: browserItems.length,
      rightsEvidenceRef: "USER_AUTHORIZATION:2026-08-16:WIKI-SELF-MULTIMODAL-177" as const,
      capabilityBoundary: { authenticatedStudentWiki: "ACTIVE" as const, textToImage: "ACTIVE" as const, imageToImage: "ACTIVE" as const, imageTextToImage: "ACTIVE" as const, externalProvider: "DISABLED" as const, externalDataEgress: "DISABLED" as const, anonymousAccess: "DISABLED" as const, r2: "DISABLED" as const, lumiRetrieval: "DISABLED" as const },
      entries: identities.active.map((identity, index) => {
        const item = browserItems.find((candidate) => candidate.id === identity.publicId)!;
        const visualVector = Array<number>(VISUAL_VECTOR_DIMENSIONS).fill(0); visualVector[index] = 1;
        return { ...identity, assetSha256: String(index + 1).repeat(64), item, visualVector, textVector: textFeatureVector(studentItemText(item)) };
      }),
    };
    const index = WikiMultimodalIndexSchema.parse({ ...material, indexHash: hashWikiValue(material) });
    await writeFile(path.join(indexRoot, "index.json"), JSON.stringify(index));
    await writeFile(path.join(indexRoot, "DONE.json"), JSON.stringify({ schemaVersion: "lumi-inspiration-wiki-multimodal-done/v1", indexId: index.indexId, indexHash: index.indexHash, status: "READY" }));
    expect((await searchWikiMultimodal(connection.db, { query: browserItems[0]!.title, indexRoot })).items.map((item) => item.id)).toContain(browserItems[0]!.id);
    withdrawFormalInspirationRelease(connection, teacher, { action: "WITHDRAW", releaseId: first.releaseId, reason: "测试同秒撤下", idempotencyKey: randomUUID() }, "2026-08-13T02:08:00.000Z");
    expect(readTeacherFormalReleaseQueue(connection, teacher).meta).toEqual({ total: 5, active: 4, withdrawn: 1, qualifiedUnreleased: 0 });
    expect(readPublishedInspirationBrowser(connection.db, { limit: 30 }).items).toHaveLength(4);
    expect((await searchWikiMultimodal(connection.db, { query: first.publicMaterial.title, indexRoot })).items.map((item) => item.id)).not.toContain(first.publicMaterial.publicId);
    expect(resolveInspirationPreview(connection.db, { userId: "student", role: "STUDENT" }, first.publicMaterial.publicId)).toBeNull();
    expect(connection.sqlite.prepare("SELECT count(*) count FROM inspiration_wiki_p2_active_channel_snapshots").get()).toEqual({ count: 6 });
  });
});
