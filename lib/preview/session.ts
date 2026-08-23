import { SignJWT, jwtVerify } from "jose";
import { TextEncoder } from "node:util";
import { z } from "zod";

import { PREVIEW_SESSION_MAX_AGE_SECONDS } from "./contracts";

export const PREVIEW_SESSION_COOKIE_NAME = "lumi_evaluator_preview";
const PREVIEW_SESSION_ISSUER = "lumi-evaluator-preview";
const PREVIEW_SESSION_AUDIENCE = "lumi-web-preview";

const payloadSchema = z.object({
  sessionId: z.string().uuid(),
  scope: z.literal("EVALUATOR_PREVIEW"),
});

export type PreviewSessionPayload = z.infer<typeof payloadSchema>;

function signingKey(secret: string) {
  const normalized = secret.trim();
  const key = new TextEncoder().encode(normalized);
  if (key.byteLength < 32) throw new Error("SESSION_SECRET is not safe for signing");
  return key;
}
export async function issuePreviewSession(sessionId: string, secret: string, now = new Date()) {
  const payload = payloadSchema.parse({ sessionId, scope: "EVALUATOR_PREVIEW" });
  const issuedAt = Math.floor(now.getTime() / 1_000);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(PREVIEW_SESSION_ISSUER)
    .setAudience(PREVIEW_SESSION_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + PREVIEW_SESSION_MAX_AGE_SECONDS)
    .sign(signingKey(secret));
}

export async function verifyPreviewSession(token: string, secret: string, now = new Date()) {
  const { payload } = await jwtVerify(token, signingKey(secret), {
    algorithms: ["HS256"],
    typ: "JWT",
    issuer: PREVIEW_SESSION_ISSUER,
    audience: PREVIEW_SESSION_AUDIENCE,
    requiredClaims: ["iat", "exp"],
    maxTokenAge: PREVIEW_SESSION_MAX_AGE_SECONDS,
    currentDate: now,
  });
  if (
    typeof payload.iat !== "number"
    || typeof payload.exp !== "number"
    || payload.exp - payload.iat > PREVIEW_SESSION_MAX_AGE_SECONDS
  ) throw new Error("preview session lifetime is invalid");
  return payloadSchema.parse(payload);
}
