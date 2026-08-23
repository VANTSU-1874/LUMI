// @vitest-environment node

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  issuePreviewSession,
  verifyPreviewSession,
} from "@/lib/preview/session";

const SECRET = "preview-session-secret-at-least-32-characters";

describe("evaluator preview session token", () => {
  it("is a separate, restricted anonymous session scope", async () => {
    const now = new Date("2026-07-30T00:00:00.000Z");
    const sessionId = randomUUID();
    const token = await issuePreviewSession(sessionId, SECRET, now);
    await expect(verifyPreviewSession(token, SECRET, now)).resolves.toEqual({
      sessionId,
      scope: "EVALUATOR_PREVIEW",
    });
  });

  it("does not accept a token with the normal student-session issuer", async () => {
    const now = new Date("2026-07-30T00:00:00.000Z");
    const token = await issuePreviewSession(randomUUID(), SECRET, now);
    await expect(verifyPreviewSession(token, "different-preview-session-secret-at-least-32")).rejects.toThrow();
  });
});
