import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const databasePath = path.resolve(argument("--database") ?? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite");
  const baseUrl = (argument("--base-url") ?? "http://localhost:3118").replace(/\/$/, "");
  const allowTeacherProbe = process.argv.includes("--allow-teacher-probe");
  const connection = createDb(databasePath);
  let actor: { id: string; role: "STUDENT" | "TEACHER" } | undefined;
  try {
    actor = connection.sqlite.prepare(
      `SELECT id,role FROM users
       WHERE role='STUDENT' OR (?=1 AND role='TEACHER')
       ORDER BY CASE role WHEN 'STUDENT' THEN 0 ELSE 1 END,id LIMIT 1`,
    ).get(allowTeacherProbe ? 1 : 0) as { id: string; role: "STUDENT" | "TEACHER" } | undefined;
  } finally { connection.sqlite.close(); }
  if (!actor) throw new Error("P2 Shadow 验证需要本地学生账号；可显式使用 --allow-teacher-probe 验证同一投影路由");
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET 未配置");
  const token = await issueSession({ userId: actor.id, role: actor.role }, secret);
  const response = await fetch(`${baseUrl}/api/inspiration/browse?q=${encodeURIComponent("版式")}`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
  const body = await response.json() as { items?: unknown[]; nextCursor?: unknown };
  const report = {
    schemaVersion: "lumi-inspiration-p2-student-shadow-http-verification/v1",
    baseUrl,
    actorRole: actor.role,
    status: response.status,
    itemCount: Array.isArray(body.items) ? body.items.length : null,
    nextCursor: body.nextCursor ?? null,
  };
  if (report.status !== 200 || report.itemCount !== 0 || report.nextCursor !== null) {
    throw new Error(`P2 Shadow 学生 HTTP 验证失败：${JSON.stringify(report)}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "P2_STUDENT_SHADOW_HTTP_VERIFICATION_FAILED");
  process.exitCode = 1;
});
