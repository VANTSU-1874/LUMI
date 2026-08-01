import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";

import {
  getLumiAuthRuntime,
  LUMI_AUTH_COOKIE_PREFIX,
} from "./better-auth";
import {
  isLumiAccountRole,
  type LumiAccountRole,
} from "./account-model";

export type LumiAccountSession = {
  userId: string;
  role: LumiAccountRole;
  name: string;
  email: string;
  classId: string | null;
  alias: string;
};

export async function readLumiAccountSession(request: NextRequest) {
  const token = getSessionCookie(request.headers, {
    cookiePrefix: LUMI_AUTH_COOKIE_PREFIX,
  });
  if (!token) return null;

  const session = await getLumiAuthRuntime().auth.api.getSession({
    headers: request.headers,
  });
  if (!session || !isLumiAccountRole(session.user.role)) return null;

  return {
    userId: session.user.id,
    role: session.user.role,
    name: session.user.name,
    email: session.user.email,
    classId: typeof session.user.classId === "string"
      ? session.user.classId
      : null,
    alias: typeof session.user.alias === "string"
      ? session.user.alias
      : session.user.name,
  } satisfies LumiAccountSession;
}
