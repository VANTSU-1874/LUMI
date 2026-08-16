import { describe, expect, it } from "vitest";

import { safeInspirationStudentList, safeInspirationStudentText } from "@/lib/domain/inspiration-student-projection";

describe("student-safe inspiration projection", () => {
  it("rejects every private locator family while retaining ordinary teaching metadata", () => {
    expect(safeInspirationStudentText("版式与留白的节奏", 80)).toBe("版式与留白的节奏");
    for (const value of [
      "C:\\Users\\student\\secret.png",
      "\\\\server\\private\\asset.png",
      "/home/student/private.png",
      "file:///tmp/private.png",
      "private-candidate://intake/secret",
      "inspiration-intake:private-id",
      "http://localhost/private",
      "source.internal/private",
      "192.168.1.20 asset",
    ]) expect(safeInspirationStudentText(value, 200)).toBeNull();
  });

  it("drops unsafe tags and facets instead of partially reflecting them", () => {
    expect(safeInspirationStudentList(["版式", "file:///tmp/private", "版式", "\\\\server\\share"], 10)).toEqual(["版式"]);
  });
});
