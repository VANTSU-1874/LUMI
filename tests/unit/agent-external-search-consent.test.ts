import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { AgentTurnRequestSchema, externalSearchMessageDigest } from "@/lib/agent/contracts";

describe("Agent external-search consent", () => {
  it("uses the same NFKC-trimmed SHA-256 digest as the platform crypto implementation", () => {
    const message = "  ＡＢＣ 与海报层级  ";
    const normalized = message.normalize("NFKC").trim();
    expect(externalSearchMessageDigest(message)).toBe(
      createHash("sha256").update(normalized, "utf8").digest("hex"),
    );
  });

  it("accepts consent only when its digest is bound to the submitted message", () => {
    const message = "查找包豪斯展览设计的公开资料";
    const consent = {
      nonce: randomUUID(),
      messageDigest: externalSearchMessageDigest(message),
      issuedAt: Date.now(),
    };
    expect(AgentTurnRequestSchema.safeParse({
      message,
      context: { view: "AGENT" },
      externalSearchConsent: consent,
    }).success).toBe(true);

    const tampered = AgentTurnRequestSchema.safeParse({
      message: `${message}，再加一个问题`,
      context: { view: "AGENT" },
      externalSearchConsent: consent,
    });
    expect(tampered.success).toBe(false);
    expect(tampered.error?.issues[0]).toMatchObject({
      path: ["externalSearchConsent", "messageDigest"],
    });
  });

  it("keeps ordinary tutor turns valid without external-search consent", () => {
    expect(AgentTurnRequestSchema.safeParse({
      message: "只用课程资料回答",
      context: { view: "AGENT" },
    }).success).toBe(true);
  });
});
