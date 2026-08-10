import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { createDb } from "@/lib/db/client";
import { parseServiceEnvironment } from "@/lib/operations/local-host";
import { renderPilotObservationPacket } from "@/lib/services/pilot-observation";
import { preparePilotClass } from "@/lib/services/pilot-provisioning";

function requiredLocalAppData() {
  const value = process.env.LOCALAPPDATA?.trim();
  if (!value || !path.isAbsolute(value)) throw new Error("LOCALAPPDATA 不可用");
  return value;
}

async function requiredConfiguration() {
  loadEnvConfig(process.cwd());
  if (process.env.PILOT_USE_PROJECT_ENV === "true" && process.env.DATABASE_PATH?.trim() && process.env.IDENTITY_CODE_PEPPER?.trim()) {
    return { databasePath: process.env.DATABASE_PATH.trim(), identityCodePepper: process.env.IDENTITY_CODE_PEPPER.trim() };
  }
  const environmentPath = path.join(requiredLocalAppData(), "ChuyingAI", "config", "service.env");
  try {
    const environment = parseServiceEnvironment(await readFile(environmentPath, "utf8"));
    if (!environment.DATABASE_PATH || !environment.IDENTITY_CODE_PEPPER) throw new Error("本机服务缺少试用班配置");
    return { databasePath: environment.DATABASE_PATH, identityCodePepper: environment.IDENTITY_CODE_PEPPER };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (process.env.DATABASE_PATH?.trim() && process.env.IDENTITY_CODE_PEPPER?.trim()) {
    return { databasePath: process.env.DATABASE_PATH.trim(), identityCodePepper: process.env.IDENTITY_CODE_PEPPER.trim() };
  }
  throw new Error("未找到本机服务或项目试用班配置");
}

function participantCount() {
  const raw = process.env.PILOT_PARTICIPANT_COUNT?.trim() || "8";
  if (!/^\d{1,2}$/.test(raw)) throw new Error("PILOT_PARTICIPANT_COUNT 必须是 1—30 的整数");
  const value = Number(raw);
  if (value < 1 || value > 30) throw new Error("PILOT_PARTICIPANT_COUNT 必须是 1—30 的整数");
  return value;
}

async function main() {
  const configuration = await requiredConfiguration();
  const now = new Date();
  const className = process.env.PILOT_CLASS_NAME?.trim() || `触映真实试用 ${now.toISOString().slice(0, 10)}`;
  const count = participantCount();
  const outputDirectory = path.join(requiredLocalAppData(), "ChuyingAI", "pilot");
  const stamp = now.toISOString().replaceAll(":", "-").replace(".", "-");
  const accessFilePath = path.join(outputDirectory, `pilot-access-${stamp}.txt`);
  const observationFilePath = path.join(outputDirectory, `pilot-observation-${stamp}.md`);
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const observationTemplatePath = path.resolve(scriptDirectory, "..", "docs", "templates", "pilot-observation-sheet.md");
  const observationPacket = renderPilotObservationPacket(await readFile(observationTemplatePath, "utf8"), {
    className,
    participantCount: count,
    createdAt: now,
  });

  const connection = createDb(configuration.databasePath);
  let result;
  try {
    result = preparePilotClass(connection, {
      className, participantCount: count, identityCodePepper: configuration.identityCodePepper, now,
    });
  } finally { connection.sqlite.close(); }

  await mkdir(outputDirectory, { recursive: true });
  const body = [
    "触映真实试用访问资料（不得公开或提交 Git）", "",
    `试用班：${result.className}`, `班级码：${result.classAccessCode}`, `创建时间：${result.createdAt}`, "",
    "匿名编号（每名学生仅发放一个）：",
    ...result.identityCodes.map((code, index) => `${String(index + 1).padStart(2, "0")}：${code}`),
    "", "使用说明：学生在首页选择学生身份，输入班级码和自己的匿名编号。首次登录会自动建立真实 DIAGNOSTIC 项目。",
    "完成后把编号与匿名观察表对应保存；不要在截图、录屏、报告或聊天中展示完整编号。", "",
  ].join("\n");
  await writeFile(accessFilePath, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await writeFile(observationFilePath, observationPacket, { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({
    ok: true,
    className: result.className,
    participantCount: result.participantCount,
    accessFilePath,
    observationFilePath,
  }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "真实试用班创建失败");
  process.exitCode = 1;
});
