import type { NextRequest } from "next/server";

import { readLumiAccountSession } from "./account-session";
import { SESSION_COOKIE_NAME, verifySession } from "./session";

export class InspirationBrowseSessionRequiredError extends Error {
  constructor() { super("请先登录后浏览灵感 Wiki"); this.name = "InspirationBrowseSessionRequiredError"; }
}
export class InspirationBrowseRoleForbiddenError extends Error {
  constructor() { super("当前身份不能浏览灵感 Wiki"); this.name = "InspirationBrowseRoleForbiddenError"; }
}

/** The Browser may show its already-published, safe projection to signed-in students or teachers only. */
export async function requireInspirationBrowseSession(request: NextRequest, secret: string) {
  try {
    const accountSession = await readLumiAccountSession(request);
    if (accountSession) {
      if (accountSession.role === "STUDENT" || accountSession.role === "TEACHER") return accountSession;
      throw new InspirationBrowseRoleForbiddenError();
    }
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!token) throw new InspirationBrowseSessionRequiredError();
    const legacySession = await verifySession(token, secret);
    if (legacySession.role === "STUDENT" || legacySession.role === "TEACHER") return legacySession;
    throw new InspirationBrowseRoleForbiddenError();
  } catch (error) {
    if (error instanceof InspirationBrowseRoleForbiddenError || error instanceof InspirationBrowseSessionRequiredError) throw error;
    throw new InspirationBrowseSessionRequiredError();
  }
}
