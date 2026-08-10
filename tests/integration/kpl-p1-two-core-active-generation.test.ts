// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { createActiveKnowledgeGenerationLoaderV2 } from "@/lib/knowledge/active-knowledge-generation-v2";
import { createIsolatedLexicalEvidenceSearchPortV2 } from "@/lib/knowledge/isolated-lexical-evidence-port-v2";
import { deactivateKnowledgeV2Storage, ingestVerifiedKnowledgeCorpusBundleV2, storeKnowledgeIndexBundleV2 } from "@/lib/knowledge/knowledge-v2-store";
import { sealKnowledgeCorpusBundleV2, sealKnowledgeIndexBundleV2, sealKnowledgeNodeV2, sealKnowledgeObjectV2, sha256StableJsonV2 } from "@/lib/knowledge/knowledge-object-v2";

const roots: string[] = [];
let openConnection: DatabaseConnection | undefined;
afterEach(async () => { vi.unstubAllEnvs(); openConnection?.sqlite.close(); openConnection = undefined; await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

function object(input: { id: string; course: "layout-design" | "book-design"; topic: "LAYOUT_DESIGN_PRINCIPLES" | "BOOK_DESIGN_PRINCIPLES"; namespace: string; title: string; claim: string; action: string; }) {
  const root = `${input.id}-document`, section = `${input.id}-section`, text = `${input.id}-content`, fact = `${input.id}-fact`, action = `${input.id}-action`;
  const nodes = [
    sealKnowledgeNodeV2({ id: root, kind: "DOCUMENT", parentId: null, childrenIds: [section], relatedIds: [], location: null, title: input.title }),
    sealKnowledgeNodeV2({ id: section, kind: "SECTION", parentId: root, childrenIds: [text, fact, action], relatedIds: [], location: null, title: "核心教学知识", level: 2 }),
    sealKnowledgeNodeV2({ id: text, kind: "TEXT", parentId: section, childrenIds: [], relatedIds: [], location: null, text: input.claim, role: "CONTENT", legacyStatementId: null }),
    sealKnowledgeNodeV2({ id: fact, kind: "TEXT", parentId: section, childrenIds: [], relatedIds: [], location: null, text: "本条仅适用于已审核页面证据范围。", role: "FACT", legacyStatementId: `${input.topic === "LAYOUT_DESIGN_PRINCIPLES" ? "layoutprin" : "book"}-kpl-page-fact` }),
    sealKnowledgeNodeV2({ id: action, kind: "TEXT", parentId: section, childrenIds: [], relatedIds: [], location: null, text: input.action, role: "ACTION", legacyStatementId: input.topic === "LAYOUT_DESIGN_PRINCIPLES" ? "layoutprin-clarify-reading-task" : "book-clarify-audience" }),
  ];
  const prefix = input.topic === "LAYOUT_DESIGN_PRINCIPLES" ? "layoutprin" : "book";
  const defaultAction = input.topic === "LAYOUT_DESIGN_PRINCIPLES" ? "layoutprin-clarify-reading-task" : "book-clarify-audience";
  return sealKnowledgeObjectV2({ schemaVersion: 2, id: input.id, title: input.title, topic: input.topic, tags: ["KPL", "本地核心试点"], sourceCoursePack: { id: input.course, version: "1" }, sourceIdentityBasis: "TRACKED_LEGACY_MAP", legacyPlacement: { coursePack: { id: input.course, version: "1" }, namespace: input.namespace }, provenance: { authority: "TEACHER_EXPERIENCE", verifiedDate: "2026-08-04", scope: "私有本地、页级边界。", locators: [{ kind: "LOCAL_DOCUMENT", path: "docs/superpowers/pilots/2026-08-04-kpl-p1-five-page-k9-k12-local-chain/k9-reviewed-knowledge-release.json" }] }, parser: { id: "kpl-two-core-materializer", version: "1.0.0" }, contentVersion: "1.0.0", rootNodeId: root, nodes, assetIds: [], annotations: [], legacyItem: { id: input.id, title: input.title, topic: input.topic, tags: ["KPL", "本地核心试点"], content: input.claim, facts: [{ id: `${prefix}-kpl-page-fact`, text: "本条仅适用于已审核页面证据范围。" }], actions: [{ id: defaultAction, text: input.action }], source: { localDocument: "docs/superpowers/pilots/2026-08-04-kpl-p1-five-page-k9-k12-local-chain/k9-reviewed-knowledge-release.json", authority: "TEACHER_EXPERIENCE", verifiedDate: "2026-08-04", scope: "私有本地、页级边界。" } } });
}

describe("KPL P1 two-core formal local generation", () => {
  it("activates, reads, degrades, rolls back, and restores only the two approved B3-25 core pages", async () => {
    vi.stubEnv("AGENT_V3_ENABLED", "true");
    const root = await mkdtemp(path.join(os.tmpdir(), "kpl-p1-two-core-")); roots.push(root); const database = path.join(root, "isolated.sqlite"); runMigrations(database); const connection = createDb(database); openConnection = connection;
    connection.sqlite.exec("INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','KPL-P1'); INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1','c1','STUDENT','学生一',1700000000);");
    const corpus = sealKnowledgeCorpusBundleV2({ schemaVersion: 2, corpusVersion: "2026.8.4", parser: { id: "kpl-two-core-materializer", version: "1.0.0" }, contentVersion: "1.0.0", objects: [
      object({ id: "kpl-b3-25-p16-v3", course: "layout-design", topic: "LAYOUT_DESIGN_PRINCIPLES", namespace: "layout-design-principles", title: "检查连续正文的文字块、书缝与边距", claim: "在连续正文为主的 Manuscript Grid（稿面网格）中，先检查正文块与内侧书缝的边距；不规定固定比例。", action: "先定位正文块与内侧书缝，再检查可阅读的边距。" }),
      object({ id: "kpl-b3-25-p20-v4", course: "book-design", topic: "BOOK_DESIGN_PRINCIPLES", namespace: "book-design-principles", title: "从可读说明核对书籍案例中的文字块与边距关系", claim: "以本页可读说明和同页案例核对文字块位置与边距；它不是所有书籍的固定构图规则。", action: "先读右侧可读说明，再对照同页文字块和边距。" }),
    ], assets: [], unreferencedAssetIds: [] });
    ingestVerifiedKnowledgeCorpusBundleV2(connection, corpus, { now: 100 });
    const config = { mode: "LOCAL_LEXICAL", generation: "kpl-p1-two-core-001" };
    const indexPayload = Buffer.from("kpl-p1-two-core-lexical-index-v1");
    const keys = corpus.objects.map((entry) => `.runtime/knowledge-index/kpl-p1-two-core/${entry.id}.bin`);
    await mkdir(path.join(root, ".runtime/knowledge-index/kpl-p1-two-core"), { recursive: true });
    await Promise.all(keys.map((key) => writeFile(path.join(root, key), indexPayload)));
    const index = sealKnowledgeIndexBundleV2({ schemaVersion: 2, corpusBundleHash: corpus.bundleHash, representations: corpus.objects.map((entry, ordinal) => ({ schemaVersion: 2 as const, id: `${entry.id}-lexical`, target: { kind: "OBJECT" as const, id: entry.id }, channel: "LEXICAL" as const, inputs: [{ kind: "TARGET" as const, hash: entry.contentHash }], indexVersion: { id: "kpl-p1-two-core-lexical-v1", builderId: "kpl-local-lexical", builderVersion: "1.0.0", modelId: null, modelRevision: null, configHash: sha256StableJsonV2(config) }, dimensions: null, vectorCount: 1, payload: { storageKind: "CONTROLLED_FILE" as const, storageKey: keys[ordinal]!, byteLength: indexPayload.byteLength, sha256: sha(indexPayload) } })), }, corpus);
    await storeKnowledgeIndexBundleV2(connection, corpus, index, { configsByVersionId: { "kpl-p1-two-core-lexical-v1": config }, activate: true, workspaceRoot: root, now: 200, requireLegacyProjection: false });
    const loader = createActiveKnowledgeGenerationLoaderV2({ connection, workspaceRoot: root, requireLegacyProjection: false }); const active = await loader.load();
    expect(active.corpus.bundleHash).toBe(corpus.bundleHash); expect(active.indexBundle?.indexBundleHash).toBe(index.indexBundleHash); expect(active.corpus.objects.map((x) => x.id).sort()).toEqual(["kpl-b3-25-p16-v3", "kpl-b3-25-p20-v4"]);
    expect(active.corpus.objects.map((x) => x.sourceCoursePack.id).sort()).toEqual(["book-design", "layout-design"]); expect(JSON.stringify(active.corpus)).toContain("Manuscript Grid（稿面网格）"); expect(JSON.stringify(active.corpus)).not.toContain("b3-20-p062");
    const port = createIsolatedLexicalEvidenceSearchPortV2({ connection, workspaceRoot: root });
    const p16 = await port.search({ query: "连续正文的书缝和边距怎么检查？", coursePackId: "layout-design", coursePackVersion: "1", signal: new AbortController().signal });
    expect(p16.bundle.status).toBe("SUCCESS"); expect(p16.evidence.sources.map((source) => source.objectId)).toEqual(["kpl-b3-25-p16-v3"]); expect(p16.evidence.nodes[0]?.excerpt).toContain("Manuscript Grid（稿面网格）");
    const p20 = await port.search({ query: "文字块和边距怎样核对？", coursePackId: "book-design", coursePackVersion: "1", signal: new AbortController().signal });
    expect(p20.evidence.sources.map((source) => source.objectId)).toEqual(["kpl-b3-25-p20-v4"]);
    const noAnswer = await port.search({ query: "医学剂量怎么计算？", coursePackId: "layout-design", coursePackVersion: "1", signal: new AbortController().signal });
    expect(noAnswer.bundle.status).toBe("EMPTY"); expect(noAnswer.evidence.nodes).toEqual([]);
    let modelCalls = 0;
    const studentTurn = await new CurrentAgentRuntime().run({ connection, actor: { userId: "s1", role: "STUDENT" }, input: { message: "连续正文的书缝和边距怎么检查？", context: { view: "AGENT" } }, options: {
      knowledgeObjectV2Enabled: true, evidenceBundleV2Enabled: true, visualRetrievalEnabled: false, evidenceSearchV2: port,
      modelProviderAdapter: { provider: "TEST", modelId: "kpl-local", capabilities: { vision: false }, async complete() { throw new Error("UNUSED"); }, async respond(_messages, options) { const tool = options?.tools?.find(({ name }) => name === "tool_knowledge-map_search-evidence"); if (modelCalls++ === 0 && tool) return { content: null, toolCalls: [{ id: "kpl-evidence", name: tool.name, arguments: JSON.stringify({ query: "连续正文的书缝和边距怎么检查？" }) }] }; return { content: "先定位正文块与内侧书缝，再检查可阅读的边距。Manuscript Grid（稿面网格）不规定固定比例。", toolCalls: [] }; } } satisfies ModelProviderAdapter,
    } });
    expect(studentTurn.reply.message).toContain("Manuscript Grid（稿面网格）"); expect(studentTurn.executionSteps).toContainEqual(expect.objectContaining({ toolId: "knowledge-map.search-evidence", status: "SUCCEEDED" }));
    const select = (course: string, query: string) => active.corpus.objects.filter((x) => x.sourceCoursePack.id === course && `${x.title} ${x.legacyItem.content}`.includes(query));
    expect(select("layout-design", "书缝").map((x) => x.id)).toEqual(["kpl-b3-25-p16-v3"]); expect(select("book-design", "文字块").map((x) => x.id)).toEqual(["kpl-b3-25-p20-v4"]); expect(select("layout-design", "医学剂量")).toEqual([]);
    deactivateKnowledgeV2Storage(connection); loader.clear(); await expect(loader.load()).rejects.toThrow("KNOWLEDGE_V2_ACTIVE_GENERATION_CORPUS_COUNT:0");
    ingestVerifiedKnowledgeCorpusBundleV2(connection, corpus, { now: 300 }); await storeKnowledgeIndexBundleV2(connection, corpus, index, { configsByVersionId: { "kpl-p1-two-core-lexical-v1": config }, activate: true, workspaceRoot: root, now: 400, requireLegacyProjection: false }); loader.clear(); expect((await loader.load()).generationKey).toBe(`${corpus.bundleHash}:${index.indexBundleHash}`);
    await writeFile(path.join(root, keys[0]!), Buffer.from("corrupt")); loader.clear(); await expect(loader.load()).rejects.toThrow(/PAYLOAD|HASH|payload/i);
  }, 30_000);
});
