// @vitest-environment node

import { describe, expect, it } from "vitest";

import { sanitizeExternalSearchIntent } from "@/lib/agent/external-web-research";

describe("external web research intent", () => {
  it("redacts common identifiers and credentials before an outbound search", () => {
    const modelKeyFixture = ["sk", "example-secret-123456"].join("-");
    const githubTokenFixture = ["github", "pat", "abcdefghijklmnopqrstuvwxyz"].join("_");
    const value = sanitizeExternalSearchIntent(
      [
        "邮箱 arlo@example.com 手机 13800138000 学号 SC20260001 身份证 11010519491231002X",
        "Bearer abcdefghijklmnopqrstuvwxyz",
        modelKeyFixture,
        githubTokenFixture,
        "api_key=super-secret-value",
        "https://user:password@example.com/docs",
      ].join(" "),
      {
        STUDENT_NUMBER_PREFIX: "SC",
        STUDENT_NUMBER_DIGITS: "8",
        NODE_ENV: "test",
      },
    );
    expect(value).not.toMatch(/arlo@example\.com|13800138000|SC20260001|11010519491231002X/);
    expect(value).not.toMatch(/abcdefghijklmnopqrstuvwxyz|super-secret-value|user:password/);
    expect(value).toContain("[已遮蔽");
  });

  it("removes controls, collapses the query to one line and bounds its length", () => {
    const value = sanitizeExternalSearchIntent(`字体\n可读性\u202e${"检索".repeat(300)}`, {
      NODE_ENV: "test",
    });
    expect(value).not.toMatch(/[\r\n\u202e]/);
    expect(value.length).toBeLessThanOrEqual(300);
  });
});
