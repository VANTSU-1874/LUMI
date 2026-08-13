import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { runMigrations } from "@/lib/db/migrate";

export const D27_SCHEMA_VERSION = "lumi-inspiration-production-release-bundle/v2";
export const D27_BUNDLE_ID = "d28-full-release-v1";
export const D27_RIGHTS_EVIDENCE_REF = "USER_RIGHTS_ATTESTATION:2026-08-13:D25-PILOT-5";
export const D28_RIGHTS_EVIDENCE_REF = "USER_RIGHTS_ATTESTATION:2026-08-13:INSPIRATION-WIKI-REMAINING-172";
const RIGHTS_EVIDENCE_REFS = [D27_RIGHTS_EVIDENCE_REF, D28_RIGHTS_EVIDENCE_REF] as const;
const EXPECTED_RELEASE_COUNT = 177;

const TABLE_ORDER = [
  "inspiration_wiki_hermes_batches",
  "inspiration_wiki_hermes_candidates",
  "inspiration_wiki_role_policies",
  "inspiration_wiki_reviewer_assignments",
  "inspiration_wiki_review_packs",
  "inspiration_wiki_review_pack_decisions",
  "inspiration_wiki_evidence_gap_review_packs",
  "inspiration_wiki_evidence_gap_review_decisions",
  "inspiration_wiki_evidence_gap_media_amendments",
  "inspiration_wiki_private_working_drafts",
  "inspiration_wiki_private_working_draft_revisions",
  "inspiration_wiki_private_domain_review_cases",
  "inspiration_wiki_private_domain_review_decisions",
  "inspiration_wiki_private_pages",
  "inspiration_wiki_private_page_revisions",
  "inspiration_wiki_private_compiled_truths",
  "inspiration_wiki_private_catalog_governance_cases",
  "inspiration_wiki_private_catalog_domain_decisions",
  "inspiration_wiki_private_internal_catalog_entries",
  "inspiration_wiki_release_qualification_cases",
  "inspiration_wiki_release_qualification_decisions",
  "inspiration_wiki_canonical_pages",
  "inspiration_wiki_canonical_page_revisions",
  "inspiration_wiki_formal_releases",
  "inspiration_wiki_current_page_events",
  "inspiration_wiki_p2_active_channel_snapshots",
] as const;

type TableName = (typeof TABLE_ORDER)[number];
type SqlValue = string | number | null;
type BundleRow = {
  table: TableName;
  primaryKey: Record<string, SqlValue>;
  row: Record<string, SqlValue>;
};
type BundleAsset = {
  mediaId: string;
  storagePath: string;
  bundlePath: string;
  mimeType: string;
  bytes: number;
  sha256: string;
};
type BundleManifest = {
  schemaVersion: typeof D27_SCHEMA_VERSION;
  bundleId: typeof D27_BUNDLE_ID;
  rightsEvidenceRefs: string[];
  releaseCount: number;
  titles: string[];
  tableOrder: TableName[];
  rowCounts: Record<string, number>;
  rowsSha256: string;
  assets: BundleAsset[];
  totalAssetBytes: number;
  capabilityBoundary: {
    browse: "ACTIVE";
    search: "ACTIVE";
    preview: "ACTIVE";
    r2: "DISABLED";
    embedding: "DISABLED";
    lumiRetrieval: "DISABLED";
  };
  bundleDigest: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sha256Bytes(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function quoteIdentifier(value: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("D27_IDENTIFIER_INVALID");
  return `"${value}"`;
}

function primaryKeyColumns(database: Database.Database, table: string) {
  const columns = database.pragma(`table_info(${quoteIdentifier(table)})`) as Array<{
    name: string;
    pk: number;
  }>;
  const keys = columns.filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk);
  if (keys.length === 0) throw new Error(`D27_PRIMARY_KEY_MISSING:${table}`);
  return keys.map((column) => column.name);
}

function selectRows(
  database: Database.Database,
  table: TableName,
  where = "1=1",
  values: SqlValue[] = [],
): BundleRow[] {
  const keys = primaryKeyColumns(database, table);
  const rows = database.prepare(
    `SELECT * FROM ${quoteIdentifier(table)} WHERE ${where} ORDER BY ${keys.map(quoteIdentifier).join(", ")}`,
  ).all(...values) as Array<Record<string, SqlValue>>;
  return rows.map((row) => ({
    table,
    primaryKey: Object.fromEntries(keys.map((key) => [key, row[key] ?? null])),
    row,
  }));
}

function placeholders(values: readonly unknown[]) {
  if (values.length === 0) throw new Error("D27_EMPTY_SELECTION");
  return values.map(() => "?").join(",");
}

function columnIn(column: string, values: readonly SqlValue[]) {
  return `${quoteIdentifier(column)} IN (${placeholders(values)})`;
}

function valuesOf(rows: BundleRow[], column: string) {
  return rows.map(({ row }) => row[column] ?? null);
}

function parseJsonObject(value: SqlValue, code: string) {
  if (typeof value !== "string") throw new Error(code);
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(code);
  return parsed as Record<string, unknown>;
}

function parseJsonArray(value: SqlValue, code: string) {
  if (typeof value !== "string") throw new Error(code);
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(code);
  return parsed;
}

function assertSafeRelativePath(value: string, prefix: string) {
  if (value.includes("\\") || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error("D27_ASSET_PATH_UNSAFE");
  }
  if (!value.startsWith(prefix)) throw new Error("D27_ASSET_PATH_OUTSIDE_PREFIX");
}

function assertControlledAssetPath(value: string) {
  if (value.startsWith("inspiration-wiki/review-packs/assets/")) {
    assertSafeRelativePath(value, "inspiration-wiki/review-packs/assets/");
    return;
  }
  assertSafeRelativePath(value, "inspiration-wiki/evidence-gap-review-packs/assets/");
}

function manifestMaterial(manifest: Omit<BundleManifest, "bundleDigest">) {
  return canonicalJson(manifest);
}

function bundleDigest(manifest: Omit<BundleManifest, "bundleDigest">) {
  return sha256Bytes(manifestMaterial(manifest));
}

function assertNoSensitiveMaterial(payload: string) {
  const forbidden = [
    /(?:cookie|proxy[_-]?(?:password|token)|authorization)\s*[=:]/i,
    /C:\\Users\\/i,
    /\/home\/arlo\//i,
    /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/,
  ];
  if (forbidden.some((pattern) => pattern.test(payload))) throw new Error("D27_SENSITIVE_MATERIAL_DETECTED");
}

function collectBundleRows(database: Database.Database) {
  const canonicalPages = selectRows(database, "inspiration_wiki_canonical_pages");
  if (canonicalPages.length !== EXPECTED_RELEASE_COUNT) throw new Error("D27_CANONICAL_PAGE_COUNT_MISMATCH");
  const candidateIds = valuesOf(canonicalPages, "candidate_id");
  const candidates = selectRows(
    database,
    "inspiration_wiki_hermes_candidates",
    columnIn("id", candidateIds),
    candidateIds,
  );
  if (candidates.length !== EXPECTED_RELEASE_COUNT) throw new Error("D27_CANDIDATE_COUNT_MISMATCH");
  const batchIds = [...new Set(valuesOf(candidates, "batch_id"))];
  const batches = selectRows(database, "inspiration_wiki_hermes_batches", columnIn("batch_id", batchIds), batchIds);
  const rolePolicies = selectRows(database, "inspiration_wiki_role_policies");
  const reviewerAssignments = selectRows(database, "inspiration_wiki_reviewer_assignments");
  const reviewPacks = selectRows(
    database,
    "inspiration_wiki_review_packs",
    columnIn("candidate_id", candidateIds),
    candidateIds,
  );
  const reviewPackIds = valuesOf(reviewPacks, "review_pack_id");
  const reviewDecisions = reviewPackIds.length ? selectRows(database, "inspiration_wiki_review_pack_decisions", columnIn("review_pack_id", reviewPackIds), reviewPackIds) : [];
  const evidenceGapPacks = selectRows(database, "inspiration_wiki_evidence_gap_review_packs", columnIn("candidate_id", candidateIds), candidateIds);
  const evidenceGapPackIds = valuesOf(evidenceGapPacks, "review_pack_id");
  const evidenceGapDecisions = evidenceGapPackIds.length ? selectRows(database, "inspiration_wiki_evidence_gap_review_decisions", columnIn("review_pack_id", evidenceGapPackIds), evidenceGapPackIds) : [];
  const evidenceGapAmendments = evidenceGapPackIds.length ? selectRows(database, "inspiration_wiki_evidence_gap_media_amendments", columnIn("review_pack_id", evidenceGapPackIds), evidenceGapPackIds) : [];
  if (reviewPacks.length + evidenceGapPacks.length !== EXPECTED_RELEASE_COUNT) throw new Error("D27_CONTROLLED_REVIEW_PACK_COUNT_MISMATCH");
  const drafts = selectRows(
    database,
    "inspiration_wiki_private_working_drafts",
    columnIn("candidate_id", candidateIds),
    candidateIds,
  );
  const draftIds = valuesOf(drafts, "draft_id");
  const draftRevisions = selectRows(
    database,
    "inspiration_wiki_private_working_draft_revisions",
    columnIn("draft_id", draftIds),
    draftIds,
  );
  const domainCases = selectRows(
    database,
    "inspiration_wiki_private_domain_review_cases",
    columnIn("candidate_id", candidateIds),
    candidateIds,
  );
  const domainCaseIds = valuesOf(domainCases, "review_case_id");
  const domainDecisions = selectRows(
    database,
    "inspiration_wiki_private_domain_review_decisions",
    columnIn("review_case_id", domainCaseIds),
    domainCaseIds,
  );
  const privatePages = selectRows(
    database,
    "inspiration_wiki_private_pages",
    columnIn("candidate_id", candidateIds),
    candidateIds,
  );
  const privatePageIds = valuesOf(privatePages, "page_id");
  const privateRevisions = selectRows(
    database,
    "inspiration_wiki_private_page_revisions",
    columnIn("candidate_id", candidateIds),
    candidateIds,
  );
  const privateRevisionIds = valuesOf(privateRevisions, "revision_id");
  const truths = selectRows(
    database,
    "inspiration_wiki_private_compiled_truths",
    columnIn("page_id", privatePageIds),
    privatePageIds,
  );
  const truthIds = valuesOf(truths, "truth_id");
  const catalogCases = selectRows(
    database,
    "inspiration_wiki_private_catalog_governance_cases",
    columnIn("candidate_id", candidateIds),
    candidateIds,
  );
  const catalogCaseIds = valuesOf(catalogCases, "governance_case_id");
  const catalogDecisions = selectRows(
    database,
    "inspiration_wiki_private_catalog_domain_decisions",
    columnIn("governance_case_id", catalogCaseIds),
    catalogCaseIds,
  );
  const catalogEntries = selectRows(
    database,
    "inspiration_wiki_private_internal_catalog_entries",
    columnIn("candidate_id", candidateIds),
    candidateIds,
  );
  const entryIds = valuesOf(catalogEntries, "entry_id");
  const qualificationCases = selectRows(
    database,
    "inspiration_wiki_release_qualification_cases",
    columnIn("entry_id", entryIds),
    entryIds,
  );
  const qualificationCaseIds = valuesOf(qualificationCases, "case_id");
  const qualificationDecisions = selectRows(
    database,
    "inspiration_wiki_release_qualification_decisions",
    columnIn("case_id", qualificationCaseIds),
    qualificationCaseIds,
  );
  const canonicalPageIds = valuesOf(canonicalPages, "canonical_page_id");
  const canonicalRevisions = selectRows(
    database,
    "inspiration_wiki_canonical_page_revisions",
    columnIn("canonical_page_id", canonicalPageIds),
    canonicalPageIds,
  );
  const formalReleases = selectRows(database, "inspiration_wiki_formal_releases");
  const currentEvents = selectRows(
    database,
    "inspiration_wiki_current_page_events",
    columnIn("canonical_page_id", canonicalPageIds),
    canonicalPageIds,
  );
  const releaseIds = valuesOf(formalReleases, "release_id").map(String).sort();
  const activeSnapshots = selectRows(database, "inspiration_wiki_p2_active_channel_snapshots")
    .filter(({ row }) => {
      const ids = parseJsonArray(row.release_ids_json ?? null, "D27_ACTIVE_RELEASE_IDS_INVALID")
        .map(String).sort();
      return JSON.stringify(ids) === JSON.stringify(releaseIds);
    });
  if (activeSnapshots.length === 0) throw new Error("D27_MATCHING_ACTIVE_SNAPSHOT_MISSING");

  const groups: Record<TableName, BundleRow[]> = {
    inspiration_wiki_hermes_batches: batches,
    inspiration_wiki_hermes_candidates: candidates,
    inspiration_wiki_role_policies: rolePolicies,
    inspiration_wiki_reviewer_assignments: reviewerAssignments,
    inspiration_wiki_review_packs: reviewPacks,
    inspiration_wiki_review_pack_decisions: reviewDecisions,
    inspiration_wiki_evidence_gap_review_packs: evidenceGapPacks,
    inspiration_wiki_evidence_gap_review_decisions: evidenceGapDecisions,
    inspiration_wiki_evidence_gap_media_amendments: evidenceGapAmendments,
    inspiration_wiki_private_working_drafts: drafts,
    inspiration_wiki_private_working_draft_revisions: draftRevisions,
    inspiration_wiki_private_domain_review_cases: domainCases,
    inspiration_wiki_private_domain_review_decisions: domainDecisions,
    inspiration_wiki_private_pages: privatePages,
    inspiration_wiki_private_page_revisions: privateRevisions,
    inspiration_wiki_private_compiled_truths: truths,
    inspiration_wiki_private_catalog_governance_cases: catalogCases,
    inspiration_wiki_private_catalog_domain_decisions: catalogDecisions,
    inspiration_wiki_private_internal_catalog_entries: catalogEntries,
    inspiration_wiki_release_qualification_cases: qualificationCases,
    inspiration_wiki_release_qualification_decisions: qualificationDecisions,
    inspiration_wiki_canonical_pages: canonicalPages,
    inspiration_wiki_canonical_page_revisions: canonicalRevisions,
    inspiration_wiki_formal_releases: formalReleases,
    inspiration_wiki_current_page_events: currentEvents,
    inspiration_wiki_p2_active_channel_snapshots: [activeSnapshots.at(-1)!],
  };
  const required = Object.entries(groups).filter(([name]) => name !== "inspiration_wiki_evidence_gap_media_amendments");
  for (const [name, rows] of required) if (rows.length === 0) throw new Error(`D27_REQUIRED_TABLE_EMPTY:${name}`);
  if (privateRevisions.some(({ row }) => !privateRevisionIds.includes(row.revision_id ?? null))) {
    throw new Error("D27_PRIVATE_REVISION_SELECTION_INVALID");
  }
  if (truths.some(({ row }) => !truthIds.includes(row.truth_id ?? null))) {
    throw new Error("D27_TRUTH_SELECTION_INVALID");
  }
  return { groups, rows: TABLE_ORDER.flatMap((table) => groups[table]), controlledPacks: [...reviewPacks, ...evidenceGapPacks], formalReleases };
}

function verifyReleaseRows(rows: BundleRow[]) {
  if (rows.length !== EXPECTED_RELEASE_COUNT) throw new Error("D27_RELEASE_COUNT_MISMATCH");
  const rightsCounts = new Map<string, number>();
  const titles = rows.map(({ row }) => {
    const release = parseJsonObject(row.release_json ?? null, "D27_RELEASE_JSON_INVALID");
    const material = release.publicMaterial;
    if (!material || typeof material !== "object" || Array.isArray(material)) {
      throw new Error("D27_PUBLIC_MATERIAL_INVALID");
    }
    const publicMaterial = material as Record<string, unknown>;
    if (!RIGHTS_EVIDENCE_REFS.includes(publicMaterial.rightsEvidenceRef as typeof RIGHTS_EVIDENCE_REFS[number])) {
      throw new Error("D27_RIGHTS_EVIDENCE_MISMATCH");
    }
    const rightsRef = String(publicMaterial.rightsEvidenceRef);
    rightsCounts.set(rightsRef, (rightsCounts.get(rightsRef) ?? 0) + 1);
    if (publicMaterial.audience !== "AUTHENTICATED_STUDENT_ONLY") {
      throw new Error("D27_AUDIENCE_BOUNDARY_MISMATCH");
    }
    const boundary = release.boundary as Record<string, unknown> | undefined;
    if (
      boundary?.r2 !== "DISABLED"
      || boundary.embedding !== "DISABLED"
      || boundary.lumiRetrieval !== "DISABLED"
      || boundary.browseRelease !== "ACTIVE"
      || boundary.studentSearch !== "ACTIVE"
      || boundary.preview !== "ACTIVE"
    ) throw new Error("D27_RELEASE_BOUNDARY_MISMATCH");
    return String(publicMaterial.title);
  }).sort();
  if (rightsCounts.get(D27_RIGHTS_EVIDENCE_REF) !== 5 || rightsCounts.get(D28_RIGHTS_EVIDENCE_REF) !== 172) throw new Error("D27_RIGHTS_EVIDENCE_COUNT_MISMATCH");
  return titles;
}

function collectAssets(
  reviewPacks: BundleRow[],
  dataRoot: string,
  stagingRoot: string,
): BundleAsset[] {
  const assets = reviewPacks.flatMap(({ row }) => (
    parseJsonArray(row.media_assets_json ?? null, "D27_MEDIA_ASSETS_INVALID") as Array<Record<string, unknown>>
  )).map((raw): BundleAsset => {
    const asset = {
      mediaId: String(raw.mediaId),
      storagePath: String(raw.storagePath),
      bundlePath: `assets/${String(raw.storagePath)}`,
      mimeType: String(raw.mimeType),
      bytes: Number(raw.bytes),
      sha256: String(raw.sha256),
    };
    assertControlledAssetPath(asset.storagePath);
    assertSafeRelativePath(asset.bundlePath, "assets/inspiration-wiki/");
    if (!/^[0-9a-f]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) {
      throw new Error("D27_ASSET_DESCRIPTOR_INVALID");
    }
    const source = path.resolve(dataRoot, asset.storagePath);
    const root = `${path.resolve(dataRoot)}${path.sep}`;
    if (!source.startsWith(root) || !statSync(source).isFile()) throw new Error("D27_ASSET_SOURCE_INVALID");
    const bytes = readFileSync(source);
    if (bytes.byteLength !== asset.bytes || sha256Bytes(bytes) !== asset.sha256) {
      throw new Error("D27_ASSET_INTEGRITY_FAILURE");
    }
    const target = path.resolve(stagingRoot, asset.bundlePath);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    return asset;
  }).sort((left, right) => left.storagePath.localeCompare(right.storagePath));
  const uniquePaths = new Set(assets.map((asset) => asset.storagePath));
  if (uniquePaths.size !== assets.length) throw new Error("D27_ASSET_PATH_DUPLICATE");
  return assets;
}

export function buildInspirationWikiProductionBundle(options: {
  databasePath: string;
  outputRoot: string;
  dataRoot?: string;
}) {
  const databasePath = path.resolve(options.databasePath);
  const outputRoot = path.resolve(options.outputRoot);
  const dataRoot = path.resolve(options.dataRoot ?? path.dirname(databasePath));
  const stagingRoot = `${outputRoot}.staging-${process.pid}`;
  if (existsSync(outputRoot)) throw new Error("D27_OUTPUT_ALREADY_EXISTS");
  if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    database.pragma("foreign_keys = ON");
    if ((database.pragma("foreign_key_check") as unknown[]).length > 0) throw new Error("D27_SOURCE_FOREIGN_KEY_FAILURE");
    const { groups, rows, controlledPacks, formalReleases } = collectBundleRows(database);
    const titles = verifyReleaseRows(formalReleases);
    const rowsPayload = rows.map((row) => JSON.stringify(canonicalize(row))).join("\n") + "\n";
    assertNoSensitiveMaterial(rowsPayload);
    writeFileSync(path.join(stagingRoot, "rows.jsonl"), rowsPayload, { flag: "wx" });
    const assets = collectAssets(controlledPacks, dataRoot, stagingRoot);
    const material: Omit<BundleManifest, "bundleDigest"> = {
      schemaVersion: D27_SCHEMA_VERSION,
      bundleId: D27_BUNDLE_ID,
      rightsEvidenceRefs: [...RIGHTS_EVIDENCE_REFS],
      releaseCount: EXPECTED_RELEASE_COUNT,
      titles,
      tableOrder: [...TABLE_ORDER],
      rowCounts: Object.fromEntries(TABLE_ORDER.map((table) => [table, groups[table].length])),
      rowsSha256: sha256Bytes(rowsPayload),
      assets,
      totalAssetBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
      capabilityBoundary: {
        browse: "ACTIVE",
        search: "ACTIVE",
        preview: "ACTIVE",
        r2: "DISABLED",
        embedding: "DISABLED",
        lumiRetrieval: "DISABLED",
      },
    };
    const manifest: BundleManifest = { ...material, bundleDigest: bundleDigest(material) };
    const manifestPayload = canonicalJson(manifest);
    assertNoSensitiveMaterial(manifestPayload);
    writeFileSync(path.join(stagingRoot, "manifest.json"), manifestPayload, { flag: "wx" });
    writeFileSync(
      path.join(stagingRoot, "report.md"),
      `# Inspiration Wiki full production bundle\n\n- Releases: ${EXPECTED_RELEASE_COUNT}\n- Evidence rows: ${rows.length}\n- Controlled assets: ${assets.length}\n- Asset bytes: ${material.totalAssetBytes}\n- Browse/Search/Preview: ACTIVE\n- Anonymous/R2/Embedding/Lumi retrieval: DISABLED\n- Bundle digest: \`${manifest.bundleDigest}\`\n`,
      { flag: "wx" },
    );
    writeFileSync(path.join(stagingRoot, "DONE.json"), canonicalJson({
      schemaVersion: "lumi-inspiration-production-release-done/v1",
      bundleId: D27_BUNDLE_ID,
      bundleDigest: manifest.bundleDigest,
      status: "READY",
    }), { flag: "wx" });
    renameSync(stagingRoot, outputRoot);
    return { manifest, rowCount: rows.length, outputRoot };
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  } finally {
    database.close();
  }
}

function readBundle(bundleRoot: string) {
  const root = path.resolve(bundleRoot);
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as BundleManifest;
  if (manifest.schemaVersion !== D27_SCHEMA_VERSION || manifest.bundleId !== D27_BUNDLE_ID) {
    throw new Error("D27_MANIFEST_IDENTITY_MISMATCH");
  }
  const { bundleDigest: claimedDigest, ...material } = manifest;
  if (!/^[0-9a-f]{64}$/.test(claimedDigest) || bundleDigest(material) !== claimedDigest) {
    throw new Error("D27_MANIFEST_DIGEST_MISMATCH");
  }
  const done = JSON.parse(readFileSync(path.join(root, "DONE.json"), "utf8")) as Record<string, unknown>;
  if (done.bundleDigest !== claimedDigest || done.status !== "READY" || done.bundleId !== D27_BUNDLE_ID) {
    throw new Error("D27_DONE_MISMATCH");
  }
  const rowsPayload = readFileSync(path.join(root, "rows.jsonl"), "utf8");
  if (sha256Bytes(rowsPayload) !== manifest.rowsSha256) throw new Error("D27_ROWS_DIGEST_MISMATCH");
  const rows = rowsPayload.trimEnd().split("\n").map((line) => JSON.parse(line) as BundleRow);
  if (JSON.stringify(manifest.tableOrder) !== JSON.stringify(TABLE_ORDER)) {
    throw new Error("D27_TABLE_ORDER_MISMATCH");
  }
  const observedCounts = Object.fromEntries(TABLE_ORDER.map((table) => [
    table,
    rows.filter((row) => row.table === table).length,
  ]));
  if (canonicalJson(observedCounts) !== canonicalJson(manifest.rowCounts)) {
    throw new Error("D27_ROW_COUNTS_MISMATCH");
  }
  for (const row of rows) {
    if (!TABLE_ORDER.includes(row.table)) throw new Error("D27_ROW_TABLE_NOT_ALLOWED");
    if (!row.row || !row.primaryKey) throw new Error("D27_ROW_INVALID");
  }
  for (const asset of manifest.assets) {
    assertControlledAssetPath(asset.storagePath);
    assertSafeRelativePath(asset.bundlePath, "assets/inspiration-wiki/");
    const bytes = readFileSync(path.resolve(root, asset.bundlePath));
    if (bytes.byteLength !== asset.bytes || sha256Bytes(bytes) !== asset.sha256) {
      throw new Error("D27_BUNDLE_ASSET_INTEGRITY_FAILURE");
    }
  }
  return { root, manifest, rows };
}

function rowsEqual(left: Record<string, SqlValue>, right: Record<string, SqlValue>) {
  return canonicalJson(left) === canonicalJson(right);
}

function insertBundleRows(database: Database.Database, rows: BundleRow[]) {
  let writes = 0;
  for (const row of rows) {
    const keys = Object.keys(row.primaryKey);
    const where = keys.map((key) => `${quoteIdentifier(key)} = ?`).join(" AND ");
    const existing = database.prepare(
      `SELECT * FROM ${quoteIdentifier(row.table)} WHERE ${where}`,
    ).get(...keys.map((key) => row.primaryKey[key])) as Record<string, SqlValue> | undefined;
    if (existing) {
      if (!rowsEqual(existing, row.row)) throw new Error(`D27_TARGET_ROW_CONFLICT:${row.table}`);
      continue;
    }
    const columns = Object.keys(row.row);
    database.prepare(
      `INSERT INTO ${quoteIdentifier(row.table)} (${columns.map(quoteIdentifier).join(",")}) VALUES (${placeholders(columns)})`,
    ).run(...columns.map((column) => row.row[column]));
    writes += 1;
  }
  return writes;
}

function verifyTarget(database: Database.Database, manifest: BundleManifest) {
  if ((database.pragma("foreign_key_check") as unknown[]).length > 0) throw new Error("D27_TARGET_FOREIGN_KEY_FAILURE");
  const formal = database.prepare(
    "SELECT release_json FROM inspiration_wiki_formal_releases WHERE status='PUBLISHED' AND student_visible=1 AND browse_release='ACTIVE' AND student_search='ACTIVE' AND preview='ACTIVE'",
  ).all() as Array<{ release_json: string }>;
  if (formal.length !== manifest.releaseCount) throw new Error("D27_TARGET_RELEASE_COUNT_MISMATCH");
  const titles = formal.map(({ release_json }) => {
    const parsed = JSON.parse(release_json) as { publicMaterial?: { title?: string } };
    return String(parsed.publicMaterial?.title);
  }).sort();
  if (JSON.stringify(titles) !== JSON.stringify([...manifest.titles].sort())) {
    throw new Error("D27_TARGET_TITLE_SET_MISMATCH");
  }
  const violations = database.prepare(
    `SELECT count(*) count FROM inspiration_wiki_formal_releases
     WHERE r2 <> 'DISABLED' OR embedding <> 'DISABLED' OR lumi_retrieval <> 'DISABLED' OR wiki_retrieval <> 'DISABLED'`,
  ).get() as { count: number };
  if (violations.count !== 0) throw new Error("D27_TARGET_CAPABILITY_BOUNDARY_FAILURE");
}

export function applyInspirationWikiProductionBundle(options: {
  databasePath: string;
  bundleRoot: string;
  dataRoot?: string;
  migrationsFolder?: string;
  validateOnly?: boolean;
}) {
  const databasePath = path.resolve(options.databasePath);
  const dataRoot = path.resolve(options.dataRoot ?? path.dirname(databasePath));
  const bundle = readBundle(options.bundleRoot);
  if (options.validateOnly) {
    return { bundleDigest: bundle.manifest.bundleDigest, databaseWrites: 0, assetWrites: 0, validatedOnly: true as const };
  }
  runMigrations(databasePath, options.migrationsFolder);
  const database = new Database(databasePath, { fileMustExist: true });
  const copied: string[] = [];
  try {
    database.pragma("foreign_keys = ON");
    const teacher = database.prepare("SELECT id, role FROM users WHERE id='teacher'").get() as { id: string; role: string } | undefined;
    if (!teacher || teacher.role !== "TEACHER") throw new Error("D27_TEACHER_IDENTITY_MISSING");
    let assetWrites = 0;
    for (const asset of bundle.manifest.assets) {
      const target = path.resolve(dataRoot, asset.storagePath);
      const rootPrefix = `${dataRoot}${path.sep}`;
      if (!target.startsWith(rootPrefix)) throw new Error("D27_TARGET_ASSET_ESCAPE");
      if (existsSync(target)) {
        const bytes = readFileSync(target);
        if (bytes.byteLength !== asset.bytes || sha256Bytes(bytes) !== asset.sha256) {
          throw new Error("D27_TARGET_ASSET_CONFLICT");
        }
        continue;
      }
      mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.d27-${process.pid}.tmp`;
      copyFileSync(path.resolve(bundle.root, asset.bundlePath), temporary);
      const bytes = readFileSync(temporary);
      if (bytes.byteLength !== asset.bytes || sha256Bytes(bytes) !== asset.sha256) {
        rmSync(temporary, { force: true });
        throw new Error("D27_COPIED_ASSET_INTEGRITY_FAILURE");
      }
      renameSync(temporary, target);
      copied.push(target);
      assetWrites += 1;
    }
    let databaseWrites = 0;
    try {
      database.transaction(() => {
        databaseWrites = insertBundleRows(database, bundle.rows);
        verifyTarget(database, bundle.manifest);
      }).immediate();
    } catch (error) {
      for (const target of copied.reverse()) rmSync(target, { force: true });
      throw error;
    }
    verifyTarget(database, bundle.manifest);
    return {
      bundleDigest: bundle.manifest.bundleDigest,
      databaseWrites,
      assetWrites,
      validatedOnly: false as const,
    };
  } finally {
    database.close();
  }
}
