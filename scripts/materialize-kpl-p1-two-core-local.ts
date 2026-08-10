import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { createActiveKnowledgeGenerationLoaderV2 } from "@/lib/knowledge/active-knowledge-generation-v2";
import {
  deactivateKnowledgeV2Storage,
  ingestVerifiedKnowledgeCorpusBundleV2,
  storeKnowledgeIndexBundleV2,
} from "@/lib/knowledge/knowledge-v2-store";
import {
  sealKnowledgeCorpusBundleV2,
  sealKnowledgeIndexBundleV2,
  sealKnowledgeNodeV2,
  sealKnowledgeObjectV2,
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";

const workspaceRoot = process.cwd();
const storageRoot = path.join(workspaceRoot, ".runtime", "kpl-p1-two-core");
const databasePath = path.join(storageRoot, "isolated.sqlite");
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function assertFreshStorage() {
  try {
    await access(storageRoot);
    throw new Error("KPL_P1_TWO_CORE_STORAGE_ALREADY_EXISTS");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function object(input: {
  id: string;
  course: "layout-design" | "book-design";
  topic: "LAYOUT_DESIGN_PRINCIPLES" | "BOOK_DESIGN_PRINCIPLES";
  namespace: string;
  title: string;
  claim: string;
  action: string;
}) {
  const root = `${input.id}-document`;
  const section = `${input.id}-section`;
  const text = `${input.id}-content`;
  const fact = `${input.id}-fact`;
  const action = `${input.id}-action`;
  const prefix = input.topic === "LAYOUT_DESIGN_PRINCIPLES" ? "layoutprin" : "book";
  const actionId = input.topic === "LAYOUT_DESIGN_PRINCIPLES"
    ? "layoutprin-clarify-reading-task"
    : "book-clarify-audience";
  const source = "docs/superpowers/pilots/2026-08-04-kpl-p1-five-page-k9-k12-local-chain/k9-reviewed-knowledge-release.json";
  return sealKnowledgeObjectV2({
    schemaVersion: 2,
    id: input.id,
    title: input.title,
    topic: input.topic,
    tags: ["KPL", "本地核心试点"],
    sourceCoursePack: { id: input.course, version: "1" },
    sourceIdentityBasis: "TRACKED_LEGACY_MAP",
    legacyPlacement: { coursePack: { id: input.course, version: "1" }, namespace: input.namespace },
    provenance: {
      authority: "TEACHER_EXPERIENCE",
      verifiedDate: "2026-08-04",
      scope: "私有本地、页级边界。",
      locators: [{ kind: "LOCAL_DOCUMENT", path: source }],
    },
    parser: { id: "kpl-two-core-materializer", version: "1.0.0" },
    contentVersion: "1.0.0",
    rootNodeId: root,
    nodes: [
      sealKnowledgeNodeV2({ id: root, kind: "DOCUMENT", parentId: null, childrenIds: [section], relatedIds: [], location: null, title: input.title }),
      sealKnowledgeNodeV2({ id: section, kind: "SECTION", parentId: root, childrenIds: [text, fact, action], relatedIds: [], location: null, title: "核心教学知识", level: 2 }),
      sealKnowledgeNodeV2({ id: text, kind: "TEXT", parentId: section, childrenIds: [], relatedIds: [], location: null, text: input.claim, role: "CONTENT", legacyStatementId: null }),
      sealKnowledgeNodeV2({ id: fact, kind: "TEXT", parentId: section, childrenIds: [], relatedIds: [], location: null, text: "本条仅适用于已审核页面证据范围。", role: "FACT", legacyStatementId: `${prefix}-kpl-page-fact` }),
      sealKnowledgeNodeV2({ id: action, kind: "TEXT", parentId: section, childrenIds: [], relatedIds: [], location: null, text: input.action, role: "ACTION", legacyStatementId: actionId }),
    ],
    assetIds: [], annotations: [],
    legacyItem: {
      id: input.id, title: input.title, topic: input.topic, tags: ["KPL", "本地核心试点"], content: input.claim,
      facts: [{ id: `${prefix}-kpl-page-fact`, text: "本条仅适用于已审核页面证据范围。" }],
      actions: [{ id: actionId, text: input.action }],
      source: { localDocument: source, authority: "TEACHER_EXPERIENCE", verifiedDate: "2026-08-04", scope: "私有本地、页级边界。" },
    },
  });
}

async function main() {
  await assertFreshStorage();
  await mkdir(storageRoot, { recursive: true });
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  try {
    const corpus = sealKnowledgeCorpusBundleV2({
      schemaVersion: 2, corpusVersion: "2026.8.4", parser: { id: "kpl-two-core-materializer", version: "1.0.0" }, contentVersion: "1.0.0",
      objects: [
        object({ id: "kpl-b3-25-p16-v3", course: "layout-design", topic: "LAYOUT_DESIGN_PRINCIPLES", namespace: "layout-design-principles", title: "检查连续正文的文字块、书缝与边距", claim: "在连续正文为主的 Manuscript Grid（稿面网格）中，先检查正文块与内侧书缝的边距；不规定固定比例。", action: "先定位正文块与内侧书缝，再检查可阅读的边距。" }),
        object({ id: "kpl-b3-25-p20-v4", course: "book-design", topic: "BOOK_DESIGN_PRINCIPLES", namespace: "book-design-principles", title: "从可读说明核对书籍案例中的文字块与边距关系", claim: "以本页可读说明和同页案例核对文字块位置与边距；它不是所有书籍的固定构图规则。", action: "先读右侧可读说明，再对照同页文字块和边距。" }),
      ], assets: [], unreferencedAssetIds: [],
    });
    const config = { mode: "LOCAL_LEXICAL", generation: "kpl-p1-two-core-001" };
    const payload = Buffer.from("kpl-p1-two-core-lexical-index-v1");
    const keys = corpus.objects.map((entry) => `.runtime/knowledge-index/kpl-p1-two-core/${entry.id}.bin`);
    await mkdir(path.join(workspaceRoot, ".runtime/knowledge-index/kpl-p1-two-core"), { recursive: true });
    await Promise.all(keys.map((key) => writeFile(path.join(workspaceRoot, key), payload)));
    const index = sealKnowledgeIndexBundleV2({
      schemaVersion: 2, corpusBundleHash: corpus.bundleHash,
      representations: corpus.objects.map((entry, ordinal) => ({
        schemaVersion: 2 as const, id: `${entry.id}-lexical`, target: { kind: "OBJECT" as const, id: entry.id }, channel: "LEXICAL" as const,
        inputs: [{ kind: "TARGET" as const, hash: entry.contentHash }],
        indexVersion: { id: "kpl-p1-two-core-lexical-v1", builderId: "kpl-local-lexical", builderVersion: "1.0.0", modelId: null, modelRevision: null, configHash: sha256StableJsonV2(config) },
        dimensions: null, vectorCount: 1,
        payload: { storageKind: "CONTROLLED_FILE" as const, storageKey: keys[ordinal]!, byteLength: payload.byteLength, sha256: sha(payload) },
      })),
    }, corpus);
    ingestVerifiedKnowledgeCorpusBundleV2(connection, corpus, { now: 100 });
    await storeKnowledgeIndexBundleV2(connection, corpus, index, { configsByVersionId: { "kpl-p1-two-core-lexical-v1": config }, activate: true, workspaceRoot, now: 200, requireLegacyProjection: false });
    const loader = createActiveKnowledgeGenerationLoaderV2({ connection, workspaceRoot, requireLegacyProjection: false });
    const active = await loader.load();
    const beforeRollback = active.generationKey;
    deactivateKnowledgeV2Storage(connection);
    loader.clear();
    let rollbackVerified = false;
    try { await loader.load(); } catch (error) { rollbackVerified = error instanceof Error && error.message === "KNOWLEDGE_V2_ACTIVE_GENERATION_CORPUS_COUNT:0"; }
    if (!rollbackVerified) throw new Error("KPL_P1_TWO_CORE_ROLLBACK_NOT_VERIFIED");
    ingestVerifiedKnowledgeCorpusBundleV2(connection, corpus, { now: 300 });
    await storeKnowledgeIndexBundleV2(connection, corpus, index, { configsByVersionId: { "kpl-p1-two-core-lexical-v1": config }, activate: true, workspaceRoot, now: 400, requireLegacyProjection: false });
    loader.clear();
    const restored = await loader.load();
    if (restored.generationKey !== beforeRollback) throw new Error("KPL_P1_TWO_CORE_RESTORE_DRIFT");
    await writeFile(path.join(storageRoot, "k12-activation-audit.json"), `${JSON.stringify({ status: "K12_ACTIVE_LOCAL_ISOLATED_LOADER_ONLY", generationKey: restored.generationKey, corpusBundleHash: corpus.bundleHash, indexBundleHash: index.indexBundleHash, approvedObjects: restored.corpus.objects.map((entry) => entry.id), excludedObjectPrefixes: ["kpl-b3-20-"], rollbackVerified, legacyProjection: "NOT_MATERIALIZED_BY_EXPLICIT_ISOLATED_CONTRACT", studentConversationRuntime: "NOT_WIRED_TO_ACTIVE_KNOWLEDGE_GENERATION_V2" }, null, 2)}\n`);
  } finally { connection.sqlite.close(); }
}

void main();
