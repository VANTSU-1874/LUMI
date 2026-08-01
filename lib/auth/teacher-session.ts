import type { NextRequest } from "next/server";

import { readLumiAccountSession } from "./account-session";
import { SESSION_COOKIE_NAME, verifySession } from "./session";

export class TeacherSessionRequiredError extends Error {
  constructor() { super("请先以教师身份进入"); this.name = "TeacherSessionRequiredError"; }
}
export class TeacherRoleForbiddenError extends Error {
  constructor() { super("仅教师可以访问"); this.name = "TeacherRoleForbiddenError"; }
}

export async function requireTeacherSession(request: NextRequest, secret: string) {
  try {
    const accountSession = await readLumiAccountSession(request);
    if (accountSession) {
      if (accountSession.role !== "TEACHER") {
        throw new TeacherRoleForbiddenError();
      }
      return accountSession;
    }

    // Keep existing teacher invitation sessions valid during the same
    // account-binding transition used by the student workspace.
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (token) {
      const legacySession = await verifySession(token, secret);
      if (legacySession.role !== "TEACHER") {
        throw new TeacherRoleForbiddenError();
      }
      return legacySession;
    }

    throw new TeacherSessionRequiredError();
  } catch (error) {
    if (error instanceof TeacherRoleForbiddenError) throw error;
    if (error instanceof TeacherSessionRequiredError) throw error;
    throw new TeacherSessionRequiredError();
  }
}
