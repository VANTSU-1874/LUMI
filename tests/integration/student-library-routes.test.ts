// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as contentGet } from "@/app/api/agent/library/[assetId]/content/route";
import { DELETE as assetDelete } from "@/app/api/agent/library/[assetId]/route";
import { GET as libraryGet, POST as libraryPost } from "@/app/api/agent/library/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { validPng } from "@/tests/helpers/image-fixtures";

const SECRET = "student-library-session-secret-at-least-32-characters";
const taskId = "11111111-1111-4111-8111-111111111111";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

function getRequest(url: string, token?: string, headers?: Record<string, string>) {
  return new NextRequest(url, {
    headers: { ...(token ? { cookie: cookie(token) } : {}), ...headers },
  });
}

async function uploadRequest(url: string, token: string, task = taskId) {
  const form = new FormData();
  form.append("file", new Blob([validPng], { type: "image/png" }), "海报草图.png");
  form.append("taskId", task);
  const encoded = new Request(url, { method: "POST", body: form });
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  return new NextRequest(url, {
    method: "POST",
    headers: {
      cookie: cookie(token),
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(bytes.byteLength),
    },
    body: bytes,
  });
}

describe("student library routes", () => {
  let directory: string;
  let databasePath: string;
  let evidenceRoot: string;
  let firstToken: string;
  let secondToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-library-routes-"));
    databasePath = path.join(directory, "library.sqlite");
    evidenceRoot = path.join(directory, "private-images");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','设计班','LIBRARY');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('s1','c1','STUDENT','学生一',1700000000),
        ('s2','c1','STUDENT','学生二',1700000000),
        ('t1','c1','TEACHER','教师一',1700000000);
      INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type)
        VALUES('${taskId}','s1','c1','海报项目','ACTIVE',1700000000,1700000000,'REAL');
    `);
    connection.sqlite.close();
    firstToken = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    secondToken = await issueSession({ userId: "s2", role: "STUDENT" }, SECRET);
    teacherToken = await issueSession({ userId: "t1", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("EVIDENCE_ROOT", evidenceRoot);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("AUTH_PROXY_SECRET", "student-library-proxy-secret-at-least-32-characters");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("uploads, lists, downloads and deletes an owned private image", async () => {
    const createdResponse = await libraryPost(await uploadRequest("http://localhost/api/agent/library", firstToken));
    expect(createdResponse.status).toBe(201);
    expect(createdResponse.headers.get("cache-control")).toBe("private, no-store");
    const created = await createdResponse.json() as { asset: { id: string; fileName: string } };
    expect(created.asset.fileName).toBe("海报草图.png");

    const listed = await libraryGet(getRequest("http://localhost/api/agent/library", firstToken));
    await expect(listed.json()).resolves.toMatchObject({ assets: [{ id: created.asset.id }] });
    const isolated = await libraryGet(getRequest("http://localhost/api/agent/library", secondToken));
    await expect(isolated.json()).resolves.toEqual({ assets: [] });

    const context = { params: Promise.resolve({ assetId: created.asset.id }) };
    const downloaded = await contentGet(
      getRequest(`http://localhost/api/agent/library/${created.asset.id}/content?download=1`, firstToken),
      context,
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("image/png");
    expect(downloaded.headers.get("content-disposition")).toContain("attachment");
    expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await downloaded.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const foreign = await contentGet(
      getRequest(`http://localhost/api/agent/library/${created.asset.id}/content`, secondToken),
      context,
    );
    expect(foreign.status).toBe(404);
    const ranged = await contentGet(
      getRequest(`http://localhost/api/agent/library/${created.asset.id}/content`, firstToken, { range: "bytes=0-10" }),
      context,
    );
    expect(ranged.status).toBe(416);

    expect((await assetDelete(
      new NextRequest(`http://localhost/api/agent/library/${created.asset.id}`, {
        method: "DELETE",
        headers: { cookie: cookie(secondToken) },
      }),
      context,
    )).status).toBe(404);
    expect((await assetDelete(
      new NextRequest(`http://localhost/api/agent/library/${created.asset.id}`, {
        method: "DELETE",
        headers: { cookie: cookie(firstToken) },
      }),
      context,
    )).status).toBe(200);
  });

  it("requires an authenticated student and rejects cross-owned project binding", async () => {
    expect((await libraryGet(getRequest("http://localhost/api/agent/library"))).status).toBe(401);
    expect((await libraryGet(getRequest("http://localhost/api/agent/library", teacherToken))).status).toBe(403);
    expect((await libraryPost(await uploadRequest(
      "http://localhost/api/agent/library",
      secondToken,
    ))).status).toBe(404);
  });
});
