import { randomInt } from "node:crypto";

import {
  CURRENT_QUESTION_SET_VERSION,
  QUESTION_SETS,
} from "@/data/diagnostic/questions";

type RandomIndex = (upperExclusive: number) => number;

export function buildPublicQuestionResponse(
  randomIndex: RandomIndex = (upperExclusive) => randomInt(upperExclusive),
) {
  const questions = QUESTION_SETS[CURRENT_QUESTION_SET_VERSION];
  return {
    questionSetVersion: CURRENT_QUESTION_SET_VERSION,
    questions: questions.map(({ id, scenario, options }) => ({
      id,
      scenario,
      options: (() => {
        const publicOptions = options.map(({ id: optionId, label }) => ({
          id: optionId,
          label,
        }));
        for (let index = publicOptions.length - 1; index > 0; index -= 1) {
          const swapIndex = randomIndex(index + 1);
          [publicOptions[index], publicOptions[swapIndex]] = [
            publicOptions[swapIndex],
            publicOptions[index],
          ];
        }
        return publicOptions;
      })(),
    })),
  };
}
