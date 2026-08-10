import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

type Environment = Record<string, string | undefined>;
type RecoveryCommandOptions = {
  leaseMs?: number;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
};

export async function runEvidenceRecovery(
  environment: Environment = process.env,
  recoveryOptions: RecoveryCommandOptions = {},
) {
  const runner = await import("./recover-evidence-runner");
  return runner.runEvidenceRecovery(environment, recoveryOptions);
}

function optionalDuration(environment: Environment, name: string, minimum: number) {
  const raw = environment[name];
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} 必须是整数毫秒`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} 超出允许范围`);
  return value;
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invoked) {
  const main = async () => {
    loadEnvConfig(process.cwd(), false);
    return runEvidenceRecovery(process.env, {
      leaseMs: optionalDuration(process.env, "EVIDENCE_RECOVERY_LEASE_MS", 3),
      waitTimeoutMs: optionalDuration(process.env, "EVIDENCE_RECOVERY_WAIT_TIMEOUT_MS", 0),
      pollIntervalMs: optionalDuration(process.env, "EVIDENCE_RECOVERY_POLL_INTERVAL_MS", 1),
    });
  };
  main().then((result) => {
    console.log(JSON.stringify({ ok: true, ...result }));
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "证据恢复失败");
    process.exitCode = 1;
  });
}
