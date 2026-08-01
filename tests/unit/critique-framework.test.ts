import { describe, expect, it } from "vitest";

import {
  CRITIQUE_DIMENSION_IDS,
  CRITIQUE_FRAMEWORK_ID,
  CritiqueResultSchema,
} from "@/lib/agent/critique-contract";
import { getCritiqueFramework, listCritiqueFrameworks } from "@/lib/agent/critique-framework";
import { routeCritiqueRequest } from "@/lib/agent/critique-routing";

function result(overrides: Record<string, unknown> = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    frameworkId: CRITIQUE_FRAMEWORK_ID,
    frameworkVersion: "1.0",
    courseId: "digital-interaction",
    artworkId: "20000000-0000-4000-8000-000000000001",
    createdAt: "2026-07-19T00:00:00.000Z",
    dimensions: CRITIQUE_DIMENSION_IDS.map((id, index) => ({
      id,
      label: getCritiqueFramework("digital-interaction")!.dimensions[index].label,
      displayOrder: index + 1,
      status: index === 0 ? "ESTABLISHED" : "DEVELOPING",
      observation: "基于画面可见关系的观察。",
      evidence: [{ kind: "ARTWORK_REGION", label: "画面中央的主视觉" }],
      guidance: {
        level: index === 0 ? "DEMONSTRATION" : "HINT",
        message: "先只调整一处，再比较变化。",
        ...(index === 0 ? { understandingCheck: "请解释为什么先改这一处。" } : {}),
      },
      isDeepDive: index < 2,
    })),
    closure: {
      established: "主视觉入口已经清楚。",
      nextStep: "下一步只调整互动提示与主视觉的距离。",
    },
    ...overrides,
  };
}

describe("critique framework contract", () => {
  it("configures the canonical five dimensions and a separate required closure", () => {
    expect(listCritiqueFrameworks().map(({ courseId }) => courseId)).toEqual([
      "general-design", "digital-interaction", "book-design",
    ]);
    for (const framework of listCritiqueFrameworks()) {
      expect(framework.dimensions.map(({ id }) => id)).toEqual(CRITIQUE_DIMENSION_IDS);
      expect(framework.closure.required).toBe(true);
    }
    expect(getCritiqueFramework("digital-interaction")?.dimensions[1].checks.join(" ")).toContain("输入信号");
    expect(getCritiqueFramework("book-design")?.dimensions[1].checks.join(" ")).toContain("版面结构");
  });

  it("accepts one or two deep dives only when all five dimensions and closure are complete", () => {
    expect(CritiqueResultSchema.safeParse(result()).success).toBe(true);
    const missingClosure = result({ closure: undefined });
    expect(CritiqueResultSchema.safeParse(missingClosure).success).toBe(false);
    const dimensions = (result().dimensions as Array<Record<string, unknown>>)
      .map((dimension) => ({ ...dimension, isDeepDive: false }));
    expect(CritiqueResultSchema.safeParse(result({ dimensions })).success).toBe(false);
  });

  it("requires an understanding check after a demonstration", () => {
    const dimensions = (result().dimensions as Array<Record<string, unknown>>).map((dimension, index) => (
      index === 0
        ? { ...dimension, guidance: { level: "DEMONSTRATION", message: "局部示范。" } }
        : dimension
    ));
    expect(CritiqueResultSchema.safeParse(result({ dimensions })).success).toBe(false);
  });
});

describe("critique dual-face routing", () => {
  it("enters structured critique only for artwork plus design critique intent", () => {
    expect(routeCritiqueRequest({
      courseId: "digital-interaction",
      message: "请看看这张作品图的创意表达和构图哪里可以改。",
      hasArtwork: true,
    })).toBe("STRUCTURED_CRITIQUE");
    expect(routeCritiqueRequest({
      courseId: "digital-interaction",
      message: "请解释创意转译是什么意思。",
      hasArtwork: false,
    })).toBe("NATURAL_TUTOR");
  });

  it("honors the structured composer choice without exposing a prompt directive", () => {
    expect(routeCritiqueRequest({
      courseId: "digital-interaction",
      message: "这张是我刚做的版本。",
      hasArtwork: true,
      explicitCritique: true,
    })).toBe("STRUCTURED_CRITIQUE");
    expect(routeCritiqueRequest({
      courseId: "digital-interaction",
      message: "还没有上传作品。",
      hasArtwork: false,
      explicitCritique: true,
    })).toBe("NATURAL_TUTOR");
  });

  it("routes software errors first even when an artwork is attached", () => {
    expect(routeCritiqueRequest({
      courseId: "digital-interaction",
      message: "也想听整体建议，但 TouchDesigner 节点报错没有数据，先帮我排查。",
      hasArtwork: true,
    })).toBe("EVIDENCE_TROUBLESHOOTING");
  });

  it("does not create a sidecar for an unknown course", () => {
    expect(routeCritiqueRequest({
      courseId: "unknown-course",
      message: "请点评这张作品图。",
      hasArtwork: true,
    })).toBe("NATURAL_TUTOR");
  });
});

