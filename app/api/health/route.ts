import Database from "better-sqlite3";
import path from "node:path";
import { NextResponse } from "next/server";

import { CURRENT_AGENT_EVAL_SUITE_VERSION, readAgentQualityGate } from "@/lib/agent/evaluation";
import { readAgentHarnessGate } from "@/lib/agent/harness";
import { readEnv } from "@/lib/config/env";
import { healthCache, type PublicHealth } from "./state";

const PUBLIC_HEADERS = { "Cache-Control": "no-store" };
const HEALTH_BUSY_TIMEOUT_MS = 20;
const HEALTHY_TTL_MS = 5_000;
const DEGRADED_TTL_MS = 1_000;
const MAX_CACHE_ENTRIES = 32;

function cacheKey(
  databasePath: string,
  aiConfigured: boolean,
  agentV2Enabled: boolean,
  qualityReportPath: string,
  harnessReportPath: string,
) {
  return `${path.resolve(databasePath)}\0${aiConfigured ? "ai" : "no-ai"}\0${agentV2Enabled ? "v2" : "legacy"}\0${path.resolve(qualityReportPath)}\0${path.resolve(harnessReportPath)}`;
}

function rememberHealth(key: string, payload: PublicHealth, now: number) {
  if (healthCache.size >= MAX_CACHE_ENTRIES && !healthCache.has(key)) {
    const oldestKey = healthCache.keys().next().value as string | undefined;
    if (oldestKey) healthCache.delete(oldestKey);
  }
  healthCache.set(key, {
    payload,
    expiresAt: now + (payload.status === "ok" ? HEALTHY_TTL_MS : DEGRADED_TTL_MS),
  });
  return payload;
}

function unavailableAgentQuality(): PublicHealth["agentQuality"] {
  return {
    status: "not_run",
    suiteVersion: null,
    evaluatedAt: null,
    caseCount: null,
    passedCaseCount: null,
    modelAssistedRate: null,
    metrics: null,
  };
}

function publicAgentQuality(reportPath: string): PublicHealth["agentQuality"] {
  const quality = readAgentQualityGate(reportPath, { expectedSuiteVersion: CURRENT_AGENT_EVAL_SUITE_VERSION });
  return {
    status: quality.status,
    suiteVersion: quality.report?.suiteVersion ?? null,
    evaluatedAt: quality.report?.evaluatedAt ?? null,
    caseCount: quality.report?.caseCount ?? null,
    passedCaseCount: quality.report?.passedCaseCount ?? null,
    modelAssistedRate: quality.report?.modelAssistedRate ?? null,
    metrics: quality.report?.metrics ?? null,
  };
}

function unavailableAgentHarness(): PublicHealth["agentHarness"] {
  return {
    status: "not_run",
    harnessVersion: null,
    evaluatedAt: null,
    caseCount: null,
    passedCaseCount: null,
  };
}

function publicAgentHarness(reportPath: string): PublicHealth["agentHarness"] {
  const harness = readAgentHarnessGate(reportPath);
  return {
    status: harness.status,
    harnessVersion: harness.report?.harnessVersion ?? null,
    evaluatedAt: harness.report?.evaluatedAt ?? null,
    caseCount: harness.report?.caseCount ?? null,
    passedCaseCount: harness.report?.passedCaseCount ?? null,
  };
}

function degradedHealth(aiConfigured: boolean, agentV2Enabled = false, databaseAvailable = false): PublicHealth {
  return {
    status: "degraded",
    database: { available: databaseAvailable },
    knowledge: {
      chunkCount: null,
      coursePacks: {
        "general-design@1": null,
        "digital-interaction@1": null,
        "book-design@1": null,
      },
    },
    aiConfigured,
    agentV2Enabled,
    agentQuality: unavailableAgentQuality(),
    agentHarness: unavailableAgentHarness(),
    competitionReady: false,
  };
}

function readPublicHealth(
  environment: Record<string, string | undefined> = process.env,
): PublicHealth {
  let config: ReturnType<typeof readEnv>;
  try {
    config = readEnv(environment);
  } catch {
    return degradedHealth(false);
  }

  const qualityReportPath = environment.AGENT_EVAL_REPORT_PATH?.trim() || path.resolve(".runtime/agent-eval/latest.json");
  const harnessReportPath = environment.AGENT_HARNESS_REPORT_PATH?.trim() || path.resolve(".runtime/agent-harness/latest.json");
  const key = cacheKey(
    config.databasePath,
    config.ai.enabled,
    config.agentV2Enabled,
    qualityReportPath,
    harnessReportPath,
  );
  const now = Date.now();
  const cached = healthCache.get(key);
  if (cached && cached.expiresAt > now) return cached.payload;
  if (cached) healthCache.delete(key);

  let sqlite: Database.Database | undefined;
  let databaseAvailable = false;
  try {
    sqlite = new Database(path.resolve(config.databasePath), {
      readonly: true,
      fileMustExist: true,
      timeout: HEALTH_BUSY_TIMEOUT_MS,
    });
    sqlite.pragma("query_only = ON");
    sqlite.pragma(`busy_timeout = ${HEALTH_BUSY_TIMEOUT_MS}`);
    const ping = sqlite.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    if (ping?.ok !== 1) return rememberHealth(key, degradedHealth(config.ai.enabled, config.agentV2Enabled), now);
    databaseAvailable = true;

    const row = sqlite.prepare("SELECT count(*) AS count FROM knowledge_chunks").get() as
      | { count: number }
      | undefined;
    const chunkCount = row?.count;
    if (!Number.isSafeInteger(chunkCount) || (chunkCount ?? -1) < 0) {
      return rememberHealth(key, degradedHealth(config.ai.enabled, config.agentV2Enabled, true), now);
    }
    const packRows = sqlite.prepare(`
      SELECT course_pack_id coursePackId, course_pack_version coursePackVersion, count(*) count
      FROM knowledge_chunks GROUP BY course_pack_id, course_pack_version
    `).all() as Array<{ coursePackId: string; coursePackVersion: string; count: number }>;
    const packCounts = new Map(packRows.map((row) => [`${row.coursePackId}@${row.coursePackVersion}`, row.count]));
    const generalCount = packCounts.get("general-design@1") ?? 0;
    const digitalCount = packCounts.get("digital-interaction@1") ?? 0;
    const bookCount = packCounts.get("book-design@1") ?? 0;
    const agentQuality = publicAgentQuality(qualityReportPath);
    const agentHarness = publicAgentHarness(harnessReportPath);
    return rememberHealth(key, {
      status: "ok",
      database: { available: true },
      knowledge: {
        chunkCount: chunkCount as number,
        coursePacks: {
          "general-design@1": generalCount,
          "digital-interaction@1": digitalCount,
          "book-design@1": bookCount,
        },
      },
      aiConfigured: config.ai.enabled,
      agentV2Enabled: config.agentV2Enabled,
      agentQuality,
      agentHarness,
      competitionReady: config.ai.enabled && config.agentV2Enabled
        && generalCount > 0 && digitalCount > 0 && bookCount > 0
        && agentQuality.status === "passed" && agentHarness.status === "passed",
    }, now);
  } catch {
    return rememberHealth(key, degradedHealth(config.ai.enabled, config.agentV2Enabled, databaseAvailable), now);
  } finally {
    sqlite?.close();
  }
}

export async function GET() {
  const payload = readPublicHealth(process.env);
  return NextResponse.json(payload, {
    status: payload.status === "ok" ? 200 : 503,
    headers: PUBLIC_HEADERS,
  });
}
