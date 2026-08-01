import type { CoursePack, LearningEpisode } from "@/lib/course-packs/contract";
import { getToolAdapter } from "@/lib/tool-adapters/registry";

import type { AgentView, DesignSpecialty } from "./contracts";
import { capabilityForTool } from "./capability-registry";
import type { AgentRequestedCapabilityId } from "./requested-capability";
import { AgentToolDescriptorSchema, type AgentToolDefinition } from "./tool-contract";
import { bookLayoutStateTool } from "./tools/book-tools";
import { designCalculatorTool } from "./tools/calculation-tools";
import { courseConceptSearchTool, touchDesignerCaseNetworkTool } from "./tools/course-tools";
import { projectEvidenceStateTool, projectTroubleshootingStateTool } from "./tools/project-tools";
import { externalWebSearchTool } from "./tools/web-tools";

const definitions = [
  projectEvidenceStateTool,
  projectTroubleshootingStateTool,
  courseConceptSearchTool,
  touchDesignerCaseNetworkTool,
  bookLayoutStateTool,
  externalWebSearchTool,
  designCalculatorTool,
] satisfies AgentToolDefinition[];

function deepFreeze<T extends object>(value: T): T {
  for (const key of Reflect.ownKeys(value)) {
    const nested = (value as Record<PropertyKey, unknown>)[key];
    if (nested !== null && typeof nested === "object" && !Object.isFrozen(nested)) {
      deepFreeze(nested as Record<PropertyKey, unknown>);
    }
  }
  return Object.freeze(value);
}

const registry = new Map<string, AgentToolDefinition>();
for (const definition of definitions) {
  const descriptor = AgentToolDescriptorSchema.parse(definition.descriptor);
  const owner = capabilityForTool(descriptor.id);
  if (owner.id !== descriptor.owner.id || owner.type !== descriptor.owner.type) {
    throw new Error(`tool owner mismatch: ${descriptor.id}`);
  }
  getToolAdapter(descriptor.adapterId);
  const key = `${descriptor.id}@${descriptor.version}`;
  if (registry.has(key)) throw new Error(`duplicate agent tool: ${key}`);
  registry.set(key, Object.freeze({ ...definition, descriptor: deepFreeze(descriptor) }));
}

export function getAgentTool(id: string, version = "1") {
  const tool = registry.get(`${id}@${version}`);
  if (!tool) throw new Error(`unknown agent tool: ${id}@${version}`);
  return tool;
}

export function listAgentTools() {
  return Object.freeze([...registry.values()].map(({ descriptor }) => descriptor));
}

export function listRecommendedAgentTools(pack: CoursePack) {
  return Object.freeze([...registry.values()].filter(({ descriptor }) =>
    pack.toolAdapterIds.includes(descriptor.adapterId)
    && descriptor.recommendedByCoursePacks.some((item) => item.id === pack.id && item.version === pack.version)));
}

const requestedCapabilityToolIds: Partial<Record<AgentRequestedCapabilityId, readonly string[]>> = {
  "course-reference": ["knowledge-map.search-concepts"],
  "book-design": [
    "knowledge-map.search-concepts",
    "book-layout-lab.read-state",
    "design-calculator.compute",
  ],
  "process-record": ["project-evidence.read-state"],
  "evidence-troubleshooting": [
    "project-evidence.read-state",
    "project-evidence.read-troubleshooting",
  ],
  "touchdesigner-cases": [
    "knowledge-map.search-concepts",
    "touchdesigner-cases.search-network",
    "design-calculator.compute",
  ],
  "public-research": ["external-web.search"],
  "design-calculation": ["design-calculator.compute"],
  "skill-installer": [],
  "skill-creator": [],
};

export function listAgentToolsForRequestedCapability(input: {
  pack: CoursePack;
  capabilityId?: AgentRequestedCapabilityId;
  externalSearchConfirmed?: boolean;
}) {
  const recommended = listRecommendedAgentTools(input.pack);
  if (!input.capabilityId || input.capabilityId === "five-dimension") {
    return Object.freeze([
      ...recommended,
      ...(input.externalSearchConfirmed
        ? [getAgentTool("external-web.search")]
        : []),
    ]);
  }
  const requestedIds = new Set(requestedCapabilityToolIds[input.capabilityId] ?? []);
  const selected = [...registry.values()].filter(({ descriptor }) => {
    if (!requestedIds.has(descriptor.id)) return false;
    if (descriptor.id === "external-web.search") return input.externalSearchConfirmed === true;
    return descriptor.recommendedByCoursePacks.some(
      (item) => item.id === input.pack.id && item.version === input.pack.version,
    );
  });
  return Object.freeze(selected);
}

export function selectAgentToolsForTurn(input: {
  pack: CoursePack;
  specialty: DesignSpecialty;
  episode: LearningEpisode;
  view: AgentView;
  message: string;
  capabilityId?: AgentRequestedCapabilityId;
}) {
  if (input.capabilityId) {
    return listAgentToolsForRequestedCapability({
      pack: input.pack,
      capabilityId: input.capabilityId,
    });
  }
  if (input.specialty === "GENERAL_DESIGN") return Object.freeze([]);
  const allowed = [...registry.values()];
  const normalized = input.message.normalize("NFKC").toLowerCase();
  const selected = allowed.filter(({ descriptor }) => {
    if (descriptor.id === "knowledge-map.search-concepts") {
      return true;
    }
    if (descriptor.id === "touchdesigner-cases.search-network") {
      return /(案例|参考|节点|网络|结构|效果|touchdesigner|粒子)/i.test(normalized);
    }
    if (descriptor.id === "project-evidence.read-troubleshooting") {
      return input.episode === "DEBUG" || /(故障|排查|不动|没反应|没变化|报错)/.test(normalized);
    }
    if (descriptor.id === "project-evidence.read-state") {
      return input.episode === "DEBUG" || input.view === "PROJECT" || input.view === "EVIDENCE"
        || /(当前|项目|进度|状态|证据|记录|做到哪)/.test(normalized);
    }
    if (descriptor.id === "book-layout-lab.read-state") {
      return input.view === "BOOK_LAYOUT_LAB" || /(当前|版面|编排|页序|受众|进度|状态|恢复)/.test(normalized);
    }
    return false;
  });
  return Object.freeze(selected);
}
