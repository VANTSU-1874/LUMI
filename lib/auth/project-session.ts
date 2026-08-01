import type { NextRequest } from "next/server";

import { readLumiAccountSession } from "./account-session";
import { SESSION_COOKIE_NAME, verifySession } from "./session";

export class StudentSessionRequiredError extends Error {
  constructor() { super("请先以学生身份进入"); this.name = "StudentSessionRequiredError"; }
}
export const STUDENT_ROLE_FORBIDDEN_CODE = "STUDENT_ROLE_FORBIDDEN" as const;
export class StudentRoleForbiddenError extends Error {
  readonly code = STUDENT_ROLE_FORBIDDEN_CODE;
  constructor() { super("仅学生可以执行此操作"); this.name = "StudentRoleForbiddenError"; }
}

export function studentAwareForbiddenPayload(error: Error) {
  return error instanceof StudentRoleForbiddenError
    ? { error: error.message, code: error.code }
    : { error: error.message };
}

export async function requireStudentSession(request: NextRequest, secret: string) {
  try {
    const accountSession = await readLumiAccountSession(request);
    if (accountSession) {
      if (accountSession.role !== "STUDENT") {
        throw new StudentRoleForbiddenError();
      }
      return accountSession;
    }

    // Account migration is dual-read so current invitation users do not lose
    // access before their course identities are bound to Better Auth.
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (token) {
      const legacySession = await verifySession(token, secret);
      if (legacySession.role !== "STUDENT") {
        throw new StudentRoleForbiddenError();
      }
      return legacySession;
    }

    throw new StudentSessionRequiredError();
  } catch (error) {
    if (error instanceof StudentRoleForbiddenError) throw error;
    if (error instanceof StudentSessionRequiredError) throw error;
    throw new StudentSessionRequiredError();
  }
}
