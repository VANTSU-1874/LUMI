// @vitest-environment node

import { describe, expect, it } from "vitest";

import { redactSensitiveText, studentNumberPolicyFromEnvironment } from "@/lib/security/redaction";

describe("redaction before knowledge or model use", () => {
  it("masks mainland mobile numbers and case-insensitive email addresses while retaining context", () => {
    const result = redactSensitiveText("输入测试由 13812345678 完成，联系 Alice.Zhang+TD@Example.COM 后继续检查OSC。", {});
    expect(result).toBe("输入测试由 [已遮蔽手机号] 完成，联系 [已遮蔽邮箱] 后继续检查OSC。");
    expect(result).not.toContain("13812345678");
    expect(result.toLowerCase()).not.toContain("alice.zhang");
  });

  it("normalizes fullwidth input and masks +86 phones with spaces or hyphens", () => {
    const result = redactSensitiveText(
      "A +86-138 1234-5678 / B ＋８６ １３９－８７６５－４３２１ / C 137-0000-1234",
      {},
    );
    expect(result).toBe("A [已遮蔽手机号] / B [已遮蔽手机号] / C [已遮蔽手机号]");
  });

  it("masks bounded mainland identity numbers without matching hash fragments", () => {
    expect(redactSensitiveText(
      "证件 11010519491231002X；全角 １１０１０５１９４９１２３１００２ｘ。",
      {},
    )).toBe("证件 [已遮蔽身份证号]；全角 [已遮蔽身份证号]。");
    expect(redactSensitiveText("a11010519491231002Xf", {}))
      .toBe("a11010519491231002Xf");
  });

  it("masks configured student numbers using a bounded prefix and digit contract", () => {
    const result = redactSensitiveText("学号 SC2026123456 的映射正常，SC202612345 不应命中。", {
      studentNumber: { prefix: "SC", digits: 10 },
    });
    expect(result).toBe("学号 [已遮蔽学号] 的映射正常，SC202612345 不应命中。");
  });

  it("uses Unicode alphanumeric boundaries and never partially masks a longer student id", () => {
    const result = redactSensitiveText("ABC1234 / ABC1234X / 甲ABC1234乙 / X13812345678Y", {
      studentNumber: { prefix: "ABC", digits: 4 },
    });
    expect(result).toBe("[已遮蔽学号] / ABC1234X / 甲ABC1234乙 / X13812345678Y");
  });

  it("treats Unicode combining marks as identifier boundaries that block partial masking", () => {
    const result = redactSensitiveText("ABC1234\u0301 / 13812345678\u0301 / \u0301ABC1234", {
      studentNumber: { prefix: "ABC", digits: 4 },
    });
    expect(result).toBe("ABC1234\u0301 / 13812345678\u0301 / \u0301ABC1234");
  });

  it("uses NFKC only as a matching shadow and preserves all unmasked original glyphs", () => {
    const result = redactSensitiveText("步骤①：型号ＡＢＣ保留；电话：＋８６ １３８－１２３４－５６７８。", {});
    expect(result).toBe("步骤①：型号ＡＢＣ保留；电话：[已遮蔽手机号]。");
  });

  it("handles adjacent and overlapping-sensitive values without retaining originals", () => {
    const result = redactSensitiveText("13812345678@test.cn / 13812345678 / S20260001", {
      studentNumber: { prefix: "S", digits: 8 },
    });
    expect(result).toBe("[已遮蔽邮箱] / [已遮蔽手机号] / [已遮蔽学号]");
  });

  it("rejects unsafe environment patterns instead of compiling arbitrary regular expressions", () => {
    expect(() => studentNumberPolicyFromEnvironment({ STUDENT_NUMBER_PREFIX: "(a+)+", STUDENT_NUMBER_DIGITS: "8" })).toThrow();
    expect(() => studentNumberPolicyFromEnvironment({ STUDENT_NUMBER_PREFIX: "S", STUDENT_NUMBER_DIGITS: "999" })).toThrow();
  });

  it("fails closed on partial or example production student-number configuration", () => {
    expect(() => studentNumberPolicyFromEnvironment({ NODE_ENV: "production", STUDENT_NUMBER_PREFIX: "SC" })).toThrow();
    expect(() => studentNumberPolicyFromEnvironment({ NODE_ENV: "production", STUDENT_NUMBER_PREFIX: "DEMO", STUDENT_NUMBER_DIGITS: "8" })).toThrow();
  });
});
