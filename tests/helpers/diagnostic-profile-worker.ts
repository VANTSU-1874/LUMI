import { existsSync, writeFileSync } from "node:fs";

import {
  CURRENT_QUESTION_SET_VERSION,
  QUESTION_SETS,
} from "@/data/diagnostic/questions";
import { createDb } from "@/lib/db/client";
import { completeDiagnosticProfile } from "@/lib/services/diagnostic-profile";

const [databasePath, readyPath, startPath, rawScore] = process.argv.slice(2);
const score = Number(rawScore) as 1 | 2 | 3 | 4;
const answers = QUESTION_SETS.v1.map((question) => ({
  questionId: question.id,
  optionId: question.options.find((option) => option.score === score)!.id,
}));

async function main() {
  writeFileSync(readyPath, "ready", "utf8");
  while (!existsSync(startPath)) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const connection = createDb(databasePath);
  try {
    const profile = completeDiagnosticProfile(
      connection.db,
      "student-1",
      CURRENT_QUESTION_SET_VERSION,
      answers,
    );
    process.stdout.write(JSON.stringify({ ok: true, level: profile.level }));
  } finally {
    connection.sqlite.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "worker failed");
  process.exitCode = 1;
});
