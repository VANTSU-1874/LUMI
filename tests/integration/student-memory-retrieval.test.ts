// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EmbeddingServiceError, type EmbeddingProvider } from "@/lib/ai/embeddings";
import {
  prepareStudentMemoryCandidateEmbeddings,
  recallStudentMemories,
} from "@/lib/agent/student-memory-retrieval";
import { storeStudentMemory } from "@/lib/agent/student-memory";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

describe("student memory semantic recall", () => {
  let root: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "tonggan-memory-recall-"));
    const databasePath = path.join(root, "memory.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','测试班','RECALL');
      INSERT INTO users(id,class_id,role,alias,created_at)
        VALUES('s1','c1','STUDENT','匿名学生',1700000000);
      INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type)
        VALUES('task-1','s1','c1','声音交互','ACTIVE',1700000000,1700000000,'REAL');
      INSERT INTO agent_conversations(id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at)
        VALUES('conversation-1','task-1','s1','c1',NULL,'digital-interaction','1',1700000000,1700000000);
      INSERT INTO agent_turns(id,conversation_id,turn_sequence,student_message,episode,decision_code,policy_trace_json,reply_json,ai_mode,source_ids_json,created_at,data_type)
        VALUES('turn-1','conversation-1',1,'原始问题','DEBUG','OPEN_TUTOR','{}','{}','MODEL_ASSISTED','[]',1700000000,'REAL');
    `);
    storeStudentMemory(connection.db, {
      studentId: "s1",
      classId: "c1",
      kind: "RECURRING_STRUGGLE",
      content: "我总是卡在 OSC 端口配置。",
      salience: 8,
      sourceTurnId: "turn-1",
    }, { environment: {}, now: new Date("2026-07-17T08:00:00.000Z") });
    storeStudentMemory(connection.db, {
      studentId: "s1",
      classId: "c1",
      kind: "PREFERENCE",
      content: "我喜欢先画纸面缩略图。",
      salience: 4,
      sourceTurnId: "turn-1",
    }, { environment: {}, now: new Date("2026-07-17T08:01:00.000Z") });
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(root, { recursive: true, force: true });
  });

  it("recalls the semantic match and sends only redacted text to embeddings", async () => {
    connection.sqlite.prepare(`
      UPDATE agent_student_memory SET embedding_json=CASE kind
        WHEN 'RECURRING_STRUGGLE' THEN '[1,0]' ELSE '[0,1]' END,
        embedding_cache_key='memory-semantic-fixture'
      WHERE student_id='s1' AND class_id='c1'
    `).run();
    const batches: string[][] = [];
    const provider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "memory-semantic-fixture",
      cacheKey: "memory-semantic-fixture",
      async embed(inputs) {
        batches.push([...inputs]);
        return inputs.map((value) => /OSC|端口|数据传不过去/.test(value) ? [1, 0] : [0, 1]);
      },
    };
    const recalled = await recallStudentMemories(connection, {
      studentId: "s1",
      classId: "c1",
      query: "OSC 数据传不过去，联系 13812345678，邮箱 arlo@example.com，学号 SC2026123456。",
      embeddingProvider: provider,
      environment: { STUDENT_NUMBER_PREFIX: "SC", STUDENT_NUMBER_DIGITS: "10" },
    });

    expect(recalled).toMatchObject({
      semanticStatus: "USED",
      errorCode: null,
      items: [{ alias: "M1", kind: "RECURRING_STRUGGLE", content: "我总是卡在 OSC 端口配置。" }],
    });
    expect(JSON.stringify(batches)).not.toMatch(/13812345678|arlo@example\.com|SC2026123456/i);
    expect(JSON.stringify(batches)).toContain("[已遮蔽手机号]");
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(JSON.stringify(batches)).not.toContain("我总是卡在 OSC 端口配置");
  });

  it("falls back to lexical recall on embedding failure and returns empty for an unrelated query", async () => {
    connection.sqlite.prepare(`
      UPDATE agent_student_memory SET embedding_json='[1,0]',embedding_cache_key='memory-offline-fixture'
      WHERE student_id='s1' AND class_id='c1'
    `).run();
    const provider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "memory-offline-fixture",
      cacheKey: "memory-offline-fixture",
      async embed() {
        throw new EmbeddingServiceError("RATE_LIMIT");
      },
    };
    const fallback = await recallStudentMemories(connection, {
      studentId: "s1",
      classId: "c1",
      query: "OSC 端口还是连不上",
      embeddingProvider: provider,
      environment: {},
    });
    expect(fallback).toMatchObject({
      semanticStatus: "FAILED",
      errorCode: "RATE_LIMIT",
      items: [expect.objectContaining({ kind: "RECURRING_STRUGGLE", retrieval: expect.objectContaining({ method: "LEXICAL" }) })],
    });

    const unrelated = await recallStudentMemories(connection, {
      studentId: "s1",
      classId: "c1",
      query: "无障碍色彩对比度",
      embeddingProvider: null,
      environment: {},
    });
    expect(unrelated.items).toEqual([]);
  });

  it("keeps lexical-only memories eligible when another memory has a stored vector", async () => {
    connection.sqlite.prepare(`
      UPDATE agent_student_memory SET embedding_json='[1,0]',embedding_cache_key='mixed-fixture'
      WHERE kind='RECURRING_STRUGGLE'
    `).run();
    const provider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "mixed-fixture",
      cacheKey: "mixed-fixture",
      async embed() { return [[0, 1]]; },
    };
    const recalled = await recallStudentMemories(connection, {
      studentId: "s1",
      classId: "c1",
      query: "我还是想先画纸面缩略图",
      embeddingProvider: provider,
      environment: {},
    });
    expect(recalled.items).toContainEqual(expect.objectContaining({
      kind: "PREFERENCE",
      content: "我喜欢先画纸面缩略图。",
      retrieval: expect.objectContaining({ method: "LEXICAL" }),
    }));
  });

  it("applies deterministic time decay and treats last use as a relevance refresh", async () => {
    connection.sqlite.prepare("DELETE FROM agent_student_memory").run();
    const insert = connection.sqlite.prepare(`
      INSERT INTO agent_student_memory(
        id,student_id,class_id,kind,content,salience,created_at,last_used_at
      ) VALUES(?,'s1','c1','PREFERENCE','我喜欢先看网格案例。',5,?,?)
    `);
    insert.run(
      "11111111-1111-4111-8111-111111111111",
      Math.floor(new Date("2026-04-28T00:00:00.000Z").getTime() / 1_000),
      null,
    );
    insert.run(
      "22222222-2222-4222-8222-222222222222",
      Math.floor(new Date("2026-07-26T00:00:00.000Z").getTime() / 1_000),
      null,
    );

    const now = new Date("2026-07-28T00:00:00.000Z");
    const recentFirst = await recallStudentMemories(connection, {
      studentId: "s1",
      classId: "c1",
      query: "我喜欢先看网格案例",
      embeddingProvider: null,
      environment: {},
      now,
    });
    expect(recentFirst.items.map(({ id }) => id)).toEqual([
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(recentFirst.items[0]!.retrieval.confidence)
      .toBeGreaterThan(recentFirst.items[1]!.retrieval.confidence);

    connection.sqlite.prepare(`
      UPDATE agent_student_memory SET last_used_at=?
      WHERE id='11111111-1111-4111-8111-111111111111'
    `).run(Math.floor(new Date("2026-07-27T12:00:00.000Z").getTime() / 1_000));
    const refreshedFirst = await recallStudentMemories(connection, {
      studentId: "s1",
      classId: "c1",
      query: "我喜欢先看网格案例",
      embeddingProvider: null,
      environment: {},
      now,
    });
    expect(refreshedFirst.items[0]?.id)
      .toBe("11111111-1111-4111-8111-111111111111");
  });

  it("semantically ranks the complete scoped memory set instead of pre-truncating by salience", async () => {
    const insert = connection.sqlite.prepare(`
      INSERT INTO agent_student_memory(
        id,student_id,class_id,kind,content,salience,embedding_json,embedding_cache_key,source_turn_id,created_at
      ) VALUES(?,'s1','c1','PROJECT_FACT',?,?,?,?, 'turn-1',?)
    `);
    connection.sqlite.transaction(() => {
      for (let index = 0; index < 70; index += 1) {
        const target = index === 0;
        insert.run(
          `00000000-0000-4000-8001-${index.toString().padStart(12, "0")}`,
          target ? "我在研究触觉反馈材料。" : `高显著度干扰记忆 ${index}`,
          target ? 1 : 10,
          target ? "[1,0]" : "[0,1]",
          "complete-scope-fixture",
          1700001000 + index,
        );
      }
    })();
    const provider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "complete-scope-fixture",
      cacheKey: "complete-scope-fixture",
      async embed(inputs) {
        expect(inputs).toHaveLength(1);
        return [[1, 0]];
      },
    };
    const recalled = await recallStudentMemories(connection, {
      studentId: "s1",
      classId: "c1",
      query: "能继续聊聊有触感的交互媒介吗？",
      embeddingProvider: provider,
      environment: {},
    });
    expect(recalled.items[0]).toMatchObject({
      content: "我在研究触觉反馈材料。",
      retrieval: { method: "SEMANTIC" },
    });
  });

  it("precomputes only redacted candidate vectors and degrades without blocking writeback", async () => {
    const batches: string[][] = [];
    const provider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "candidate-fixture",
      cacheKey: "candidate-fixture",
      async embed(inputs) {
        batches.push([...inputs]);
        return inputs.map(() => [0.5, 0.5]);
      },
    };
    const prepared = await prepareStudentMemoryCandidateEmbeddings([{
      kind: "PROJECT_FACT",
      content: "我的项目电话是 13812345678。",
      salience: 2,
    }], provider, { environment: {} });
    expect(prepared[0]).toMatchObject({
      content: "我的项目电话是 [已遮蔽手机号]。",
      embedding: { cacheKey: "candidate-fixture", vector: [0.5, 0.5] },
    });
    expect(JSON.stringify(batches)).not.toContain("13812345678");

    const failed = await prepareStudentMemoryCandidateEmbeddings(prepared, {
      ...provider,
      async embed() { throw new EmbeddingServiceError("RATE_LIMIT"); },
    });
    expect(failed[0]?.embedding).toBeUndefined();
    expect(failed[0]?.content).toContain("[已遮蔽手机号]");
  });
});
