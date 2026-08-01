import { z } from "zod";

import { readEnv } from "@/lib/config/env";
import { createDb } from "@/lib/db/client";

import { executeAgentRun } from "./agent-run-executor";

type RuntimeEnvironment = Record<string, string | undefined>;
type ExecuteRun = typeof executeAgentRun;

const RecoveryLimitSchema = z.number().int().min(1).max(100);

export async function recoverPendingAgentRuns(
  environment: RuntimeEnvironment = process.env,
  options: {
    now?: Date;
    limit?: number;
    execute?: ExecuteRun;
  } = {},
) {
  const config = readEnv(environment);
  const connection = createDb(config.databasePath);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const limit = RecoveryLimitSchema.parse(options.limit ?? 20);
  let rows: Array<{ id: string }>;
  try {
    rows = connection.sqlite.prepare(`
      SELECT id FROM agent_runs
      WHERE status='QUEUED' OR (status='RUNNING' AND coalesce(lease_expires_at,0)<=?)
      ORDER BY created_at, rowid LIMIT ?
    `).all(nowSeconds, limit) as Array<{ id: string }>;
  } finally {
    connection.sqlite.close();
  }

  const execute = options.execute ?? executeAgentRun;
  let recovered = 0;
  let failed = 0;
  for (const { id } of rows) {
    try {
      const run = await execute(id, environment);
      if (["WAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) recovered += 1;
    } catch {
      failed += 1;
    }
  }
  return { found: rows.length, recovered, failed };
}
