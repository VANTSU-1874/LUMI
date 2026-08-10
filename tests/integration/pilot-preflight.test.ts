// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { enterStudent } from "@/lib/services/access";
import { readPilotClassPreflightSnapshot } from "@/lib/services/pilot-preflight";
import { preparePilotClass } from "@/lib/services/pilot-provisioning";

const PEPPER = "pilot-preflight-pepper-at-least-32-characters";

describe("pilot preflight database snapshot", () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-pilot-preflight-"));
    const databasePath = path.join(directory, "pilot.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("reports an untouched class and then tracks a claimed identity with its diagnostic project", () => {
    const prepared = preparePilotClass(connection, {
      className: "第一轮真实试用",
      participantCount: 5,
      identityCodePepper: PEPPER,
      now: new Date("2026-07-16T08:00:00.000Z"),
    });
    expect(readPilotClassPreflightSnapshot(connection, prepared.className)).toMatchObject({
      classId: prepared.classId,
      moduleCount: 4,
      totalHours: 64,
      assignmentCount: 1,
      issuedIdentityCount: 5,
      claimedIdentityCount: 0,
      studentCount: 0,
      projectCount: 0,
    });

    enterStudent(connection.db, {
      classCode: prepared.classAccessCode,
      alias: prepared.identityCodes[0]!,
    }, PEPPER);
    expect(readPilotClassPreflightSnapshot(connection, prepared.className)).toMatchObject({
      issuedIdentityCount: 5,
      claimedIdentityCount: 1,
      studentCount: 1,
      projectCount: 1,
    });
  });

  it("rejects ambiguous class names instead of choosing an arbitrary cohort", () => {
    preparePilotClass(connection, { className: "同名试用班", participantCount: 5, identityCodePepper: PEPPER });
    preparePilotClass(connection, { className: "同名试用班", participantCount: 5, identityCodePepper: PEPPER });
    expect(() => readPilotClassPreflightSnapshot(connection, "同名试用班")).toThrow("存在同名试用班");
  });
});
