import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  ReleaseQualificationCaseSchema,
  ReleaseQualificationDecisionInputSchema,
  ReleaseQualificationDecisionSchema,
  TeacherReleaseQualificationQueueSchema,
  type ReleaseQualificationCase,
  type ReleaseQualificationDecision,
  type ReleaseQualificationDecisionInput,
} from "@/lib/domain/inspiration-wiki/release-qualification-contracts";
import { hashWikiValue } from "@/lib/domain/inspiration-wiki/integrity";
import { readTeacherPrivateInternalCatalog } from "./inspiration-wiki-private-catalog-governance";

const BOUNDARY = {
  teacherPrivate: true,
  formalQualificationOnly: true,
  studentVisible: false,
  formalRelease: "DISABLED",
  currentPage: "DISABLED",
  browseRelease: "SHADOW",
  studentSearch: "SHADOW",
  wikiRetrieval: "DISABLED",
  r2: "DISABLED",
  embedding: "DISABLED",
  lumiRetrieval: "DISABLED",
  productionDeployment: "DISABLED",
} as const;

const GATES = [
  ["STUDENT_DISPLAY_RIGHTS", "学生正式展示权利"],
  ["AUDIENCE_POLICY", "学生受众与预览策略"],
  ["SOURCE_DISCLOSURE", "来源与署名披露"],
  ["WITHDRAWAL_READINESS", "撤下与回滚准备"],
  ["RELEASE_ROLE_SIGNOFF", "发布角色签核"],
] as const;

export class ReleaseQualificationConflictError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "ReleaseQualificationConflictError";
  }
}

function isoSeconds(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("D-25 时间无效");
  return new Date(Math.floor(date.getTime() / 1_000) * 1_000).toISOString();
}

function parseJson(value: string) {
  return JSON.parse(value) as unknown;
}

function assertCaseHash(releaseCase: ReleaseQualificationCase) {
  const { caseHash, ...material } = releaseCase;
  if (hashWikiValue(material) !== caseHash) {
    throw new ReleaseQualificationConflictError("D25_CASE_HASH_MISMATCH");
  }
}

function assertDecisionHash(decision: ReleaseQualificationDecision) {
  const { decisionHash, ...material } = decision;
  if (hashWikiValue(material) !== decisionHash) {
    throw new ReleaseQualificationConflictError("D25_DECISION_HASH_MISMATCH");
  }
}

function choosePilotItems(items: ReturnType<typeof readTeacherPrivateInternalCatalog>["items"], limit: number) {
  const eligible = items.filter((item) => item.evidenceGapCount === 0 && item.primaryPreviewUrl !== null)
    .sort((left, right) => left.primaryCategory.localeCompare(right.primaryCategory, "zh-CN") || left.title.localeCompare(right.title, "zh-CN"));
  const chosen: typeof eligible = [];
  const categories = new Set<string>();
  for (const item of eligible) {
    if (categories.has(item.primaryCategory)) continue;
    categories.add(item.primaryCategory);
    chosen.push(item);
    if (chosen.length === limit) return chosen;
  }
  for (const item of eligible) {
    if (chosen.some((current) => current.entryId === item.entryId)) continue;
    chosen.push(item);
    if (chosen.length === limit) break;
  }
  return chosen;
}

function insertQualificationCases(
  connection: DatabaseConnection,
  items: ReturnType<typeof readTeacherPrivateInternalCatalog>["items"],
  selectedAt: string | Date,
) {
  const stamp = isoSeconds(selectedAt);
  const insert = connection.sqlite.prepare(
    `INSERT INTO inspiration_wiki_release_qualification_cases (
      case_id,case_hash,entry_id,page_id,page_revision_id,content_hash,primary_category,case_json,
      teacher_private,formal_qualification_only,student_visible,formal_release,current_page,
      browse_release,student_search,wiki_retrieval,r2,embedding,lumi_retrieval,production_deployment,created_at
    ) VALUES (?,?,?,?,?,?,?,?,1,1,0,'DISABLED','DISABLED','SHADOW','SHADOW','DISABLED','DISABLED','DISABLED','DISABLED','DISABLED',?)`,
  );
  return connection.sqlite.transaction(() => items.map((item) => {
    const row = connection.sqlite.prepare(
      `SELECT e.page_revision_id,r.revision,r.content_hash
       FROM inspiration_wiki_private_internal_catalog_entries e
       JOIN inspiration_wiki_private_page_revisions r ON r.revision_id=e.page_revision_id
       WHERE e.entry_id=?`,
    ).get(item.entryId) as { page_revision_id: string; revision: number; content_hash: string } | undefined;
    if (!row) throw new ReleaseQualificationConflictError("D25_SOURCE_REVISION_MISSING");
    const suffix = item.pageId.split(":").at(-1);
    if (!suffix) throw new ReleaseQualificationConflictError("D25_PAGE_ID_INVALID");
    const material: Omit<ReleaseQualificationCase, "caseHash"> = {
      schemaVersion: "lumi-inspiration-release-qualification-case/v1",
      caseId: `release-qualification:${suffix}`,
      entryId: item.entryId,
      pageId: item.pageId,
      pageRevisionId: row.page_revision_id,
      pageRevision: row.revision,
      contentHash: row.content_hash,
      title: item.title,
      primaryCategory: item.primaryCategory,
      artisticStyleLabels: [...item.artisticStyleLabels],
      primaryPreviewUrl: item.primaryPreviewUrl,
      evidenceGapCount: item.evidenceGapCount,
      rightsScope: "UNKNOWN_PRIVATE_ONLY",
      selectedAt: stamp,
      boundary: BOUNDARY,
    };
    const releaseCase = ReleaseQualificationCaseSchema.parse({ ...material, caseHash: hashWikiValue(material) });
    assertCaseHash(releaseCase);
    insert.run(
      releaseCase.caseId,
      releaseCase.caseHash,
      releaseCase.entryId,
      releaseCase.pageId,
      releaseCase.pageRevisionId,
      releaseCase.contentHash,
      releaseCase.primaryCategory,
      JSON.stringify(releaseCase),
      new Date(releaseCase.selectedAt).getTime() / 1_000,
    );
    return releaseCase;
  }))();
}

export function prepareReleaseQualificationPilots(
  connection: DatabaseConnection,
  actor: SessionPayload,
  selectedAt: string | Date = new Date(),
  limit = 5,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error("D-25 试点数量必须为 1-12");
  const catalog = readTeacherPrivateInternalCatalog(connection, actor);
  const existing = connection.sqlite.prepare(
    "SELECT case_json FROM inspiration_wiki_release_qualification_cases ORDER BY created_at,case_id",
  ).all() as Array<{ case_json: string }>;
  if (existing.length) {
    const cases = existing.map((row) => ReleaseQualificationCaseSchema.parse(parseJson(row.case_json)));
    cases.forEach(assertCaseHash);
    return { cases, created: 0, replayed: cases.length };
  }
  const chosen = choosePilotItems(catalog.items, limit);
  if (chosen.length !== limit) throw new ReleaseQualificationConflictError("D25_NOT_ENOUGH_STRICT_MEDIA_PILOTS");
  const cases = insertQualificationCases(connection, chosen, selectedAt);
  return { cases, created: cases.length, replayed: 0 };
}

export function prepareRemainingReleaseQualificationCases(
  connection: DatabaseConnection,
  actor: SessionPayload,
  selectedAt: string | Date = new Date(),
  expectedCount = 172,
) {
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 500) {
    throw new Error("剩余发布资格数量必须为 1-500");
  }
  const catalog = readTeacherPrivateInternalCatalog(connection, actor);
  const existing = new Set((connection.sqlite.prepare(
    "SELECT entry_id FROM inspiration_wiki_release_qualification_cases",
  ).all() as Array<{ entry_id: string }>).map((row) => row.entry_id));
  const remaining = catalog.items
    .filter((item) => !existing.has(item.entryId) && item.primaryPreviewUrl !== null)
    .sort((left, right) => left.pageId.localeCompare(right.pageId));
  if (remaining.length === 0) return { cases: [] as ReleaseQualificationCase[], created: 0, replayed: expectedCount };
  if (remaining.length !== expectedCount) {
    throw new ReleaseQualificationConflictError(`REMAINING_RELEASE_SET_MISMATCH:${remaining.length}:${expectedCount}`);
  }
  const cases = insertQualificationCases(connection, remaining, selectedAt);
  return { cases, created: cases.length, replayed: 0 };
}

export function readTeacherReleaseQualificationQueue(
  connection: DatabaseConnection,
  actor: SessionPayload,
) {
  readTeacherPrivateInternalCatalog(connection, actor);
  const cases = (connection.sqlite.prepare(
    "SELECT case_json FROM inspiration_wiki_release_qualification_cases ORDER BY created_at,case_id",
  ).all() as Array<{ case_json: string }>).map((row) => {
    const releaseCase = ReleaseQualificationCaseSchema.parse(parseJson(row.case_json));
    assertCaseHash(releaseCase);
    return releaseCase;
  });
  const decisions = (connection.sqlite.prepare(
    "SELECT decision_json FROM inspiration_wiki_release_qualification_decisions ORDER BY case_id,gate,revision DESC",
  ).all() as Array<{ decision_json: string }>).map((row) => {
    const decision = ReleaseQualificationDecisionSchema.parse(parseJson(row.decision_json));
    assertDecisionHash(decision);
    return decision;
  });
  const latest = new Map<string, ReleaseQualificationDecision>();
  for (const decision of decisions) {
    const key = `${decision.caseId}:${decision.gate}`;
    if (!latest.has(key)) latest.set(key, decision);
  }
  const items = cases.map((releaseCase) => {
    const gates = GATES.map(([gate, label]) => {
      const decision = latest.get(`${releaseCase.caseId}:${gate}`) ?? null;
      return { gate, label, status: decision?.status ?? "PENDING" as const, decision };
    });
    const satisfiedGateCount = gates.filter((gate) => gate.status === "SATISFIED").length;
    return {
      releaseCase,
      gates,
      satisfiedGateCount,
      state: satisfiedGateCount === GATES.length ? "QUALIFIED_FOR_CANONICAL_BUILD" as const : "QUALIFICATION_IN_PROGRESS" as const,
    };
  });
  return TeacherReleaseQualificationQueueSchema.parse({
    schemaVersion: "lumi-inspiration-release-qualification-queue/v1",
    items,
    meta: {
      total: items.length,
      inProgress: items.filter((item) => item.state === "QUALIFICATION_IN_PROGRESS").length,
      qualified: items.filter((item) => item.state === "QUALIFIED_FOR_CANONICAL_BUILD").length,
      boundary: BOUNDARY,
    },
  });
}

export function decideReleaseQualificationGate(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: ReleaseQualificationDecisionInput,
  decidedAt: string | Date = new Date(),
) {
  readTeacherPrivateInternalCatalog(connection, actor);
  const input = ReleaseQualificationDecisionInputSchema.parse(rawInput);
  const requestHash = hashWikiValue(input);
  const existing = connection.sqlite.prepare(
    "SELECT request_hash,decision_json FROM inspiration_wiki_release_qualification_decisions WHERE idempotency_key=?",
  ).get(input.idempotencyKey) as { request_hash: string; decision_json: string } | undefined;
  if (existing) {
    if (existing.request_hash !== requestHash) throw new ReleaseQualificationConflictError("D25_IDEMPOTENCY_CONFLICT");
    const decision = ReleaseQualificationDecisionSchema.parse(parseJson(existing.decision_json));
    assertDecisionHash(decision);
    return { decision, replayed: true as const };
  }
  const releaseCase = connection.sqlite.prepare(
    "SELECT case_hash FROM inspiration_wiki_release_qualification_cases WHERE case_id=?",
  ).get(input.caseId) as { case_hash: string } | undefined;
  if (!releaseCase) throw new ReleaseQualificationConflictError("D25_CASE_NOT_FOUND");
  const revision = (connection.sqlite.prepare(
    "SELECT coalesce(max(revision),0)+1 AS revision FROM inspiration_wiki_release_qualification_decisions WHERE case_id=? AND gate=?",
  ).get(input.caseId, input.gate) as { revision: number }).revision;
  const stamp = isoSeconds(decidedAt);
  const suffix = input.caseId.split(":").at(-1);
  const material: Omit<ReleaseQualificationDecision, "decisionHash"> = {
    schemaVersion: "lumi-inspiration-release-qualification-decision/v1",
    decisionId: `release-qualification-decision:${suffix}:${revision}:${input.gate.toLowerCase()}`,
    caseId: input.caseId,
    gate: input.gate,
    status: input.status,
    evidenceRef: input.evidenceRef,
    note: input.note,
    idempotencyKey: input.idempotencyKey,
    revision,
    actorId: actor.userId,
    decidedAt: stamp,
  };
  const decision = ReleaseQualificationDecisionSchema.parse({ ...material, decisionHash: hashWikiValue(material) });
  assertDecisionHash(decision);
  connection.sqlite.prepare(
    `INSERT INTO inspiration_wiki_release_qualification_decisions (
      decision_id,decision_hash,request_hash,idempotency_key,case_id,gate,status,evidence_ref,note,
      actor_id,revision,decision_json,decided_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    decision.decisionId,
    decision.decisionHash,
    requestHash,
    decision.idempotencyKey,
    decision.caseId,
    decision.gate,
    decision.status,
    decision.evidenceRef,
    decision.note,
    decision.actorId,
    decision.revision,
    JSON.stringify(decision),
    new Date(decision.decidedAt).getTime() / 1_000,
  );
  return { decision, replayed: false as const };
}

export { BOUNDARY as RELEASE_QUALIFICATION_BOUNDARY };
