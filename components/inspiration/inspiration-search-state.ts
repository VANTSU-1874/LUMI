import type {
  InspirationEntries,
  InspirationEntry,
} from "./inspiration-wiki-data";

/**
 * `CONTEXT_ASSISTED_SEARCH` and `CHAT_MENTION` describe the protected
 * server-routed flows. This local fixture browser intentionally implements
 * only the first two states until owner-checked context APIs exist.
 */
export type InspirationInteractionState =
  | "BROWSE_DEFAULT"
  | "SEARCH_INTENT"
  | "CONTEXT_ASSISTED_SEARCH"
  | "CHAT_MENTION";

export type InspirationBrowseResult = {
  state: Extract<InspirationInteractionState, "BROWSE_DEFAULT" | "SEARCH_INTENT">;
  entries: InspirationEntry[];
  appliedFacets: string[];
};

type SearchFacet = {
  label: string;
  keywords: readonly string[];
  matches: (entry: InspirationEntry) => boolean;
};

const searchFacets: readonly SearchFacet[] = [
  {
    label: "书籍设计",
    keywords: ["书籍", "装帧", "装订", "纸张"],
    matches: (entry) => entry.course.includes("书籍") || entry.medium.includes("纸"),
  },
  {
    label: "版式与网格",
    keywords: ["版式", "网格", "排版", "信息层级"],
    matches: (entry) => entry.course.includes("版式")
      || entry.topics.some((topic) => ["网格", "层级", "字体"].includes(topic)),
  },
  {
    label: "品牌与系统",
    keywords: ["品牌", "手册", "vi", "识别", "标志"],
    matches: (entry) => entry.course.includes("品牌")
      || entry.topics.some((topic) => ["标志", "系统", "延展"].includes(topic)),
  },
  {
    label: "交互与动势",
    keywords: ["交互", "动态", "动效", "时序", "反馈"],
    matches: (entry) => entry.course.includes("交互")
      || entry.topics.some((topic) => ["动势", "交互", "时序"].includes(topic)),
  },
  {
    label: "色彩与对比",
    keywords: ["色彩", "配色", "对比", "颜色"],
    matches: (entry) => entry.topics.some((topic) => ["色彩", "对比", "聚焦"].includes(topic)),
  },
];

function normalized(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

function entrySurface(entry: InspirationEntry) {
  return [
    entry.title,
    entry.subtitle,
    entry.description,
    entry.observation,
    entry.relation,
    entry.course,
    entry.medium,
    ...entry.topics,
  ].join(" ").toLocaleLowerCase("zh-CN");
}

function explicitEntryTerms(entry: InspirationEntry) {
  return [entry.course, entry.medium, ...entry.topics]
    .map(normalized)
    .filter((term) => term.length >= 2);
}

/**
 * Deterministic browse-only intent parsing for the in-repository fixture.
 * It never reads conversations, projects, or any account data.
 */
export function searchInspirationEntries(
  entries: InspirationEntries,
  query: string,
  activeTopic: string,
): InspirationBrowseResult {
  const search = normalized(query);
  const matchingFacets = searchFacets.filter((facet) => (
    facet.keywords.some((keyword) => search.includes(keyword))
  ));
  const matchingFacetLabels = matchingFacets.map(({ label }) => label);
  const visibleEntries = entries
    .map((entry, index) => {
      const topicMatched = activeTopic === "全部" || entry.topics.includes(activeTopic);
      if (!topicMatched) return null;
      if (!search) return { entry, score: -index };

      const surface = entrySurface(entry);
      const directMatch = surface.includes(search)
        || explicitEntryTerms(entry).some((term) => search.includes(term));
      const matchedFacetCount = matchingFacets.filter((facet) => facet.matches(entry)).length;
      if (!directMatch && matchedFacetCount === 0) return null;
      return { entry, score: matchedFacetCount * 10 + (directMatch ? 1 : 0) - index / 100 };
    })
    .filter((result): result is { entry: InspirationEntry; score: number } => result !== null)
    .sort((left, right) => right.score - left.score)
    .map(({ entry }) => entry);

  return {
    state: search ? "SEARCH_INTENT" : "BROWSE_DEFAULT",
    entries: visibleEntries,
    appliedFacets: matchingFacetLabels,
  };
}
