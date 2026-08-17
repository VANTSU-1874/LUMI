// @vitest-environment node

import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareAgentArtwork, storeAgentArtwork } from "@/lib/agent/artwork-attachment";
import {
  createStudentLibraryAsset,
  deleteStudentLibraryAsset,
  listStudentLibraryAssets,
  openStudentLibraryAsset,
  StudentLibraryNotFoundError,
} from "@/lib/agent/student-library";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { validPng } from "@/tests/helpers/image-fixtures";

const roots: string[] = [];
const first = { userId: "s1", role: "STUDENT" as const };
const second = { userId: "s2", role: "STUDENT" as const };
const firstTask = "11111111-1111-4111-8111-111111111111";
const secondTask = "22222222-2222-4222-8222-222222222222";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-student-library-"));
  roots.push(root);
  const databasePath = path.join(root, "library.sqlite");
  const storageRoot = path.join(root, "private-images");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','LIBRARY');
    INSERT INTO users(id,class_id,role,alias,created_at) VALUES
      ('s1','c1','STUDENT','学生一',1700000000),
      ('s2','c1','STUDENT','学生二',1700000000);
    INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type) VALUES
      ('${firstTask}','s1','c1','海报练习','ACTIVE',1700000000,1700000000,'REAL'),
      ('${secondTask}','s2','c1','产品练习','ACTIVE',1700000000,1700000000,'REAL');
  `);
  return { connection, storageRoot };
}

describe("student file library", () => {
  it("persists a private direct upload, binds it to its owner and deletes only its own file", async () => {
    const { connection, storageRoot } = await fixture();
    try {
      const artwork = await prepareAgentArtwork({ bytes: validPng, declaredMime: "image/png" });
      const created = await createStudentLibraryAsset(connection, first, {
        artwork,
        originalName: '..\\\"课程海报?.jpeg',
        taskId: firstTask,
      }, storageRoot, new Date("2026-08-17T06:00:00.000Z"));

      expect(created.asset).toMatchObject({
        source: "DIRECT_UPLOAD",
        fileName: "_课程海报_.png",
        mimeType: "image/png",
        width: 2,
        height: 2,
        project: null,
        canDelete: true,
      });
      expect(created.asset.previewUrl).toBe(`/api/agent/library/${created.asset.id}/content`);
      expect(listStudentLibraryAssets(connection, first).assets).toEqual([created.asset]);

      const opened = await openStudentLibraryAsset(connection, first, created.asset.id, storageRoot);
      expect(Buffer.from(opened.bytes)).toEqual(Buffer.from(artwork.bytes));
      await expect(openStudentLibraryAsset(connection, second, created.asset.id, storageRoot))
        .rejects.toBeInstanceOf(StudentLibraryNotFoundError);
      await expect(deleteStudentLibraryAsset(connection, second, created.asset.id, storageRoot))
        .rejects.toBeInstanceOf(StudentLibraryNotFoundError);

      const row = connection.sqlite.prepare(
        "SELECT storage_path storagePath FROM student_library_assets WHERE id=?",
      ).get(created.asset.id) as { storagePath: string };
      const absolutePath = path.resolve(storageRoot, ...row.storagePath.split("/"));
      await expect(access(absolutePath)).resolves.toBeUndefined();
      await expect(deleteStudentLibraryAsset(connection, first, created.asset.id, storageRoot))
        .resolves.toEqual({ deleted: created.asset.id });
      await expect(access(absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(listStudentLibraryAssets(connection, first).assets).toEqual([]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("combines chat artwork with uploads without allowing ownership or task reassignment", async () => {
    const { connection, storageRoot } = await fixture();
    try {
      const directArtwork = await prepareAgentArtwork({ bytes: validPng, declaredMime: "image/png" });
      const direct = await createStudentLibraryAsset(connection, first, {
        artwork: directArtwork,
        originalName: "构图草图.png",
        taskId: null,
      }, storageRoot, new Date("2026-08-17T06:00:00.000Z"));

      const chatArtwork = await prepareAgentArtwork({ bytes: validPng, declaredMime: "image/png" });
      const storedChat = await storeAgentArtwork(storageRoot, firstTask, chatArtwork);
      connection.sqlite.exec(`
        INSERT INTO agent_conversations(
          id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at
        ) VALUES('33333333-3333-4333-8333-333333333333','${firstTask}','s1','c1',NULL,'design-foundations','1',1700000000000,1700000000000);
        INSERT INTO agent_turns(
          id,conversation_id,turn_sequence,student_message,episode,decision_code,policy_trace_json,
          response_strategy,response_latency_ms,reply_json,ai_mode,source_ids_json,created_at,data_type
        ) VALUES(
          '44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333',1,
          '请点评这张作品','UNDERSTAND','UNDERSTAND_VISUAL','{}','CLARIFY',10,'{}',
          'DETERMINISTIC_FALLBACK','[]',1700000000000,'REAL'
        );
      `);
      connection.sqlite.prepare(`
        INSERT INTO agent_artwork_attachments(
          id,task_id,turn_id,student_id,class_id,mime_type,storage_path,digest,byte_size,
          width,height,created_at,updated_at,data_type
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        storedChat.id, firstTask, "44444444-4444-4444-8444-444444444444", "s1", "c1",
        storedChat.mimeType, storedChat.storagePath, storedChat.digest, storedChat.byteSize,
        storedChat.width, storedChat.height, 1_700_000_001_000, 1_700_000_001_000, "REAL",
      );

      const assets = listStudentLibraryAssets(connection, first).assets;
      expect(assets).toHaveLength(2);
      const chatAsset = assets.find(({ source }) => source === "CHAT_ATTACHMENT");
      expect(chatAsset).toMatchObject({
        id: storedChat.id,
        source: "CHAT_ATTACHMENT",
        project: null,
        canDelete: false,
      });
      expect(chatAsset?.downloadUrl).toBe(`/api/agent/artworks/${storedChat.id}?download=1`);
      expect(assets).toContainEqual(direct.asset);
      expect(listStudentLibraryAssets(connection, second).assets).toEqual([]);

      expect(() => connection.sqlite.prepare(
        "UPDATE student_library_assets SET task_id=? WHERE id=?",
      ).run(secondTask, direct.asset.id)).toThrow(/student library task owner mismatch/i);

      const row = connection.sqlite.prepare(
        "SELECT storage_path storagePath FROM student_library_assets WHERE id=?",
      ).get(direct.asset.id) as { storagePath: string };
      await writeFile(path.resolve(storageRoot, ...row.storagePath.split("/")), Buffer.from("tampered"));
      await expect(openStudentLibraryAsset(connection, first, direct.asset.id, storageRoot))
        .rejects.toBeInstanceOf(StudentLibraryNotFoundError);
    } finally {
      connection.sqlite.close();
    }
  });
});
