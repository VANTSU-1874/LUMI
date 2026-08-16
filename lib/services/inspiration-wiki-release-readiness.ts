import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  TeacherReleaseReadinessQueueSchema,
  type TeacherReleaseReadinessQueue,
} from "@/lib/domain/inspiration-wiki/release-readiness-contracts";
import { readTeacherPrivateInternalCatalog } from "./inspiration-wiki-private-catalog-governance";

const BOUNDARY = {
  teacherPrivate: true,
  readOnlyAudit: true,
  studentVisible: false,
  formalRelease: "DISABLED",
  currentPage: "DISABLED",
  browseRelease: "DISABLED",
  studentSearch: "DISABLED",
  r2: "DISABLED",
  embedding: "DISABLED",
  lumiRetrieval: "DISABLED",
} as const;

const GATES = [
  { key: "PRIVATE_CATALOG_BINDING", status: "PASSED", label: "私有目录精确绑定", explanation: "已绑定当前私有页面修订、编译快照与四域治理决定。" },
  { key: "RIGHTS_ALLOW", status: "BLOCKED", label: "正式展示权利", explanation: "当前为已确认未知，仅允许教师私有使用；不能推导为正式展示或再发布许可。" },
  { key: "CANONICAL_MATERIAL", status: "NOT_STARTED", label: "正式 canonical 物料", explanation: "尚未创建正式 Page Revision、Compiled Truth、Timeline 或 Link 决定集。" },
  { key: "WITHDRAWAL_READINESS", status: "NOT_STARTED", label: "撤下与回滚准备", explanation: "尚未建立正式撤下快照、传播验证与回滚回执。" },
  { key: "AUDIENCE_POLICY", status: "NOT_STARTED", label: "学生受众策略", explanation: "尚未建立允许学生展示、预览和引用的受众策略。" },
  { key: "RELEASE_DECISION", status: "NOT_STARTED", label: "正式发布决定", explanation: "尚无绑定精确正式修订和角色策略的发布决定。" },
  { key: "CURRENT_PAGE", status: "NOT_STARTED", label: "当前页面指针", explanation: "尚未创建 Current Page；私有最新修订指针不能替代它。" },
  { key: "CHANNEL_ACTIVATION", status: "NOT_STARTED", label: "学生通道激活", explanation: "浏览、搜索与 Lumi 引用通道全部保持关闭。" },
] as const;

function isoSeconds(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("发布准备审计时间无效");
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
}

export function readTeacherReleaseReadiness(
  connection: DatabaseConnection,
  actor: SessionPayload,
  evaluatedAt: string | Date = new Date(),
): TeacherReleaseReadinessQueue {
  const catalog = readTeacherPrivateInternalCatalog(connection, actor);
  const formal = connection.sqlite.prepare(
    `SELECT
      (SELECT count(*) FROM inspiration_wiki_draft_revisions) AS canonicalDrafts,
      (SELECT count(*) FROM inspiration_wiki_domain_review_decisions) AS canonicalDomainDecisions,
      (SELECT count(*) FROM inspiration_wiki_internal_catalog_entries) AS legacyInternalCatalog`,
  ).get() as { canonicalDrafts: number; canonicalDomainDecisions: number; legacyInternalCatalog: number };
  const items = catalog.items.map((item) => ({
    entryId: item.entryId,
    pageId: item.pageId,
    revision: item.revision,
    title: item.title,
    primaryCategory: item.primaryCategory,
    artisticStyleLabels: item.artisticStyleLabels,
    primaryPreviewUrl: item.primaryPreviewUrl,
    evidenceGapCount: item.evidenceGapCount,
    rightsScope: item.rightsScope,
    state: "BLOCKED_FOR_FORMAL_RELEASE" as const,
    passedGateCount: 1 as const,
    totalGateCount: 8 as const,
    gates: GATES,
  }));
  return TeacherReleaseReadinessQueueSchema.parse({
    schemaVersion: "lumi-inspiration-release-readiness-audit/v1",
    evaluatedAt: isoSeconds(evaluatedAt),
    items,
    meta: {
      total: items.length,
      eligible: 0,
      blocked: items.length,
      rightsUnknown: items.length,
      ...formal,
      boundary: BOUNDARY,
    },
  });
}

export { BOUNDARY as RELEASE_READINESS_BOUNDARY };
