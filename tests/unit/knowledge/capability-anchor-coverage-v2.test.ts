// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createCapabilityAnchorCoverageV2,
  extractExplicitTechnicalAnchorsV2,
  unsupportedExplicitTechnicalAnchorsV2,
  verifyCapabilityAnchorCoverageV2,
} from "@/lib/knowledge/capability-anchor-coverage-v2";
import {
  KnowledgeObjectV2Schema,
  type KnowledgeObjectV2,
} from "@/lib/knowledge/knowledge-object-v2";

const HASH = "a".repeat(64);

function fixtureObject(): KnowledgeObjectV2 {
  const stored = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "data/knowledge-v2/knowledge-corpus.v2.json",
      ),
      "utf8",
    ),
  ) as { objects?: unknown[] };
  const base = KnowledgeObjectV2Schema.parse(stored.objects?.[0]);
  return KnowledgeObjectV2Schema.parse({
    ...base,
    title: "技术锚点测试对象",
    tags: [
      "Adobe InDesign Data Merge",
      "Document Grid",
      "ＰＤＦ Export",
      "Content‐Aware Fill",
      "H.264",
      "C++",
      "OSC Out",
      "GPU Rendering",
    ],
    nodes: [
      ...base.nodes.map((node) => ({
        ...node,
        ...("title" in node ? { title: "测试节点" } : {}),
        ...("text" in node ? { text: "测试正文" } : {}),
      })),
      {
        id: "anchor-table",
        kind: "TABLE",
        parentId: null,
        childrenIds: [],
        relatedIds: [],
        location: null,
        plainText: "Table Merge",
        rowCount: 1,
        columnCount: 1,
        cells: [{
          row: 0,
          column: 0,
          rowSpan: 1,
          columnSpan: 1,
          text: "表格",
          header: false,
        }],
        contentHash: HASH,
      },
      {
        id: "anchor-region",
        kind: "REGION",
        parentId: null,
        childrenIds: [],
        relatedIds: [],
        location: {
          pageNumber: null,
          bbox: {
            coordinateSpace: "NORMALIZED",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          sourceSpan: null,
        },
        assetId: "fixture-asset",
        label: "RegionCamel",
        contentHash: HASH,
      },
    ],
  });
}

describe("capability anchor coverage V2", () => {
  it("normalizes NFKC and Unicode dashes after classifying raw shapes", () => {
    const anchors = extractExplicitTechnicalAnchorsV2(
      "Ｄａｔａ　Ｍｅｒｇｅ；Content‐Aware Fill；"
      + "H.264；C++；C#；InDesign；OSC",
    );

    expect(anchors).toEqual([
      "c#",
      "c++",
      "content-aware fill",
      "data merge",
      "h.264",
      "indesign",
      "osc",
    ]);
  });

  it("suppresses noisy acronyms only when they stand alone", () => {
    for (const standalone of [
      "PDF",
      "Esc",
      "VI",
      "GPU",
      "TD",
    ]) {
      expect(extractExplicitTechnicalAnchorsV2(standalone)).toEqual([]);
    }

    expect(
      extractExplicitTechnicalAnchorsV2(
        "PDF Export；Esc Key；VI System；GPU Rendering；TD Project",
      ),
    ).toEqual([
      "esc key",
      "gpu rendering",
      "pdf export",
      "td project",
      "vi system",
    ]);
  });

  it("uses ASCII identifier boundaries instead of matching suffix substrings", () => {
    expect(
      extractExplicitTechnicalAnchorsV2(
        "123PDF；_GPU_；PDF_value",
      ),
    ).toEqual([]);
    expect(extractExplicitTechnicalAnchorsV2("PDF2")).toEqual([
      "pdf2",
    ]);
  });

  it("separates ordinary English lead-in and tail words from name-shaped anchors", () => {
    expect(extractExplicitTechnicalAnchorsV2(
      "Please explain Document Grid settings",
    )).toEqual(["document grid"]);
    expect(extractExplicitTechnicalAnchorsV2(
      "Can you use Data Merge please",
    )).toEqual(["data merge"]);
    expect(extractExplicitTechnicalAnchorsV2(
      "Use GPU please",
    )).toEqual([]);
    expect(extractExplicitTechnicalAnchorsV2(
      "Could we export PDF now",
    )).toEqual([]);
    expect(extractExplicitTechnicalAnchorsV2(
      "Can I use C++ here",
    )).toEqual(["c++"]);
    expect(extractExplicitTechnicalAnchorsV2(
      "Try OSC out please",
    )).toEqual(["osc", "osc out"]);
    expect(extractExplicitTechnicalAnchorsV2(
      "What is InDesign used for",
    )).toEqual(["indesign"]);
    expect(extractExplicitTechnicalAnchorsV2(
      "Open InDesign please",
    )).toEqual(["indesign"]);
    expect(extractExplicitTechnicalAnchorsV2(
      "Run C++ here",
    )).toEqual(["c++"]);
    expect(extractExplicitTechnicalAnchorsV2(
      "Select H.264 now",
    )).toEqual(["h.264"]);
    expect(extractExplicitTechnicalAnchorsV2(
      "Check OSC Out",
    )).toEqual(["osc out"]);
    expect(extractExplicitTechnicalAnchorsV2(
      "Open Document Grid please",
    )).toEqual(["document grid"]);
    expect(extractExplicitTechnicalAnchorsV2(
      "Use ZetaMerge Pro please",
    )).toEqual(["zetamerge pro"]);
  });

  it("derives stable exact, phrase and raw-shape variants from corpus text", () => {
    const object = fixtureObject();
    const first = createCapabilityAnchorCoverageV2({
      corpusBundleHash: HASH,
      objects: [object],
    });
    const second = createCapabilityAnchorCoverageV2({
      corpusBundleHash: HASH,
      objects: [object],
    });
    const pack = first.coursePacks[0]!;

    expect(second).toEqual(first);
    expect(verifyCapabilityAnchorCoverageV2(first)).toEqual(first);
    expect(pack.supportedAnchors).toEqual(
      [...pack.supportedAnchors].sort(),
    );
    expect(pack.supportedAnchors).toEqual(
      expect.arrayContaining([
        "adobe indesign data merge",
        "content-aware fill",
        "c++",
        "data merge",
        "document grid",
        "gpu rendering",
        "h.264",
        "indesign",
        "osc",
        "osc out",
        "pdf export",
        "regioncamel",
        "table merge",
      ]),
    );
    expect(pack.supportedAnchors).not.toContain("pdf");
    expect(pack.supportedAnchors).not.toContain("gpu");
  });

  it("accepts exact and suffix-supported phrases while reporting real gaps", () => {
    const object = fixtureObject();
    const coverage = createCapabilityAnchorCoverageV2({
      corpusBundleHash: HASH,
      objects: [object],
    });
    const sourceCoursePack = object.sourceCoursePack;

    for (const queryText of [
      "Data Merge",
      "Please use Data Merge",
      "Can you use Data Merge please",
      "Please explain Document Grid settings",
      "PDF Export",
      "GPU Rendering",
      "Use GPU please",
      "Could we export PDF now",
      "Can I use C++ here",
      "Try OSC out please",
      "What is InDesign used for",
      "Open InDesign please",
      "Run C++ here",
      "Select H.264 now",
      "Check OSC Out",
      "Open Document Grid please",
    ]) {
      expect(unsupportedExplicitTechnicalAnchorsV2({
        queryText,
        sourceCoursePack,
        coverage,
      })).toEqual([]);
    }
    expect(unsupportedExplicitTechnicalAnchorsV2({
      queryText: "Spot Color",
      sourceCoursePack,
      coverage,
    })).toEqual(["spot color"]);
    expect(unsupportedExplicitTechnicalAnchorsV2({
      queryText: "Open InDesign please",
      sourceCoursePack,
      coverage,
    })).toEqual([]);
    expect(unsupportedExplicitTechnicalAnchorsV2({
      queryText: "InDesign ZetaMerge Pro",
      sourceCoursePack,
      coverage,
    })).toEqual(["indesign zetamerge pro"]);
    for (const [queryText, expectedAnchor] of [
      ["ZetaMerge Document Grid", "zetamerge document grid"],
      [
        "Open ZetaMerge Document Grid please",
        "zetamerge document grid",
      ],
      ["Document Grid ZetaMerge", "document grid zetamerge"],
      ["InDesign Document Grid", "indesign document grid"],
      ["Zeta Merge Document Grid", "zeta merge document grid"],
      ["Zeta Document Grid", "zeta document grid"],
      [
        "Open Zeta Merge Document Grid please",
        "zeta merge document grid",
      ],
      ["Zeta Merge InDesign", "zeta merge indesign"],
      [
        "Open Zeta Merge InDesign please",
        "zeta merge indesign",
      ],
      [
        "Zeta Document Grid InDesign",
        "zeta document grid indesign",
      ],
    ] as const) {
      expect(unsupportedExplicitTechnicalAnchorsV2({
        queryText,
        sourceCoursePack,
        coverage,
      })).toEqual([expectedAnchor]);
    }
    expect(unsupportedExplicitTechnicalAnchorsV2({
      queryText: "PDF",
      sourceCoursePack,
      coverage,
    })).toEqual([]);
  });

  it("rejects config-hash drift", () => {
    const object = fixtureObject();
    const coverage = createCapabilityAnchorCoverageV2({
      corpusBundleHash: HASH,
      objects: [object],
    });

    expect(() => verifyCapabilityAnchorCoverageV2({
      ...coverage,
      configHash: "b".repeat(64),
    })).toThrow(/config hash mismatch/i);
  });
});
