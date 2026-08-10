// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GENERATIVE_ARTIFACT_CSP,
  GenerativeArtifactRejectedError,
} from "@/lib/agent/skills/generative-html-guard";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  buildGenerativeArtifact,
  GenerativeBuildConflictError,
  readGenerativeWorkspace,
  requestGenerativeBuild,
  resetGenerativeWorkspace,
} from "@/lib/services/generative-tool";

const roots: string[] = [];
const student = { userId: "s1", role: "STUDENT" as const };
const validHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8"><style>body{margin:0}</style></head>
  <body><canvas></canvas><script>function draw(){};draw()</script></body>
</html>`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "lumi-generative-tool-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','设计班','GENERATIVE-1');
    INSERT INTO users(id,class_id,role,alias,created_at)
    VALUES('s1','c1','STUDENT','学生一',1700000000);
  `);
  return connection;
}

describe("generative tool service", () => {
  it("persists a request, stores only a guarded artifact, and restores a matching ready workspace", async () => {
    const connection = await setup();
    try {
      const request = requestGenerativeBuild(connection, student, {
        kind: "DOT_MATRIX",
        brief: "做一个可调整密度与点大小的点阵实验",
      }, new Date("2026-07-27T01:00:00.000Z"));
      expect(readGenerativeWorkspace(connection, student)).toMatchObject({
        status: "REQUESTED",
        request: { id: request.id, kind: "DOT_MATRIX" },
        artifact: null,
      });

      const generate = vi.fn().mockResolvedValue(validHtml);
      const artifact = await buildGenerativeArtifact(connection, student, {
        requestId: request.id,
        kind: request.kind,
        brief: request.brief,
      }, generate, new Date("2026-07-27T01:01:00.000Z"));

      expect(generate).toHaveBeenCalledWith({ kind: "DOT_MATRIX", brief: request.brief });
      expect(artifact).toMatchObject({
        requestId: request.id,
        kind: "DOT_MATRIX",
        validation: { safe: true, violations: [] },
      });
      expect(artifact.html).toContain('http-equiv="Content-Security-Policy"');
      expect(artifact.html).toContain(GENERATIVE_ARTIFACT_CSP);
      expect(readGenerativeWorkspace(connection, student)).toMatchObject({
        status: "READY",
        request: { id: request.id },
        artifact: { id: artifact.id, requestId: request.id },
      });
    } finally {
      connection.sqlite.close();
    }
  });

  it("returns the stored artifact idempotently without invoking the model twice", async () => {
    const connection = await setup();
    try {
      const command = {
        kind: "ARC_RING" as const,
        brief: "生成带层数与切割角度控制的弧形圆环",
      };
      const firstGenerator = vi.fn().mockResolvedValue(validHtml);
      const first = await buildGenerativeArtifact(connection, student, command, firstGenerator);
      const requestId = first.requestId;
      const secondGenerator = vi.fn().mockResolvedValue("should not be used");
      const second = await buildGenerativeArtifact(connection, student, {
        ...command,
        requestId,
      }, secondGenerator);

      expect(second.id).toBe(first.id);
      expect(firstGenerator).toHaveBeenCalledOnce();
      expect(secondGenerator).not.toHaveBeenCalled();
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps a rejected artifact out of storage and leaves the confirmed request recoverable", async () => {
    const connection = await setup();
    try {
      const request = requestGenerativeBuild(connection, student, {
        kind: "PARTICLE_FIELD",
        brief: "生成一个粒子流场参数实验",
      });
      await expect(buildGenerativeArtifact(connection, student, {
        requestId: request.id,
        kind: request.kind,
        brief: request.brief,
      }, async () => documentWithNetworkRequest())).rejects.toBeInstanceOf(GenerativeArtifactRejectedError);

      expect(readGenerativeWorkspace(connection, student)).toMatchObject({
        status: "REQUESTED",
        request: { id: request.id },
        artifact: null,
      });
      const count = connection.sqlite.prepare(
        "SELECT count(*) count FROM audit_events WHERE user_id=? AND type='GENERATIVE_ARTIFACT_STORED'",
      ).get(student.userId) as { count: number };
      expect(count.count).toBe(0);
    } finally {
      connection.sqlite.close();
    }
  });

  it("rejects a stale request and makes reset the latest durable workspace state", async () => {
    const connection = await setup();
    try {
      const stale = requestGenerativeBuild(connection, student, {
        kind: "CONTOUR_TERRAIN",
        brief: "第一版等高线实验",
      });
      requestGenerativeBuild(connection, student, {
        kind: "GRADIENT_DIFFUSION",
        brief: "第二版渐变扩散实验",
      });
      const generator = vi.fn().mockResolvedValue(validHtml);
      await expect(buildGenerativeArtifact(connection, student, {
        requestId: stale.id,
        kind: stale.kind,
        brief: stale.brief,
      }, generator)).rejects.toBeInstanceOf(GenerativeBuildConflictError);
      expect(generator).not.toHaveBeenCalled();

      expect(resetGenerativeWorkspace(connection, student)).toEqual({
        reset: true,
        workspace: { status: "EMPTY", request: null, artifact: null },
      });
      expect(readGenerativeWorkspace(connection, student)).toEqual({
        status: "EMPTY",
        request: null,
        artifact: null,
      });
    } finally {
      connection.sqlite.close();
    }
  });
});

function documentWithNetworkRequest() {
  return "<!doctype html><html><head></head><body><script>fetch('/api/private')</script></body></html>";
}
