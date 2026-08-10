import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { renderPilotObservationPacket } from "@/lib/services/pilot-observation";

function requiredLocalAppData() {
  const value = process.env.LOCALAPPDATA?.trim();
  if (!value || !path.isAbsolute(value)) throw new Error("LOCALAPPDATA 不可用");
  return value;
}

function participantCount() {
  const raw = process.env.PILOT_PARTICIPANT_COUNT?.trim() || "8";
  if (!/^\d{1,2}$/.test(raw)) throw new Error("PILOT_PARTICIPANT_COUNT 必须是 1—30 的整数");
  const value = Number(raw);
  if (value < 1 || value > 30) throw new Error("PILOT_PARTICIPANT_COUNT 必须是 1—30 的整数");
  return value;
}

async function main() {
  const now = new Date();
  const className = process.env.PILOT_CLASS_NAME?.trim();
  if (!className) throw new Error("PILOT_CLASS_NAME 不能为空");
  const count = participantCount();
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(scriptDirectory, "..", "docs", "templates", "pilot-observation-sheet.md");
  const packet = renderPilotObservationPacket(await readFile(templatePath, "utf8"), {
    className,
    participantCount: count,
    createdAt: now,
  });
  const outputDirectory = path.join(requiredLocalAppData(), "ChuyingAI", "pilot");
  await mkdir(outputDirectory, { recursive: true });
  const stamp = now.toISOString().replaceAll(":", "-").replace(".", "-");
  const observationFilePath = path.join(outputDirectory, `pilot-observation-${stamp}.md`);
  await writeFile(observationFilePath, packet, { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ ok: true, className, participantCount: count, observationFilePath }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "匿名观察包生成失败");
  process.exitCode = 1;
});
