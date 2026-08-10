import { describe, expect, it } from "vitest";

import { getCoursePack } from "@/lib/course-packs/registry";
import { knowledgePlacementForTopic } from "@/lib/knowledge/course-pack-store";
import {
  knowledgeDefaultActionId,
  KnowledgeItemSchema,
  knowledgeStatementPrefix,
  type KnowledgeTopic,
} from "@/lib/knowledge/retrieve";

const layoutTopics = [
  {
    topic: "LAYOUT_DESIGN_PRINCIPLES",
    namespace: "layout-design-principles",
    prefix: "layoutprin-",
    defaultActionId: "layoutprin-clarify-reading-task",
  },
  {
    topic: "TYPOGRAPHY_BASICS",
    namespace: "typography-basics",
    prefix: "type-",
    defaultActionId: "type-clarify-text-role",
  },
] as const satisfies ReadonlyArray<{
  topic: KnowledgeTopic;
  namespace: string;
  prefix: string;
  defaultActionId: string;
}>;

describe("layout knowledge topic placement", () => {
  it.each(layoutTopics)(
    "places $topic in a namespace declared by the layout-design course pack",
    ({ topic, namespace }) => {
      const placement = knowledgePlacementForTopic(topic);
      const pack = getCoursePack(placement.coursePackId, placement.coursePackVersion);

      expect(placement).toEqual({
        coursePackId: "layout-design",
        coursePackVersion: "1",
        namespace,
      });
      expect(pack.knowledgeNamespaces).toContain(namespace);
    },
  );

  it.each(layoutTopics)(
    "exposes the shared prefix and required default action for $topic",
    ({ topic, prefix, defaultActionId }) => {
      expect(knowledgeStatementPrefix(topic)).toBe(prefix);
      expect(knowledgeDefaultActionId(topic)).toBe(defaultActionId);
      expect(defaultActionId.startsWith(prefix)).toBe(true);
    },
  );

  it.each(layoutTopics)(
    "accepts a complete item using the $topic contract",
    ({ topic, prefix, defaultActionId }) => {
      expect(
        KnowledgeItemSchema.parse({
          id: `${prefix}sample`,
          title: "版式知识样例",
          topic,
          tags: ["版式设计"],
          content: "先确认读者任务，再检查局部关系。",
          facts: [{ id: `${prefix}sample-fact-01`, text: "版式判断需要可观察关系。" }],
          actions: [{ id: defaultActionId, text: "先说明当前读者任务。" }],
          source: {
            localDocument: "data/courses/layout-design/sample.md",
            authority: "TEACHER_EXPERIENCE",
            verifiedDate: "2026-07-27",
            scope: "版式知识主题契约测试",
          },
        }),
      ).toMatchObject({ topic });
    },
  );
});

describe("brand knowledge topic placement", () => {
  const topic = "BRAND_IDENTITY" as const;
  const namespace = "brand-identity";
  const prefix = "brand-";
  const defaultActionId = "brand-clarify-identity-task";

  it("places BRAND_IDENTITY in a namespace declared by the brand course pack", () => {
    const placement = knowledgePlacementForTopic(topic);
    const pack = getCoursePack(placement.coursePackId, placement.coursePackVersion);

    expect(placement).toEqual({
      coursePackId: "brand-vi-design",
      coursePackVersion: "1",
      namespace,
    });
    expect(pack.knowledgeNamespaces).toContain(namespace);
  });

  it("exposes the unique brand prefix and required default action", () => {
    expect(knowledgeStatementPrefix(topic)).toBe(prefix);
    expect(knowledgeDefaultActionId(topic)).toBe(defaultActionId);
    expect(defaultActionId.startsWith(prefix)).toBe(true);
  });

  it("accepts a complete BRAND_IDENTITY item", () => {
    expect(KnowledgeItemSchema.parse({
      id: "brand-sample",
      title: "品牌识别知识样例",
      topic,
      tags: ["品牌识别"],
      content: "先说明识别任务，再比较字标与图形关系。",
      facts: [{ id: "brand-sample-fact-01", text: "品牌识别判断需要真实接触场景。" }],
      actions: [{ id: defaultActionId, text: "先说明当前品牌识别任务。" }],
      source: {
        localDocument: "data/courses/brand-vi-design/sample.md",
        authority: "TEACHER_EXPERIENCE",
        verifiedDate: "2026-07-27",
        scope: "品牌知识主题契约测试",
      },
    })).toMatchObject({ topic });
  });
});
