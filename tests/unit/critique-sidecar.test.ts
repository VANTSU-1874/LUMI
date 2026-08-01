import { describe, expect, it } from "vitest";

import { CRITIQUE_DIMENSION_IDS } from "@/lib/agent/critique-contract";
import { parseTutorSidecar } from "@/lib/agent/v3/tutor-sidecar";

const artworkSourceId = "artwork:20000000-0000-4000-8000-000000000001";
const studentMessage = "请点评这张数字交互作品。";

const boundOptions = {
  enabled: true,
  courseId: "digital-interaction",
  studentMessage,
  artworkSourceId,
};

function critique() {
  return {
    frameworkId: "critique-framework-five-plus-closure",
    frameworkVersion: "1.0",
    dimensions: CRITIQUE_DIMENSION_IDS.map((id, index) => ({
      id,
      label: ["目标", "创意转译", "构成与层级", "形式语言", "工艺与规范"][index],
      displayOrder: index + 1,
      status: index === 4 ? "NEEDS_EVIDENCE" : "DEVELOPING",
      observation: "只描述画面可见的关系。",
      evidence: [{ kind: "ARTWORK_REGION", label: "画面中央的主视觉", reference: artworkSourceId }],
      guidance: { level: "HINT", message: "先只调整一处并比较。" },
      isDeepDive: index === 2,
    })),
    closure: {
      established: "主视觉入口已经成立。",
      nextStep: "下一步只调整说明文字与主视觉的距离。",
    },
  };
}

function response(value: unknown) {
  return `自然正文完整保留。\n\n<!-- tutor-meta ${JSON.stringify({ critique: value })} -->`;
}

describe("optional critique sidecar", () => {
  it("accepts only a complete evidence-bound five-plus-closure draft", () => {
    const parsed = parseTutorSidecar(response(critique()), {
      ...boundOptions,
      allowedCourseSourceIds: new Set(),
    });
    expect(parsed.text).toBe("自然正文完整保留。");
    expect(parsed.status).toBe("PARSED");
    expect(parsed.critiqueStatus).toBe("PARSED");
    expect(parsed.sidecar?.critique?.dimensions).toHaveLength(5);
    expect(parsed.sidecar?.critique?.closure.established).toContain("成立");
  });

  it("accepts a normalized student-statement excerpt only when it is present in this turn", () => {
    const value = critique();
    value.dimensions[0]!.evidence = [{
      kind: "STUDENT_STATEMENT",
      label: "我想做一张面向新生的海报",
      reference: "student-message",
    }];
    const parsed = parseTutorSidecar(response(value), {
      ...boundOptions,
      studentMessage: "我 想做一张面向新生的海报。",
    });
    expect(parsed.critiqueStatus).toBe("PARSED");
  });

  it("drops an incomplete critique without dropping the natural body", () => {
    const invalid = { ...critique(), closure: undefined };
    const parsed = parseTutorSidecar(response(invalid), {
      ...boundOptions,
    });
    expect(parsed.text).toBe("自然正文完整保留。");
    expect(parsed.status).toBe("PARSED");
    expect(parsed.critiqueStatus).toBe("INVALID");
    expect(parsed.sidecar?.critique).toBeUndefined();
  });

  it("rejects invented course references and ineligible critique payloads", () => {
    const unbound = critique();
    unbound.dimensions[0]!.evidence = [{
      kind: "COURSE_REFERENCE",
      label: "并未注入的课程资料",
      reference: "invented-source",
    }];
    expect(parseTutorSidecar(response(unbound), {
      ...boundOptions,
      allowedCourseSourceIds: new Set(["real-source"]),
    }).critiqueStatus).toBe("INVALID");
    const ineligible = parseTutorSidecar(response(critique()), {
      ...boundOptions,
      enabled: false,
    });
    expect(ineligible.critiqueStatus).toBe("INELIGIBLE");
    expect(ineligible.text).toBe("自然正文完整保留。");
  });

  it("never accepts a model-generated history record id", () => {
    const forged = critique() as ReturnType<typeof critique> & {
      closure: ReturnType<typeof critique>["closure"] & { historyReference?: unknown };
    };
    forged.closure.historyReference = {
      recordId: "30000000-0000-4000-8000-000000000001",
      comparison: "模型自行指定上一条。",
    };
    const parsed = parseTutorSidecar(response(forged), {
      ...boundOptions,
      allowedHistoryRecordIds: new Set(["30000000-0000-4000-8000-000000000001"]),
    });
    expect(parsed.critiqueStatus).toBe("INVALID");
    expect(parsed.text).toBe("自然正文完整保留。");
  });

  it("shares case-insensitive whitespace-tolerant marker semantics with streaming", () => {
    const raw = `自然正文完整保留。\n<!--   TuToR-MeTa \n ${JSON.stringify({ critique: critique() })} -->`;
    const parsed = parseTutorSidecar(raw, boundOptions);
    expect(parsed.text).toBe("自然正文完整保留。");
    expect(parsed.critiqueStatus).toBe("PARSED");
  });
});
