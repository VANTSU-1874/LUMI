import type { KnowledgeItem, RankedKnowledgeItem } from "@/lib/knowledge/retrieve";

const NON_TECHNICAL_ENGLISH_TOKENS = new Set([
  "the", "and", "for", "with", "from", "into", "your", "you", "this", "that",
  "step", "first", "second", "then", "next", "one", "two", "three", "use", "using",
  "before", "after", "between", "through", "value", "values", "data", "result", "results",
]);

const GENERAL_DESIGN_TECHNICAL_TOKENS = new Set([
  "arduino", "led", "localhost", "midi", "processing", "pva",
]);

export function technicalTokens(value: string) {
  return Array.from(new Set(
    (value.normalize("NFKC").toLowerCase().match(/[a-z][a-z0-9._+-]{2,}/g) ?? [])
      .filter((token) => !NON_TECHNICAL_ENGLISH_TOKENS.has(token)),
  ));
}

export function isGeneralDesignTechnicalToken(token: string) {
  return GENERAL_DESIGN_TECHNICAL_TOKENS.has(token.normalize("NFKC").toLowerCase());
}

export function knowledgeCorpus(knowledge: Array<KnowledgeItem | RankedKnowledgeItem>) {
  return knowledge.map((item) => [
    item.title,
    item.tags.join(" "),
    item.content,
    ...item.facts.map(({ text }) => text),
    ...item.actions.map(({ text }) => text),
  ].join(" ")).join("\n");
}

export function plainKnowledgeItem(item: KnowledgeItem | RankedKnowledgeItem): KnowledgeItem {
  const plain = { ...item } as Partial<RankedKnowledgeItem>;
  delete plain.score;
  delete plain.matchedTokens;
  delete plain.retrieval;
  return plain as KnowledgeItem;
}
