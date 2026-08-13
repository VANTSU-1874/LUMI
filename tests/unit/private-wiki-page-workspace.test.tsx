import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrivateWikiPageDetail } from "@/components/teacher/PrivateWikiPageDetail";
import { PrivateWikiPageWorkspace } from "@/components/teacher/PrivateWikiPageWorkspace";
import { PrivateInternalCatalogWorkspace } from "@/components/teacher/PrivateInternalCatalogWorkspace";
import { ReleaseReadinessWorkspace } from "@/components/teacher/ReleaseReadinessWorkspace";

const boundary = { teacherPrivate: true as const, studentVisible: false as const, privateCompilation: "ENABLED" as const, canonicalCompilation: "DISABLED" as const, currentPage: "DISABLED" as const, formalRelease: "DISABLED" as const, r2: "DISABLED" as const, embedding: "DISABLED" as const, lumiRetrieval: "DISABLED" as const };
const pageId = `private-wiki-page:${"1".repeat(32)}`;
const revisionId = `private-wiki-page-revision:${"1".repeat(32)}:1`;
const truthId = `private-compiled-truth:${"1".repeat(32)}:1`;
const candidateId = `hermes-candidate:${"1".repeat(32)}`;
const hash = "a".repeat(64);
const compiledAt = "2026-08-12T17:00:00.000Z";
const content = {
  pageType: "INSPIRATION_CASE" as const,
  title: "几何海报教学案例",
  summary: "高对比色块与压缩字形建立清晰的信息层级。",
  classification: { primary: "海报设计", secondary: ["字体设计"] },
  artisticStyle: { labels: ["几何现代主义"], rationale: "几何切分和有限色彩形成秩序。" },
  facets: ["海报设计", "字体设计", "几何现代主义"],
  curation: { recommendation: "RECOMMEND" as const, rationale: "具有清晰的比较价值。" },
  teaching: { recommendation: "RECOMMEND" as const, rationale: "适合训练信息层级。", prompts: ["哪些元素形成主次？"], cautions: ["不推断作者未声明的意图。"] },
  media: [{ mediaId: "cover", previewUrl: "/api/teacher/inspiration-wiki/review-packs/review-pack:test/media/cover", role: "COVER" as const, alt: "几何海报", width: 800, height: 1000, sha256: hash }],
  work: { creators: ["示例工作室"], year: "2026" },
  sourceRecords: [{ sourceId: "source-1", platform: "BEHANCE" as const, pageUrl: "https://www.behance.net/gallery/123/test", role: "CREATOR_WORK_PAGE", creatorName: "示例工作室", curatorName: null }],
  rights: { status: "UNKNOWN" as const, evidenceSummaries: ["未知"], formalRepublicationAllowed: false as const },
  visualObservations: [{ observation: "黑色标题占据主要视觉重量。", mediaIds: ["cover"] }],
  duplicateRelationship: { status: "DISTINCT" as const, relatedCandidateIds: [], explanation: "未发现重复。" },
  safety: { status: "READY_FOR_TEACHER_DECISION" as const, evidence: ["不含学生数据。"] },
  evidenceGaps: [],
  editorialNote: "",
};
const decisions = { CURATION: "decision-c", TEACHING: "decision-t", RIGHTS: "decision-r", SAFETY: "decision-s" };
const revision = { schemaVersion: "lumi-inspiration-private-page-revision/v1" as const, revisionId, pageId, candidateId, revision: 1, sourceBinding: { draftId: `private-wiki-draft:${"1".repeat(32)}`, draftRevision: 2, draftContentHash: hash, reviewCaseId: `private-domain-review:${"1".repeat(32)}`, reviewCaseRevision: 5, reviewStateHash: hash, decisionIds: decisions }, compilationState: "PRIVATE_COMPILED_PREVIEW" as const, compiledAt, contentHash: hash, revisionHash: hash, content, capabilityBoundary: boundary };
const detail = {
  page: { schemaVersion: "lumi-inspiration-private-wiki-page/v1" as const, pageId, candidateId, pageType: "INSPIRATION_CASE" as const, state: "PRIVATE_COMPILED" as const, title: content.title, latestPrivateRevision: { revisionId, revision: 1, revisionHash: hash }, latestPrivateTruth: { truthId, truthHash: hash }, rightsScope: "UNKNOWN_PRIVATE_ONLY" as const, createdAt: compiledAt, updatedAt: compiledAt, capabilityBoundary: boundary },
  revision,
  compiledTruth: { schemaVersion: "lumi-inspiration-private-compiled-truth/v1" as const, truthId, state: "PRIVATE_COMPILED_PREVIEW" as const, pageId, pageRevision: { revisionId, revision: 1, revisionHash: hash }, sourceDecisionIds: decisions, rightsScope: "UNKNOWN_PRIVATE_ONLY" as const, contentHash: hash, truthHash: hash, compiledAt, content, capabilityBoundary: boundary },
};

describe("private wiki page workspace", () => {
  afterEach(cleanup);

  it("lists private compiled pages without exposing a release action", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [{ pageId, candidateId, revisionId, revision: 1, title: content.title, primaryCategory: content.classification.primary, artisticStyleLabels: content.artisticStyle.labels, primaryPreviewUrl: content.media[0]!.previewUrl, evidenceGapCount: 0, compiledAt }], meta: { total: 1, revisions: 1, compiledTruths: 1, rightsUnknown: 1, strictSource: 1, evidenceGapSource: 0, boundary } }));
    render(<PrivateWikiPageWorkspace fetcher={fetcher} />);
    expect(await screen.findByText("1 个审核通过项，已形成可追溯编译快照。")).toBeInTheDocument();
    expect(screen.getByText(content.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看编译页" })).toHaveAttribute("href", `/teacher/inspiration-wiki/private-pages/${encodeURIComponent(pageId)}`);
    expect(screen.getByRole("link", { name: "查看内部目录" })).toHaveAttribute("href", "/teacher/inspiration-wiki/private-catalog");
    expect(screen.queryByRole("button", { name: /发布|Current Page|学生可见|Lumi/ })).not.toBeInTheDocument();
  });

  it("shows role-governed private catalog entries without a release action", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      items: [{ entryId: `private-internal-catalog:${"1".repeat(32)}:1`, pageId, revision: 1, title: content.title, primaryCategory: content.classification.primary, artisticStyleLabels: content.artisticStyle.labels, primaryPreviewUrl: content.media[0]!.previewUrl, evidenceGapCount: 0, reviewerModel: "SINGLE_TEACHER_EXPLICIT_ROLES", rightsScope: "UNKNOWN_PRIVATE_ONLY", activatedAt: compiledAt }],
      meta: { total: 1, rolePolicies: 1, roleAssignments: 4, roleDecisions: 4, strictSource: 1, evidenceGapSource: 0, distinctActors: 1, boundary: { teacherPrivate: true, studentVisible: false, internalCatalog: "ENABLED", canonicalCompilation: "DISABLED", currentPage: "DISABLED", formalRelease: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" } },
    }));
    render(<PrivateInternalCatalogWorkspace fetcher={fetcher} />);
    expect(await screen.findByText("1 个精确修订已进入私有内部目录。")).toBeInTheDocument();
    expect(screen.getByText("单教师明确四角色策略")).toBeInTheDocument();
    expect(screen.getByText(content.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "检查发布准备" })).toHaveAttribute("href", "/teacher/inspiration-wiki/release-readiness");
    expect(screen.queryByRole("button", { name: /发布|Current Page|学生可见|Lumi/ })).not.toBeInTheDocument();
  });

  it("shows every catalog item as release-blocked while rights remain unknown", async () => {
    const gates = [
      { key: "PRIVATE_CATALOG_BINDING", status: "PASSED", label: "私有目录精确绑定", explanation: "已绑定当前私有页面修订、编译快照与四域治理决定。" },
      { key: "RIGHTS_ALLOW", status: "BLOCKED", label: "正式展示权利", explanation: "当前为已确认未知。" },
      { key: "CANONICAL_MATERIAL", status: "NOT_STARTED", label: "正式 canonical 物料", explanation: "尚未创建。" },
      { key: "WITHDRAWAL_READINESS", status: "NOT_STARTED", label: "撤下与回滚准备", explanation: "尚未建立。" },
      { key: "AUDIENCE_POLICY", status: "NOT_STARTED", label: "学生受众策略", explanation: "尚未建立。" },
      { key: "RELEASE_DECISION", status: "NOT_STARTED", label: "正式发布决定", explanation: "尚无决定。" },
      { key: "CURRENT_PAGE", status: "NOT_STARTED", label: "当前页面指针", explanation: "尚未创建。" },
      { key: "CHANNEL_ACTIVATION", status: "NOT_STARTED", label: "学生通道激活", explanation: "全部关闭。" },
    ] as const;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      schemaVersion: "lumi-inspiration-release-readiness-audit/v1",
      evaluatedAt: compiledAt,
      items: [{ entryId: `private-internal-catalog:${"1".repeat(32)}:1`, pageId, revision: 1, title: content.title, primaryCategory: content.classification.primary, artisticStyleLabels: content.artisticStyle.labels, primaryPreviewUrl: content.media[0]!.previewUrl, evidenceGapCount: 0, rightsScope: "UNKNOWN_PRIVATE_ONLY", state: "BLOCKED_FOR_FORMAL_RELEASE", passedGateCount: 1, totalGateCount: 8, gates }],
      meta: { total: 1, eligible: 0, blocked: 1, rightsUnknown: 1, canonicalDrafts: 0, canonicalDomainDecisions: 0, legacyInternalCatalog: 0, boundary: { teacherPrivate: true, readOnlyAudit: true, studentVisible: false, formalRelease: "DISABLED", currentPage: "DISABLED", browseRelease: "DISABLED", studentSearch: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" } },
    }));
    render(<ReleaseReadinessWorkspace fetcher={fetcher} />);
    expect(await screen.findByText("0 个可激活，1 个被正式发布门阻断。")).toBeInTheDocument();
    expect(screen.getByText("正式展示权利")).toBeInTheDocument();
    expect(screen.getByText("不可发布")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /正式发布|激活|学生可见/ })).not.toBeInTheDocument();
  });

  it("shows five D-25 qualification pilots without exposing a release action", async () => {
    const oldAudit = {
      schemaVersion: "lumi-inspiration-release-readiness-audit/v1",
      evaluatedAt: compiledAt,
      items: [],
      meta: { total: 0, eligible: 0, blocked: 0, rightsUnknown: 0, canonicalDrafts: 0, canonicalDomainDecisions: 0, legacyInternalCatalog: 0, boundary: { teacherPrivate: true, readOnlyAudit: true, studentVisible: false, formalRelease: "DISABLED", currentPage: "DISABLED", browseRelease: "DISABLED", studentSearch: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" } },
    };
    const qualificationBoundary = { teacherPrivate: true, formalQualificationOnly: true, studentVisible: false, formalRelease: "DISABLED", currentPage: "DISABLED", browseRelease: "SHADOW", studentSearch: "SHADOW", wikiRetrieval: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED", productionDeployment: "DISABLED" } as const;
    const gateDefinitions = [
      ["STUDENT_DISPLAY_RIGHTS", "学生正式展示权利"],
      ["AUDIENCE_POLICY", "学生受众与预览策略"],
      ["SOURCE_DISCLOSURE", "来源与署名披露"],
      ["WITHDRAWAL_READINESS", "撤下与回滚准备"],
      ["RELEASE_ROLE_SIGNOFF", "发布角色签核"],
    ] as const;
    const items = Array.from({ length: 5 }, (_, index) => {
      const suffix = String(index + 1).repeat(32);
      return {
        releaseCase: {
          schemaVersion: "lumi-inspiration-release-qualification-case/v1",
          caseId: `release-qualification:${suffix}`,
          caseHash: `sha256:${String(index + 1).repeat(64)}`,
          entryId: `private-internal-catalog:${suffix}:1`,
          pageId: `private-wiki-page:${suffix}`,
          pageRevisionId: `private-wiki-page-revision:${suffix}:1`,
          pageRevision: 1,
          contentHash: String(index + 2).repeat(64),
          title: `D-25 资格试点 ${index + 1}`,
          primaryCategory: `分类 ${index + 1}`,
          artisticStyleLabels: [`风格 ${index + 1}`],
          primaryPreviewUrl: `/api/teacher/inspiration-wiki/review-packs/review-pack:d25-${index + 1}/media/cover`,
          evidenceGapCount: 0,
          rightsScope: "UNKNOWN_PRIVATE_ONLY",
          selectedAt: compiledAt,
          boundary: qualificationBoundary,
        },
        gates: gateDefinitions.map(([gate, label]) => ({ gate, label, status: "PENDING", decision: null })),
        satisfiedGateCount: 0,
        state: "QUALIFICATION_IN_PROGRESS",
      };
    });
    const fetcher = vi.fn<typeof fetch>(async (input) => Response.json(
      String(input).includes("phase=d25")
        ? { schemaVersion: "lumi-inspiration-release-qualification-queue/v1", items, meta: { total: 5, inProgress: 5, qualified: 0, boundary: qualificationBoundary } }
        : oldAudit,
    ));
    render(<ReleaseReadinessWorkspace fetcher={fetcher} />);
    expect(await screen.findByText("5 个试点，0 个完成五道资格门。")).toBeInTheDocument();
    expect(screen.getAllByText(/资格补齐中 · 0\/5/)).toHaveLength(5);
    expect(screen.getByText("D-25 资格试点 1")).toBeInTheDocument();
    expect(screen.getByText("D-24 Shadow 继续生效")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /正式发布|激活|学生可见/ })).not.toBeInTheDocument();
  });

  it("shows Chinese private truth, teaching, source and rights sections", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(detail));
    render(<PrivateWikiPageDetail pageId={pageId} fetcher={fetcher} />);
    expect(await screen.findByText("教师私有编译真相快照")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "教学编纂" })).toBeInTheDocument();
    expect(screen.getByText("权利状态：未知，仅限教师私有使用。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /发布|Current Page|学生可见|Lumi/ })).not.toBeInTheDocument();
  });
});
