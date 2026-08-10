// @vitest-environment node

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteEvidenceRoute, scheduleCleanupAfterResponse } from "@/app/api/evidence/[evidenceId]/handler";
import { DELETE, GET } from "@/app/api/evidence/[evidenceId]/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { validPng } from "@/tests/helpers/image-fixtures";
import { deletePrivateEvidence, EvidenceCleanupPendingError } from "@/lib/services/private-evidence";
import { verifySession } from "@/lib/auth/session";

const SECRET = "private-evidence-secret-at-least-32-characters";
const EVIDENCE_ID = "11111111-1111-4111-8111-111111111111";

function request(method: "GET" | "DELETE", token?: string) {
  return new NextRequest(`http://localhost/api/evidence/${EVIDENCE_ID}`, {
    method,
    headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : undefined,
  });
}

function context(id = EVIDENCE_ID) { return { params: Promise.resolve({ evidenceId: id }) }; }

describe("protected evidence file and deletion route", () => {
  let directory: string;
  let databasePath: string;
  let evidenceRoot: string;
  let filePath: string;
  let student: string;
  let otherStudent: string;
  let classTeacher: string;
  let otherTeacher: string;
  let globalTeacher: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-private-evidence-"));
    databasePath = path.join(directory, "course.sqlite");
    evidenceRoot = path.join(directory, "private-evidence");
    await mkdir(path.join(evidenceRoot, "project-1"), { recursive: true });
    filePath = path.join(evidenceRoot, "project-1", `${EVIDENCE_ID}.png`);
    await writeFile(filePath, validPng);
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes VALUES ('class-1','一班','CLASS001'),('class-2','二班','CLASS002');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('student-1','class-1','STUDENT','匿名-1',1700000000),
        ('student-2','class-1','STUDENT','匿名-2',1700000000),
        ('teacher-1','class-1','TEACHER','教师-1',1700000000),
        ('teacher-2','class-2','TEACHER','教师-2',1700000000),
        ('teacher',NULL,'TEACHER','课程负责人',1700000000);
      INSERT INTO course_modules VALUES ('module-1','class-1',1,'搭建',2,'信号');
      INSERT INTO assignments VALUES ('assignment-1','class-1','module-1','作业','简介','["DIGISHOW"]',1700000000);
      INSERT INTO projects VALUES ('project-1','class-1','assignment-1','student-1','BUILD',1700000000,1700000000,1);
    `);
    connection.sqlite.prepare(`INSERT INTO evidence
      (id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
      VALUES (?,?,?,?,1,'IMAGE','INPUT',NULL,'SUBMITTED','READY','截图',?,? ,NULL,'source.png',1700000000)`)
      .run(EVIDENCE_ID, "project-1", "class-1", "student-1", `project-1/${EVIDENCE_ID}.png`, "a".repeat(64));
    connection.sqlite.close();
    student = await issueSession({ userId: "student-1", role: "STUDENT" }, SECRET);
    otherStudent = await issueSession({ userId: "student-2", role: "STUDENT" }, SECRET);
    classTeacher = await issueSession({ userId: "teacher-1", role: "TEACHER" }, SECRET);
    otherTeacher = await issueSession({ userId: "teacher-2", role: "TEACHER" }, SECRET);
    globalTeacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("EVIDENCE_ROOT", evidenceRoot);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("TEACHER_ACCESS_CODE", "teacher-code");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("streams an owned image without exposing filesystem metadata", async () => {
    const response = await GET(request("GET", student), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("accept-ranges")).toBe("none");
    expect(response.headers.get("content-disposition")).toBe(`inline; filename="${EVIDENCE_ID}.png"`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(validPng);
    expect(JSON.stringify(Object.fromEntries(response.headers))).not.toContain(directory);
  });

  it("rejects byte ranges explicitly instead of serving ambiguous partial content", async () => {
    const ranged = request("GET", student);
    ranged.headers.set("range", "bytes=0-10");
    const response = await GET(ranged, context());
    expect(response.status).toBe(416);
    expect(response.headers.get("accept-ranges")).toBe("none");
  });

  it("permits only the owning student or a teacher assigned to the evidence class", async () => {
    expect((await GET(request("GET"), context())).status).toBe(401);
    expect((await GET(request("GET", otherStudent), context())).status).toBe(404);
    expect((await GET(request("GET", otherTeacher), context())).status).toBe(404);
    expect((await GET(request("GET", classTeacher), context())).status).toBe(200);
  });

  it("deletes both the private file and database record and remains idempotent", async () => {
    expect((await DELETE(request("DELETE", student), context())).status).toBe(204);
    await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    const check = createDb(databasePath);
    expect(check.sqlite.prepare("SELECT count(*) count FROM evidence WHERE id=?").get(EVIDENCE_ID)).toEqual({ count: 0 });
    expect(check.sqlite.prepare("SELECT type,payload_json FROM audit_events WHERE type='EVIDENCE_DELETED'").get()).toMatchObject({ type: "EVIDENCE_DELETED" });
    check.sqlite.close();
    expect((await DELETE(request("DELETE", student), context())).status).toBe(204);
  });

  it("does not reveal cross-account or cross-class evidence during deletion", async () => {
    expect((await DELETE(request("DELETE", otherStudent), context())).status).toBe(204);
    expect((await DELETE(request("DELETE", otherTeacher), context())).status).toBe(204);
    expect(await readFile(filePath)).toEqual(validPng);
  });

  it("attributes a managed-class teacher deletion to the teacher without logging content or paths", async () => {
    expect((await DELETE(request("DELETE", classTeacher), context())).status).toBe(204);
    const check = createDb(databasePath);
    const audit = check.sqlite.prepare("SELECT user_id,payload_json FROM audit_events WHERE type='EVIDENCE_DELETED'").get() as { user_id: string; payload_json: string };
    expect(audit.user_id).toBe("teacher-1");
    expect(audit.payload_json).not.toContain(directory);
    expect(audit.payload_json).not.toContain("source.png");
    check.sqlite.close();
  });

  it("attributes an actual global-owner login deletion to the persistent teacher identity", async () => {
    expect((await DELETE(request("DELETE", globalTeacher), context())).status).toBe(204);
    const check = createDb(databasePath);
    try {
      expect(check.sqlite.prepare("SELECT user_id FROM audit_events WHERE type='EVIDENCE_DELETED'").get()).toEqual({ user_id: "teacher" });
    } finally { check.sqlite.close(); }
  });

  it("does not grant cross-class GET or DELETE when the fixed teacher id has a class", async () => {
    const connection = createDb(databasePath);
    try { connection.sqlite.prepare("UPDATE users SET class_id='class-2' WHERE id='teacher'").run(); }
    finally { connection.sqlite.close(); }
    expect((await GET(request("GET", globalTeacher), context())).status).toBe(404);
    expect((await DELETE(request("DELETE", globalTeacher), context())).status).toBe(204);
    await expect(readFile(filePath)).resolves.toEqual(validPng);
    const check = createDb(databasePath);
    try { expect(check.sqlite.prepare("SELECT count(*) count FROM evidence WHERE id=?").get(EVIDENCE_ID)).toEqual({ count: 1 }); }
    finally { check.sqlite.close(); }
  });

  it("restores the original file and keeps the database row when the transaction fails", async () => {
    const connection = createDb(databasePath);
    const actor = await verifySession(student, SECRET);
    await expect(deletePrivateEvidence(connection.db, actor, EVIDENCE_ID, evidenceRoot, {
      beforeDeleteTransaction: () => { throw new Error("injected transaction failure"); },
    })).rejects.toThrow("injected transaction failure");
    expect(await readFile(filePath)).toEqual(validPng);
    expect(connection.sqlite.prepare("SELECT count(*) count FROM evidence WHERE id=?").get(EVIDENCE_ID)).toEqual({ count: 1 });
    connection.sqlite.close();
  });

  it("keeps DB and original file unchanged when the tombstone rename fails", async () => {
    const connection = createDb(databasePath);
    const actor = await verifySession(student, SECRET);
    await expect(deletePrivateEvidence(connection.db, actor, EVIDENCE_ID, evidenceRoot, {
      rename: async () => { throw Object.assign(new Error("rename denied"), { code: "EACCES" }); },
    })).rejects.toThrow("rename denied");
    expect(await readFile(filePath)).toEqual(validPng);
    expect(connection.sqlite.prepare("SELECT count(*) count FROM evidence WHERE id=?").get(EVIDENCE_ID)).toEqual({ count: 1 });
    connection.sqlite.close();
  });

  it("keeps a persistent tombstone and exposes a real retry that removes it after initial cleanup failure", async () => {
    const connection = createDb(databasePath);
    const actor = await verifySession(student, SECRET);
    let cleanupError: EvidenceCleanupPendingError | undefined;
    try {
      await deletePrivateEvidence(connection.db, actor, EVIDENCE_ID, evidenceRoot, {
        remove: async () => { throw new Error("cleanup denied"); },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceCleanupPendingError);
      cleanupError = error as EvidenceCleanupPendingError;
    }
    expect(connection.sqlite.prepare("SELECT count(*) count FROM evidence WHERE id=?").get(EVIDENCE_ID)).toEqual({ count: 0 });
    await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    const tombstone = (await readdir(path.dirname(filePath))).find((name) => name.startsWith(".deleting-"));
    expect(tombstone).toBeDefined();
    await cleanupError?.retryCleanup();
    expect((await readdir(path.dirname(filePath))).some((name) => name.startsWith(".deleting-"))).toBe(false);
    connection.sqlite.close();
  });

  it("registers cleanup through the route after-response scheduler and performs the actual retry", async () => {
    const connection = createDb(databasePath);
    const actor = await verifySession(student, SECRET);
    let cleanupError: EvidenceCleanupPendingError | undefined;
    try {
      await deletePrivateEvidence(connection.db, actor, EVIDENCE_ID, evidenceRoot, {
        remove: async () => { throw new Error("cleanup denied"); },
      });
    } catch (error) { cleanupError = error as EvidenceCleanupPendingError; }
    const scheduled: Array<() => Promise<void>> = [];
    scheduleCleanupAfterResponse(cleanupError!, (task) => { scheduled.push(task); }, "request-id");
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect((await readdir(path.dirname(filePath))).some((name) => name.startsWith(".deleting-"))).toBe(false);
    connection.sqlite.close();
  });

  it("contains a synchronous after-registration failure without leaking paths or changing the 204 contract", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const retryCleanup = vi.fn(async () => undefined);
    const cleanup = new EvidenceCleanupPendingError(retryCleanup);
    expect(() => scheduleCleanupAfterResponse(
      cleanup,
      () => { throw new Error(`scheduler refused ${directory}`); },
      "request-id",
    )).not.toThrow();
    expect(retryCleanup).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({
      requestId: "request-id",
      route: "private-evidence-cleanup-schedule",
      errorName: "Error",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(directory);
    log.mockRestore();
  });

  it("still returns 204 when cleanup is pending and after registration throws synchronously", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cleanup = new EvidenceCleanupPendingError(async () => undefined);
    const response = await deleteEvidenceRoute(request("DELETE", student), context(), {
      deleteEvidence: async () => { throw cleanup; },
      schedule: () => { throw new Error(`scheduler refused ${directory}`); },
    });
    expect(response.status).toBe(204);
    expect(JSON.stringify(log.mock.calls)).not.toContain(directory);
    log.mockRestore();
  });

  it("contains an asynchronous after callback failure without an unhandled rejection or path leak", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitivePath = path.join(directory, "private-evidence", "secret.png");
    const cleanup = new EvidenceCleanupPendingError(async () => {
      throw new Error(`cleanup refused ${sensitivePath}`);
    });
    const scheduled: Array<() => Promise<void>> = [];
    scheduleCleanupAfterResponse(cleanup, (task) => { scheduled.push(task); }, "request-id");

    await expect(scheduled[0]()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith({
      requestId: "request-id",
      route: "private-evidence-cleanup",
      errorName: "Error",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(sensitivePath);
    log.mockRestore();
  });

  it("handles two concurrent authorized DELETE requests idempotently", async () => {
    const [first, second] = await Promise.all([
      DELETE(request("DELETE", student), context()),
      DELETE(request("DELETE", student), context()),
    ]);
    expect([first.status, second.status]).toEqual([204, 204]);
    const check = createDb(databasePath);
    expect(check.sqlite.prepare("SELECT count(*) count FROM evidence WHERE id=?").get(EVIDENCE_ID)).toEqual({ count: 0 });
    check.sqlite.close();
    await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
