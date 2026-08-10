import { describe, expect, it } from "vitest";

import type { RecentConversationTurn } from "@/lib/agent/conversation-context";
import { emptyProjectBrief } from "@/lib/agent/project-brief-memory";
import {
  buildTutorContextMessage,
  buildTutorContextMessageWithSources,
  buildTutorSystemPrompt,
} from "@/lib/agent/v3/tutor-prompt";
import { bookDesignCoursePack } from "@/lib/course-packs/book-design";
import type { KnowledgeItem } from "@/lib/knowledge/retrieve";

function knowledge(index: number): KnowledgeItem {
  return {
    id: `source-${index}`,
    title: `资料标题${index}（课程设计）`,
    topic: "INFORMATION_HIERARCHY",
    tags: [`资料${index}`],
    content: "资料正文".repeat(2_000),
    facts: [
      { id: `hierarchy-fact-${index}-a`, text: "事实说明".repeat(55) },
      { id: `hierarchy-fact-${index}-b`, text: "另一事实".repeat(55) },
    ],
    actions: [
      { id: `hierarchy-action-${index}-a`, text: "行动说明".repeat(55) },
      { id: `hierarchy-action-${index}-b`, text: "另一行动".repeat(55) },
    ],
    source: {
      authority: "COURSE_DESIGN",
      verifiedDate: "2026-07-18",
      scope: "上下文预算测试",
      localDocument: `source-${index}.md`,
    },
  };
}

function evidence(index: number) {
  return {
    sourceId: `evidence:${index}`,
    evidenceId: `evidence-${index}`,
    label: `学习证据${index}`,
    kind: "TEXT" as const,
    signalLayer: "INPUT" as const,
    verificationStatus: "TEACHER_VERIFIED" as const,
    statement: "已核验的学习现场事实".repeat(30),
    boundary: "只能说明这条已核验事实。",
    evidenceSequence: index,
  };
}

describe("V3 tutor context source envelope", () => {
  it("conditions numeric design guidance on evidence and observable tests", () => {
    const prompt = buildTutorSystemPrompt(bookDesignCoursePack);

    expect(prompt).toContain("不要把百分比、字号、像素、间距或阈值写成普适答案");
    expect(prompt).toContain("试作起点");
    expect(prompt).toContain("示例范围");
    expect(prompt).toContain("对照测试");
    expect(prompt).toContain("可观察成功标准");
    expect(prompt).toContain("不要用精确数字制造专业感");
  });

  it("reports only references that survive context-budget compression", () => {
    const items = Array.from({ length: 5 }, (_, index) => knowledge(index + 1));
    const recentTurns: RecentConversationTurn[] = Array.from({ length: 8 }, () => ({
      studentMessage: "学生长消息".repeat(100),
      assistantTitle: "上一轮标题".repeat(20),
      assistantMessage: "导师长回答".repeat(180),
      episode: "UNDERSTAND",
    }));
    const input = {
      studentQuestion: "怎样安排信息层级和页序？",
      view: "AGENT",
      focus: null,
      pack: bookDesignCoursePack,
      context: {
        taskId: "task-1",
        studentId: "student-1",
        classId: "class-1",
        dataType: "REAL" as const,
        project: null,
        profile: null,
        onboarding: {
          nickname: "小岚",
          displayName: "小岚",
          major: "book-design" as const,
          selfAssessedLevel: "BEGINNER" as const,
          interests: "字体与装帧",
          completedAt: "2026-07-28T02:00:00.000Z",
          completed: true,
        },
        evidenceCount: 0,
        evidenceSummary: [],
        verifiedEvidenceFacts: Array.from({ length: 5 }, (_, index) => evidence(index + 1)),
        toolState: null,
        projectBrief: emptyProjectBrief(),
      },
      recentTurns,
      sessionSummary: null,
      studentMemories: [],
      knowledge: items,
      environment: {},
    };

    const built = buildTutorContextMessageWithSources(input);
    const parsed = JSON.parse(built.content) as {
      referenceMaterials: Array<{ sourceId: string }>;
      learningState: {
        verifiedEvidenceFacts: Array<{ sourceId: string }>;
        profile: unknown;
        learnerIdentity: {
          preferredName: string;
          declaredMajor: string;
          selfAssessedLevel: string;
          interests: string;
          selfReportAuthority: string;
          instruction: string;
        };
      };
    };
    const serializedIds = parsed.referenceMaterials.map(({ sourceId }) => sourceId);
    const serializedEvidenceIds = parsed.learningState.verifiedEvidenceFacts
      .map(({ sourceId }) => sourceId);

    expect(serializedIds.length).toBeGreaterThan(0);
    expect(serializedIds.length).toBeLessThan(items.length);
    expect(built.knowledgeSourceIds).toEqual(serializedIds);
    expect(serializedEvidenceIds.length).toBeGreaterThan(0);
    expect(serializedEvidenceIds.length).toBeLessThan(5);
    expect(built.evidenceSourceIds).toEqual(serializedEvidenceIds);
    expect(serializedIds).toEqual(items.slice(0, serializedIds.length).map(({ id }) => id));
    expect(parsed.learningState.learnerIdentity).toMatchObject({
      preferredName: "小岚",
      declaredMajor: "book-design",
      selfAssessedLevel: "BEGINNER",
      interests: "字体与装帧",
      selfReportAuthority: "SOFT_HINT_ONLY",
    });
    expect(parsed.learningState.learnerIdentity.instruction).toContain("必须以 profile 为准");
    expect(buildTutorContextMessage(input)).toBe(built.content);
  });

  it("keeps unanswered originals ordered and marks the latest steer as authoritative", () => {
    const content = buildTutorContextMessage({
      studentQuestion: "现在改成低饱和并减少装饰",
      view: "AGENT",
      focus: null,
      pack: bookDesignCoursePack,
      context: {
        taskId: "task-1",
        studentId: "student-1",
        classId: "class-1",
        dataType: "REAL",
        project: null,
        profile: null,
        onboarding: {
          nickname: null,
          displayName: "学生",
          major: null,
          selfAssessedLevel: null,
          interests: null,
          completedAt: null,
          completed: false,
        },
        evidenceCount: 0,
        evidenceSummary: [],
        verifiedEvidenceFacts: [],
        toolState: null,
        projectBrief: emptyProjectBrief(),
      },
      recentTurns: [],
      sessionSummary: null,
      studentMemories: [],
      knowledge: [],
      interventionContext: {
        mode: "STEER",
        unansweredMessages: [
          { id: "m1", content: "先做一张高对比海报" },
          { id: "m2", content: "再给三个版式方案" },
        ],
      },
      environment: {},
    });
    const parsed = JSON.parse(content) as {
      studentQuestion: string;
      unansweredStudentMessages: Array<{ id: string; content: string }>;
      intervention: { mode: string; instruction: string };
    };

    expect(parsed.studentQuestion).toBe("现在改成低饱和并减少装饰");
    expect(parsed.unansweredStudentMessages).toEqual([
      { id: "m1", content: "先做一张高对比海报" },
      { id: "m2", content: "再给三个版式方案" },
    ]);
    expect(parsed.intervention).toMatchObject({
      mode: "STEER",
      instruction: expect.stringContaining("优先"),
    });
  });
});

describe("requested Lumi Skill instructions", () => {
  it("loads the installer safety protocol only for the selected Skill", () => {
    const installerPrompt = buildTutorSystemPrompt(
      bookDesignCoursePack,
      undefined,
      "skill-installer",
    );
    const normalPrompt = buildTutorSystemPrompt(bookDesignCoursePack);

    expect(installerPrompt).toContain("本轮启用“Skill 安装”工作流");
    expect(installerPrompt).toContain("内容不可见就停止审查");
    expect(installerPrompt).toContain("只有真实的 Lumi 服务端安装工具返回成功");
    expect(normalPrompt).not.toContain("本轮启用“Skill 安装”工作流");
  });

  it("loads the creator structure and validation protocol", () => {
    const prompt = buildTutorSystemPrompt(
      bookDesignCoursePack,
      undefined,
      "skill-creator",
    );

    expect(prompt).toContain("本轮启用“Skill 创建”工作流");
    expect(prompt).toContain("YAML frontmatter 只保留 name 与 description");
    expect(prompt).toContain("没有真实执行验证时写“待验证”");
  });
});
