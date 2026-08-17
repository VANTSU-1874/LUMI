// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/inspiration/multimodal-search/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import * as multimodalService from "@/lib/services/inspiration-wiki-multimodal";

const SECRET = "inspiration-multimodal-route-secret-32-chars";

function request(form: FormData, token?: string, extraHeaders: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/inspiration/multimodal-search", {
    method: "POST",
    body: form,
    headers: token
      ? { cookie: `${SESSION_COOKIE_NAME}=${token}`, origin: "http://localhost", ...extraHeaders }
      : { origin: "http://localhost", ...extraHeaders },
  });
}

describe("Inspiration Wiki multimodal search route", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lumi-wiki-mm-route-"));
    const databasePath = path.join(directory, "route.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('student',NULL,'STUDENT','学生',1700000000)");
    } finally { connection.sqlite.close(); }
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("INSPIRATION_WIKI_MULTIMODAL_INDEX_ROOT", path.join(directory, "missing-index"));
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

  it("requires an authenticated student or teacher", async () => {
    const form = new FormData();
    form.set("query", "海报");
    expect((await POST(request(form))).status).toBe(401);
  });

  it("accepts a bounded text query without exposing index internals", async () => {
    const token = await issueSession({ userId: "student", role: "STUDENT" }, SECRET);
    const form = new FormData();
    form.set("query", "红色海报");
    const response = await POST(request(form, token));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toMatchObject({ items: [], retrieval: { mode: "TEXT_FALLBACK", state: "DEGRADED", indexId: null } });
    expect(JSON.stringify(payload)).not.toContain("visualVector");
    expect(JSON.stringify(payload)).not.toContain("textVector");
    expect(JSON.stringify(payload)).not.toContain("storagePath");
  });

  it("accepts text queries when the server runtime has no global File constructor", async () => {
    const token = await issueSession({ userId: "student", role: "STUDENT" }, SECRET);
    const form = new FormData();
    form.set("query", "红色海报");
    const fileDescriptor = Object.getOwnPropertyDescriptor(globalThis, "File");
    Reflect.deleteProperty(globalThis, "File");
    try {
      const response = await POST(request(form, token));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        retrieval: { mode: "TEXT_FALLBACK", state: "DEGRADED" },
      });
    } finally {
      if (fileDescriptor) Object.defineProperty(globalThis, "File", fileDescriptor);
    }
  });

  it("keeps authenticated text search available when multimodal retrieval throws", async () => {
    const token = await issueSession({ userId: "student", role: "STUDENT" }, SECRET);
    vi.spyOn(multimodalService, "searchWikiMultimodal").mockRejectedValueOnce(new TypeError("synthetic retrieval failure"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const form = new FormData();
    form.set("query", "红色海报");
    const response = await POST(request(form, token));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [],
      retrieval: { mode: "TEXT_FALLBACK", state: "DEGRADED", indexId: null },
    });
    expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({
      route: "inspiration-multimodal-search",
      diagnosticStage: "RETRIEVAL",
      errorName: "TypeError",
      fallbackState: "SUCCEEDED",
    }));
  });

  it("rejects unsupported and undecodable image payloads", async () => {
    const token = await issueSession({ userId: "student", role: "STUDENT" }, SECRET);
    const unsupported = new FormData();
    unsupported.set("image", new File(["hello"], "sample.gif", { type: "image/gif" }));
    expect((await POST(request(unsupported, token))).status).toBe(415);
    const corrupt = new FormData();
    corrupt.set("image", new File(["not a png"], "sample.png", { type: "image/png" }));
    expect((await POST(request(corrupt, token))).status).toBe(422);
    const gifBytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ffffff" } }).gif().toBuffer();
    const disguised = new FormData();
    disguised.set("image", new File([Uint8Array.from(gifBytes)], "sample.png", { type: "image/png" }));
    expect((await POST(request(disguised, token))).status).toBe(422);
  });

  it("rejects a declared request body above the upload limit", async () => {
    const token = await issueSession({ userId: "student", role: "STUDENT" }, SECRET);
    const form = new FormData();
    form.set("query", "海报");
    const response = await POST(request(form, token, { "content-length": String(9 * 1024 * 1024) }));
    expect(response.status).toBe(413);
  });
});
