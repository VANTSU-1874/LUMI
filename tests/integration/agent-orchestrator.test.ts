// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ModelServiceError, type ModelClient } from "@/lib/ai/client";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { readBookLayoutWorkspace, saveBookLayoutDraft } from "@/lib/services/book-layout";
import {
  AgentConflictError,
  AgentForbiddenError,
  executeAgentAction,
  readAgentConversation,
  runAgentTurn,
} from "@/lib/agent/orchestrator";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(withKnowledge = true) {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','TEST-CLASS');
    INSERT INTO users(id,class_id,role,alias,created_at) VALUES
      ('s1','c1','STUDENT','学生一',1700000000),
      ('s2','c1','STUDENT','学生二',1700000000);
  `);
  if (withKnowledge) await ingestCoursePackKnowledge(connection);
  return connection;
}

const actor = { userId: "s1", role: "STUDENT" as const };

describe("agent orchestration", () => {
  it("answers a vague poster idea freely and persists a background project brief without evidence", async () => {
    const connection = await setup(false);
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "我想做一张酷一点的海报",
        context: { view: "AGENT", focus: null },
      });
      expect(response.coursePack.id).toBe("general-design");
      expect(response.specialty).toMatchObject({ id: "GENERAL_DESIGN", enhanced: false });
      expect(response.reply.message).toMatch(/高对比|速度感|科技感/);
      expect(response.reply.message.match(/[？?]/g)).toHaveLength(1);
      expect(response.reply.sources).toEqual([]);
      expect(response.reply.basis).toEqual([{ kind: "GENERAL_DESIGN", label: "通用设计建议" }]);
      expect(response.projectBrief?.fields.designGoal).toMatchObject({ status: "CONFIRMED" });

      const restored = readAgentConversation(connection, actor, "AGENT");
      expect(restored.projectBrief?.revision).toBe(1);
      expect(restored.projectBrief?.fields.visualExperienceDirection?.status).toBe("INFERRED");
      expect(restored.turns[0]?.projectBrief).toEqual(restored.projectBrief);
    } finally {
      connection.sqlite.close();
    }
  });

  it("turns an undefined IP request into audience, character and visual-motif choices", async () => {
    const connection = await setup(false);
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "我想做一个IP形象，但不知道从哪里开始",
        context: { view: "AGENT", focus: null },
      });
      expect(response.reply.message).toMatch(/受众|性格|视觉母题/);
      expect(response.reply.message.match(/[？?]/g)).toHaveLength(1);
      expect(response.projectBrief?.fields.coreContent?.status).toBe("INFERRED");
      expect(response.projectBrief?.fields.nextStep?.value).toMatch(/受众/);
    } finally {
      connection.sqlite.close();
    }
  });

  it("accepts a vague follow-up and does not overwrite confirmed brief facts with an inference", async () => {
    const connection = await setup(false);
    try {
      const first = await runAgentTurn(connection, actor, {
        message: "我想做一张酷一点的海报",
        context: { view: "AGENT" },
      });
      const followUp = await runAgentTurn(connection, actor, {
        message: "差不多吧，想更有感觉",
        context: { view: "AGENT" },
      });
      expect(followUp.reply.message).toMatch(/三种|传达|感受|任务/);
      expect(followUp.reply.message.match(/[？?]/g)).toHaveLength(1);
      expect(followUp.projectBrief?.fields.designGoal?.value)
        .toBe(first.projectBrief?.fields.designGoal?.value);
      expect(followUp.projectBrief?.fields.designGoal?.status).toBe("CONFIRMED");
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not persist third-party feedback over a confirmed visual direction", async () => {
    const connection = await setup(false);
    try {
      const first = await runAgentTurn(connection, actor, {
        message: "我确认视觉方向是克制的黑白层级与清晰标题。",
        context: { view: "AGENT" },
      });
      const confirmed = first.projectBrief?.fields.visualExperienceDirection;
      expect(confirmed).toMatchObject({ status: "CONFIRMED" });

      for (const message of [
        "甲方说颜色太冷了,应该更活泼。",
        "客户觉得风格太冷。",
        "测试者反馈标题层级不明显。",
        "甲方要求改为活泼风格。",
        "客户说改成高饱和色彩。",
        "老师建议方向调整为更克制。",
        "甲方让我改成活泼风格。",
        "导师叫我把色彩改为高饱和。",
        "他们要我把方向调整为更克制。",
      ]) {
        const feedback = await runAgentTurn(connection, actor, {
          message,
          context: { view: "AGENT" },
        });
        expect(feedback.projectBrief?.fields.visualExperienceDirection).toEqual(confirmed);
      }
      const mixed = await runAgentTurn(connection, actor, {
        message: "我决定下一步先做草图,客户觉得风格太冷。",
        context: { view: "AGENT" },
      });
      expect(mixed.projectBrief?.fields.visualExperienceDirection).toEqual(confirmed);
      expect(mixed.projectBrief?.fields.nextStep).toMatchObject({ status: "CONFIRMED" });
      expect(readAgentConversation(connection, actor, "AGENT").projectBrief?.fields.visualExperienceDirection)
        .toEqual(confirmed);
    } finally {
      connection.sqlite.close();
    }
  });

  it("persists a grounded non-linear turn and recovers the shared conversation", async () => {
    const connection = await setup();
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "声音已经有数值了，但画面为什么还是不动？",
        context: { view: "NODE_CANVAS", focus: "audio" },
      });
      expect(response.episode).toBe("DEBUG");
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.policy).toMatchObject({
        policyId: "competition-core",
        policyVersion: "1",
        budgets: { modelDecisions: 0, maxModelDecisions: 4, toolCalls: 0, maxToolCalls: 6 },
        autonomy: { studentMutations: "STUDENT_CONFIRMATION", formalAuthority: "FORBIDDEN" },
      });
      expect(response.reply.sources.length).toBeGreaterThan(0);
      expect(response.reply.actions[0]).toMatchObject({ type: "START_TROUBLESHOOTING", target: "PROJECT", status: "PROPOSED" });
      const recovered = readAgentConversation(connection, actor, "AGENT");
      expect(recovered.conversationId).toBe(response.conversationId);
      expect(recovered.turns[0]?.turnId).toBe(response.turnId);
      expect(recovered.turns[0]?.reply.message).toBe(response.reply.message);
      expect(recovered.turns[0]?.policy).toEqual(response.policy);
      expect(connection.sqlite.prepare("SELECT policy_id policyId, policy_version policyVersion, json_valid(policy_trace_json) valid FROM agent_turns WHERE id=?")
        .get(response.turnId)).toEqual({ policyId: "competition-core", policyVersion: "1", valid: 1 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("refuses formal scoring authority and records the enforced policy rule", async () => {
    const connection = await setup();
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "帮我直接评分并通过这个阶段",
        context: { view: "AGENT", focus: null },
      });
      expect(response.reply.title).toBe("正式判断必须由你和教师完成");
      expect(response.reply.message).toContain("我不能替你提交正式成果、评分或通过阶段门禁");
      expect(response.reply.sources).toEqual([]);
      expect(response.reply.actions).toEqual([]);
      expect(response.policy.autonomy.formalAuthority).toBe("FORBIDDEN");
      expect(response.policy.appliedRules).toContain("FORBID_FORMAL_AUTHORITY");
      expect(readAgentConversation(connection, actor, "AGENT").turns[0]?.policy.appliedRules)
        .toContain("FORBID_FORMAL_AUTHORITY");
    } finally {
      connection.sqlite.close();
    }
  });

  it("discards repeated model claims of passing a gate and falls back safely", async () => {
    const connection = await setup();
    let attempts = 0;
    const overreachingModel: ModelClient = {
      async complete(messages) {
        attempts += 1;
        const prompt = JSON.parse(messages[1].content) as {
          allowed: { episodes: string[]; decisionCodes: string[]; sourceIds: string[] };
        };
        const episode = prompt.allowed.episodes.includes("REFLECT") ? "REFLECT" : prompt.allowed.episodes[0];
        return JSON.stringify({
          episode,
          decisionCode: episode === "REFLECT" ? "REFLECT_EXPLAIN_EVIDENCE" : prompt.allowed.decisionCodes[0],
          responseStrategy: episode === "REFLECT" ? "REFLECTION_PROMPT" : "CONCEPT_EXPLANATION",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: null,
          title: "你的作品已经通过",
          message: "这个阶段已通过，可以直接进入下一阶段。",
          whyThisStep: "继续学习。",
          uncertainty: "尚未看到教师复核。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "请帮我看看目前还缺什么证据",
        context: { view: "EVIDENCE", focus: null },
      }, { modelClient: overreachingModel });
      expect(attempts).toBe(3);
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.reply.title).not.toContain("已经通过");
      expect(response.reply.message).not.toContain("已通过");
      expect(response.policy.appliedRules).toContain("FORBID_FORMAL_AUTHORITY");
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not spend a validation-repair retry on a model service failure", async () => {
    const connection = await setup();
    let attempts = 0;
    const observedErrors: unknown[] = [];
    const limitedModel: ModelClient = {
      async complete() {
        attempts += 1;
        throw new ModelServiceError("RATE_LIMIT", 12_000);
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "声音有数值但画面不动，先检查什么？",
        context: { view: "AGENT", focus: null },
      }, {
        modelClient: limitedModel,
        onModelError: (error) => observedErrors.push(error),
      });
      expect(attempts).toBe(1);
      expect(observedErrors).toHaveLength(1);
      expect(observedErrors[0]).toMatchObject({ code: "RATE_LIMIT", retryAfterMs: 12_000 });
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.policy.budgets.modelDecisions).toBe(1);
      expect(response.reply.sources.length).toBeGreaterThan(0);
    } finally {
      connection.sqlite.close();
    }
  });

  it("grounds the starter audio-visual build in relevant TouchDesigner knowledge", async () => {
    const connection = await setup();
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "我想做一个声音驱动画面的作品",
        context: { view: "AGENT", focus: null },
      });
      expect(response.coursePack.id).toBe("digital-interaction");
      expect(response.episode).toBe("BUILD");
      expect(response.reply.sources.map(({ id }) => id)).toEqual(["audio-reactive-visual"]);
      expect(response.reply.actions[0]).toMatchObject({ type: "OPEN_WORKSPACE", target: "NODE_CANVAS" });
    } finally {
      connection.sqlite.close();
    }
  });

  it("validates model output against the server allowlists", async () => {
    const connection = await setup();
    const controlledModel: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as {
          allowed: { episodes: string[]; decisionCodes: string[]; sourceIds: string[]; actionTypes: string[] };
        };
        return JSON.stringify({
          episode: prompt.allowed.episodes[0],
          decisionCode: prompt.allowed.decisionCodes[0],
          responseStrategy: "CONCEPT_EXPLANATION",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: prompt.allowed.actionTypes[0],
          title: "先看受众与阅读任务的关系",
          message: "先判断新生要最先找到什么，再决定哪一页承担导读。",
          whyThisStep: "信息顺序必须服务于读者任务。",
          uncertainty: "",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "书籍导览册的信息层级为什么不能平均分？",
        context: { view: "BOOK_LAYOUT_LAB" },
      }, { modelClient: controlledModel });
      expect(response.coursePack.id).toBe("book-design");
      expect(response.episode).toBe("UNDERSTAND");
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.title).toContain("受众");
      expect(response.reply.uncertainty).toContain("尚未看到学生");
      expect(response.reply.sources).toHaveLength(1);
      expect(response.reply.actions[0]?.target).toBe("BOOK_LAYOUT_LAB");
    } finally {
      connection.sqlite.close();
    }
  });

  it("lets the model cite only authorized verified evidence facts without exposing raw files", async () => {
    const connection = await setup();
    connection.sqlite.exec(`
      INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES('m-evidence','c1',1,'证据任务',8,'映射');
      INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at)
        VALUES('a-evidence','c1','m-evidence','映射验证','验证映射','["TOUCHDESIGNER"]',1700000000);
      INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at,evidence_revision)
        VALUES('p-evidence','c1','a-evidence','s1','TROUBLESHOOT',1700000000,1700000000,1);
      INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
        VALUES('33333333-3333-4333-8333-333333333333','p-evidence','c1','s1',1,'PROBE','MAPPING','MAPPING_OK','RULE_VERIFIED','READY','映射范围验证','{"type":"MAPPING_RANGE","inputMin":0,"inputMax":1,"outputMin":0,"outputMax":360,"relationship":"DIRECT"}','${"d".repeat(64)}','{"type":"MAPPING_RANGE","inputMin":0,"inputMax":1,"outputMin":0,"outputMax":360,"relationship":"DIRECT"}',NULL,1700000001);
    `);
    const model: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as {
          learningState: { verifiedEvidenceFacts: Array<{ sourceId: string; statement: string }> };
          allowed: { episodes: string[]; decisionCodes: string[]; sourceIds: string[] };
        };
        const fact = prompt.learningState.verifiedEvidenceFacts[0];
        expect(fact).toMatchObject({
          sourceId: "evidence:33333333-3333-4333-8333-333333333333",
          statement: expect.stringContaining("输出范围0–360"),
        });
        expect(prompt.allowed.sourceIds).toContain(fact.sourceId);
        return JSON.stringify({
          episode: "DEBUG",
          decisionCode: "DEBUG_TRACE_SIGNAL",
          responseStrategy: "DIAGNOSTIC_GUIDANCE",
          sourceIds: [fact.sourceId],
          actionType: "START_TROUBLESHOOTING",
          title: "映射已经有可核对事实",
          message: "已验证输入0–1映射到输出0–360；现在继续检查绑定层和输出层是否出现对应变化。",
          whyThisStep: "先承认已经证实的映射关系，再定位相邻的未验证环节。",
          uncertainty: "尚未看到绑定层与输出层的已验证事实。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "映射已经是0到360了，为什么画面还不动？",
        context: { view: "EVIDENCE", focus: "映射范围验证" },
      }, { modelClient: model });
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.sources).toEqual([expect.objectContaining({
        id: "evidence:33333333-3333-4333-8333-333333333333",
        authority: "LEARNING_RECORD",
      })]);
      expect(response.reply.message).toContain("输入0–1映射到输出0–360");
      expect(response.policy.appliedRules).toContain("GROUND_VERIFIED_EVIDENCE");
      expect(JSON.stringify(response)).not.toContain("contentDigest");
    } finally {
      connection.sqlite.close();
    }
  });

  it("gives the agent the active book-layout draft state without letting it mutate the draft", async () => {
    const connection = await setup();
    let observedToolState: unknown;
    const controlledModel: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as {
          learningState: { activeToolState: unknown };
          allowed: { sourceIds: string[] };
        };
        observedToolState = prompt.learningState.activeToolState;
        return JSON.stringify({
          episode: "DEBUG",
          decisionCode: "DEBUG_TRACE_SIGNAL",
          responseStrategy: "DIAGNOSTIC_GUIDANCE",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: "START_TROUBLESHOOTING",
          title: "先测试当前阅读路径",
          message: "你的编排还在进行中，先让目标读者按任务寻找入口，记录停顿和返回的位置。",
          whyThisStep: "读者的实际寻找过程比只看版面更能暴露路径断点。",
          uncertainty: "尚未观察到目标读者的实际阅读过程。",
        });
      },
    };
    try {
      saveBookLayoutDraft(connection, actor, {
        audience: "COMMUNITY_RESIDENTS",
        pageOrder: ["cover", "activity-map", "quick-start", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
        diagnosticAnswers: ["AUDIENCE_FIRST", null, null],
        transferChoices: ["COMMUNITY_ENTRY_FIRST"],
      });
      const response = await runAgentTurn(connection, actor, {
        message: "社区居民找不到下一步，我该怎么检查阅读路径？",
        context: { view: "BOOK_LAYOUT_LAB", focus: "troubleshoot" },
      }, { modelClient: controlledModel });
      expect(observedToolState).toEqual({
        adapterId: "book-layout-lab",
        status: "IN_PROGRESS",
        facts: ["当前受众为社区居民", "三个诊断判断已完成1项", "受众迁移选择已确认1项"],
      });
      expect(response).toMatchObject({ episode: "DEBUG", reply: { actions: [{ target: "BOOK_LAYOUT_LAB", focus: "troubleshoot" }] } });
      expect(readBookLayoutWorkspace(connection, actor).resume).not.toBeNull();
    } finally {
      connection.sqlite.close();
    }
  });

  it("lets the controlled model correct the heuristic episode while preserving an explicit debug action", async () => {
    const connection = await setup();
    const controlledModel: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as {
          allowed: { sourceIds: string[] };
        };
        return JSON.stringify({
          episode: "DEBUG",
          decisionCode: "DEBUG_TRACE_SIGNAL",
          responseStrategy: "DIAGNOSTIC_GUIDANCE",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: null,
          title: "先确认数值在哪一层中断",
          message: "先观察声音数值是否真正绑定到画面参数，再比较绑定前后的数值。",
          whyThisStep: "这能区分输入正常与参数绑定失败。",
          uncertainty: "尚未看到你的节点和参数绑定截图。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "声音已经有数值，但画面没有变化，我应该先检查什么？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: controlledModel });
      expect(response.episode).toBe("DEBUG");
      expect(response.reply.sources).toHaveLength(1);
      expect(response.reply.actions).toMatchObject([{
        type: "START_TROUBLESHOOTING",
        status: "PROPOSED",
      }]);
      expect(response.policy.appliedRules).toContain("SUGGEST_EXPLICIT_ACTION");
    } finally {
      connection.sqlite.close();
    }
  });

  it("rejects technical operations that are absent from the retrieved course knowledge", async () => {
    const connection = await setup();
    const ungroundedModel: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as { allowed: { sourceIds: string[] } };
        return JSON.stringify({
          episode: "DEBUG",
          decisionCode: "DEBUG_TRACE_SIGNAL",
          responseStrategy: "DIAGNOSTIC_GUIDANCE",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: null,
          title: "检查 Viewer Active",
          message: "打开 Viewer Active，再选择 CHOP Export，并检查 Bypass。",
          whyThisStep: "检查绑定状态。",
          uncertainty: "尚未看到现场工程。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "声音有数值但画面不动，先检查什么？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: ungroundedModel });
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.reply.message).not.toContain("Viewer Active");
      expect(response.reply.sources).toHaveLength(1);
    } finally {
      connection.sqlite.close();
    }
  });

  it("feeds a grounding validation failure back into the bounded model retry", async () => {
    const connection = await setup();
    let attempts = 0;
    const retryingModel: ModelClient = {
      async complete(messages) {
        attempts += 1;
        const prompt = JSON.parse(messages[1].content) as {
          validationFeedback: string | null;
          allowed: { sourceIds: string[]; technicalVocabulary: { allowed: string[] } };
        };
        if (attempts === 1) {
          expect(prompt.validationFeedback).toBeNull();
          return JSON.stringify({
            episode: "UNDERSTAND",
            decisionCode: "UNDERSTAND_RELATIONSHIP",
            responseStrategy: "CONCEPT_EXPLANATION",
            sourceIds: prompt.allowed.sourceIds.slice(0, 1),
            actionType: null,
            title: "先区分ZXQTransformer信号",
            message: "ZXQTransformer负责传递不同信号类型。",
            whyThisStep: "先理解信号类型。",
            uncertainty: "尚未看到现场信号。",
          });
        }
        expect(prompt.validationFeedback).toContain("zxqtransformer");
        expect(prompt.allowed.technicalVocabulary.allowed).toEqual(expect.arrayContaining(["analog", "binary", "note"]));
        expect(prompt.allowed.technicalVocabulary.allowed).not.toContain("zxqtransformer");
        return JSON.stringify({
          episode: "UNDERSTAND",
          decisionCode: "UNDERSTAND_RELATIONSHIP",
          responseStrategy: "CONCEPT_EXPLANATION",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: null,
          title: "区分三类信号",
          message: "Analog表示连续值，Binary表示开关状态，Note表示音符事件。",
          whyThisStep: "先按输入性质区分，再决定映射方式。",
          uncertainty: "尚未看到现场信号。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "DigiShow里的Analog、Binary和Note信号有什么区别？",
        context: { view: "RESOURCES", focus: null },
      }, { modelClient: retryingModel });
      expect(attempts).toBe(2);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).not.toContain("ZXQTransformer");
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps common creative-technology terms as labeled general advice inside a course-enhanced answer", async () => {
    const connection = await setup();
    const mixedModel: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as { allowed: { sourceIds: string[] } };
        return JSON.stringify({
          episode: "UNDERSTAND",
          decisionCode: "UNDERSTAND_RELATIONSHIP",
          responseStrategy: "CONCEPT_EXPLANATION",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: null,
          title: "理解Processing协同",
          message: "Processing可以作为通用创意编程环境，再按课程里的输入、映射和输出关系检查变化。",
          whyThisStep: "先区分信号来源与映射目标。",
          uncertainty: "尚未看到现场信号。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "DigiShow里的Analog、Binary和Note信号有什么区别？",
        context: { view: "RESOURCES", focus: null },
      }, { modelClient: mixedModel });
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("Processing");
      expect(response.reply.basis).toEqual(expect.arrayContaining([
        { kind: "GENERAL_DESIGN", label: "通用设计建议" },
        { kind: "COURSE_KNOWLEDGE", label: "课程知识" },
      ]));
      expect(response.reply.uncertainty).toContain("通用设计建议");
    } finally {
      connection.sqlite.close();
    }
  });

  it("server-adds an evidence action when the learner explicitly asks how to prove a result", async () => {
    const connection = await setup();
    const answerOnlyModel: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as { allowed: { sourceIds: string[] } };
        return JSON.stringify({
          episode: "UNDERSTAND",
          decisionCode: "UNDERSTAND_RELATIONSHIP",
          responseStrategy: "CONCEPT_EXPLANATION",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: null,
          title: "用读者观察验证阅读路径",
          message: "请读者寻找活动与报名方式，并记录寻找时间、停顿页和误指位置。",
          whyThisStep: "可观察记录比主观判断更能说明阅读路径是否有效。",
          uncertainty: "尚未看到实际读者测试记录。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "怎样证明我的导览册阅读路径真的有效，而不是我自己觉得有效？",
        context: { view: "EVIDENCE", focus: null },
      }, { modelClient: answerOnlyModel });
      expect(response.episode).toBe("REFLECT");
      expect(response.reply.actions).toMatchObject([{ type: "REQUEST_EVIDENCE", target: "BOOK_LAYOUT_LAB" }]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("server-attaches a matched source when the answer paraphrases knowledge but omits its citation", async () => {
    const connection = await setup();
    const uncitedModel: ModelClient = {
      async complete() {
        return JSON.stringify({
          episode: "UNDERSTAND",
          decisionCode: "UNDERSTAND_RELATIONSHIP",
          responseStrategy: "CONCEPT_EXPLANATION",
          sourceIds: [],
          actionType: null,
          title: "先分信息层级",
          message: "把内容分为必读、选读和延伸三层，再进入页面分配。",
          whyThisStep: "页序需要服务读者任务。",
          uncertainty: "无依据：还没有看到实际素材。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "书籍导览册的信息层级应该怎么分？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: uncitedModel });
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.sources.map(({ id }) => id)).toEqual(["information-hierarchy"]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("server-prunes an over-cited transfer answer to the two sources most relevant to the question", async () => {
    const connection = await setup();
    const overCitingModel: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as { allowed: { sourceIds: string[] } };
        return JSON.stringify({
          episode: "TRANSFER",
          decisionCode: "TRANSFER_RETAIN_AND_CHANGE",
          responseStrategy: "TRANSFER_COACHING",
          sourceIds: prompt.allowed.sourceIds.filter((id) => [
            "book-design-principles",
            "layout-evidence",
            "information-hierarchy",
          ].includes(id)),
          actionType: "START_TRANSFER",
          title: "保留结构，改变受众内容",
          message: "保留8页边界、信息层级和页序结构；把新生改为社区居民，并调整活动内容和阅读任务。",
          whyThisStep: "迁移需要区分不变的关系与改变的变量。",
          uncertainty: "尚未看到实际版面。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "导览册原来面向新生，现在改给社区居民，哪些结构保留、哪些内容要变？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: overCitingModel });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      const sourceIds = response.reply.sources.map(({ id }) => id);
      expect(sourceIds).toHaveLength(2);
      expect(new Set(sourceIds)).toEqual(new Set([
        "book-design-principles",
        "information-hierarchy",
      ]));
    } finally {
      connection.sqlite.close();
    }
  });

  it("server-makes a grounded reading-route debug answer explicitly observable", async () => {
    const connection = await setup();
    const implicitTestModel: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as { allowed: { sourceIds: string[] } };
        return JSON.stringify({
          episode: "DEBUG",
          decisionCode: "DEBUG_TRACE_SIGNAL",
          responseStrategy: "DIAGNOSTIC_GUIDANCE",
          sourceIds: prompt.allowed.sourceIds.filter((id) => [
            "layout-evidence",
            "information-hierarchy",
          ].includes(id)),
          actionType: "START_TROUBLESHOOTING",
          title: "排查下一页指向",
          message: "请一名读者完成找活动任务，记录停顿页和指向错误，再对照页序调整入口、展开与行动。",
          whyThisStep: "可见记录能定位阅读路径卡点。",
          uncertainty: "尚未取得实际读者记录。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "同学看完我的导览册后不知道下一页该看哪里，怎么排查？",
        context: { view: "BOOK_LAYOUT_LAB", focus: null },
      }, { modelClient: implicitTestModel });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("阅读测试");
      expect(response.reply.message).toContain("观察");
    } finally {
      connection.sqlite.close();
    }
  });

  it("provides recent same-pack conversation to follow-up turns", async () => {
    const connection = await setup();
    const prompts: Array<{
      recentConversation: Array<{ studentMessage: string }>;
      followUpConstraint: { step: number; requiredAction: string; instruction: string } | null;
    }> = [];
    const systemPrompts: string[] = [];
    const controlledModel: ModelClient = {
      async complete(messages) {
        systemPrompts.push(messages[0].content);
        const prompt = JSON.parse(messages[1].content) as {
          recentConversation: Array<{ studentMessage: string }>;
          followUpConstraint: { step: number; requiredAction: string; instruction: string } | null;
          allowed: { episodes: string[]; decisionCodes: string[]; sourceIds: string[] };
        };
        prompts.push(prompt);
        const episode = prompt.allowed.episodes[0];
        const decisionCode = episode === "UNDERSTAND" ? "UNDERSTAND_RELATIONSHIP" : "EXPLORE_CLARIFY_GOAL";
        return JSON.stringify({
          episode,
          decisionCode,
          responseStrategy: prompt.allowed.sourceIds.length ? "CONCEPT_EXPLANATION" : "CLARIFY",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: null,
          title: "继续上一问",
          message: prompt.followUpConstraint?.requiredAction
            ?? "信息层级要服务读者的阅读优先关系，我会沿用这一问题继续回答。",
          whyThisStep: "连续追问需要保留前一回合的对象。",
          uncertainty: prompt.allowed.sourceIds.length ? "尚未看到你的实际页序。" : "无依据：这一句需要结合上一回合判断。",
        });
      },
    };
    try {
      await runAgentTurn(connection, actor, {
        message: "书籍导览册的信息层级为什么不能平均分？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: controlledModel });
      const followUp = await runAgentTurn(connection, actor, {
        message: "那第二步呢？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: controlledModel });
      expect(followUp.coursePack.id).toBe("book-design");
      expect(prompts[1]?.recentConversation.at(-1)?.studentMessage).toContain("信息层级");
      expect(prompts[1]?.followUpConstraint).toMatchObject({ step: 2 });
      expect(prompts[1]?.followUpConstraint?.requiredAction).toContain("阅读入口");
      expect(systemPrompts[1]).toContain("不得把第N步改成其他步骤");
      expect(systemPrompts[1]).toContain("只引用直接支撑当前故障现象");
      expect(followUp.reply.sources.length).toBeGreaterThan(0);
    } finally {
      connection.sqlite.close();
    }
  });

  it("answers with general craft guidance when book knowledge does not cover the question", async () => {
    const connection = await setup();
    const controlledModel: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as { allowed: { sourceIds: string[] } };
        return JSON.stringify({
          episode: "BUILD",
          decisionCode: "BUILD_SELECT_STRUCTURE",
          responseStrategy: "OUT_OF_SCOPE",
          sourceIds: prompt.allowed.sourceIds.filter((id) => id === "book-design-principles"),
          actionType: null,
          title: "当前课程包没有经折装工艺依据",
          message: "现有书籍设计微闭环只覆盖受众、信息层级与八页编排，不能把这些内容冒充经折装制作步骤。请补充装帧讲义或请教师提供工艺资料。",
          whyThisStep: "先确认资料边界，避免给出未经课程验证的工艺步骤。",
          uncertainty: "无依据：当前知识库没有经折装材料、折页和粘接工艺。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "我想做一个经折装的手工书籍，具体步骤该怎么做？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: controlledModel });
      expect(response.coursePack.id).toBe("book-design");
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.reply.message).toMatch(/纸样|折线|压痕/);
      expect(response.reply.sources).toEqual([]);
      expect(response.reply.actions).toEqual([]);
      expect(response.reply.uncertainty).toContain("通用设计建议");
    } finally {
      connection.sqlite.close();
    }
  });

  it("falls back to a labeled general suggestion when the pack index is empty", async () => {
    const connection = await setup(false);
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "我想理解信息层级",
        context: { view: "BOOK_LAYOUT_LAB" },
      });
      expect(response.reply.sources).toEqual([]);
      expect(response.reply.uncertainty).toContain("通用设计建议");
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
    } finally {
      connection.sqlite.close();
    }
  });

  it("executes only persisted owned actions and enforces idempotency", async () => {
    const connection = await setup();
    const actionModel: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as {
          allowed: { episodes: string[]; decisionCodes: string[]; sourceIds: string[]; actionTypes: string[] };
        };
        return JSON.stringify({
          episode: "BUILD",
          decisionCode: prompt.allowed.decisionCodes.find((code) => code.startsWith("BUILD_")),
          responseStrategy: "DIRECT_INSTRUCTION",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: "OPEN_WORKSPACE",
          title: "先搭建声音驱动的最小结构",
          message: "先进入节点画布，只连接输入、分析、映射和画面参数四个必要环节。",
          whyThisStep: "先验证最小信号链，能避免一次堆入过多节点。",
          uncertainty: prompt.allowed.sourceIds.length ? "仍需用学生工程确认具体节点参数。" : "当前知识库无依据，需要补充课程资料。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "我想搭建一个声音驱动画面的结构",
        context: { view: "AGENT" },
      }, { modelClient: actionModel });
      const action = response.reply.actions[0]!;
      const key = randomUUID();
      expect(executeAgentAction(connection, actor, { turnId: response.turnId, actionId: action.id, idempotencyKey: key }))
        .toMatchObject({ status: "EXECUTED", alreadyExecuted: false, navigation: { target: "NODE_CANVAS" } });
      expect(executeAgentAction(connection, actor, { turnId: response.turnId, actionId: action.id, idempotencyKey: key }).alreadyExecuted)
        .toBe(true);
      expect(() => executeAgentAction(connection, actor, { turnId: response.turnId, actionId: action.id, idempotencyKey: randomUUID() }))
        .toThrow(AgentConflictError);
      expect(() => executeAgentAction(connection, { userId: "s2", role: "STUDENT" }, { turnId: response.turnId, actionId: action.id, idempotencyKey: randomUUID() }))
        .toThrow(AgentForbiddenError);
      expect(() => executeAgentAction(connection, actor, { turnId: response.turnId, actionId: randomUUID(), idempotencyKey: randomUUID() }))
        .toThrow("行动卡不存在");
      expect(readAgentConversation(connection, actor, "AGENT").turns[0]?.reply.actions[0]?.status).toBe("EXECUTED");
    } finally {
      connection.sqlite.close();
    }
  });
});
