import { describe, expect, it } from "vitest";

import { createVisualMentorReply } from "@/lib/domain/visual-mentor";

describe("createVisualMentorReply", () => {
  it("routes learning-before, learning-during and learning-after questions to distinct tutor roles", () => {
    expect(createVisualMentorReply("图片怎么变成粒子", "CHAT").moment).toBe("BEFORE");
    expect(createVisualMentorReply("画面不动怎么排查", "NODE_CANVAS").moment).toBe("DURING");
    expect(createVisualMentorReply("还能迁移成声音控制吗", "KNOWLEDGE_MAP").moment).toBe("AFTER");
  });

  it("answers with nodes and actions rather than a text-only paragraph", () => {
    const reply = createVisualMentorReply("Noise 和 Math 有什么区别", "CHAT");
    expect(reply.nodes.map(({ id }) => id)).toEqual(expect.arrayContaining(["noise", "math"]));
    expect(reply.links.length).toBeGreaterThan(0);
    expect(reply.actions).toHaveLength(3);
  });
});
