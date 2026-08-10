// @vitest-environment node

import { decodeProtectedHeader, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  issueSession,
  SESSION_MAX_AGE_SECONDS,
  verifySession,
} from "@/lib/auth/session";

const SECRET = "a-secure-session-secret-with-32-characters";

function tamperSignature(token: string) {
  const parts = token.split(".");
  const signature = Buffer.from(parts[2], "base64url");
  signature[0] ^= 1;
  parts[2] = signature.toString("base64url");
  return parts.join(".");
}

async function signRawSession(
  claims: Record<string, unknown>,
  options: { issuer?: string; audience?: string; typ?: string } = {},
) {
  let token = new SignJWT(claims).setProtectedHeader({
    alg: "HS256",
    typ: options.typ ?? "JWT",
  });
  if (options.issuer !== undefined) token = token.setIssuer(options.issuer);
  if (options.audience !== undefined) token = token.setAudience(options.audience);
  return token.sign(new TextEncoder().encode(SECRET));
}

describe("signed sessions", () => {
  it("round-trips a student identity", async () => {
    const token = await issueSession({ userId: "u1", role: "STUDENT" }, SECRET);

    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "HS256", typ: "JWT" });
    await expect(verifySession(token, SECRET)).resolves.toEqual({
      userId: "u1",
      role: "STUDENT",
    });
  });

  it("rejects a tampered token", async () => {
    const token = await issueSession({ userId: "u1", role: "STUDENT" }, SECRET);

    await expect(verifySession(tamperSignature(token), SECRET)).rejects.toThrow();
  });

  it("rejects a token verified with another secret", async () => {
    const token = await issueSession({ userId: "u1", role: "TEACHER" }, SECRET);

    await expect(
      verifySession(token, "another-secure-session-secret-32-characters"),
    ).rejects.toThrow();
  });

  it("only accepts student and teacher roles", async () => {
    await expect(
      issueSession(
        { userId: "u1", role: "ADMIN" } as unknown as {
          userId: string;
          role: "STUDENT" | "TEACHER";
        },
        SECRET,
      ),
    ).rejects.toThrow();
  });

  it("rejects an expired token without waiting in real time", async () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const token = await issueSession(
      { userId: "u1", role: "STUDENT" },
      SECRET,
      { now: issuedAt },
    );

    await expect(
      verifySession(token, SECRET, {
        now: new Date(issuedAt.getTime() + 12 * 60 * 60 * 1000 + 1_000),
      }),
    ).rejects.toThrow();
  });

  it("rejects handcrafted tokens missing iat or exp", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const missingIat = await signRawSession(
      { userId: "u1", role: "STUDENT", exp: now + 60 },
      { issuer: "tonggan-agent", audience: "tonggan-web" },
    );
    const missingExp = await signRawSession(
      { userId: "u1", role: "STUDENT", iat: now },
      { issuer: "tonggan-agent", audience: "tonggan-web" },
    );

    await expect(verifySession(missingIat, SECRET)).rejects.toThrow();
    await expect(verifySession(missingExp, SECRET)).rejects.toThrow();
  });

  it.each([
    ["issuer", { issuer: "wrong", audience: "tonggan-web" }],
    ["audience", { issuer: "tonggan-agent", audience: "wrong" }],
    ["typ", { issuer: "tonggan-agent", audience: "tonggan-web", typ: "NOT-JWT" }],
  ] as const)("rejects a token with the wrong %s", async (_claim, options) => {
    const now = Math.floor(Date.now() / 1_000);
    const token = await signRawSession(
      {
        userId: "u1",
        role: "STUDENT",
        iat: now,
        exp: now + SESSION_MAX_AGE_SECONDS,
      },
      options,
    );

    await expect(verifySession(token, SECRET)).rejects.toThrow();
  });

  it("rejects a token whose declared lifetime exceeds 12 hours", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const token = await signRawSession(
      {
        userId: "u1",
        role: "STUDENT",
        iat: now,
        exp: now + SESSION_MAX_AGE_SECONDS + 1,
      },
      { issuer: "tonggan-agent", audience: "tonggan-web" },
    );

    await expect(verifySession(token, SECRET)).rejects.toThrow();
  });

  it.each([
    "short-secret",
    "replace-with-at-least-32-random-characters",
  ])("rejects an unsafe signing secret", async (secret) => {
    await expect(
      issueSession({ userId: "u1", role: "STUDENT" }, secret),
    ).rejects.toThrow();
  });
});
