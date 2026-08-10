// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ModelClient } from "@/lib/ai/client";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { saveAgentDecisionReview, AgentReviewNotFoundError } from "@/lib/services/agent-review";
import { readLearnerDetail } from "@/lib/services/teacher-analytics";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("teacher agent decision review", () => {
  it("shows the decision chain and lets a teacher confirm or correct it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-review-"));
    roots.push(root);
    const databasePath = path.join(root, "review.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','测试班','REVIEW-CLASS');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('s1','c1','STUDENT','学习者',1700000000),
        ('t1',NULL,'TEACHER','教师',1700000000);
    `);
    await ingestCoursePackKnowledge(connection);
    try {
      const model: ModelClient = {
        async complete(messages) {
          const prompt = JSON.parse(messages[1].content) as {
            allowed: { sourceIds: string[] };
            toolObservations: Array<{ sourceId: string }>;
          };
          if (prompt.toolObservations.length === 0) {
            return JSON.stringify({ step: "CALL_TOOL", toolId: "project-evidence.read-state", arguments: {} });
          }
          return JSON.stringify({
            step: "ANSWER",
            episode: "DEBUG",
            decisionCode: "DEBUG_TRACE_SIGNAL",
            responseStrategy: "DIAGNOSTIC_GUIDANCE",
            sourceIds: [prompt.toolObservations[0]?.sourceId],
            actionType: "START_TROUBLESHOOTING",
            title: "先建立可观察的项目证据",
            message: "当前没有可读取的项目与证据，先进入排障工作区检查Math后的数值范围与映射，再核对Null通道和视觉参数引用并记录实际现象。",
            whyThisStep: "读取学习现场后确认没有项目证据，继续猜测不能形成可复核判断。",
            uncertainty: "尚未看到学生的项目、参数和输出节点状态。",
          });
        },
      };
      const turn = await runAgentTurn(connection, { userId: "s1", role: "STUDENT" }, {
        message: "声音有数值但画面不动",
        context: { view: "NODE_CANVAS" },
      }, { modelClient: model });
      const first = saveAgentDecisionReview(connection, { userId: "t1", role: "TEACHER" }, {
        turnId: turn.turnId, decision: "CONFIRMED", notes: "排障情境与证据请求合理。",
      }, new Date("2026-07-14T09:00:00.000Z"));
      const corrected = saveAgentDecisionReview(connection, { userId: "t1", role: "TEACHER" }, {
        turnId: turn.turnId, decision: "CORRECTED", notes: "应先核对输出节点是否激活。",
      }, new Date("2026-07-14T09:01:00.000Z"));
      expect(corrected.id).toBe(first.id);
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_decision_reviews").get()).toEqual({ count: 1 });
      const detail = readLearnerDetail(connection.db, "c1", "s1");
      expect(detail.agentTimeline?.[0]).toMatchObject({
        turnId: turn.turnId,
        episode: "DEBUG",
        coursePackId: "digital-interaction",
        aiMode: "MODEL_ASSISTED",
        policy: {
          policyId: "competition-core",
          policyVersion: "1",
          budgets: { modelDecisions: 2, toolCalls: 1 },
        },
        executionSteps: [
          { sequence: 1, kind: "MODEL_DECISION" },
          { sequence: 2, kind: "TOOL_CALL", toolId: "project-evidence.read-state" },
          { sequence: 3, kind: "TOOL_OBSERVATION", status: "EMPTY" },
          { sequence: 4, kind: "MODEL_DECISION" },
          { sequence: 5, kind: "FINAL_RESPONSE" },
        ],
        toolCalls: [{
          sequence: 1,
          toolId: "project-evidence.read-state",
          status: "EMPTY",
          input: {},
        }],
        reply: {
          whyThisStep: expect.any(String),
          sources: [{ id: expect.any(String), title: expect.any(String) }],
          actions: [{ label: "开始证据排障", status: "PROPOSED" }],
        },
        review: { decision: "CORRECTED", notes: "应先核对输出节点是否激活。" },
      });
      expect(() => saveAgentDecisionReview(connection, { userId: "t1", role: "TEACHER" }, {
        turnId: "99999999-9999-4999-8999-999999999999", decision: "CONFIRMED", notes: "不存在",
      })).toThrow(AgentReviewNotFoundError);
    } finally {
      connection.sqlite.close();
    }
  });
});
