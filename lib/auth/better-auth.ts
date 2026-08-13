import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, desc, eq } from "drizzle-orm";

import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  assignments,
  authAccount,
  authSession,
  authUser,
  authVerification,
  classes,
  projects,
  users,
} from "@/lib/db/schema";

import {
  AUTH_USER_ADDITIONAL_FIELDS,
  isLumiAccountRole,
  type LumiAccountRole,
} from "./account-model";

export const LUMI_AUTH_COOKIE_PREFIX = "lumi";
export const LUMI_INTERNAL_REGISTRATION_HEADER =
  "x-lumi-internal-registration";

type RuntimeEnvironment = Record<string, string | undefined>;
type CourseDatabase = DatabaseConnection["db"];

function internalRegistrationToken(secret: string) {
  return createHmac("sha256", secret)
    .update("lumi:better-auth:account-registration:v1", "utf8")
    .digest("base64url");
}

function tokenMatches(submitted: string | null, expected: string) {
  if (!submitted) return false;
  const submittedBytes = Buffer.from(submitted, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return submittedBytes.length === expectedBytes.length
    && timingSafeEqual(submittedBytes, expectedBytes);
}

function stableAlias(name: string, userId: string) {
  const readableName = name.trim().replace(/\s+/g, " ").slice(0, 24)
    || "学习者";
  return `${readableName}-${userId.slice(0, 6).toUpperCase()}`;
}

function provisionCourseIdentity(
  db: CourseDatabase,
  account: {
    id: string;
    name: string;
    role: LumiAccountRole;
    classId?: string | null;
    alias: string;
    createdAt: Date;
  },
) {
  const classId = account.role === "STUDENT" ? account.classId : null;
  if (account.role === "STUDENT" && !classId) {
    throw new Error("学生账号缺少班级归属");
  }

  db.insert(users)
    .values({
      id: account.id,
      classId,
      role: account.role,
      alias: account.alias,
      createdAt: account.createdAt,
    })
    .onConflictDoNothing({ target: users.id })
    .run();

  const stored = db
    .select({
      id: users.id,
      classId: users.classId,
      role: users.role,
      alias: users.alias,
    })
    .from(users)
    .where(eq(users.id, account.id))
    .get();

  if (
    !stored
    || stored.role !== account.role
    || stored.classId !== classId
    || stored.alias !== account.alias
  ) {
    throw new Error("课程身份创建失败");
  }

  if (account.role !== "STUDENT" || !classId) return;

  const existingProject = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.studentId, account.id), eq(projects.classId, classId)))
    .orderBy(desc(projects.updatedAt), desc(projects.createdAt), desc(projects.id))
    .limit(1)
    .get();
  if (existingProject) return;

  const assignment = db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.classId, classId))
    .orderBy(desc(assignments.createdAt), desc(assignments.id))
    .limit(1)
    .get();
  if (!assignment) return;

  const now = account.createdAt;
  db.insert(projects)
    .values({
      id: randomUUID(),
      classId,
      assignmentId: assignment.id,
      studentId: account.id,
      stage: "DIAGNOSTIC",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export function createLumiAuthRuntime(
  environment: RuntimeEnvironment = process.env,
) {
  const config = readEnv(environment);
  const connection = createDb(config.databasePath);
  const registrationToken = internalRegistrationToken(config.sessionSecret);
  const configuredOrigin = config.publicAppUrl;

  const auth = betterAuth({
    ...(configuredOrigin
      ? { baseURL: configuredOrigin, trustedOrigins: [configuredOrigin] }
      : {}),
    secret: config.sessionSecret,
    database: drizzleAdapter(connection.db, {
      provider: "sqlite",
      schema: {
        authUser,
        authSession,
        authAccount,
        authVerification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    user: {
      modelName: "authUser",
      additionalFields: AUTH_USER_ADDITIONAL_FIELDS,
    },
    session: {
      modelName: "authSession",
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    account: {
      modelName: "authAccount",
    },
    verification: {
      modelName: "authVerification",
    },
    advanced: {
      cookiePrefix: LUMI_AUTH_COOKIE_PREFIX,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
    },
    telemetry: {
      enabled: false,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (candidate, context) => {
            const submittedToken = context?.headers?.get(
              LUMI_INTERNAL_REGISTRATION_HEADER,
            ) ?? null;
            if (!tokenMatches(submittedToken, registrationToken)) {
              throw new APIError("FORBIDDEN", {
                message: "请从 Lumi 注册页面创建账号",
              });
            }

            if (!isLumiAccountRole(candidate.role)) {
              throw new APIError("BAD_REQUEST", {
                message: "账号身份无效",
              });
            }

            const role = candidate.role;
            const id = role === "TEACHER"
              ? "teacher"
              : typeof candidate.id === "string" && candidate.id.length > 0
                ? candidate.id
                : randomUUID();
            const classId = role === "STUDENT"
              ? typeof candidate.classId === "string"
                ? candidate.classId
                : null
              : null;

            if (role === "STUDENT") {
              const courseClass = classId
                ? connection.db
                    .select({ id: classes.id })
                    .from(classes)
                    .where(eq(classes.id, classId))
                    .get()
                : undefined;
              if (!courseClass) {
                throw new APIError("BAD_REQUEST", {
                  message: "班级邀请码无效",
                });
              }
            }

            return {
              data: {
                ...candidate,
                id,
                role,
                classId,
                alias: role === "TEACHER"
                  ? "课程负责人"
                  : stableAlias(candidate.name, id),
              },
            };
          },
          after: async (created) => {
            if (!isLumiAccountRole(created.role)) {
              throw new Error("账号身份写入失败");
            }
            provisionCourseIdentity(connection.db, {
              id: created.id,
              name: created.name,
              role: created.role,
              classId: typeof created.classId === "string"
                ? created.classId
                : null,
              alias: typeof created.alias === "string"
                ? created.alias
                : stableAlias(created.name, created.id),
              createdAt: created.createdAt,
            });
          },
        },
      },
    },
  });

  return {
    auth,
    config,
    connection,
    databasePath: config.databasePath,
    registrationToken,
  };
}

export type LumiAuthRuntime = ReturnType<typeof createLumiAuthRuntime>;

const globalAuth = globalThis as typeof globalThis & {
  __lumiAuthRuntime?: LumiAuthRuntime;
};

export function getLumiAuthRuntime() {
  const config = readEnv(process.env);
  const current = globalAuth.__lumiAuthRuntime;
  if (current?.databasePath === config.databasePath) return current;

  if (current && process.env.NODE_ENV === "test") {
    current.connection.sqlite.close();
  }

  const runtime = createLumiAuthRuntime(process.env);
  globalAuth.__lumiAuthRuntime = runtime;
  return runtime;
}

export function clearLumiAuthRuntimeForTests() {
  if (process.env.NODE_ENV !== "test") return;
  globalAuth.__lumiAuthRuntime?.connection.sqlite.close();
  delete globalAuth.__lumiAuthRuntime;
}
