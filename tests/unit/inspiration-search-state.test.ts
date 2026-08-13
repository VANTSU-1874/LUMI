import { describe, expect, it } from "vitest";

import { searchInspirationEntries } from "@/components/inspiration/inspiration-search-state";
import { inspirationEntries } from "@/components/inspiration/inspiration-wiki-data";

describe("inspiration browse search state", () => {
  it("keeps the curated flow available before a student searches", () => {
    const result = searchInspirationEntries(inspirationEntries, "", "全部");

    expect(result.state).toBe("BROWSE_DEFAULT");
    expect(result.entries).toHaveLength(inspirationEntries.length);
    expect(result.appliedFacets).toEqual([]);
  });

  it("turns a natural-language book design request into a visible browse facet", () => {
    const result = searchInspirationEntries(
      inspirationEntries,
      "我想找一些书籍设计的参考示范",
      "全部",
    );

    expect(result.state).toBe("SEARCH_INTENT");
    expect(result.appliedFacets).toContain("书籍设计");
    expect(result.entries.map(({ id }) => id)).toEqual(["fold"]);
  });

  it("keeps an explicit topic filter in the search decision", () => {
    const result = searchInspirationEntries(inspirationEntries, "版式参考", "网格");

    expect(result.entries.map(({ id }) => id)).toEqual(["grid"]);
  });
});
