import { describe, expect, it } from "vitest";

import { BOOK_DESIGN_MICRO_BRIEF } from "@/lib/course-packs/book-design";
import { CoursePackSchema, coursePackKey } from "@/lib/course-packs/contract";
import { DEFAULT_COURSE_PACK, getCoursePack, listCoursePacks } from "@/lib/course-packs/registry";
import { getToolAdapter } from "@/lib/tool-adapters/registry";

describe("course pack registry", () => {
  it("registers a general-design foundation plus two professional enhancement packs", () => {
    expect(listCoursePacks().map(coursePackKey)).toEqual(["general-design@1", "digital-interaction@1", "book-design@1"]);
    expect(DEFAULT_COURSE_PACK).toEqual({ id: "general-design", version: "1" });
    expect(getCoursePack("general-design", "1").toolAdapterIds).toEqual(["knowledge-map", "design-calculator"]);
    expect(getCoursePack("digital-interaction", "1").diagnostic.questionCount).toBe(10);
    expect(getCoursePack("book-design", "1").summary).toContain("受众");
    expect(BOOK_DESIGN_MICRO_BRIEF).toContain("8页");
  });

  it("version-locks lookups and rejects unknown packs", () => {
    expect(() => getCoursePack("digital-interaction", "2")).toThrow("unknown course pack");
  });

  it("rejects duplicate course-pack definitions", () => {
    const pack = getCoursePack("book-design", "1");
    expect(CoursePackSchema.safeParse({
      ...pack,
      knowledgeNamespaces: ["book-design-principles", "book-design-principles"],
    }).success).toBe(false);
  });

  it("resolves every declared tool adapter", () => {
    for (const pack of listCoursePacks()) {
      for (const id of pack.toolAdapterIds) expect(getToolAdapter(id).id).toBe(id);
    }
  });

  it("exposes resumable book-layout actions to the agent", () => {
    expect(getToolAdapter("book-layout-lab").capabilities).toEqual(expect.arrayContaining([
      "troubleshoot-reading-path",
      "save-draft",
      "reset-draft",
      "submit-evidence",
    ]));
  });
});
