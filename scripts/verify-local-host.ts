import { readFile } from "node:fs/promises";
import { request } from "node:http";
import path from "node:path";

import { parseServiceEnvironment } from "@/lib/operations/local-host";
import { assessCompetitionHealth } from "@/lib/operations/release-readiness";

type ProbeResult = {
  status: number;
  headers: import("node:http").IncomingHttpHeaders;
  body: string;
};

function requiredLocalAppData() {
  const value = process.env.LOCALAPPDATA?.trim();
  if (!value || !path.isAbsolute(value)) throw new Error("LOCALAPPDATA 不可用");
  return value;
}

function probe(options: {
  port: number;
  method?: string;
  route: string;
  headers?: Record<string, string>;
  body?: string;
}) {
  return new Promise<ProbeResult>((resolve, reject) => {
    const operation = request({
      hostname: "127.0.0.1",
      port: options.port,
      method: options.method ?? "GET",
      path: options.route,
      headers: options.headers,
      timeout: 10_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    operation.once("timeout", () => operation.destroy(new Error("本机服务验证超时")));
    operation.once("error", reject);
    operation.end(options.body);
  });
}

function authHeaders(origin: string, body: string) {
  return {
    host: "127.0.0.1:3100",
    origin,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
  };
}

async function main() {
  const environmentPath = process.env.CHUYING_SERVICE_ENV?.trim()
    || path.join(requiredLocalAppData(), "ChuyingAI", "config", "service.env");
  const environment = parseServiceEnvironment(await readFile(environmentPath, "utf8"));
  const studentBody = JSON.stringify({ classCode: "DIGI2026", alias: "7K9M-2Q4R-P8TX" });
  const teacherBody = JSON.stringify({ code: environment.TEACHER_ACCESS_CODE });
  const health = await probe({ port: 3100, route: "/api/health" });
  const direct = await probe({
    port: 3000,
    method: "POST",
    route: "/api/auth/student",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(studentBody)) },
    body: studentBody,
  });
  const student = await probe({
    port: 3100,
    method: "POST",
    route: "/api/auth/student",
    headers: authHeaders("http://127.0.0.1:3100", studentBody),
    body: studentBody,
  });
  const teacher = await probe({
    port: 3100,
    method: "POST",
    route: "/api/auth/teacher",
    headers: authHeaders("http://127.0.0.1:3100", teacherBody),
    body: teacherBody,
  });
  const crossOrigin = await probe({
    port: 3100,
    method: "POST",
    route: "/api/auth/student",
    headers: authHeaders("https://attacker.example", studentBody),
    body: studentBody,
  });
  const healthChecks = assessCompetitionHealth(JSON.parse(health.body) as unknown);
  const studentCookie = student.headers["set-cookie"]?.join(";") ?? "";
  const teacherCookie = teacher.headers["set-cookie"]?.join(";") ?? "";
  const checks = {
    healthStatus: health.status === 200 && healthChecks.statusOk,
    databaseAvailable: healthChecks.databaseAvailable,
    aiConfigured: healthChecks.aiConfigured,
    agentV2Enabled: healthChecks.agentV2Enabled,
    generalKnowledgeReady: healthChecks.generalKnowledgeReady,
    digitalKnowledgeReady: healthChecks.digitalKnowledgeReady,
    bookKnowledgeReady: healthChecks.bookKnowledgeReady,
    agentQualityPassed: healthChecks.agentQualityPassed,
    agentHarnessPassed: healthChecks.agentHarnessPassed,
    competitionReady: healthChecks.competitionReady,
    directUnsignedRejected: direct.status === 403,
    studentBrowserOriginAccepted: student.status === 200 && /Secure/i.test(studentCookie),
    teacherBrowserOriginAccepted: teacher.status === 200 && /Secure/i.test(teacherCookie),
    crossOriginRejected: crossOrigin.status === 403,
  };
  if (Object.values(checks).some((value) => !value)) throw new Error(`本机服务验证失败：${JSON.stringify(checks)}`);
  console.log(JSON.stringify({ ok: true, checks }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "本机服务验证失败");
  process.exitCode = 1;
});
