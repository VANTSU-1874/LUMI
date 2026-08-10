import type { DatabaseConnection } from "@/lib/db/client";
import type { ModelProviderAdapter } from "./model-provider-adapter";
import { buildModelClient } from "./orchestrator-context";
import { getActiveAgentPolicy, resolveAgentPolicyTimeouts } from "./policy-registry";

const DEFAULT_TITLE = "未命名设计任务";
const TITLE_TIMEOUT_MS = 15_000;

type AiConfig = {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  embeddingModel?: string;
  maxOutputTokens?: number;
  vision?: boolean;
};

type TimeoutConfig = {
  modelIdleTimeoutMs: number;
  modelTotalTimeoutMs: number;
  turnTotalTimeoutMs: number;
};

export function sanitizeGeneratedDesignTaskTitle(raw: string) {
  const firstLine = raw
    .normalize("NFKC")
    .replace(/^\s*```(?:text)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .split(/\r?\n/, 1)[0]
    ?.replace(/^\s*(?:标题|title)\s*[:：]\s*/i, "") ?? "";
  const title = [...firstLine]
    .filter((character) => /\p{Script=Han}/u.test(character))
    .slice(0, 10)
    .join("");
  return title.length >= 2 && title !== DEFAULT_TITLE ? title : null;
}

function firstTurnStillUntitled(connection: DatabaseConnection, taskId: string) {
  return connection.sqlite.prepare(`
    SELECT d.title,
      (SELECT count(*)
       FROM agent_turns t
       JOIN agent_conversations c ON c.id=t.conversation_id
       WHERE c.task_id=d.id) turnCount
    FROM design_project_tasks d
    WHERE d.id=?
  `).get(taskId) as { title: string; turnCount: number } | undefined;
}

export async function generateFirstTurnDesignTaskTitle(input: {
  connection: DatabaseConnection;
  taskId: string;
  firstMessage: string;
  ai: AiConfig;
  timeouts: TimeoutConfig;
  modelProviderAdapter?: ModelProviderAdapter;
  now?: Date;
}) {
  try {
    const before = firstTurnStillUntitled(input.connection, input.taskId);
    if (!before || before.title !== DEFAULT_TITLE || before.turnCount !== 1) {
      return { updated: false, title: before?.title ?? null };
    }

    const policy = resolveAgentPolicyTimeouts(getActiveAgentPolicy(), input.timeouts);
    const client = input.modelProviderAdapter ?? buildModelClient({ ai: input.ai }, policy);
    if (!client) return { updated: false, title: DEFAULT_TITLE };

    const raw = await client.complete([
      {
        role: "system",
        content: [
          "你是 Lumi 的对话标题生成器。",
          "根据学生首条消息生成一个准确、具体的中文标题。",
          "只返回 2 到 10 个简体汉字，不要标点、引号、前缀、解释或换行。",
          "不得输出未命名设计任务。",
        ].join("\n"),
      },
      { role: "user", content: input.firstMessage },
    ], {
      signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
      totalTimeoutMs: TITLE_TIMEOUT_MS,
    });
    const title = sanitizeGeneratedDesignTaskTitle(raw);
    if (!title) return { updated: false, title: DEFAULT_TITLE };
    const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    const result = input.connection.sqlite.prepare(`
      UPDATE design_project_tasks
      SET title=?, updated_at=?
      WHERE id=? AND title=?
        AND (SELECT count(*)
          FROM agent_turns t
          JOIN agent_conversations c ON c.id=t.conversation_id
          WHERE c.task_id=design_project_tasks.id)=1
    `).run(title, now, input.taskId, DEFAULT_TITLE);
    return {
      updated: result.changes === 1,
      title: result.changes === 1 ? title : firstTurnStillUntitled(input.connection, input.taskId)?.title ?? null,
    };
  } catch {
    return { updated: false, title: DEFAULT_TITLE };
  }
}
