import { createDb } from "../../lib/db/client";
import { recoverEvidenceStorage } from "../../lib/services/evidence-recovery";

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing recovery process test environment: ${name}`);
  return value;
}

const databasePath = requiredEnvironment("TEST_DATABASE_PATH");
const root = requiredEnvironment("TEST_EVIDENCE_ROOT");
const holdMs = Number(process.env.TEST_HOLD_MS ?? "0");
async function main() {
  const connection = createDb(databasePath);
  try {
    const result = await recoverEvidenceStorage(connection, {
      root,
      afterLockAcquired: holdMs > 0
        ? () => new Promise<void>((resolve) => setTimeout(resolve, holdMs))
        : undefined,
    });
    process.stdout.write(JSON.stringify(result));
  } finally {
    connection.sqlite.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
