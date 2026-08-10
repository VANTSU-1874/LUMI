// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  resolveTrustedSource,
  signTrustedSource,
} from "@/lib/auth/trusted-source";

const SECRET = "trusted-proxy-secret-at-least-32-characters";
const NOW = new Date("2026-07-12T00:00:00.000Z");

function signedHeaders(sourceId = "campus-gateway-42", timestamp = NOW) {
  const timestampSeconds = Math.floor(timestamp.getTime() / 1_000).toString();
  return new Headers({
    "x-tonggan-source-id": sourceId,
    "x-tonggan-source-timestamp": timestampSeconds,
    "x-tonggan-source-signature": signTrustedSource(
      sourceId,
      timestampSeconds,
      SECRET,
    ),
  });
}

describe("trusted authentication source", () => {
  it("verifies a fresh proxy-signed source", () => {
    expect(
      resolveTrustedSource(signedHeaders(), {
        nodeEnv: "production",
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ id: "campus-gateway-42", kind: "proxy-signed" });
  });

  it.each([
    ["missing", new Headers()],
    ["expired", signedHeaders("campus-gateway-42", new Date(NOW.getTime() - 61_000))],
    [
      "tampered source",
      (() => {
        const headers = signedHeaders();
        headers.set("x-tonggan-source-id", "attacker");
        return headers;
      })(),
    ],
  ])("rejects %s production source headers", (_case, headers) => {
    expect(() =>
      resolveTrustedSource(headers, {
        nodeEnv: "production",
        secret: SECRET,
        now: NOW,
      }),
    ).toThrow("请求来源无效");
  });

  it("uses an explicit development fallback only when headers are absent", () => {
    expect(
      resolveTrustedSource(new Headers(), {
        nodeEnv: "test",
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ id: "local-development", kind: "development-fallback" });
  });
});
