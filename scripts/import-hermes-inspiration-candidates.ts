import path from "node:path";

import { createDb } from "../lib/db/client";
import { runMigrations } from "../lib/db/migrate";
import { validateLegacyHermesHandoffV1 } from "../lib/domain/inspiration-wiki/legacy-hermes-handoff-v1";
import { persistValidatedLegacyHermesBatch } from "../lib/services/inspiration-wiki-hermes-intake";

const argumentsList = process.argv.slice(2).filter((value) => value !== "--");

function argument(name: string) {
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
}

async function main() {
  const handoffDirectory = argumentsList.find((value) => !value.startsWith("--") && value !== argument("--database"));
  if (!handoffDirectory || handoffDirectory.startsWith("--")) {
    throw new Error("Usage: pnpm inspiration:hermes:import -- <handoff-directory> [--database <sqlite-path>]");
  }
  const databasePath = path.resolve(argument("--database") ?? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite");

  // D-18 requires the immutable package to pass every mechanical gate before the first DB write.
  const handoff = await validateLegacyHermesHandoffV1(path.resolve(handoffDirectory));
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  try {
    const admissionsBefore = connection.sqlite.prepare("SELECT count(*) AS count FROM inspiration_admissions").get() as { count: number };
    const result = persistValidatedLegacyHermesBatch(connection, handoff);
    const admissionsAfter = connection.sqlite.prepare("SELECT count(*) AS count FROM inspiration_admissions").get() as { count: number };
    if (admissionsAfter.count !== admissionsBefore.count) throw new Error("D18_ADMISSION_BOUNDARY_VIOLATED");
    const boundary = connection.sqlite.prepare(
      `SELECT count(*) AS total,
        sum(case when student_visible = 0 and scope = 'PRIVATE_CANDIDATE'
          and wiki_draft = 'NOT_CREATED' and current_page = 'DISABLED'
          and r2 = 'DISABLED' and embedding = 'DISABLED' and lumi_retrieval = 'DISABLED'
          then 1 else 0 end) AS private_count,
        sum(case when contract_state = 'V1_UPGRADE_REQUIRED' then 1 else 0 end) AS upgrade_required
       FROM inspiration_wiki_hermes_candidates WHERE batch_id = ?`,
    ).get(handoff.manifest.batchId) as { total: number; private_count: number; upgrade_required: number };
    if (boundary.total !== boundary.private_count || boundary.total !== boundary.upgrade_required) {
      throw new Error("D18_PRIVATE_CANDIDATE_BOUNDARY_VIOLATED");
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      ...result,
      failures: handoff.failures.length,
      packageDigest: handoff.done.packageDigest,
      contractState: "V1_UPGRADE_REQUIRED",
      studentVisible: false,
      admissionsDelta: admissionsAfter.count - admissionsBefore.count,
      disabledCapabilities: ["CURRENT_PAGE", "R2", "EMBEDDING", "LUMI_RETRIEVAL"],
    }, null, 2)}\n`);
  } finally {
    connection.sqlite.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "HERMES_IMPORT_FAILED" })}\n`);
  process.exitCode = 1;
});
