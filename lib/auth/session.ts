import { jwtVerify, SignJWT } from "jose";
import { TextEncoder } from "node:util";
import { z } from "zod";

export const SESSION_COOKIE_NAME = "tonggan_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const SESSION_ISSUER = "tonggan-agent";
const SESSION_AUDIENCE = "tonggan-web";
const SESSION_SECRET_PLACEHOLDER = "replace-with-at-least-32-random-characters";

const sessionPayloadSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["STUDENT", "TEACHER"]),
});

export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

type SessionClockOptions = {
  now?: Date;
};

function signingKey(secret: string) {
  const normalizedSecret = secret.trim();
  const key = new TextEncoder().encode(normalizedSecret);
  if (
    key.byteLength < 32 ||
    normalizedSecret === SESSION_SECRET_PLACEHOLDER
  ) {
    throw new Error("SESSION_SECRET is not safe for signing");
  }
  return key;
}

export async function issueSession(
  payload: SessionPayload,
  secret: string,
  options: SessionClockOptions = {},
) {
  const validatedPayload = sessionPayloadSchema.parse(payload);
  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1_000);

  return new SignJWT(validatedPayload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_MAX_AGE_SECONDS)
    .sign(signingKey(secret));
}

export async function verifySession(
  token: string,
  secret: string,
  options: SessionClockOptions = {},
): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, signingKey(secret), {
    algorithms: ["HS256"],
    typ: "JWT",
    issuer: SESSION_ISSUER,
    audience: SESSION_AUDIENCE,
    requiredClaims: ["iat", "exp"],
    maxTokenAge: SESSION_MAX_AGE_SECONDS,
    currentDate: options.now,
  });

  if (
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    payload.exp - payload.iat > SESSION_MAX_AGE_SECONDS
  ) {
    throw new Error("Session lifetime is invalid");
  }

  return sessionPayloadSchema.parse(payload);
}
