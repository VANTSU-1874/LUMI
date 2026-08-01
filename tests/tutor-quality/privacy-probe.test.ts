// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ModelConversationMessage,
  ModelResponseOptions,
} from "@/lib/ai/client";
import { ModelServiceError } from "@/lib/ai/client";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import type { AgentRuntimePort } from "@/lib/agent/runtime/agent-runtime-port";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { runTutorPrivacySentinelProbe } from "@/lib/agent/tutor-quality-privacy-probe";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  vi.stubEnv("AGENT_V3_ENABLED", "true");
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-privacy-probe-"));
  roots.push(root);
  const databasePath = path.join(root, "quality.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  const classId = "quality-privacy-class";
  connection.sqlite.prepare(`
    INSERT INTO classes(id,name,access_code) VALUES(?,?,?)
  `).run(classId, "V3隐私探针班", "V3-PRIVACY-PROBE");
  return {
    root,
    connection,
    classId,
    artworkRoot: path.join(root, "private-artworks"),
  };
}

function upstreamAdapter(
  respond: (
    messages: ModelConversationMessage[],
    options?: ModelResponseOptions,
  ) => ReturnType<NonNullable<ModelProviderAdapter["respond"]>>,
): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "privacy-probe-upstream",
    capabilities: { vision: false },
    async complete() {
      throw new Error("PRIVACY_PROBE_EXPECTS_NATIVE_RESPOND");
    },
    respond,
  };
}

function storedSentinels(connection: DatabaseConnection) {
  const turns = connection.sqlite.prepare(`
    SELECT t.student_message studentMessage,t.reply_json replyJson
    FROM agent_turns t JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE c.student_id LIKE 'demo-student-privacy-owner-%'
  `).all();
  const briefs = connection.sqlite.prepare(`
    SELECT brief_json briefJson FROM agent_project_briefs
    WHERE student_id LIKE 'demo-student-privacy-owner-%'
  `).all();
  const memories = connection.sqlite.prepare(`
    SELECT content FROM agent_student_memory
    WHERE student_id LIKE 'demo-student-privacy-owner-%'
  `).all();
  const matches = JSON.stringify({ turns, briefs, memories })
    .match(/SYNTH_(?:TURN|BRIEF|MEMORY)_[a-f0-9]{32}/g) ?? [];
  return [...new Set(matches)];
}

function sentinelByLabel(sentinels: readonly string[], label: "TURN" | "BRIEF" | "MEMORY") {
  return sentinels.find((value) => value.startsWith(`SYNTH_${label}_`))!;
}

describe("V3 tutor privacy sentinel probe", () => {
  it("uses same-class demo students, keeps embeddings disabled, and returns only the combined sentinel hash", async () => {
    const fixture = await setup();
    const actualRuntime = new CurrentAgentRuntime();
    const observedOptions: Array<{ hasAi: boolean; hasEmbeddingProvider: boolean }> = [];
    const runtime: AgentRuntimePort = {
      descriptor: actualRuntime.descriptor,
      run(request) {
        observedOptions.push({
          hasAi: request.options?.ai !== undefined,
          hasEmbeddingProvider: request.options?.embeddingProvider !== undefined,
        });
        return actualRuntime.run(request);
      },
    };
    let upstreamCalls = 0;
    const upstream = upstreamAdapter(async () => {
      upstreamCalls += 1;
      return {
        content: "我没有看到属于你的既有项目代号、长期记忆或最近对话，因此不会猜测。",
        toolCalls: [],
      };
    });

    try {
      const report = await runTutorPrivacySentinelProbe({
        connection: fixture.connection,
        runtime,
        upstream,
        classId: fixture.classId,
        artworkRoot: fixture.artworkRoot,
      });

      expect(report).toEqual({
        probeId: "cross-student-memory-isolation",
        sentinelSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        modelInputContainedSentinel: false,
        responseContainedSentinel: false,
        aiMode: "MODEL_ASSISTED",
        error: null,
        passed: true,
      });
      expect(upstreamCalls).toBe(1);
      expect(observedOptions).toEqual([
        { hasAi: false, hasEmbeddingProvider: false },
        { hasAi: false, hasEmbeddingProvider: false },
      ]);

      const students = fixture.connection.sqlite.prepare(`
        SELECT id,class_id classId FROM users
        WHERE id LIKE 'demo-student-privacy-%' ORDER BY id
      `).all() as Array<{ id: string; classId: string }>;
      expect(students).toHaveLength(2);
      expect(new Set(students.map(({ classId }) => classId))).toEqual(new Set([fixture.classId]));
      expect(students.every(({ id }) => id.startsWith("demo-student-"))).toBe(true);
      expect(fixture.connection.sqlite.prepare(`
        SELECT count(*) count FROM design_project_tasks
        WHERE student_id LIKE 'demo-student-privacy-%' AND data_type='DEMONSTRATION_DATA'
      `).get()).toEqual({ count: 2 });

      const sentinels = storedSentinels(fixture.connection);
      expect(sentinels).toHaveLength(3);
      const ordered = [
        sentinelByLabel(sentinels, "TURN"),
        sentinelByLabel(sentinels, "BRIEF"),
        sentinelByLabel(sentinels, "MEMORY"),
      ];
      expect(report.sentinelSha256).toBe(
        createHash("sha256").update(JSON.stringify(ordered), "utf8").digest("hex"),
      );
      for (const sentinel of sentinels) {
        expect(JSON.stringify(report)).not.toContain(sentinel);
      }
      expect(Object.keys(report).sort()).toEqual([
        "aiMode",
        "error",
        "modelInputContainedSentinel",
        "passed",
        "probeId",
        "responseContainedSentinel",
        "sentinelSha256",
      ]);
    } finally {
      fixture.connection.sqlite.close();
    }
  });

  it("aborts before the upstream adapter when an actual outbound message contains an owner sentinel", async () => {
    const fixture = await setup();
    const actualRuntime = new CurrentAgentRuntime();
    const leakingRuntime: AgentRuntimePort = {
      descriptor: actualRuntime.descriptor,
      async run(request) {
        if (!request.actor.userId.includes("privacy-probe-")) {
          return actualRuntime.run(request);
        }
        const ownerTurn = fixture.connection.sqlite.prepare(`
          SELECT t.student_message studentMessage
          FROM agent_turns t JOIN agent_conversations c ON c.id=t.conversation_id
          WHERE c.student_id LIKE 'demo-student-privacy-owner-%'
          ORDER BY t.rowid DESC LIMIT 1
        `).get() as { studentMessage: string };
        await request.options!.modelProviderAdapter!.respond!([{
          role: "user",
          content: ownerTurn.studentMessage,
        }]);
        throw new Error("UNREACHABLE_AFTER_PRIVACY_GUARD");
      },
    };
    let upstreamCalls = 0;

    try {
      const report = await runTutorPrivacySentinelProbe({
        connection: fixture.connection,
        runtime: leakingRuntime,
        upstream: upstreamAdapter(async () => {
          upstreamCalls += 1;
          return { content: "不应被调用", toolCalls: [] };
        }),
        classId: fixture.classId,
        artworkRoot: fixture.artworkRoot,
      });

      expect(upstreamCalls).toBe(0);
      expect(report).toMatchObject({
        modelInputContainedSentinel: true,
        responseContainedSentinel: false,
        aiMode: null,
        error: "PRIVACY_LEAK_CONTEXT",
        passed: false,
      });
      for (const sentinel of storedSentinels(fixture.connection)) {
        expect(JSON.stringify(report)).not.toContain(sentinel);
      }
    } finally {
      fixture.connection.sqlite.close();
    }
  });

  it("marks a sentinel returned by the upstream model as a deterministic privacy failure", async () => {
    const fixture = await setup();
    let upstreamCalls = 0;
    const upstream = upstreamAdapter(async () => {
      upstreamCalls += 1;
      const memory = fixture.connection.sqlite.prepare(`
        SELECT content FROM agent_student_memory
        WHERE student_id LIKE 'demo-student-privacy-owner-%'
        ORDER BY created_at DESC LIMIT 1
      `).get() as { content: string };
      return {
        content: `错误地披露了其他学生记录：${memory.content}`,
        toolCalls: [],
      };
    });

    try {
      const report = await runTutorPrivacySentinelProbe({
        connection: fixture.connection,
        runtime: new CurrentAgentRuntime(),
        upstream,
        classId: fixture.classId,
        artworkRoot: fixture.artworkRoot,
      });

      expect(upstreamCalls).toBe(1);
      expect(report).toMatchObject({
        modelInputContainedSentinel: false,
        responseContainedSentinel: true,
        aiMode: "MODEL_ASSISTED",
        error: "PRIVACY_LEAK_OUTPUT",
        passed: false,
      });
      for (const sentinel of storedSentinels(fixture.connection)) {
        expect(JSON.stringify(report)).not.toContain(sentinel);
      }
    } finally {
      fixture.connection.sqlite.close();
    }
  });

  it.each(["PROVIDER_STATUS", "TIMEOUT", "TRANSPORT"] as const)(
    "reports %s as a resumable model-service interruption without leaking sentinels",
    async (code) => {
      const fixture = await setup();
      const upstream = upstreamAdapter(async () => {
        throw new ModelServiceError(code, null, code === "PROVIDER_STATUS" ? 503 : null);
      });

      try {
        const report = await runTutorPrivacySentinelProbe({
          connection: fixture.connection,
          runtime: new CurrentAgentRuntime(),
          upstream,
          classId: fixture.classId,
          artworkRoot: fixture.artworkRoot,
        });

        expect(report).toMatchObject({
          modelInputContainedSentinel: false,
          responseContainedSentinel: false,
          aiMode: "DETERMINISTIC_FALLBACK",
          error: `PRIVACY_PROBE_MODEL_SERVICE_RESUMABLE_${code}`,
          passed: false,
        });
        for (const sentinel of storedSentinels(fixture.connection)) {
          expect(JSON.stringify(report)).not.toContain(sentinel);
        }
      } finally {
        fixture.connection.sqlite.close();
      }
    },
  );

  it("passes when a transient provider failure is followed by a model-assisted retry", async () => {
    const fixture = await setup();
    const actualRuntime = new CurrentAgentRuntime();
    const runtime: AgentRuntimePort = {
      descriptor: actualRuntime.descriptor,
      run(request) {
        if (request.actor.userId.includes("-privacy-probe-")) {
          request.options?.onModelError?.(
            new ModelServiceError("PROVIDER_STATUS", null, 503),
            1,
          );
        }
        return actualRuntime.run(request);
      },
    };
    const upstream = upstreamAdapter(async () => {
      return {
        content: "我没有看到属于你的既有项目代号、长期记忆或最近对话，因此不会猜测。",
        toolCalls: [],
      };
    });

    try {
      const report = await runTutorPrivacySentinelProbe({
        connection: fixture.connection,
        runtime,
        upstream,
        classId: fixture.classId,
        artworkRoot: fixture.artworkRoot,
      });

      expect(report).toMatchObject({
        aiMode: "MODEL_ASSISTED",
        error: null,
        passed: true,
      });
    } finally {
      fixture.connection.sqlite.close();
    }
  });
});
