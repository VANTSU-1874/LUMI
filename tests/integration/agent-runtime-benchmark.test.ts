// @vitest-environment node

import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeBenchmarkFixtureAdapter } from "@/lib/agent/runtime-benchmark-adapter";
import type { AgentRuntimePort, AgentRuntimeRequest } from "@/lib/agent/runtime/agent-runtime-port";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { FreshProcessRecoveryResultSchema } from "@/lib/agent/runtime-benchmark-restart";
import { loadAgentRuntimeBenchmarkSuite } from "@/lib/agent/runtime-benchmark";
import {
  runDesignBenchmarkCases,
  runLongSessionProbe,
  runRestartRecoveryProbe,
  runTaskIsolationProbe,
} from "@/lib/agent/runtime-benchmark-probes";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
const actor = { userId: "benchmark-student", role: "STUDENT" as const };

class RecordingRuntime implements AgentRuntimePort {
  readonly descriptor;
  calls = 0;

  constructor(private readonly delegate: AgentRuntimePort) {
    this.descriptor = delegate.descriptor;
  }

  run(request: AgentRuntimeRequest) {
    this.calls += 1;
    return this.delegate.run(request);
  }
}

function initializeDatabase(databasePath: string) {
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('benchmark-class','Benchmark','BENCHMARK');
    INSERT INTO users(id,class_id,role,alias,created_at)
      VALUES('benchmark-student','benchmark-class','STUDENT','Benchmark Student',1700000000);
  `);
  return connection;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("current Agent Runtime benchmark probes", () => {
  it("keeps all disciplines answerable and preserves continuity, task isolation and restart recovery", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-runtime-benchmark-"));
    roots.push(root);
    const databasePath = path.join(root, "benchmark.sqlite");
    const restartPath = path.join(root, "restart.sqlite");
    const connection = initializeDatabase(databasePath);
    const restartSetup = initializeDatabase(restartPath);
    restartSetup.sqlite.close();
    const { suite } = loadAgentRuntimeBenchmarkSuite(path.resolve("data/evals/agent-runtime-benchmark.json"));
    const adapter = createRuntimeBenchmarkFixtureAdapter();
    const runtime = new RecordingRuntime(new CurrentAgentRuntime());
    try {
      const design = await runDesignBenchmarkCases({ connection, actor, suite, adapter, runtime });
      const continuity = await runLongSessionProbe({ connection, actor, suite, adapter, runtime });
      const isolation = await runTaskIsolationProbe({ connection, actor, suite, adapter, runtime });
      const restart = await runRestartRecoveryProbe({
        openConnection: () => createDb(restartPath), actor, suite, adapter, runtime,
        freshProcessCheck: async (expectation) => {
          const stdout = execFileSync(process.execPath, [
            path.resolve("node_modules/tsx/dist/cli.mjs"),
            path.resolve("scripts/check-agent-runtime-restart.ts"),
            restartPath,
            actor.userId,
            expectation.taskId,
            expectation.conversationId,
            expectation.goalIncludes,
          ], { cwd: process.cwd(), encoding: "utf8" });
          return FreshProcessRecoveryResultSchema.parse(JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || "{}"));
        },
      });

      expect(design).toHaveLength(REQUIRED_DESIGN_CASE_COUNT);
      expect(design.filter(({ passed }) => !passed)).toEqual([]);
      expect(continuity).toMatchObject({ passed: true, observed: { turnCount: 20, briefFieldCount: 8 } });
      expect(isolation).toMatchObject({ passed: true, observed: { taskATurns: 2, taskBTurns: 2 } });
      expect(restart).toMatchObject({
        passed: true,
        observed: { taskRecovered: true, turnCount: 1, freshProcessBoundary: true },
      });
      expect(runtime.calls).toBe(36);
    } finally {
      connection.sqlite.close();
    }
  });
});

const REQUIRED_DESIGN_CASE_COUNT = 11;
