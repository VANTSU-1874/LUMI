import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import {
  discardStoredAgentArtwork,
  loadStoredAgentArtworkForRecovery,
  storeAgentArtwork,
  type PreparedAgentArtwork,
  type StoredAgentArtwork,
} from "@/lib/agent/artwork-attachment";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

type CountRow = { count: number };
type DataType = "REAL" | "DEMONSTRATION_DATA";
type ResetArtworkRow = StoredAgentArtwork & { taskId: string };
type ProvenanceMismatchRow = { relation: string; id: string };
type ResetDemoAgentHistoryOptions = {
  artworkRoot: string;
  faultInjection?: {
    beforeArtworkDelete?: (index: number) => void | Promise<void>;
    beforeCommit?: () => void | Promise<void>;
  };
};

function count(connection: DatabaseConnection, sql: string) {
  return (connection.sqlite.prepare(sql).get() as CountRow).count;
}

function countsByDataType(connection: DatabaseConnection, dataType: DataType) {
  const value = `'${dataType}'`;
  return {
    conversations: count(connection, `SELECT count(*) count FROM agent_conversations WHERE data_type=${value}`),
    turns: count(connection, `SELECT count(*) count FROM agent_turns WHERE data_type=${value}`),
    actions: count(connection, `SELECT count(*) count FROM agent_actions WHERE data_type=${value}`),
    reviews: count(connection, `SELECT count(*) count FROM agent_decision_reviews WHERE data_type=${value}`),
    toolCalls: count(connection, `SELECT count(*) count FROM agent_tool_calls WHERE data_type=${value}`),
    steps: count(connection, `SELECT count(*) count FROM agent_steps WHERE data_type=${value}`),
    runtimeEvents: count(connection, `SELECT count(*) count FROM agent_runtime_events WHERE data_type=${value}`),
    attachments: count(connection, `SELECT count(*) count FROM agent_artwork_attachments WHERE data_type=${value}`),
    critiques: count(connection, `SELECT count(*) count FROM agent_critiques WHERE data_type=${value}`),
    memories: count(connection, `SELECT count(*) count FROM agent_student_memory WHERE data_type=${value}`),
    summaries: count(connection, `SELECT count(*) count FROM agent_session_summaries WHERE data_type=${value}`),
  };
}

function findProvenanceMismatch(connection: DatabaseConnection) {
  return connection.sqlite.prepare(`
    SELECT relation, id FROM (
      SELECT 'conversation-turn' relation, t.id id
      FROM agent_turns t
      JOIN agent_conversations c ON c.id=t.conversation_id
      WHERE c.data_type<>t.data_type
      UNION ALL
      SELECT 'turn-action', a.id
      FROM agent_actions a JOIN agent_turns t ON t.id=a.turn_id
      WHERE a.data_type<>t.data_type
      UNION ALL
      SELECT 'turn-tool-call', tc.id
      FROM agent_tool_calls tc JOIN agent_turns t ON t.id=tc.turn_id
      WHERE tc.data_type<>t.data_type
      UNION ALL
      SELECT 'turn-step', s.id
      FROM agent_steps s JOIN agent_turns t ON t.id=s.turn_id
      WHERE s.data_type<>t.data_type
      UNION ALL
      SELECT 'turn-runtime-event', e.id
      FROM agent_runtime_events e JOIN agent_turns t ON t.id=e.turn_id
      WHERE e.data_type<>t.data_type
      UNION ALL
      SELECT 'turn-review', r.id
      FROM agent_decision_reviews r JOIN agent_turns t ON t.id=r.turn_id
      WHERE r.data_type<>t.data_type
      UNION ALL
      SELECT 'turn-artwork', a.id
      FROM agent_artwork_attachments a JOIN agent_turns t ON t.id=a.turn_id
      WHERE a.data_type<>t.data_type
      UNION ALL
      SELECT 'artwork-critique', c.id
      FROM agent_critiques c JOIN agent_artwork_attachments a ON a.id=c.artwork_id
      WHERE c.data_type<>a.data_type OR c.turn_id<>a.turn_id
      UNION ALL
      SELECT 'turn-summary', s.task_id
      FROM agent_session_summaries s JOIN agent_turns t ON t.id=s.through_turn_id
      WHERE s.data_type<>t.data_type
      UNION ALL
      SELECT 'turn-memory', m.id
      FROM agent_student_memory m JOIN agent_turns t ON t.id=m.source_turn_id
      WHERE m.data_type<>t.data_type
    )
    LIMIT 1
  `).get() as ProvenanceMismatchRow | undefined;
}

export async function resetDemoAgentHistory(
  connection: DatabaseConnection,
  options: ResetDemoAgentHistoryOptions,
) {
  let transactionActive = false;
  const attemptedArtworkDeletes: Array<{ row: ResetArtworkRow; prepared: PreparedAgentArtwork }> = [];
  try {
    connection.sqlite.exec("BEGIN IMMEDIATE");
    transactionActive = true;
    const provenanceMismatch = findProvenanceMismatch(connection);
    if (provenanceMismatch) {
      throw new Error(`DEMO_AGENT_RESET_CROSS_PROVENANCE:${provenanceMismatch.relation}:${provenanceMismatch.id}`);
    }
    const demoArtworks = connection.sqlite.prepare(`
      SELECT id, task_id taskId, mime_type mimeType, storage_path storagePath, digest,
        byte_size byteSize, width, height
      FROM agent_artwork_attachments WHERE data_type='DEMONSTRATION_DATA'
      ORDER BY id
    `).all() as ResetArtworkRow[];
    const demonstration = countsByDataType(connection, "DEMONSTRATION_DATA");
    const realBefore = countsByDataType(connection, "REAL");

    const recoverableArtworks = new Map<string, PreparedAgentArtwork>();
    for (const artwork of demoArtworks) {
      const prepared = await loadStoredAgentArtworkForRecovery(options.artworkRoot, artwork);
      if (prepared) recoverableArtworks.set(artwork.id, prepared);
    }
    for (const [index, artwork] of demoArtworks.entries()) {
      const prepared = recoverableArtworks.get(artwork.id);
      if (prepared) attemptedArtworkDeletes.push({ row: artwork, prepared });
      await options.faultInjection?.beforeArtworkDelete?.(index);
      await discardStoredAgentArtwork(options.artworkRoot, artwork);
    }
    connection.sqlite.prepare("DELETE FROM agent_session_summaries WHERE data_type='DEMONSTRATION_DATA'").run();
    connection.sqlite.prepare("DELETE FROM agent_student_memory WHERE data_type='DEMONSTRATION_DATA'").run();
    connection.sqlite.prepare("DELETE FROM agent_conversations WHERE data_type='DEMONSTRATION_DATA'").run();
    const realAfter = countsByDataType(connection, "REAL");
    if (JSON.stringify(realBefore) !== JSON.stringify(realAfter)) {
      throw new Error("DEMO_AGENT_RESET_TOUCHED_REAL_DATA");
    }
    await options.faultInjection?.beforeCommit?.();
    connection.sqlite.exec("COMMIT");
    transactionActive = false;
    return {
      removed: { ...demonstration, privateArtworkFiles: recoverableArtworks.size },
      realPreserved: realAfter,
    };
  } catch (error) {
    const restoreErrors: unknown[] = [];
    for (const { row, prepared } of attemptedArtworkDeletes.reverse()) {
      try {
        const current = await loadStoredAgentArtworkForRecovery(options.artworkRoot, row);
        if (!current) await storeAgentArtwork(options.artworkRoot, row.taskId, prepared);
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
    }
    if (transactionActive) connection.sqlite.exec("ROLLBACK");
    if (restoreErrors.length > 0) {
      throw new AggregateError([error, ...restoreErrors], "DEMO_AGENT_RESET_RESTORE_FAILED");
    }
    throw error;
  }
}

export async function runDemoAgentHistoryReset(environment = process.env) {
  if (environment.ALLOW_DEMO_AGENT_RESET !== "true") {
    throw new Error("ALLOW_DEMO_AGENT_RESET=true is required");
  }
  const config = readEnv(environment);
  const databasePath = path.resolve(config.databasePath);
  if (!/(^|[\\/_-])(demo|dev|test)([\\/_.-]|$)/i.test(databasePath)) {
    throw new Error("Demo agent reset requires a database path explicitly marked demo, dev, or test");
  }
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  try {
    return await resetDemoAgentHistory(connection, { artworkRoot: config.evidenceRoot });
  } finally {
    connection.sqlite.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  void runDemoAgentHistoryReset().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
