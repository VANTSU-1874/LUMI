// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { users } from "@/lib/db/schema";
import { issueStudentIdentityCode } from "@/lib/auth/identity-code";
import { enterStudent, enterTeacher } from "@/lib/services/access";

const PEPPER = "access-test-identity-pepper-at-least-32-characters";

describe("class-code access", () => {
  let temporaryDirectory: string;
  let connection: DatabaseConnection;
  let identityCode: string;
  let secondClassIdentityCode: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tonggan-access-"));
    const databasePath = path.join(temporaryDirectory, "access.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes (id, name, access_code) VALUES
        ('class-1', '一班', 'CLASS001'),
        ('class-2', '二班', 'CLASS002');
    `);
    identityCode = issueStudentIdentityCode(connection.db, {
      classId: "class-1",
      pepper: PEPPER,
    });
    secondClassIdentityCode = issueStudentIdentityCode(connection.db, {
      classId: "class-2",
      pepper: PEPPER,
    });
  });

  afterEach(async () => {
    connection?.sqlite.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("creates a student for a valid trimmed class code", () => {
    const student = enterStudent(connection.db, {
      classCode: "  CLASS001  ",
      alias: identityCode.toLowerCase(),
    }, PEPPER);

    expect(student).toMatchObject({
      classId: "class-1",
      alias: expect.stringMatching(/^匿名-/),
      role: "STUDENT",
    });
    expect(student.userId).toEqual(expect.any(String));
  });

  it("restores the same student after trimming the alias", () => {
    const first = enterStudent(connection.db, {
      classCode: "CLASS001",
      alias: `  ${identityCode.toLowerCase()} `,
    }, PEPPER);
    connection.sqlite.exec(`
      CREATE TABLE insert_attempts (count INTEGER NOT NULL);
      INSERT INTO insert_attempts (count) VALUES (0);
      CREATE TRIGGER count_user_insert_attempts
      BEFORE INSERT ON users
      BEGIN
        UPDATE insert_attempts SET count = count + 1;
      END;
    `);
    const second = enterStudent(connection.db, {
      classCode: "CLASS001",
      alias: identityCode,
    }, PEPPER);
    const [total] = connection.db.select({ value: count() }).from(users).all();
    const insertAttempts = connection.sqlite
      .prepare("SELECT count FROM insert_attempts")
      .get() as { count: number };

    expect(second.userId).toBe(first.userId);
    expect(second.alias).not.toContain(identityCode);
    expect(total.value).toBe(1);
    expect(insertAttempts.count).toBe(1);
  });

  it("keeps preissued identities isolated to their class", () => {
    expect(() =>
      enterStudent(connection.db, {
        classCode: "CLASS002",
        alias: identityCode,
      }, PEPPER),
    ).toThrow("匿名编号无效");
    const second = enterStudent(connection.db, {
      classCode: "CLASS002",
      alias: secondClassIdentityCode,
    }, PEPPER);
    expect(second.classId).toBe("class-2");
  });

  it("does not create a user for a well-formed code that was never preissued", () => {
    expect(() =>
      enterStudent(connection.db, {
        classCode: "CLASS001",
        alias: "9Z8Y-7X6W-5V4U",
      }, PEPPER),
    ).toThrow("匿名编号无效");
    const [total] = connection.db.select({ value: count() }).from(users).all();
    expect(total.value).toBe(0);
  });

  it("rejects an invalid class code", () => {
    expect(() =>
      enterStudent(connection.db, { classCode: "MISSING", alias: identityCode }, PEPPER),
    ).toThrow("班级邀请码无效");
  });

  it.each([
    ["blank", "   "],
    ["overlong", "C".repeat(65)],
  ])("rejects a %s class code as invalid", (_case, classCode) => {
    expect(() =>
      enterStudent(connection.db, { classCode, alias: identityCode }, PEPPER),
    ).toThrow("班级邀请码无效");
  });

  it("rejects short, invalid-character, blank, or overlong identity codes", () => {
    for (const alias of ["S01", "7K9M_2Q4R_P8TX", "   ", "A".repeat(33)]) {
      expect(() =>
        enterStudent(connection.db, { classCode: "CLASS001", alias }, PEPPER),
      ).toThrow("匿名编号无效");
    }
  });

  it("normalizes a lowercase identity code before restoring", () => {
    const first = enterStudent(connection.db, {
      classCode: "CLASS001",
      alias: identityCode.toLowerCase(),
    }, PEPPER);
    const second = enterStudent(connection.db, {
      classCode: "CLASS001",
      alias: identityCode,
    }, PEPPER);

    expect(first.alias).not.toContain(identityCode);
    expect(second.userId).toBe(first.userId);
  });

  it("never persists the raw identity code in authentication tables", () => {
    enterStudent(
      connection.db,
      { classCode: "CLASS001", alias: identityCode },
      PEPPER,
    );

    const persisted = JSON.stringify({
      users: connection.sqlite.prepare("SELECT * FROM users").all(),
      identityCodes: connection.sqlite
        .prepare("SELECT * FROM student_identity_codes")
        .all(),
      rateLimits: connection.sqlite.prepare("SELECT * FROM auth_rate_limits").all(),
      audit: connection.sqlite.prepare("SELECT * FROM audit_events").all(),
    });
    expect(persisted).not.toContain(identityCode);
    expect(persisted).toMatch(/[a-f0-9]{64}/);
  });

  it("safely restores one identity across repeated duplicate attempts", () => {
    const results = Array.from({ length: 4 }, () =>
      enterStudent(connection.db, {
        classCode: "CLASS001",
        alias: identityCode,
      }, PEPPER),
    );
    const stored = connection.db
      .select()
      .from(users)
      .where(eq(users.id, results[0].userId))
      .all();

    expect(new Set(results.map(({ userId }) => userId)).size).toBe(1);
    expect(stored).toHaveLength(1);
  });

  it("propagates a real database insert failure instead of restoring", () => {
    enterStudent(connection.db, { classCode: "CLASS001", alias: identityCode }, PEPPER);
    connection.sqlite.exec(`
      CREATE TRIGGER force_user_insert_failure
      BEFORE INSERT ON users
      BEGIN
        SELECT RAISE(ABORT, 'forced database failure');
      END;
    `);

    expect(() =>
      enterStudent(connection.db, { classCode: "CLASS001", alias: identityCode }, PEPPER),
    ).toThrow("forced database failure");
  });
});

describe("teacher access", () => {
  it("accepts a trimmed correct code and returns a fixed teacher identity", () => {
    expect(enterTeacher("  private-teacher-code  ", "private-teacher-code")).toEqual({
      userId: "teacher",
      role: "TEACHER",
    });
  });

  it("rejects an incorrect teacher code", () => {
    expect(() => enterTeacher("wrong-code", "private-teacher-code")).toThrow(
      "教师访问码无效",
    );
  });
});
