import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { createDb } from "@/lib/db/client";
import { readTeacherReleaseReadiness } from "@/lib/services/inspiration-wiki-release-readiness";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const databasePath = path.resolve(argument("--database") ?? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite");
  const outputPath = path.resolve(argument("--output") ?? "./data/inspiration-wiki/release-readiness/d23-release-readiness-audit.json");
  const connection = createDb(databasePath);
  try {
    const teachers = connection.sqlite.prepare("SELECT id FROM users WHERE role='TEACHER' ORDER BY id").all() as Array<{ id: string }>;
    if (teachers.length !== 1) throw new Error(`发布准备审计要求恰好 1 个教师账号，当前为 ${teachers.length}`);
    const audit = readTeacherReleaseReadiness(connection, { userId: teachers[0]!.id, role: "TEACHER" });
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ outputPath, total: audit.meta.total, eligible: audit.meta.eligible, blocked: audit.meta.blocked, rightsUnknown: audit.meta.rightsUnknown, boundary: audit.meta.boundary }, null, 2));
  } finally { connection.sqlite.close(); }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "INSPIRATION_RELEASE_READINESS_AUDIT_FAILED");
  process.exitCode = 1;
});
