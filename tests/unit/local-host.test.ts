// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolveTrustedSource } from "@/lib/auth/trusted-source";
import {
  buildTrustedProxyHeaders,
  deriveTrustedSourceId,
  parseServiceEnvironment,
  proxiedApplicationOrigin,
  resolveExternalRequestOrigin,
} from "@/lib/operations/local-host";

const SECRET = "local-host-proxy-secret-at-least-32-characters";
const NOW = new Date("2026-07-13T08:00:00.000Z");

describe("local computer hosting", () => {
  it("parses an external service environment without exposing it to Next env files", () => {
    expect(parseServiceEnvironment("SESSION_SECRET=abc\nDATABASE_PATH=C:\\data\\demo.sqlite\n"))
      .toEqual({ SESSION_SECRET: "abc", DATABASE_PATH: "C:\\data\\demo.sqlite" });
    expect(() => parseServiceEnvironment("SESSION_SECRET=one\nSESSION_SECRET=two\n"))
      .toThrow(/重复/);
  });

  it("uses a stable hashed source id without forwarding the client IP", () => {
    const headers = { "cf-connecting-ip": "203.0.113.42" };
    expect(deriveTrustedSourceId(headers, "127.0.0.1"))
      .toBe(deriveTrustedSourceId(headers, "127.0.0.1"));
    expect(deriveTrustedSourceId(headers, "127.0.0.1")).not.toContain("203.0.113.42");
  });

  it("removes spoofed proxy headers and adds a fresh valid signature", () => {
    const proxied = buildTrustedProxyHeaders({
      headers: {
        host: "chuyingai.cc.cd",
        "cf-connecting-ip": "203.0.113.42",
        "x-forwarded-for": "198.51.100.2",
        "x-forwarded-port": "8443",
        connection: "x-attacker-hop",
        "x-attacker-hop": "must-not-pass",
        "x-tonggan-source-id": "attacker",
        "x-tonggan-source-timestamp": "1",
        "x-tonggan-source-signature": "a".repeat(64),
      },
      peerAddress: "127.0.0.1",
      secret: SECRET,
      publicUrl: "https://chuyingai.cc.cd",
      upstreamOrigin: "http://localhost:3000",
      now: NOW,
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(proxied)) {
      if (typeof value === "string" || typeof value === "number") headers.set(name, String(value));
    }

    expect(headers.get("host")).toBe("localhost:3000");
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("x-forwarded-port")).toBeNull();
    expect(headers.get("x-attacker-hop")).toBeNull();
    expect(headers.get("cf-connecting-ip")).toBeNull();
    expect(resolveTrustedSource(headers, {
      nodeEnv: "production",
      secret: SECRET,
      now: NOW,
    })).toEqual({
      id: deriveTrustedSourceId({ "cf-connecting-ip": "203.0.113.42" }, "127.0.0.1"),
      kind: "proxy-signed",
    });
  });

  it("accepts browser same-origin requests and rewrites only the trusted upstream origin", () => {
    expect(proxiedApplicationOrigin("https://chuyingai.cc.cd"))
      .toBe("https://localhost:3000");
    const proxied = buildTrustedProxyHeaders({
      headers: {
        host: "chuyingai.cc.cd",
        origin: "https://chuyingai.cc.cd",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "same-origin",
      },
      peerAddress: "127.0.0.1",
      secret: SECRET,
      publicUrl: "https://chuyingai.cc.cd",
      upstreamOrigin: "http://localhost:3000",
      now: NOW,
    });
    expect(proxied.origin).toBe("https://localhost:3000");
    expect(proxied["x-forwarded-host"]).toBe("chuyingai.cc.cd");
    expect(proxied["x-forwarded-proto"]).toBe("https");
  });

  it("allows an explicit quick-tunnel preview but rejects cross-origin and unknown hosts", () => {
    expect(resolveExternalRequestOrigin({
      headers: {
        host: "preview-name.trycloudflare.com",
        origin: "https://preview-name.trycloudflare.com",
        "x-forwarded-proto": "https",
      },
      peerAddress: "127.0.0.1",
      publicUrl: "https://chuyingai.cc.cd",
      allowQuickTunnelOrigin: true,
    })).toBe("https://preview-name.trycloudflare.com");
    expect(() => resolveExternalRequestOrigin({
      headers: {
        host: "chuyingai.cc.cd",
        origin: "https://attacker.example",
        "x-forwarded-proto": "https",
      },
      peerAddress: "127.0.0.1",
      publicUrl: "https://chuyingai.cc.cd",
    })).toThrow(/请求来源无效/);
    expect(() => resolveExternalRequestOrigin({
      headers: { host: "attacker.example", origin: "https://attacker.example" },
      peerAddress: "127.0.0.1",
      publicUrl: "https://chuyingai.cc.cd",
    })).toThrow(/请求来源无效/);
  });
});
