import type { EmbeddingProvider } from "@/lib/ai/embeddings";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  loadStoredCoursePackKnowledge,
  retrieveCoursePackKnowledge,
} from "@/lib/knowledge/course-pack-store";
import type { KnowledgeItem, RankedKnowledgeItem } from "@/lib/knowledge/retrieve";
import {
  retrieveKnowledgeHybrid,
  type HybridKnowledgeRetrieval,
} from "@/lib/knowledge/semantic-retrieve";

export type RetrievedKnowledge = Array<KnowledgeItem | RankedKnowledgeItem>;

export class KnowledgeRetriever {
  constructor(private readonly connection: DatabaseConnection) {}

  retrieve(packId: string, packVersion: string, query: string): RetrievedKnowledge {
    const knowledge = retrieveCoursePackKnowledge(this.connection, packId, packVersion, query).slice(0, 3);
    const technicalTokens = query.normalize("NFKC").toLowerCase()
      .match(/[a-z][a-z0-9._+-]{2,}/g)
      ?.filter((token) => !["the", "and", "for", "with", "how", "what"].includes(token)) ?? [];
    if (technicalTokens.length < 2) return knowledge;
    const corpus = knowledge.map((item) => [
      item.title,
      item.content,
      item.tags.join(" "),
      ...item.facts.map(({ text }) => text),
      ...item.actions.map(({ text }) => text),
    ].join(" ")).join("\n").normalize("NFKC").toLowerCase();
    return technicalTokens.some((token) => corpus.includes(token)) ? knowledge : [];
  }
}

export class TutorKnowledgeRetriever {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly embeddingProvider?: EmbeddingProvider | null,
  ) {}

  retrieve(
    packId: string,
    packVersion: string,
    query: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<HybridKnowledgeRetrieval> {
    const items = loadStoredCoursePackKnowledge(this.connection, packId, packVersion);
    return retrieveKnowledgeHybrid(query, items, this.embeddingProvider, options);
  }
}
export function retrieveAgentKnowledge(
  connection: DatabaseConnection,
  packId: string,
  packVersion: string,
  query: string,
) {
  return new KnowledgeRetriever(connection).retrieve(packId, packVersion, query);
}

export function retrieveTutorKnowledge(
  connection: DatabaseConnection,
  packId: string,
  packVersion: string,
  query: string,
  embeddingProvider?: EmbeddingProvider | null,
  options: { signal?: AbortSignal } = {},
) {
  return new TutorKnowledgeRetriever(connection, embeddingProvider)
    .retrieve(packId, packVersion, query, options);
}
