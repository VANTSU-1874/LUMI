import { createHash } from "node:crypto";

import type { AgentEvidenceSearchPortV2, AgentEvidenceToolOutputV2 } from "@/lib/agent/evidence-tool-v2";
import type { DatabaseConnection } from "@/lib/db/client";

import { createActiveKnowledgeGenerationLoaderV2 } from "./active-knowledge-generation-v2";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bigrams(value: string) {
  const characters = [...value.toLocaleLowerCase().replace(/\s+/gu, "")];
  return new Set(characters.flatMap((character, index) =>
    index + 1 < characters.length ? [`${character}${characters[index + 1]}`] : [],
  ));
}

/**
 * Local-only bridge for a formally stored, lexical-only V2 generation. It is
 * intentionally injected through AgentOptions.evidenceSearchV2: normal
 * provider-backed V2 runtime construction and legacy retrieval remain intact.
 */
export function createIsolatedLexicalEvidenceSearchPortV2(input: {
  connection: DatabaseConnection;
  workspaceRoot: string;
  timeoutMs?: number;
}): AgentEvidenceSearchPortV2 {
  const loader = createActiveKnowledgeGenerationLoaderV2({
    connection: input.connection,
    workspaceRoot: input.workspaceRoot,
    requireLegacyProjection: false,
  });
  const timeoutMs = input.timeoutMs ?? 250;
  return {
    async search({ query, coursePackId, coursePackVersion, signal }) {
      const run = async () => {
        const generation = await loader.load();
        const queryBigrams = bigrams(query);
        const candidates = generation.corpus.objects
          .filter((object) => object.sourceCoursePack.id === coursePackId
            && object.sourceCoursePack.version === coursePackVersion)
          .map((object) => ({
            object,
            score: [...bigrams(`${object.title} ${object.legacyItem.content}`)]
              .filter((term) => queryBigrams.has(term)).length,
          }))
          .filter(({ score }) => score > 0)
          .sort((left, right) => right.score - left.score || left.object.id.localeCompare(right.object.id))
          .slice(0, 5);
        const lexicalVersion = generation.indexBundle?.representations.find(
          ({ channel }) => channel === "LEXICAL",
        )?.indexVersion;
        const capabilitiesLost: AgentEvidenceToolOutputV2["bundle"]["capabilitiesLost"] = ["TEXT_VECTOR", "VISUAL_VECTOR", "ASSET", "REGION", "GRAPH_CONTEXT"];
        const base: AgentEvidenceToolOutputV2 = {
          schemaVersion: 2 as const,
          kind: "KNOWLEDGE_MAP_SEARCH_EVIDENCE" as const,
          bundle: {
            bundleId: `isolated-lexical-${sha256(`${generation.generationKey}:${query}`)}`,
            status: candidates.length ? "SUCCESS" as const : "EMPTY" as const,
            queryHash: sha256(query), corpusBundleHash: generation.corpus.bundleHash,
            activeIndexBundleHash: generation.activeIndexBundleHash!,
            capabilitiesLost,
          },
          channels: [
            { channel: "LEXICAL" as const, status: candidates.length ? "SUCCESS" as const : "EMPTY" as const, hitCount: candidates.length, indexVersionId: lexicalVersion?.id ?? null, modelId: null, modelRevision: null },
            { channel: "TEXT_VECTOR" as const, status: "UNAVAILABLE" as const, hitCount: 0, indexVersionId: null, modelId: null, modelRevision: null },
            { channel: "VISUAL_VECTOR" as const, status: "SKIPPED" as const, hitCount: 0, indexVersionId: null, modelId: null, modelRevision: null },
          ],
          evidence: {
            nodes: candidates.map(({ object }) => {
              const node = object.nodes.find((candidate): candidate is Extract<typeof candidate, { kind: "TEXT" }> => candidate.kind === "TEXT" && Boolean(candidate.text));
              if (!node) throw new Error(`ISOLATED_LEXICAL_TEXT_NODE_MISSING:${object.id}`);
              return { nodeId: node.id, objectId: object.id, sourceId: object.id, kind: "TEXT" as const, relation: "PRIMARY" as const, evidenceKind: "KNOWLEDGE_FACT" as const, excerpt: node.text!, assetId: null };
            }),
            assets: [], regions: [],
            sources: candidates.map(({ object }) => ({ sourceId: object.id, objectId: object.id, title: object.title, authority: object.provenance.authority, verifiedDate: object.provenance.verifiedDate, scope: object.provenance.scope })),
          },
          usageRules: {
            knowledgeFacts: "只把带 excerpt 的课程节点作为课程知识事实。",
            visualReferences: "图片和区域是课程参考图，只描述其中可见内容，不当作学生当前作品。",
            inference: "超出节点文字或参考图可见内容的判断必须明确标为推断。",
            uncertainty: "证据不足或通道降级时要说明不确定性，不得补造来源。",
          },
        };
        return base;
      };
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          run(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("ISOLATED_LEXICAL_TIMEOUT")), timeoutMs); }),
        ]);
      } catch (error) {
        if (error instanceof Error && error.message === "ISOLATED_LEXICAL_TIMEOUT") {
          throw error;
        }
        throw error;
      } finally { if (timer) clearTimeout(timer); }
    },
    runtimeHealth() { return { generationHash: "isolated-lexical", textCircuitState: "CLOSED", visualCircuitState: null, visualQueueDepth: 0, visualCacheEntries: 0 }; },
  };
}
