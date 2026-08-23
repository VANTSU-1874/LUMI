import type { NextRequest } from "next/server";

import { readLumiAccountSession } from "./account-session";
import {
  SESSION_COOKIE_NAME,
  verifySession,
  type SessionPayload,
} from "./session";

/** Resolve the current email-account session first, then the invitation-era cookie. */
export async function readUnifiedSession(
  request: NextRequest,
  secret: string,
): Promise<SessionPayload | null> {
  try {
    const accountSession = await readLumiAccountSession(request);
    if (accountSession) {
      return { userId: accountSession.userId, role: accountSession.role };
    }
  } catch {
    // An invalid account cookie must not prevent a still-valid legacy session
    // from being checked during the account migration window.
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    return await verifySession(token, secret);
  } catch {
    return null;
  }
}
