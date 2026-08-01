import { describe, expect, it, vi } from "vitest";

import type { ModelClient } from "@/lib/ai/client";
import type { LogicCardCoachInput } from "@/lib/domain/logic-card-coach-contract";
import {
  clarifyLogicCard,
  createModelLogicCardCoach,
  deterministicCoachSuggestion,
  type LogicCardCoach,
} from "@/lib/services/logic-card-coach";

const input: LogicCardCoachInput = {
  field: "culturalIntent",
  answer: "热闹",
  card: {
    culturalIntent: "",
    participantAction: "",
    inputSignal: "",
    mappingRule: "",
    outputMedium: "",
    experienceFeedback: "",
  },
};

describe("logic card clarification coach", () => {
  it("turns a vague answer into distinct student-confirmed hypotheses", async () => {
    const complete = vi.fn(async () => JSON.stringify({
      acknowledgement: "热闹可以有几种不同的意思。",
      question: "你更在意现场气氛，还是参与者感受到社区活力？",
      options: [
        { label: "感到社区有活力", value: "希望参与者感受到社区活动的活力" },
        { label: "愿意加入活动", value: "希望参与者愿意主动加入社区活动" },
      ],
    }));
    const coach = createModelLogicCardCoach({ complete } satisfies ModelClient);

    const result = await clarifyLogicCard(coach, input);

    expect(result).toMatchObject({ field: "culturalIntent", mode: "MODEL_ASSISTED", source: "model-clarification-v1" });
    expect(result.options).toHaveLength(2);
    expect(result.options[0]).toMatchObject({ id: "option-1", value: "希望参与者感受到社区活动的活力" });
    expect(complete).toHaveBeenCalledOnce();
    expect(JSON.stringify(complete.mock.calls[0])).toContain("热闹");
  });

  it("falls back to course guidance when model output exposes internal fields", async () => {
    const coach = createModelLogicCardCoach({
      complete: async () => JSON.stringify({
        acknowledgement: "继续填写",
        question: "请选择",
        options: [
          { label: "culturalIntent", value: "culturalIntent" },
          { label: "另一个", value: "另一个" },
        ],
      }),
    });

    const result = await clarifyLogicCard(coach, input);

    expect(result.mode).toBe("DETERMINISTIC_FALLBACK");
    expect(JSON.stringify({ acknowledgement: result.acknowledgement, question: result.question, options: result.options })).not.toMatch(/culturalIntent/);
    expect(result.options).toHaveLength(3);
    expect(result.options.every((option) => option.label !== option.value)).toBe(true);
  });

  it("rejects model hypotheses that claim the student has passed or is correct", async () => {
    const coach = createModelLogicCardCoach({
      complete: async () => JSON.stringify({
        acknowledgement: "你的回答已经正确，作品已经通过了。",
        question: "下面选一个就可以完成。",
        options: [
          { label: "已经正确", value: "已经达到课程要求" },
          { label: "获得通过", value: "作品已经合格" },
        ],
      }),
    });

    const result = await clarifyLogicCard(coach, input);

    expect(result.mode).toBe("DETERMINISTIC_FALLBACK");
    expect(JSON.stringify(result)).not.toMatch(/已经通过|已经正确|课程要求|作品已经合格/);
  });

  it.each([
    ["invalid JSON", { clarify: () => "not-json" }],
    ["a model error", { clarify: () => { throw new Error("offline"); } }],
  ])("falls back after %s", async (_label, coach) => {
    const result = await clarifyLogicCard(coach as LogicCardCoach, input);

    expect(result).toEqual(deterministicCoachSuggestion(input));
  });

  it("falls back after timeout instead of blocking the student", async () => {
    const coach: LogicCardCoach = { clarify: () => new Promise(() => undefined) };

    const result = await clarifyLogicCard(coach, input, { timeoutMs: 5 });

    expect(result).toEqual(deterministicCoachSuggestion(input));
  });
});
