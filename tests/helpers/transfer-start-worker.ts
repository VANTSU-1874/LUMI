import { access, writeFile } from "node:fs/promises";

import { createDb } from "../../lib/db/client";
import { getOrCreateTransferChallenge } from "../../lib/services/transfer";

async function main() {
  const [databasePath, readyPath, startPath] = process.argv.slice(2);
  if (!databasePath || !readyPath || !startPath) throw new Error("missing transfer start worker arguments");
  await writeFile(readyPath, "ready", "utf8");
  for (;;) {
    try { await access(startPath); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  const connection = createDb(databasePath);
  try {
    const result = getOrCreateTransferChallenge(connection.db, { userId: "student-1", role: "STUDENT" }, "project-1");
    process.stdout.write(JSON.stringify({ revision: result.challenge.challengeRevision }));
  } finally {
    connection.sqlite.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
