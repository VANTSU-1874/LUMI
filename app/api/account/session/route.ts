import { NextResponse, type NextRequest } from "next/server";

import { readLumiAccountSession } from "@/lib/auth/account-session";
import {
  SESSION_COOKIE_NAME,
  verifySession,
} from "@/lib/auth/session";
import { readEnv } from "@/lib/config/env";

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
};

export async function GET(request: NextRequest) {
  const accountSession = await readLumiAccountSession(request);
  if (accountSession) {
    return NextResponse.json({
      user: {
        id: accountSession.userId,
        role: accountSession.role,
        name: accountSession.name,
        alias: accountSession.alias,
        classId: accountSession.classId,
      },
      session: { type: "ACCOUNT" },
    }, { headers: NO_STORE_HEADERS });
  }

  // Account migration is intentionally dual-read: existing invitation
  // sessions remain valid until their users have been bound to an account.
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    try {
      const legacySession = await verifySession(
        token,
        readEnv(process.env).sessionSecret,
      );
      return NextResponse.json({
        user: {
          id: legacySession.userId,
          role: legacySession.role,
        },
        session: { type: "LEGACY_TRANSITION" },
      }, { headers: NO_STORE_HEADERS });
    } catch {
      // Invalid transitional cookies fall through to the same 401 response.
    }
  }

  return NextResponse.json(
    { error: "请先登录 Lumi" },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}
