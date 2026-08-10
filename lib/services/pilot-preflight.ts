import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { DatabaseConnection } from "@/lib/db/client";

const PilotClassNameSchema = z.string().trim().min(2).max(80);
const ExpectedParticipantCountSchema = z.number().int().min(1).max(30).optional();
const IDENTITY_CODE_PATTERN = /[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}/g;
const ACCESS_IDENTITY_LINE_PATTERN = /^\d{2}：[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}$/gm;
const OBSERVATION_SHEET_PATTERN = /真实试用匿名观察表（试用序号 \d{2}）/g;

export type PilotClassPreflightSnapshot = {
  classId: string;
  className: string;
  moduleCount: number;
  totalHours: number;
  assignmentCount: number;
  issuedIdentityCount: number;
  claimedIdentityCount: number;
  studentCount: number;
  projectCount: number;
};

export type PilotMaterialSnapshot = {
  accessFilePath: string | null;
  observationFilePath: string | null;
  accessIdentityCount: number;
  observationSheetCount: number;
  observationPrivateCodeCount: number;
  observationClassCodeCount: number;
};

export type PilotHealthProbe = {
  configured: boolean;
  https: boolean;
  reachable: boolean;
  competitionReady: boolean;
};

export type PilotPreflightCheck = {
  code: "COURSE_STRUCTURE" | "IDENTITY_CAPACITY" | "IDENTITY_CLAIMS" | "PROJECT_OWNERSHIP"
    | "PRIVATE_ACCESS_FILE" | "ANONYMOUS_OBSERVATION_PACKET" | "LOCAL_SERVICE" | "PUBLIC_HTTPS";
  passed: boolean;
  detail: string;
};

function countRow(row: unknown, key: string) {
  const value = (row as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`试用预检读取到无效计数：${key}`);
  }
  return value;
}

export function readPilotClassPreflightSnapshot(
  connection: DatabaseConnection,
  rawClassName: string,
): PilotClassPreflightSnapshot {
  const className = PilotClassNameSchema.parse(rawClassName);
  const matches = connection.sqlite.prepare("SELECT id,name FROM classes WHERE name=? ORDER BY id").all(className) as Array<{
    id: string;
    name: string;
  }>;
  if (matches.length === 0) throw new Error("未找到指定真实试用班");
  if (matches.length > 1) throw new Error("存在同名试用班，必须先在教师端确认正确班级");
  const selected = matches[0]!;
  const moduleStats = connection.sqlite.prepare(`
    SELECT count(*) moduleCount,coalesce(sum(hours),0) totalHours FROM course_modules WHERE class_id=?
  `).get(selected.id);
  const assignmentStats = connection.sqlite.prepare("SELECT count(*) assignmentCount FROM assignments WHERE class_id=?").get(selected.id);
  const identityStats = connection.sqlite.prepare(`
    SELECT count(*) issuedIdentityCount,
      coalesce(sum(case when claimed_user_id is not null then 1 else 0 end),0) claimedIdentityCount
    FROM student_identity_codes WHERE class_id=?
  `).get(selected.id);
  const studentStats = connection.sqlite.prepare(`
    SELECT count(*) studentCount FROM users WHERE class_id=? AND role='STUDENT'
  `).get(selected.id);
  const projectStats = connection.sqlite.prepare("SELECT count(*) projectCount FROM projects WHERE class_id=?").get(selected.id);

  return {
    classId: selected.id,
    className: selected.name,
    moduleCount: countRow(moduleStats, "moduleCount"),
    totalHours: countRow(moduleStats, "totalHours"),
    assignmentCount: countRow(assignmentStats, "assignmentCount"),
    issuedIdentityCount: countRow(identityStats, "issuedIdentityCount"),
    claimedIdentityCount: countRow(identityStats, "claimedIdentityCount"),
    studentCount: countRow(studentStats, "studentCount"),
    projectCount: countRow(projectStats, "projectCount"),
  };
}

async function newestMatchingFile(directory: string, prefix: string, expectedLine: string) {
  let names: string[];
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  for (const name of names) {
    const filePath = path.join(directory, name);
    const content = await readFile(filePath, "utf8");
    if (content.split(/\r?\n/).includes(expectedLine)) return { filePath, content };
  }
  return null;
}

export async function readPilotMaterialSnapshot(directory: string, rawClassName: string): Promise<PilotMaterialSnapshot> {
  if (!path.isAbsolute(directory)) throw new Error("试用材料目录必须是绝对路径");
  const className = PilotClassNameSchema.parse(rawClassName);
  const [access, observation] = await Promise.all([
    newestMatchingFile(directory, "pilot-access-", `试用班：${className}`),
    newestMatchingFile(directory, "pilot-observation-", `- 试用班：${className}`),
  ]);
  return {
    accessFilePath: access?.filePath ?? null,
    observationFilePath: observation?.filePath ?? null,
    accessIdentityCount: access ? (access.content.match(ACCESS_IDENTITY_LINE_PATTERN) ?? []).length : 0,
    observationSheetCount: observation ? (observation.content.match(OBSERVATION_SHEET_PATTERN) ?? []).length : 0,
    observationPrivateCodeCount: observation ? (observation.content.match(IDENTITY_CODE_PATTERN) ?? []).length : 0,
    observationClassCodeCount: observation ? (observation.content.match(/班级码：/g) ?? []).length : 0,
  };
}

export function assessPilotPreflight(input: {
  classSnapshot: PilotClassPreflightSnapshot;
  materials: PilotMaterialSnapshot;
  localHealth: PilotHealthProbe;
  publicHealth: PilotHealthProbe;
  expectedParticipantCount?: number;
}) {
  const expectedParticipantCount = ExpectedParticipantCountSchema.parse(input.expectedParticipantCount);
  const cohortExpected = expectedParticipantCount
    ? input.classSnapshot.issuedIdentityCount === expectedParticipantCount
    : input.classSnapshot.issuedIdentityCount >= 5 && input.classSnapshot.issuedIdentityCount <= 8;
  const checks: PilotPreflightCheck[] = [
    {
      code: "COURSE_STRUCTURE",
      passed: input.classSnapshot.moduleCount === 4 && input.classSnapshot.totalHours === 64 && input.classSnapshot.assignmentCount === 1,
      detail: `模块${input.classSnapshot.moduleCount}个、${input.classSnapshot.totalHours}课时、任务${input.classSnapshot.assignmentCount}个`,
    },
    {
      code: "IDENTITY_CAPACITY",
      passed: cohortExpected,
      detail: expectedParticipantCount
        ? `已签发${input.classSnapshot.issuedIdentityCount}个，预期${expectedParticipantCount}个`
        : `已签发${input.classSnapshot.issuedIdentityCount}个，首轮应为5—8个`,
    },
    {
      code: "IDENTITY_CLAIMS",
      passed: input.classSnapshot.claimedIdentityCount === input.classSnapshot.studentCount,
      detail: `已认领${input.classSnapshot.claimedIdentityCount}个、真实学生${input.classSnapshot.studentCount}人`,
    },
    {
      code: "PROJECT_OWNERSHIP",
      passed: input.classSnapshot.projectCount === input.classSnapshot.studentCount,
      detail: `真实学生${input.classSnapshot.studentCount}人、学生项目${input.classSnapshot.projectCount}个`,
    },
    {
      code: "PRIVATE_ACCESS_FILE",
      passed: input.materials.accessFilePath !== null
        && input.materials.accessIdentityCount === input.classSnapshot.issuedIdentityCount,
      detail: `访问文件${input.materials.accessFilePath ? "已找到" : "缺失"}，编号数量${input.materials.accessIdentityCount}`,
    },
    {
      code: "ANONYMOUS_OBSERVATION_PACKET",
      passed: input.materials.observationFilePath !== null
        && input.materials.observationSheetCount === input.classSnapshot.issuedIdentityCount
        && input.materials.observationPrivateCodeCount === 0
        && input.materials.observationClassCodeCount === 0,
      detail: `观察表${input.materials.observationSheetCount}份，完整身份码${input.materials.observationPrivateCodeCount}处，班级码${input.materials.observationClassCodeCount}处`,
    },
    {
      code: "LOCAL_SERVICE",
      passed: input.localHealth.reachable && input.localHealth.competitionReady,
      detail: `本机服务${input.localHealth.reachable ? "可访问" : "不可访问"}，竞赛健康门${input.localHealth.competitionReady ? "通过" : "未通过"}`,
    },
    {
      code: "PUBLIC_HTTPS",
      passed: input.publicHealth.configured && input.publicHealth.https
        && input.publicHealth.reachable && input.publicHealth.competitionReady,
      detail: input.publicHealth.configured
        ? `公网HTTPS${input.publicHealth.https ? "有效" : "无效"}，服务${input.publicHealth.reachable ? "可访问" : "不可访问"}，健康门${input.publicHealth.competitionReady ? "通过" : "未通过"}`
        : "未配置本轮公网地址",
    },
  ];
  const ready = checks.every((check) => check.passed);
  return {
    ok: ready,
    status: ready
      ? input.classSnapshot.studentCount > 0 ? "PILOT_IN_PROGRESS" as const : "READY_TO_START" as const
      : "NOT_READY" as const,
    className: input.classSnapshot.className,
    checks,
    metrics: {
      issuedIdentityCount: input.classSnapshot.issuedIdentityCount,
      claimedIdentityCount: input.classSnapshot.claimedIdentityCount,
      studentCount: input.classSnapshot.studentCount,
      projectCount: input.classSnapshot.projectCount,
    },
    materialPaths: {
      accessFilePath: input.materials.accessFilePath,
      observationFilePath: input.materials.observationFilePath,
    },
  };
}
