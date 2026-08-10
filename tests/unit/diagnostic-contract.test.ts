import { describe, expect, it } from "vitest";

import {
  DiagnosticAnswersSchema,
  DiagnosticDimensionScoreSchema,
  DiagnosticProfileResponseSchema,
  DiagnosticSubmissionSchema,
} from "@/lib/domain/diagnostic";

const answers = Array.from({ length: 10 }, (_, index) => ({
  questionId: `question-${index}`,
  optionId: `option-${index}`,
}));

const validResponse = {
  profile: {
    decomposition: 4,
    signalUnderstanding: 3.5,
    mappingDesign: 3,
    troubleshooting: 2.5,
    transfer: 4,
    average: 3.4,
    level: "L3",
    updatedAt: "2026-07-12T04:00:00.000Z",
  },
};

describe("diagnostic wire schemas", () => {
  it("accepts exactly ten strict ID-only answers and a required version", () => {
    expect(DiagnosticAnswersSchema.parse(answers)).toEqual(answers);
    expect(
      DiagnosticSubmissionSchema.parse({ questionSetVersion: "v1", answers }),
    ).toEqual({ questionSetVersion: "v1", answers });
    expect(() => DiagnosticSubmissionSchema.parse({ answers })).toThrow();
    expect(() =>
      DiagnosticAnswersSchema.parse(
        answers.map((answer) => ({ ...answer, score: 4 })),
      ),
    ).toThrow();
  });

  it("accepts a complete, bounded profile response", () => {
    expect(DiagnosticProfileResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it("preserves legal half-point dimension scores and rejects other fractions", () => {
    expect(DiagnosticDimensionScoreSchema.parse(3.5)).toBe(3.5);
    expect(() => DiagnosticDimensionScoreSchema.parse(3.25)).toThrow();
    expect(() => DiagnosticDimensionScoreSchema.parse(0.5)).toThrow();
    expect(() => DiagnosticDimensionScoreSchema.parse(4.5)).toThrow();
    expect(() => DiagnosticProfileResponseSchema.parse({
      profile: { ...validResponse.profile, decomposition: 3.25 },
    })).toThrow();
  });

  it.each([
    ["missing dimension", { profile: { ...validResponse.profile, transfer: undefined } }],
    ["invalid level", { profile: { ...validResponse.profile, level: "L5" } }],
    ["non-number dimension", { profile: { ...validResponse.profile, decomposition: "4" } }],
    ["out-of-range average", { profile: { ...validResponse.profile, average: 4.1 } }],
    ["invalid timestamp", { profile: { ...validResponse.profile, updatedAt: "today" } }],
  ])("rejects %s", (_case, response) => {
    expect(() => DiagnosticProfileResponseSchema.parse(response)).toThrow();
  });
});
