import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { createDb } from "@/lib/db/client";
import { parseServiceEnvironment } from "@/lib/operations/local-host";
import {
  assessPilotPreflight,
  readPilotClassPreflightSnapshot,
  readPilotMaterialSnapshot,
  type PilotHealthProbe,
} from "@/lib/services/pilot-preflight";

function requiredLocalAppData() {
  const value = process.env.LOCALAPPDATA?.trim();
  if (!value || !path.isAbsolute(value)) throw new Error("LOCALAPPDATA 不可用");
  return value;
}

function expectedParticipantCount() {
  const raw = process.env.PILOT_PARTICIPANT_COUNT?.trim();
  if (!raw) return undefined;
  if (!/^\d{1,2}$/.test(raw)) throw new Error("PILOT_PARTICIPANT_COUNT 必须是 1—30 的整数");
  const value = Number(raw);
  if (value < 1 || value > 30) throw new Error("PILOT_PARTICIPANT_COUNT 必须是 1—30 的整数");
  return value;
}

async function probeHealth(baseUrl: string | undefined, requireHttps: boolean): Promise<PilotHealthProbe> {
  if (!baseUrl?.trim()) return { configured: false, https: false, reachable: false, competitionReady: false };
  let url: URL;
  try {
    url = new URL("/api/health", baseUrl.trim());
  } catch {
    return { configured: true, https: false, reachable: false, competitionReady: false };
  }
  const https = url.protocol === "https:";
  if (!https && requireHttps) return { configured: true, https: false, reachable: false, competitionReady: false };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const body = await response.json() as { competitionReady?: unknown };
    return {
      configured: true,
      https,
      reachable: response.ok,
      competitionReady: body.competitionReady === true,
    };
  } catch {
    return { configured: true, https, reachable: false, competitionReady: false };
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  const className = process.env.PILOT_CLASS_NAME?.trim();
  if (!className) throw new Error("PILOT_CLASS_NAME 不能为空");
  const localRoot = path.join(requiredLocalAppData(), "ChuyingAI");
  const serviceEnvironmentPath = path.join(localRoot, "config", "service.env");
  const serviceEnvironment = parseServiceEnvironment(await readFile(serviceEnvironmentPath, "utf8"));
  if (!serviceEnvironment.DATABASE_PATH) throw new Error("本机服务缺少数据库配置");
  const connection = createDb(serviceEnvironment.DATABASE_PATH);
  let classSnapshot;
  try {
    classSnapshot = readPilotClassPreflightSnapshot(connection, className);
  } finally {
    connection.sqlite.close();
  }
  const [materials, localHealth, publicHealth] = await Promise.all([
    readPilotMaterialSnapshot(path.join(localRoot, "pilot"), className),
    probeHealth("http://127.0.0.1:3100", false),
    probeHealth(process.env.PILOT_PUBLIC_URL?.trim() || serviceEnvironment.PUBLIC_APP_URL, true),
  ]);
  const assessment = assessPilotPreflight({
    classSnapshot,
    materials,
    localHealth,
    publicHealth,
    expectedParticipantCount: expectedParticipantCount(),
  });
  console.log(JSON.stringify(assessment));
  if (!assessment.ok) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "真实试用预检失败");
  process.exitCode = 1;
});
