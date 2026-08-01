// @vitest-environment node

import { access, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AgentArtworkNotFoundError,
  openAgentArtwork,
  prepareAgentArtwork,
} from "@/lib/agent/artwork-attachment";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { readAgentConversation, runAgentTurn } from "@/lib/agent/orchestrator";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { recoverPendingEvidence } from "@/lib/services/evidence";
import { validPng } from "@/tests/helpers/image-fixtures";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function answer(
  messages: Parameters<ModelProviderAdapter["complete"]>[0],
  message: string,
  useArtwork = false,
) {
  const prompt = JSON.parse(messages[1].content) as {
    allowed: { episodes: string[]; decisionCodes: string[] };
    artworkInput?: { sourceId?: string };
  };
  const episode = prompt.allowed.episodes[0];
  return JSON.stringify({
    step: "ANSWER",
    episode,
    decisionCode: prompt.allowed.decisionCodes.find((code) => code.startsWith(`${episode}_`)),
    responseStrategy: "CLARIFY",
    sourceIds: useArtwork && prompt.artworkInput?.sourceId ? [prompt.artworkInput.sourceId] : [],
    actionType: null,
    title: "先确认画面的主次关系",
    message,
    whyThisStep: "先分清观察与判断，修改才不会只靠感觉。",
    uncertainty: "仍需确认真实尺寸和观看距离。",
  });
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-artwork-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  const storageRoot = path.join(root, "private-images");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','TEST');
    INSERT INTO users(id,class_id,role,alias,created_at) VALUES
      ('s1','c1','STUDENT','学生一',1700000000),
      ('s2','c1','STUDENT','学生二',1700000000);
    INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type)
      VALUES('11111111-1111-4111-8111-111111111111','s1','c1','海报练习','ACTIVE',1700000000,1700000000,'REAL');
  `);
  return { connection, storageRoot };
}

describe("agent artwork attachments", () => {
  it("uses an explicit vision capability and restores the private attachment", async () => {
    const { connection, storageRoot } = await fixture();
    try {
      const artwork = await prepareAgentArtwork({ bytes: validPng, declaredMime: "image/png" });
      let observedBytes = 0;
      const adapter: ModelProviderAdapter = {
        provider: "TEST",
        capabilities: { vision: true },
        async complete() { throw new Error("text completion should not be used"); },
        async completeWithImage(messages, image) {
          observedBytes = image.bytes.byteLength;
          return answer(messages, "作品读取结果：主标题和几何形集中在画面上部。\n通用设计建议：先拉开标题与装饰形的明度差。你最想优先突出标题还是图形？", true);
        },
      };
      const response = await runAgentTurn(
        connection,
        { userId: "s1", role: "STUDENT" },
        {
          taskId: "11111111-1111-4111-8111-111111111111",
          message: "帮我看看这张海报的层级",
          context: { view: "AGENT" },
        },
        { modelProviderAdapter: adapter, artworkRoot: storageRoot },
        artwork,
      );
      expect(observedBytes).toBeGreaterThan(0);
      expect(response.artworkAttachment).toMatchObject({ mimeType: "image/png", width: 2, height: 2 });
      expect(response.reply.basis).toContainEqual({ kind: "ARTWORK_OBSERVATION", label: "作品读取结果" });
      expect(response.reply.basis).toContainEqual({ kind: "GENERAL_DESIGN", label: "通用设计建议" });
      expect(response.reply.sources[0]).toMatchObject({ authority: "STUDENT_ARTWORK" });

      const restored = readAgentConversation(
        connection,
        { userId: "s1", role: "STUDENT" },
        "AGENT",
        "11111111-1111-4111-8111-111111111111",
      );
      expect(restored.turns[0]?.artworkAttachment).toEqual(response.artworkAttachment);
      const opened = await openAgentArtwork(connection, { userId: "s1", role: "STUDENT" }, artwork.id, storageRoot);
      expect(opened).toMatchObject({ contentType: "image/png", size: response.artworkAttachment?.byteSize });
      opened.stream.destroy();
      await expect(openAgentArtwork(connection, { userId: "s2", role: "STUDENT" }, artwork.id, storageRoot))
        .rejects.toBeInstanceOf(AgentArtworkNotFoundError);
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps the image but explicitly degrades when the adapter is text-only", async () => {
    const { connection, storageRoot } = await fixture();
    try {
      const artwork = await prepareAgentArtwork({ bytes: validPng, declaredMime: "image/png" });
      const adapter: ModelProviderAdapter = {
        provider: "TEST",
        capabilities: { vision: false },
        async complete() { throw new Error("text-only model must not inspect an attached image"); },
      };
      const response = await runAgentTurn(
        connection,
        { userId: "s1", role: "STUDENT" },
        {
          taskId: "11111111-1111-4111-8111-111111111111",
          message: "这张作品哪里需要改？",
          context: { view: "AGENT" },
        },
        { modelProviderAdapter: adapter, artworkRoot: storageRoot },
        artwork,
      );
      expect(response.artworkAttachment).toBeDefined();
      expect(response.reply.basis?.some(({ kind }) => kind === "ARTWORK_OBSERVATION")).toBe(false);
      expect(response.reply.sources.some(({ authority }) => authority === "STUDENT_ARTWORK")).toBe(false);
      expect(response.reply.message).toContain("不能可靠读取");
      expect(response.reply.uncertainty).toContain("当前模型未能可靠读取");
      expect(response.policy.appliedRules).toContain("DEGRADE_UNAVAILABLE_VISION");
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not mark or expose a visual answer that omitted the artwork source", async () => {
    const { connection, storageRoot } = await fixture();
    try {
      const artwork = await prepareAgentArtwork({ bytes: validPng, declaredMime: "image/png" });
      const adapter: ModelProviderAdapter = {
        provider: "TEST",
        capabilities: { vision: true },
        async complete() { throw new Error("text completion should not be used"); },
        async completeWithImage(messages) {
          return answer(messages, "你的海报用了红黑配色，左侧标题太小。", false);
        },
      };
      const response = await runAgentTurn(
        connection,
        { userId: "s1", role: "STUDENT" },
        {
          taskId: "11111111-1111-4111-8111-111111111111",
          message: "这张海报哪里需要改？",
          context: { view: "AGENT" },
        },
        { modelProviderAdapter: adapter, artworkRoot: storageRoot },
        artwork,
      );
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.reply.message).not.toContain("红黑配色");
      expect(response.reply.message).not.toContain("左侧标题");
      expect(response.reply.sources.some(({ authority }) => authority === "STUDENT_ARTWORK")).toBe(false);
      expect(response.reply.basis?.some(({ kind }) => kind === "ARTWORK_OBSERVATION")).toBe(false);
      expect(response.policy.appliedRules).toContain("DEGRADE_UNAVAILABLE_VISION");
    } finally {
      connection.sqlite.close();
    }
  });

  it("rejects an artwork citation that does not separate observation from advice", async () => {
    const { connection, storageRoot } = await fixture();
    try {
      const artwork = await prepareAgentArtwork({ bytes: validPng, declaredMime: "image/png" });
      const adapter: ModelProviderAdapter = {
        provider: "TEST",
        capabilities: { vision: true },
        async complete() { throw new Error("text completion should not be used"); },
        async completeWithImage(messages) {
          return answer(messages, "主标题位于上方，建议增加明度差。", true);
        },
      };
      const response = await runAgentTurn(
        connection,
        { userId: "s1", role: "STUDENT" },
        {
          taskId: "11111111-1111-4111-8111-111111111111",
          message: "分析这张作品",
          context: { view: "AGENT" },
        },
        { modelProviderAdapter: adapter, artworkRoot: storageRoot },
        artwork,
      );
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.reply.message).not.toContain("主标题位于上方");
      expect(response.reply.sources.some(({ authority }) => authority === "STUDENT_ARTWORK")).toBe(false);
      expect(response.policy.appliedRules).toContain("DEGRADE_UNAVAILABLE_VISION");
    } finally {
      connection.sqlite.close();
    }
  });

  it("preserves referenced artwork and removes an aged crash orphan during recovery", async () => {
    const { connection, storageRoot } = await fixture();
    try {
      const artwork = await prepareAgentArtwork({ bytes: validPng, declaredMime: "image/png" });
      await runAgentTurn(
        connection,
        { userId: "s1", role: "STUDENT" },
        {
          taskId: "11111111-1111-4111-8111-111111111111",
          message: "保存这张作品",
          context: { view: "AGENT" },
        },
        { artworkRoot: storageRoot },
        artwork,
      );
      const row = connection.sqlite.prepare(
        "SELECT storage_path storagePath FROM agent_artwork_attachments WHERE id=?",
      ).get(artwork.id) as { storagePath: string };
      const storedPath = path.resolve(storageRoot, ...row.storagePath.split("/"));
      const orphanPath = path.join(path.dirname(storedPath), `${crypto.randomUUID()}.png`);
      await writeFile(orphanPath, validPng);
      await Promise.all([
        utimes(storedPath, new Date(0), new Date(0)),
        utimes(orphanPath, new Date(0), new Date(0)),
      ]);

      const result = await recoverPendingEvidence(connection.db, {
        root: storageRoot,
        now: new Date(2_000_000),
        orphanGraceMs: 1_000,
      });
      expect(result.removedOrphans).toBe(1);
      await expect(readFile(storedPath)).resolves.toEqual(Buffer.from(artwork.bytes));
      await expect(access(orphanPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      connection.sqlite.close();
    }
  });
});
