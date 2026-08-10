// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { enterStudent } from "@/lib/services/access";
import { preparePilotClass } from "@/lib/services/pilot-provisioning";

const PEPPER = "pilot-provisioning-pepper-at-least-32-characters";

describe("pilot provisioning", () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-pilot-provisioning-"));
    const databasePath = path.join(directory, "pilot.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates a dedicated REAL class and first-login diagnostic project without duplicating it", () => {
    const prepared = preparePilotClass(connection, {
      className: "第一轮真实试用", participantCount: 5, identityCodePepper: PEPPER,
      now: new Date("2026-07-16T08:00:00.000Z"),
    });
    expect(prepared.identityCodes).toHaveLength(5);
    expect(new Set(prepared.identityCodes).size).toBe(5);
    expect(connection.sqlite.prepare("SELECT sum(hours) hours FROM course_modules WHERE class_id=?").get(prepared.classId)).toEqual({ hours: 64 });

    const first = enterStudent(connection.db, { classCode: prepared.classAccessCode, alias: prepared.identityCodes[0]! }, PEPPER);
    expect(first.userId).not.toMatch(/^demo-/);
    expect(connection.sqlite.prepare("SELECT stage,data_type dataType FROM projects WHERE class_id=? AND student_id=?").all(prepared.classId, first.userId))
      .toEqual([{ stage: "DIAGNOSTIC", dataType: "REAL" }]);
    expect(enterStudent(connection.db, { classCode: prepared.classAccessCode, alias: prepared.identityCodes[0]! }, PEPPER).userId).toBe(first.userId);
    expect(connection.sqlite.prepare("SELECT count(*) count FROM projects WHERE class_id=? AND student_id=?").get(prepared.classId, first.userId)).toEqual({ count: 1 });
  });

  it("rejects an oversized cohort instead of silently issuing an unreviewable batch", () => {
    expect(() => preparePilotClass(connection, { className: "超大试用", participantCount: 31, identityCodePepper: PEPPER })).toThrow();
  });
});
