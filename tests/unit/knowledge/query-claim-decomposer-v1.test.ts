import { describe, expect, it } from "vitest";

import {
  decomposeRetrievalClaimsV1,
  QUERY_CLAIM_DECOMPOSER_CONFIG_HASH_V1,
  QUERY_CLAIM_DECOMPOSER_CONFIG_V1,
  QueryClaimDecompositionV1Schema,
} from "@/lib/knowledge/query-claim-decomposer-v1";
import { sha256StableJsonV2 } from "@/lib/knowledge/knowledge-object-v2";
import { normalizeRetrievalTextV2 } from "@/lib/knowledge/retrieval-query-v2";

const normalized = (value: string) =>
  normalizeRetrievalTextV2(value);

describe("query claim decomposer V1", () => {
  it("requires the caller to provide deterministically normalized text", () => {
    expect(() =>
      decomposeRetrievalClaimsV1(
        "  先检查网格，再检查层级？  ",
      )).toThrow(
      "QUERY_CLAIM_DECOMPOSER_INPUT_NOT_NORMALIZED",
    );
  });

  it("uses the whole query once when no smaller support claim exists", () => {
    const trace = decomposeRetrievalClaimsV1(
      normalized("Illustrator里的文字格式怎么复用？"),
    );

    expect(trace.claims).toEqual([
      expect.objectContaining({
        claimId: "claim-1",
        text: "illustrator里的文字格式怎么复用?",
        sourceRule: "WHOLE_FALLBACK",
      }),
    ]);
    expect(trace.probes).toEqual([
      expect.objectContaining({
        probeId: "probe-whole",
        kind: "WHOLE_QUERY",
        claimIds: ["claim-1"],
      }),
    ]);
  });

  it("extracts clause and conjunction facets without a course dictionary", () => {
    const trace = decomposeRetrievalClaimsV1(
      normalized("先检查网格，再核对信息层级和留白？"),
    );

    expect(trace.claims.map(({ text }) => text)).toEqual([
      "先检查网格",
      "再核对信息层级",
      "留白",
    ]);
    expect(trace.claims.map(({ sourceRule }) =>
      sourceRule)).toEqual([
      "CLAUSE",
      "CONJUNCT",
      "CONJUNCT",
    ]);
    expect(trace.probes).toHaveLength(4);
    expect(trace.probes[0]).toMatchObject({
      probeId: "probe-whole",
      kind: "WHOLE_QUERY",
      claimIds: [],
    });
  });

  it("deduplicates normalized facets and caps support claims at four", () => {
    const trace = decomposeRetrievalClaimsV1(
      normalized(
        "网格、层级、留白、对齐、节奏和网格怎么一起检查？",
      ),
    );

    expect(trace.claims).toHaveLength(
      QUERY_CLAIM_DECOMPOSER_CONFIG_V1
        .maximumSupportClaims,
    );
    expect(new Set(
      trace.claims.map(({ text }) => text),
    ).size).toBe(trace.claims.length);
    expect(trace.probes.length).toBeLessThanOrEqual(
      QUERY_CLAIM_DECOMPOSER_CONFIG_V1.maximumProbes,
    );
  });

  it("keeps deterministic code-point spans for non-BMP input", () => {
    const trace = decomposeRetrievalClaimsV1(
      normalized("先看图😀，再检查文字与表格？"),
    );

    for (const claim of trace.claims) {
      const source = Array.from(trace.wholeQuery)
        .slice(
          claim.sourceSpan.startCodePoint,
          claim.sourceSpan.endCodePoint,
        )
        .join("");
      expect(source).toContain(claim.text);
    }
  });

  it("binds every hash and schema field to the frozen config", () => {
    expect(QUERY_CLAIM_DECOMPOSER_CONFIG_HASH_V1)
      .toBe(sha256StableJsonV2(
        QUERY_CLAIM_DECOMPOSER_CONFIG_V1,
      ));
    const trace = decomposeRetrievalClaimsV1(
      normalized("怎样同时检查出血和装订影响？"),
    );
    expect(QueryClaimDecompositionV1Schema.parse(trace))
      .toEqual(trace);
    expect(trace.claims.every((claim) =>
      claim.textHash === sha256StableJsonV2(claim.text)))
      .toBe(true);
  });

  it("does not expose labels, course packs, cases, objects, or nodes", () => {
    const serialized = JSON.stringify(
      decomposeRetrievalClaimsV1(
        normalized(
          "怎样比较识别度、缩小清晰度和单色表现？",
        ),
      ),
    );

    for (const forbidden of [
      "coursePack",
      "caseId",
      "objectId",
      "nodeId",
      "qrels",
      "expected",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
