import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readEnv } from "@/lib/config/env";
import { parseServiceEnvironment } from "@/lib/operations/local-host";
import { seedDemoDatabase } from "@/scripts/seed-demo";

function requiredLocalAppData() {
  const value = process.env.LOCALAPPDATA?.trim();
  if (!value || !path.isAbsolute(value)) throw new Error("LOCALAPPDATA 不可用");
  return value;
}

function secret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function renderEnvironment(environment: Record<string, string>) {
  return `${Object.entries(environment).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

async function readExistingEnvironment(environmentPath: string) {
  try {
    return parseServiceEnvironment(await readFile(environmentPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function main() {
  const root = path.join(requiredLocalAppData(), "ChuyingAI");
  const configDirectory = path.join(root, "config");
  const dataDirectory = path.join(root, "data");
  const qualityDirectory = path.join(root, "quality");
  const evidenceRoot = path.join(dataDirectory, "evidence");
  const databasePath = path.join(dataDirectory, "competition-demo.sqlite");
  const environmentPath = path.join(configDirectory, "service.env");
  const accessInfoPath = path.join(configDirectory, "access-info.txt");
  await mkdir(configDirectory, { recursive: true });
  await mkdir(evidenceRoot, { recursive: true });
  await mkdir(qualityDirectory, { recursive: true });

  let environment = await readExistingEnvironment(environmentPath);
  if (!environment) {
    environment = {
      SESSION_SECRET: secret(),
      DATABASE_PATH: databasePath,
      EVIDENCE_ROOT: evidenceRoot,
      TEACHER_ACCESS_CODE: `teacher-${secret(15)}`,
      IDENTITY_CODE_PEPPER: secret(),
      AUTH_PROXY_SECRET: secret(),
      PUBLIC_APP_URL: "https://chuyingai.cc.cd",
      AGENT_V2_ENABLED: "true",
      ALLOW_QUICK_TUNNEL_ORIGIN: "true",
      ALLOW_DEMO_SEED: "false",
    };
    await writeFile(environmentPath, renderEnvironment(environment), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }

  if (environment.ALLOW_QUICK_TUNNEL_ORIGIN === undefined) {
    environment.ALLOW_QUICK_TUNNEL_ORIGIN = "true";
    await writeFile(environmentPath, renderEnvironment(environment), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  if (environment.AGENT_EVAL_REPORT_PATH === undefined) {
    environment.AGENT_EVAL_REPORT_PATH = path.join(qualityDirectory, "agent-eval-latest.json");
    await writeFile(environmentPath, renderEnvironment(environment), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  if (environment.AGENT_HARNESS_REPORT_PATH === undefined) {
    environment.AGENT_HARNESS_REPORT_PATH = path.join(qualityDirectory, "agent-harness-latest.json");
    await writeFile(environmentPath, renderEnvironment(environment), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  if (environment.AGENT_V2_ENABLED === undefined) {
    environment.AGENT_V2_ENABLED = "true";
    await writeFile(environmentPath, renderEnvironment(environment), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  readEnv({ ...environment, NODE_ENV: "production" });
  const demoAccess = await seedDemoDatabase({
    databasePath: environment.DATABASE_PATH,
    artworkRoot: environment.EVIDENCE_ROOT,
    identityCodePepper: environment.IDENTITY_CODE_PEPPER,
    allowDemoSeed: true,
    nodeEnv: "development",
  });

  const accessInfo = [
    "触映智能体·本机演示访问资料",
    "",
    `教师访问码：${environment.TEACHER_ACCESS_CODE}`,
    "演示班级码：DIGI2026",
    `演示匿名编号：${demoAccess.identityCodes.join("、")}`,
    `从诊断开始的互动体验编号：${demoAccess.starterIdentityCode}`,
    "",
    "以上均为竞赛演示资料，不代表真实学生成效。",
  ].join("\n");
  await writeFile(accessInfoPath, `${accessInfo}\n`, { encoding: "utf8", mode: 0o600 });

  console.log(JSON.stringify({
    ok: true,
    root,
    databasePath,
    evidenceRoot,
    environmentPath,
    accessInfoPath,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "本机服务初始化失败");
  process.exitCode = 1;
});
