// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  digestIdentityCode,
  generateIdentityCode,
  normalizeIdentityCode,
} from "@/lib/auth/identity-code";

const PEPPER = "identity-code-pepper-at-least-32-characters";

describe("student identity codes", () => {
  it("generates unique 4-4-4 codes from the unambiguous alphabet", () => {
    const codes = Array.from({ length: 100 }, () => generateIdentityCode());

    expect(new Set(codes).size).toBe(100);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it("normalizes whitespace and lowercase while rejecting low-diversity values", () => {
    expect(normalizeIdentityCode("  7k9m-2q4r-p8tx  ")).toBe("7K9M-2Q4R-P8TX");
    expect(() => normalizeIdentityCode("AAAA-AAAA-AAAA")).toThrow("匿名编号无效");
    expect(() => normalizeIdentityCode("--------------")).toThrow("匿名编号无效");
  });

  it("creates a stable pepper-dependent HMAC digest without exposing the code", () => {
    const code = "7K9M-2Q4R-P8TX";
    const digest = digestIdentityCode(code, PEPPER);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).toBe(digestIdentityCode(code.toLowerCase(), PEPPER));
    expect(digest).not.toBe(
      digestIdentityCode(code, "another-identity-pepper-at-least-32-chars"),
    );
    expect(digest).not.toContain(code);
  });
});
