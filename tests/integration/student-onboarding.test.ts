// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET as onboardingGet,
  PUT as onboardingPut,
} from "@/app/api/agent/onboarding/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  readStudentOnboarding,
  saveStudentOnboarding,
} from "@/lib/services/student-onboarding";

const SECRET = "student-onboarding-route-secret-at-least-32-characters";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

describe("student onboarding model and owned API", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lumi-onboarding-"));
    databasePath = path.join(directory, "onboarding.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','一班','ONBOARD1');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('s1','c1','STUDENT','匿名一',1700000000),
          ('s2','c1','STUDENT','匿名二',1700000000),
          ('teacher',NULL,'TEACHER','课程负责人',1700000000);
        INSERT INTO auth_user(
          id,name,email,email_verified,image,created_at,updated_at,role,class_id,alias
        ) VALUES(
          's1','注册姓名一','s1@example.test',1,NULL,1700000000000,1700000000000,
          'STUDENT','c1','匿名一'
        );
        INSERT INTO learner_profiles(
          user_id,level,decomposition,signal_understanding,mapping_design,
          troubleshooting,transfer,updated_at
        ) VALUES('s1','L3',3,3,3,3,3,1700000000);
      `);
    } finally {
      connection.sqlite.close();
    }
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("AUTH_PROXY_SECRET", "student-onboarding-proxy-secret-at-least-32");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates constrained student fields and structured onboarding memory sources", () => {
    const connection = createDb(databasePath);
    try {
      expect(connection.sqlite.prepare(
        "SELECT count(*) count FROM __drizzle_migrations",
      ).get()).toEqual({ count: 51 });
      const userColumns = connection.sqlite.prepare(
        "SELECT name FROM pragma_table_xinfo('users')",
      ).all() as Array<{ name: string }>;
      expect(userColumns.map(({ name }) => name)).toEqual(expect.arrayContaining([
        "nickname",
        "major",
        "onboarding_completed_at",
      ]));
      expect(connection.sqlite.prepare(`
        SELECT count(*) count FROM sqlite_master
        WHERE type='trigger' AND name LIKE 'agent_student_memory_%_guard'
      `).get()).toEqual({ count: 4 });
      expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);

      expect(() => connection.sqlite.prepare(`
        UPDATE users SET nickname='不应写入' WHERE id='teacher'
      `).run()).toThrow();
      expect(() => connection.sqlite.prepare(`
        UPDATE users SET major='unknown-major' WHERE id='s1'
      `).run()).toThrow();
      expect(() => connection.sqlite.prepare(`
        INSERT INTO agent_student_memory(
          id,student_id,class_id,kind,content,salience,source_key,created_at
        ) VALUES(
          '11111111-1111-4111-8111-111111111111','s1','c1','PROJECT_FACT',
          '错误来源类型',1,'ONBOARDING_INTERESTS',1700000000
        )
      `).run()).toThrow();
    } finally {
      connection.sqlite.close();
    }
  });

  it("stores self-report as deletable Tier 1 soft signals without changing measured profile", () => {
    const connection = createDb(databasePath);
    try {
      expect(readStudentOnboarding(
        connection.db,
        { userId: "s1", role: "STUDENT" },
      )).toEqual({
        nickname: null,
        displayName: "注册姓名一",
        major: null,
        selfAssessedLevel: null,
        interests: null,
        completedAt: null,
        completed: false,
      });

      const saved = saveStudentOnboarding(
        connection.db,
        { userId: "s1", role: "STUDENT" },
        {
          nickname: "小岚",
          major: "book-design",
          selfAssessedLevel: "BEGINNER",
          interests: "书籍装帧与字体设计",
          markCompleted: true,
        },
        {
          now: new Date("2026-07-28T02:00:00.000Z"),
          environment: {},
        },
      );
      expect(saved).toEqual({
        nickname: "小岚",
        displayName: "小岚",
        major: "book-design",
        selfAssessedLevel: "BEGINNER",
        interests: "书籍装帧与字体设计",
        completedAt: "2026-07-28T02:00:00.000Z",
        completed: true,
      });

      const storedMemories = connection.sqlite.prepare(`
        SELECT kind,source_key sourceKey,source_turn_id sourceTurnId,content
        FROM agent_student_memory WHERE student_id='s1' ORDER BY source_key
      `).all() as Array<{
        kind: string;
        sourceKey: string;
        sourceTurnId: string | null;
        content: string;
      }>;
      expect(storedMemories).toHaveLength(2);
      expect(storedMemories.every(({ kind }) => kind === "PREFERENCE")).toBe(true);
      expect(storedMemories.every(({ sourceTurnId }) => sourceTurnId === null)).toBe(true);
      expect(storedMemories.map(({ sourceKey }) => sourceKey)).toEqual([
        "ONBOARDING_INTERESTS",
        "ONBOARDING_SELF_ASSESSMENT",
      ]);
      expect(connection.sqlite.prepare(`
        SELECT level,decomposition,signal_understanding,mapping_design,troubleshooting,transfer
        FROM learner_profiles WHERE user_id='s1'
      `).get()).toEqual({
        level: "L3",
        decomposition: 3,
        signal_understanding: 3,
        mapping_design: 3,
        troubleshooting: 3,
        transfer: 3,
      });

      const cleared = saveStudentOnboarding(
        connection.db,
        { userId: "s1", role: "STUDENT" },
        {
          nickname: null,
          major: null,
          selfAssessedLevel: null,
          interests: null,
          markCompleted: false,
        },
        {
          now: new Date("2026-07-28T03:00:00.000Z"),
          environment: {},
        },
      );
      expect(cleared).toMatchObject({
        nickname: null,
        displayName: "注册姓名一",
        completedAt: "2026-07-28T02:00:00.000Z",
        completed: true,
      });
      expect(connection.sqlite.prepare(`
        SELECT count(*) count FROM agent_student_memory
        WHERE student_id='s1' AND source_key IS NOT NULL
      `).get()).toEqual({ count: 0 });
      const auditPayload = connection.sqlite.prepare(`
        SELECT payload_json payloadJson FROM audit_events
        WHERE type='STUDENT_ONBOARDING_UPDATED' ORDER BY created_at ASC LIMIT 1
      `).get() as { payloadJson: string };
      expect(auditPayload.payloadJson).not.toContain("小岚");
      expect(auditPayload.payloadJson).not.toContain("书籍装帧与字体设计");
    } finally {
      connection.sqlite.close();
    }
  });

  it("derives ownership from the student session and rejects teacher or cross-student access", async () => {
    const s1 = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    const s2 = await issueSession({ userId: "s2", role: "STUDENT" }, SECRET);
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);

    const crossRead = await onboardingGet(new NextRequest(
      "http://localhost/api/agent/onboarding?studentId=s2",
      { headers: { cookie: cookie(s1) } },
    ));
    expect(crossRead.status).toBe(403);
    expect(await crossRead.json()).toMatchObject({
      code: "STUDENT_ONBOARDING_OWNER_FORBIDDEN",
    });

    const forbiddenTeacherWrite = await onboardingPut(new NextRequest(
      "http://localhost/api/agent/onboarding",
      {
        method: "PUT",
        headers: {
          cookie: cookie(teacher),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          nickname: null,
          major: null,
          selfAssessedLevel: null,
          interests: null,
          markCompleted: true,
        }),
      },
    ));
    expect(forbiddenTeacherWrite.status).toBe(403);

    const forgedOwnerWrite = await onboardingPut(new NextRequest(
      "http://localhost/api/agent/onboarding",
      {
        method: "PUT",
        headers: {
          cookie: cookie(s1),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          studentId: "s2",
          nickname: "越权昵称",
          major: "book-design",
          selfAssessedLevel: null,
          interests: null,
          markCompleted: true,
        }),
      },
    ));
    expect(forgedOwnerWrite.status).toBe(400);

    const saved = await onboardingPut(new NextRequest(
      "http://localhost/api/agent/onboarding",
      {
        method: "PUT",
        headers: {
          cookie: cookie(s1),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          nickname: "小岚",
          major: "book-design",
          selfAssessedLevel: "FOUNDATION",
          interests: "装帧",
          markCompleted: true,
        }),
      },
    ));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      nickname: "小岚",
      major: "book-design",
      completed: true,
    });

    const s2OwnRead = await onboardingGet(new NextRequest(
      "http://localhost/api/agent/onboarding",
      { headers: { cookie: cookie(s2) } },
    ));
    expect(s2OwnRead.status).toBe(200);
    expect(await s2OwnRead.json()).toMatchObject({
      displayName: "匿名二",
      nickname: null,
      major: null,
      completed: false,
    });
  });
});
