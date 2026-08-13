import { and, asc, desc, eq } from "drizzle-orm";

import type { InspirationBrowseItem, InspirationBrowseResponse } from "@/lib/domain/inspiration-browser";
import type { DatabaseConnection } from "@/lib/db/client";
import { inspirationAdmissions, inspirationCandidates, inspirationSources, inspirationWikiCurrentPageEvents, inspirationWikiFormalReleases, type JsonRecord } from "@/lib/db/schema";
import { FormalReleaseSchema } from "@/lib/domain/inspiration-wiki/formal-release-contracts";
import { isFormalWikiStudentEligible, studentPreviewAllowed } from "@/lib/domain/inspiration-eligibility";
import { inspirationPublicId } from "@/lib/domain/inspiration-public-id";
import { projectApprovedPublicSource, reviewedPublicHostsFromSourceConfiguration } from "@/lib/domain/inspiration-public-source";
import { safeInspirationStudentList, safeInspirationStudentText } from "@/lib/domain/inspiration-student-projection";
import { controlledPreviewUrl } from "@/lib/services/inspiration-preview";
import { p2StudentChannelBlocksStudentRead } from "@/lib/services/inspiration-wiki-p2-student-channels";

type CourseAssociation = { coursePackId: string; facets: string[] };
type Cursor = { activatedAt: string; id: string };

const intentFacets = [
  { terms: ["书籍", "装帧", "book"], facet: "书籍设计" },
  { terms: ["版式", "排版", "layout", "网格"], facet: "版式" },
  { terms: ["品牌", "标志", "vi", "identity"], facet: "品牌与识别" },
  { terms: ["交互", "动效", "动态", "interaction"], facet: "交互与动势" },
  { terms: ["色彩", "配色", "color"], facet: "色彩" },
] as const;

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const raw = parsed as Record<string, unknown>;
    if (typeof raw.activatedAt !== "string" || typeof raw.id !== "string" || !/^inspiration:[a-f0-9]{24}$/.test(raw.id) || !Number.isFinite(Date.parse(raw.activatedAt))) return null;
    return { activatedAt: raw.activatedAt, id: raw.id };
  } catch { return null; }
}
function encodeCursor(value: Cursor) { return Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); }

function appliedFacets(query: string) {
  const normalized = query.normalize("NFKC").toLocaleLowerCase("zh-CN");
  return intentFacets.filter(({ terms }) => terms.some((term) => normalized.includes(term))).map(({ facet }) => facet);
}
function matches(item: InspirationBrowseItem, query: string, facets: readonly string[]) {
  if (!query.trim()) return true;
  const surface = [item.title, item.description ?? "", item.source.label, ...item.tags, ...item.courseAssociations.flatMap((association) => [association.coursePackId, ...association.facets])]
    .join(" ").normalize("NFKC").toLocaleLowerCase("zh-CN");
  const normalized = query.normalize("NFKC").toLocaleLowerCase("zh-CN");
  const directTokens = normalized.match(/[a-z][a-z0-9._+-]{1,}|[\p{Script=Han}]{2,}/gu) ?? [];
  const facetTerms = facets.flatMap((facet) => intentFacets.find((entry) => entry.facet === facet)?.terms ?? []);
  return [...new Set([...directTokens, ...facetTerms])].some((token) => surface.includes(token));
}
function matchesTopic(item: InspirationBrowseItem, topic: string | null | undefined) {
  if (!topic || topic === "全部") return true;
  return item.tags.includes(topic) || item.courseAssociations.some((association) => association.facets.includes(topic));
}
function courseAssociations(value: unknown): CourseAssociation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const coursePackId = safeInspirationStudentText(raw.coursePackId, 64);
    const facets = safeInspirationStudentList(raw.facets, 12);
    return coursePackId && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(coursePackId) && facets.length ? [{ coursePackId, facets }] : [];
  }).slice(0, 20);
}
function safeItem(row: {
  candidateId: string;
  candidateState: string;
  admissionStatus: string | null;
  rights: JsonRecord;
  withdrawalStatus: string;
  readModel: JsonRecord;
  asset: JsonRecord;
  contentHash: string | null;
  sourceConfiguration: JsonRecord;
  publicationScope: string | null;
  studentVisible: boolean | null;
  studentDisplayDecision: string | null;
  sourceDisclosureDecision: string | null;
  teachingDecision: string | null;
  safetyDecision: string | null;
  qualityDecision: string | null;
  withdrawalReadiness: string | null;
  browserChannel: string | null;
  bridgeChannel: string | null;
  formalWikiActivationRecorded: boolean | null;
}): InspirationBrowseItem | null {
  if (!isFormalWikiStudentEligible(row)) return null;
  const model = row.readModel as Record<string, unknown>;
  const title = safeInspirationStudentText(model.title, 240) ?? "未命名灵感案例";
  const rawSource = model.source && typeof model.source === "object" ? model.source as Record<string, unknown> : {};
  const source = projectApprovedPublicSource({
    publicLabel: rawSource.label,
    publicUrl: rawSource.url,
    allowedPublicHosts: reviewedPublicHostsFromSourceConfiguration(row.sourceConfiguration),
  });
  const previewUrl = studentPreviewAllowed(row.rights)
    ? controlledPreviewUrl(row.candidateId, row.asset, row.contentHash)
    : null;
  return {
    id: inspirationPublicId(row.candidateId), title,
    description: safeInspirationStudentText(model.description, 1_000),
    tags: safeInspirationStudentList(model.tags, 24),
    courseAssociations: courseAssociations(model.courseAssociations),
    source,
    attributionNotice: safeInspirationStudentText(model.attributionNotice, 280) ?? "来源状态未知；当前不提供外部链接。",
    preview: previewUrl ? "CONTROLLED" : "METADATA_ONLY",
    previewUrl,
  };
}

export function readPublishedInspirationBrowser(db: DatabaseConnection["db"], input: { cursor?: string | null; limit?: number; query?: string | null; topic?: string | null }): InspirationBrowseResponse {
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 30);
  const query = input.query?.trim().slice(0, 160) ?? "";
  const topic = safeInspirationStudentText(input.topic, 80);
  const cursor = decodeCursor(input.cursor ?? null);
  if (input.cursor && !cursor) throw new Error("INVALID_CURSOR");
  const facets = [...new Set([...appliedFacets(query), ...(topic && topic !== "全部" ? [topic] : [])])];
  if (p2StudentChannelBlocksStudentRead(db)) {
    return { items: [], nextCursor: null, appliedFacets: facets };
  }
  const currentEvents = db.select({ canonicalPageId: inspirationWikiCurrentPageEvents.canonicalPageId, eventType: inspirationWikiCurrentPageEvents.eventType })
    .from(inspirationWikiCurrentPageEvents)
    .orderBy(desc(inspirationWikiCurrentPageEvents.createdAt), desc(inspirationWikiCurrentPageEvents.eventId)).all();
  const latestEvents = new Map<string, "ACTIVATED" | "WITHDRAWN">();
  for (const event of currentEvents) if (!latestEvents.has(event.canonicalPageId)) latestEvents.set(event.canonicalPageId, event.eventType);
  const formal = db.select({
    canonicalPageId: inspirationWikiFormalReleases.canonicalPageId,
    releaseJson: inspirationWikiFormalReleases.releaseJson,
    publishedAt: inspirationWikiFormalReleases.publishedAt,
  }).from(inspirationWikiFormalReleases).orderBy(desc(inspirationWikiFormalReleases.publishedAt), asc(inspirationWikiFormalReleases.releaseId)).all()
    .flatMap((row) => {
      if (latestEvents.get(row.canonicalPageId) !== "ACTIVATED") return [];
      const material = FormalReleaseSchema.parse(row.releaseJson).publicMaterial;
      const item: InspirationBrowseItem = {
        id: material.publicId,
        title: material.title,
        description: material.description,
        tags: material.tags,
        courseAssociations: material.courseAssociations,
        source: material.source,
        attributionNotice: material.attributionNotice,
        preview: "CONTROLLED",
        previewUrl: material.preview.previewUrl,
      };
      return matchesTopic(item, topic) && matches(item, query, facets) ? [{ item, activatedAt: row.publishedAt.toISOString() }] : [];
    });
  const rows = db.select({
    candidateId: inspirationCandidates.id,
    candidateState: inspirationCandidates.state,
    admissionStatus: inspirationAdmissions.status,
    rights: inspirationCandidates.rightsJson,
    asset: inspirationCandidates.assetJson,
    contentHash: inspirationCandidates.contentHash,
    withdrawalStatus: inspirationCandidates.withdrawalStatus,
    readModel: inspirationAdmissions.readModelJson,
    activatedAt: inspirationAdmissions.activatedAt,
    sourceConfiguration: inspirationSources.configurationJson,
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
  })
    .from(inspirationAdmissions)
    .innerJoin(inspirationCandidates, eq(inspirationAdmissions.candidateId, inspirationCandidates.id))
    .innerJoin(inspirationSources, eq(inspirationCandidates.sourceId, inspirationSources.id))
    .where(and(eq(inspirationAdmissions.status, "ACTIVE"), eq(inspirationCandidates.state, "ACTIVE")))
    .orderBy(desc(inspirationAdmissions.activatedAt), asc(inspirationCandidates.id)).all();
  const visible = [...formal, ...rows.flatMap((row) => {
    const item = safeItem(row);
    return item && matchesTopic(item, topic) && matches(item, query, facets) ? [{ item, activatedAt: row.activatedAt.toISOString() }] : [];
  })].sort((left, right) => right.activatedAt.localeCompare(left.activatedAt) || left.item.id.localeCompare(right.item.id));
  const after = cursor ? visible.filter((entry) => entry.activatedAt < cursor.activatedAt || (entry.activatedAt === cursor.activatedAt && entry.item.id > cursor.id)) : visible;
  const page = after.slice(0, limit);
  const last = page.at(-1);
  return { items: page.map((entry) => entry.item), nextCursor: after.length > page.length && last ? encodeCursor({ activatedAt: last.activatedAt, id: last.item.id }) : null, appliedFacets: facets };
}
