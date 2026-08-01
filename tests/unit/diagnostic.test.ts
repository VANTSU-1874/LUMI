import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CURRENT_QUESTION_SET_VERSION,
  QUESTION_SETS,
} from "@/data/diagnostic/questions";
import {
  DiagnosticVersionConflictError,
  gradeDiagnosticAnswers,
  scoreDiagnostic,
  type DiagnosticDimension,
} from "@/lib/services/diagnostic";

const QUESTIONS = QUESTION_SETS.v1;

const dimensions: DiagnosticDimension[] = [
  "decomposition",
  "signalUnderstanding",
  "mappingDesign",
  "troubleshooting",
  "transfer",
];

function scores(values: [number, number, number, number, number]) {
  return dimensions.map((dimension, index) => ({
    dimension,
    score: values[index],
  }));
}

function answersForScore(score: number) {
  return QUESTIONS.map((question) => ({
    questionId: question.id,
    optionId: question.options.find((option) => option.score === score)!.id,
  }));
}

describe("diagnostic question bank", () => {
  it("contains ten stable scenario questions with two questions per dimension", () => {
    expect(CURRENT_QUESTION_SET_VERSION).toBe("v1");
    expect(QUESTIONS).toHaveLength(10);
    expect(new Set(QUESTIONS.map((question) => question.id)).size).toBe(10);
    for (const dimension of dimensions) {
      expect(QUESTIONS.filter((question) => question.dimension === dimension)).toHaveLength(2);
    }
    for (const question of QUESTIONS) {
      expect(question.scenario.length).toBeGreaterThan(20);
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options.map((option) => option.id)).size).toBe(4);
      expect(question.options.map((option) => option.score).sort()).toEqual([1, 2, 3, 4]);
    }
  });

  it("balances authoritative scores across option positions", () => {
    const positionAverages = [0, 1, 2, 3].map(
      (position) =>
        QUESTIONS.reduce(
          (total, question) => total + question.options[position].score,
          0,
        ) / QUESTIONS.length,
    );

    expect(Math.max(...positionAverages) - Math.min(...positionAverages)).toBeLessThanOrEqual(0.5);
  });

  it("keeps every option set similarly detailed and professionally plausible", () => {
    for (const question of QUESTIONS) {
      const lengths = question.options.map(({ label }) => label.length);
      expect(Math.max(...lengths) - Math.min(...lengths), question.id).toBeLessThanOrEqual(18);
      expect(Math.min(...lengths), question.id).toBeGreaterThanOrEqual(18);
    }
  });

  it("defines one-shot triggering by a state transition and explicit reset", () => {
    const trigger = QUESTIONS.find(({ id }) => id === "entry-state-signal")!;
    const rule = QUESTIONS.find(({ id }) => id === "one-shot-mapping")!;

    expect(trigger.options.find(({ score }) => score === 4)?.label).toMatch(/无人.*有人/);
    expect(rule.options.find(({ score }) => score === 4)?.label).toMatch(/离开|无人/);
  });

  it("pins the immutable v1 question content and scores to a canonical hash", () => {
    const hash = createHash("sha256")
      .update(JSON.stringify(QUESTION_SETS.v1), "utf8")
      .digest("hex");

    expect(hash).toBe("088804d350093f0d95c90191c0899e1dd682eac31d2bd8e64e6cdda85b600b6e");
  });
});

describe("scoreDiagnostic", () => {
  it("assigns L1 when the learner has weak dimensions", () => {
    expect(scoreDiagnostic(scores([1, 1, 2, 1, 2]))).toMatchObject({
      average: 1.4,
      level: "L1",
    });
  });

  it("does not assign L3 when the average is high but transfer is low", () => {
    expect(scoreDiagnostic(scores([4, 4, 4, 4, 2]))).toMatchObject({
      average: 3.6,
      level: "L2",
      transfer: 2,
    });
  });

  it("assigns L4 only at an excellent average with transfer 4", () => {
    expect(scoreDiagnostic(scores([4, 4, 4, 3, 4]))).toMatchObject({
      average: 3.8,
      level: "L4",
    });
    expect(scoreDiagnostic(scores([4, 4, 4, 3, 3]))).toMatchObject({ level: "L3" });
  });

  it("honors the L2 and L3 boundaries", () => {
    expect(scoreDiagnostic(scores([2, 2, 2, 2.5, 2.5]))).toMatchObject({
      average: 2.2,
      level: "L2",
    });
    expect(scoreDiagnostic(scores([3, 3, 3, 3.5, 3]))).toMatchObject({
      average: 3.1,
      level: "L2",
    });
    expect(scoreDiagnostic(scores([3, 3, 3.5, 3.5, 3]))).toMatchObject({
      average: 3.2,
      level: "L3",
    });
  });

  it("preserves half-point dimensions while deriving the average", () => {
    expect(scoreDiagnostic(scores([3.5, 3.5, 3.5, 3.5, 3.5]))).toEqual({
      decomposition: 3.5,
      signalUnderstanding: 3.5,
      mappingDesign: 3.5,
      troubleshooting: 3.5,
      transfer: 3.5,
      average: 3.5,
      level: "L3",
    });
  });

  it.each([
    ["duplicate dimension", [...scores([2, 2, 2, 2, 2]), { dimension: "transfer", score: 3 }]],
    ["missing dimension", scores([2, 2, 2, 2, 2]).slice(0, 4)],
    ["score below range", scores([0, 2, 2, 2, 2])],
    ["score above range", scores([5, 2, 2, 2, 2])],
    ["score outside half-point increments", scores([3.25, 2, 2, 2, 2])],
  ])("rejects %s instead of silently averaging invalid input", (_case, input) => {
    expect(() => scoreDiagnostic(input)).toThrow();
  });
});

describe("gradeDiagnosticAnswers", () => {
  it("looks up authoritative option scores and averages each dimension", () => {
    const answers = QUESTIONS.map((question, index) => ({
      questionId: question.id,
      optionId: question.options.find((option) => option.score === (index % 4) + 1)!.id,
    }));

    const result = gradeDiagnosticAnswers("v1", answers);

    for (const dimension of dimensions) {
      const selected = QUESTIONS.filter((question) => question.dimension === dimension)
        .map((question) => question.options.find((option) =>
          answers.some(
            (answer) => answer.questionId === question.id && answer.optionId === option.id,
          ),
        )!.score);
      expect(result[dimension]).toBe((selected[0] + selected[1]) / 2);
    }
  });

  it("grades all-best answers as L4 without accepting client scores", () => {
    const result = gradeDiagnosticAnswers("v1", answersForScore(4));

    expect(result).toMatchObject({ average: 4, level: "L4" });
    expect(Object.keys(result)).not.toContain("answers");
  });

  it.each([
    ["unknown question", () => [{ ...answersForScore(3)[0], questionId: "unknown" }, ...answersForScore(3).slice(1)]],
    ["unknown option", () => [{ ...answersForScore(3)[0], optionId: "unknown" }, ...answersForScore(3).slice(1)]],
    ["duplicate question", () => [...answersForScore(3).slice(0, 9), answersForScore(3)[0]]],
    ["missing question", () => answersForScore(3).slice(0, 9)],
    ["extra question", () => [...answersForScore(3), { questionId: "extra", optionId: "extra" }]],
  ])("rejects %s", (_case, buildAnswers) => {
    expect(() => gradeDiagnosticAnswers("v1", buildAnswers())).toThrow();
  });

  it.each(["v0", "unknown"])("rejects unavailable question set version %s", (version) => {
    expect(() => gradeDiagnosticAnswers(version, answersForScore(4))).toThrow(
      DiagnosticVersionConflictError,
    );
  });
});
