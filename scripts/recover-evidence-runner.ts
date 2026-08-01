import { readEnv } from "../lib/config/env";
import { createDb } from "../lib/db/client";
import { recoverEvidenceStorage } from "../lib/services/evidence-recovery";

type Environment = Record<string, string | undefined>;
export type RecoveryCommandOptions = Pick<
  Parameters<typeof recoverEvidenceStorage>[1],
  "leaseMs" | "waitTimeoutMs" | "pollIntervalMs"
>;

export async function runEvidenceRecovery(
  environment: Environment,
  recoveryOptions: RecoveryCommandOptions = {},
) {
  const config = readEnv(environment);
  const connection = createDb(config.databasePath);
  try {
    return await recoverEvidenceStorage(connection, {
      root: config.evidenceRoot,
      ...recoveryOptions,
    });
  } finally {
    connection.sqlite.close();
  }
}
