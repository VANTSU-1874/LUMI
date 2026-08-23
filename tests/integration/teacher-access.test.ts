// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  grantTeacherAccessScope,
  readTeacherScope,
  TeacherIdentityForbiddenError,
} from "@/lib/auth/teacher-access";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("explicit teacher access scopes", () => {
  it("fails closed for an unscoped teacher and records explicit global or class access", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lumi-teacher-scope-"));
    roots.push(root);
    const databasePath = path.join(root, "scope.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','一班','CLASS-1');
        INSERT INTO users(id,class_id,role,alias,created_at)
        VALUES('teacher-account',NULL,'TEACHER','预置教师',1700000000);
      `);
      const actor = { userId: "teacher-account", role: "TEACHER" as const };
      expect(() => readTeacherScope(connection.db, actor)).toThrow(TeacherIdentityForbiddenError);

      expect(grantTeacherAccessScope(connection.db, {
        teacherId: actor.userId,
        scope: { kind: "CLASS", classId: "c1" },
        grantedBy: "competition-admin",
        grantReason: "负责一班课程验收",
        now: new Date("2026-08-22T00:00:00.000Z"),
      })).toEqual({ kind: "CLASS", classId: "c1" });

      expect(grantTeacherAccessScope(connection.db, {
        teacherId: actor.userId,
        scope: { kind: "GLOBAL" },
        grantedBy: "competition-admin",
        grantReason: "课程负责人需要跨班级治理",
        now: new Date("2026-08-22T01:00:00.000Z"),
      })).toEqual({ kind: "GLOBAL", classId: null });
      expect(connection.sqlite.prepare(`
        SELECT scope_kind scopeKind,class_id classId,granted_by grantedBy,grant_reason grantReason
        FROM teacher_access_scopes WHERE teacher_id=?
      `).get(actor.userId)).toEqual({
        scopeKind: "GLOBAL",
        classId: null,
        grantedBy: "competition-admin",
        grantReason: "课程负责人需要跨班级治理",
      });
    } finally {
      connection.sqlite.close();
    }
  });
});
