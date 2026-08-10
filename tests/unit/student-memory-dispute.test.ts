// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  recordStudentMemoryDispute,
} from "@/lib/agent/student-memory-dispute";
import {
  recallStudentMemories,
} from "@/lib/agent/student-memory-retrieval";
import {
  createDb,
  type DatabaseConnection,
} from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

describe("student memory dispute exclusion", () => {
  let root: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    root = await mkdtemp(path.join(
      tmpdir(),
      "lumi-memory-dispute-",
    ));
    const databasePath = path.join(root, "memory.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code)
        VALUES('c1','测试班','DISPUTE');
      INSERT INTO users(id,class_id,role,alias,created_at)
        VALUES('s1','c1','STUDENT','学生一',1700000000);
      INSERT INTO agent_student_memory(
        id,student_id,class_id,kind,content,salience,
        source_turn_id,created_at
      ) VALUES(
        'memory-1','s1','c1','PROJECT_FACT',
        '国际主义风格必须使用装饰花纹。',8,NULL,1700000000
      );
    `);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(root, {
      recursive: true,
      force: true,
    });
  });

  it("retains the original memory row but excludes an independent dispute from recall", async () => {
    recordStudentMemoryDispute(connection, {
      memoryId: "memory-1",
      studentId: "s1",
      classId: "c1",
      reason: "这不是我确认过的项目事实。",
      now: new Date("2026-07-30T12:00:00.000Z"),
    });

    const recalled = await recallStudentMemories(
      connection,
      {
        studentId: "s1",
        classId: "c1",
        query: "国际主义风格的装饰花纹",
        embeddingProvider: null,
      },
    );
    const original = connection.sqlite.prepare(
      "SELECT content FROM agent_student_memory WHERE id=?",
    ).get("memory-1");
    const dispute = connection.sqlite.prepare(
      "SELECT reason FROM agent_student_memory_disputes WHERE memory_id=?",
    ).get("memory-1");

    expect(original).toEqual({
      content: "国际主义风格必须使用装饰花纹。",
    });
    expect(dispute).toEqual({
      reason: "这不是我确认过的项目事实。",
    });
    expect(recalled.items).toEqual([]);
  });
});
