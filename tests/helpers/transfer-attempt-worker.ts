import { access, writeFile } from "node:fs/promises";

import { createDb } from "../../lib/db/client";
import { submitTransferChallenge } from "../../lib/services/transfer";

async function main() {
  const [databasePath, readyPath, startPath, answerJson] = process.argv.slice(2);
  if (!databasePath || !readyPath || !startPath || !answerJson) throw new Error("missing transfer worker arguments");
  await writeFile(readyPath, "ready", "utf8");
  for (;;) {
    try { await access(startPath); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  const connection = createDb(databasePath);
  try {
    const state = await submitTransferChallenge(
      connection.db,
      { userId: "student-1", role: "STUDENT" },
      "project-1",
      { challengeRevision: 1, expectedAttempt: 0, answer: JSON.parse(answerJson) },
    );
    process.stdout.write(JSON.stringify({ ok: true, attemptsUsed: state.attemptsUsed }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, errorName: error instanceof Error ? error.name : "UnknownError" }));
  } finally {
    connection.sqlite.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
