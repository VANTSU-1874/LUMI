import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  touchDesignerOperatorChinese,
  touchDesignerParameterChinese,
} from "@/lib/touchdesigner/localization";
import {
  STUDIO_FAMILIES,
  type NodeCatalogEntry,
  type NodeCatalogResponse,
  type StudioFamily,
} from "@/lib/touchdesigner/node-catalog-shared";
import type {
  TouchDesignerCaseLibrary,
  TouchDesignerFamily,
  TouchDesignerStructure,
} from "@/lib/touchdesigner/types";

const browserRunnable = new Set([
  "CHOP:audiodevin",
  "CHOP:analyze",
  "CHOP:math",
  "CHOP:filter",
  "CHOP:lfo",
  "CHOP:constant",
  "TOP:level",
  "TOP:noise",
  "TOP:transform",
  "TOP:displace",
]);

const popStarters = ["pointgenerator", "noise", "particle", "force", "transform", "null"] as const;

type MutableEntry = {
  family: StudioFamily;
  operatorType: string;
  useCount: number;
  courseCases: Set<string>;
  parameters: Set<string>;
  source: "COURSE" | "POP_STARTER";
};

export async function readTouchDesignerNodeCatalog(): Promise<NodeCatalogResponse> {
  const dataRoot = path.join(process.cwd(), "data", "touchdesigner");
  const manifest = JSON.parse(await readFile(path.join(dataRoot, "posters-cases.generated.json"), "utf8")) as TouchDesignerCaseLibrary;
  const entries = new Map<string, MutableEntry>();

  for (const courseModule of manifest.modules) {
    for (const item of courseModule.cases) {
      const active = item.versions.find((version) => version.id === item.activeVersionId);
      if (!active?.structureId) continue;
      const structure = JSON.parse(
        await readFile(path.join(dataRoot, "structures", `${active.structureId}.json`), "utf8"),
      ) as TouchDesignerStructure;
      for (const node of structure.nodes) {
        if (!isStudioFamily(node.family)) continue;
        const operatorType = node.operatorType.trim().toLowerCase();
        if (!operatorType) continue;
        const id = `${node.family}:${operatorType}`;
        const entry = entries.get(id) ?? {
          family: node.family,
          operatorType,
          useCount: 0,
          courseCases: new Set<string>(),
          parameters: new Set<string>(),
          source: "COURSE" as const,
        };
        entry.useCount += 1;
        entry.courseCases.add(item.title);
        for (const parameter of node.parameters.slice(0, 12)) entry.parameters.add(parameter.name);
        entries.set(id, entry);
      }
    }
  }

  for (const operatorType of popStarters) {
    const id = `POP:${operatorType}`;
    if (!entries.has(id)) entries.set(id, {
      family: "POP",
      operatorType,
      useCount: 0,
      courseCases: new Set<string>(),
      parameters: new Set<string>(),
      source: "POP_STARTER",
    });
  }

  const result = [...entries.values()].map((entry): NodeCatalogEntry => {
    const glossary = touchDesignerOperatorChinese(entry.operatorType, entry.family);
    return {
      id: `${entry.family}:${entry.operatorType}`,
      family: entry.family,
      operatorType: entry.operatorType,
      englishName: touchDesignerOperatorLabel(entry.operatorType, entry.family),
      chineseName: glossary.label,
      description: glossary.description,
      useCount: entry.useCount,
      courseCases: [...entry.courseCases].slice(0, 5),
      parameters: [...entry.parameters].slice(0, 12).map((name) => ({
        name,
        chineseName: touchDesignerParameterChinese(name),
      })),
      browserRunnable: browserRunnable.has(`${entry.family}:${entry.operatorType}`),
      source: entry.source,
    };
  }).sort((a, b) => {
    const familyOrder = STUDIO_FAMILIES.indexOf(a.family) - STUDIO_FAMILIES.indexOf(b.family);
    return familyOrder || b.useCount - a.useCount || a.operatorType.localeCompare(b.operatorType);
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    entries: result,
    totals: {
      entries: result.length,
      courseEntries: result.filter((entry) => entry.source === "COURSE").length,
      families: STUDIO_FAMILIES.length,
      browserRunnable: result.filter((entry) => entry.browserRunnable).length,
    },
  };
}

function isStudioFamily(family: TouchDesignerFamily): family is StudioFamily {
  return (STUDIO_FAMILIES as readonly TouchDesignerFamily[]).includes(family);
}

function touchDesignerOperatorLabel(operatorType: string, family: StudioFamily) {
  const suffix = family === "COMP" ? "COMP" : family;
  return `${titleCase(operatorType)} ${suffix}`;
}

function titleCase(value: string) {
  return value.replace(/(^|[\s_-])([a-z])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
}
