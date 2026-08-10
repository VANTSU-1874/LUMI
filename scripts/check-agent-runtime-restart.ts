import path from "node:path";

import { inspectPersistedAgentState } from "@/lib/agent/runtime-benchmark-restart";
import { createDb } from "@/lib/db/client";

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`MISSING_${name}`);
  return value;
}

function main() {
  const [databaseArg, userIdArg, taskIdArg, conversationIdArg, goalIncludesArg] = process.argv.slice(2);
  const databasePath = path.resolve(required(databaseArg, "DATABASE_PATH"));
  const connection = createDb(databasePath);
  try {
    const result = inspectPersistedAgentState({
      connection,
      actor: { userId: required(userIdArg, "USER_ID"), role: "STUDENT" },
      taskId: required(taskIdArg, "TASK_ID"),
      conversationId: required(conversationIdArg, "CONVERSATION_ID"),
      goalIncludes: required(goalIncludesArg, "GOAL_INCLUDES"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    connection.sqlite.close();
  }
}

main();
