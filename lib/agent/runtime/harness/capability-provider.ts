import { createHash } from "node:crypto";

import { z } from "zod";

import { capabilityForTool } from "@/lib/agent/capability-registry";
import type { CoursePack } from "@/lib/course-packs/contract";
import type { AgentRequestedCapabilityId } from "@/lib/agent/requested-capability";
import type { AgentToolDefinition } from "@/lib/agent/tool-contract";
import { getAgentTool } from "@/lib/agent/tool-registry";

export const CapabilityResolutionReasonSchema = z.enum([
  "BUILTIN",
  "COURSE_RECOMMENDED",
  "VIEW_RELEVANT",
  "STUDENT_REQUESTED",
  "CONSENT_CONFIRMED",
]);

const CapabilityProviderDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  version: z.string().regex(/^[0-9]+(?:\.[0-9]+){0,2}$/),
}).strict();

const SelectedCapabilitySchema = z.object({
  capabilityId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  capabilityVersion: z.string().regex(/^[0-9]+$/),
  ownerType: z.enum(["PLUGIN", "SKILL"]),
  ownerId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  toolId: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/),
  toolVersion: z.string().regex(/^[0-9]+$/),
  reasons: z.array(CapabilityResolutionReasonSchema).min(1).max(5),
}).strict();

const RejectedCapabilitySchema = z.object({
  capabilityId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
}).strict();

export const CapabilityResolutionRecordSchema = z.object({
  providerSetVersion: z.string().trim().min(1).max(200),
  selected: z.array(SelectedCapabilitySchema).max(50),
  rejected: z.array(RejectedCapabilitySchema).max(50),
  canonicalHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type CapabilityProviderInput = {
  pack: CoursePack;
  capabilityId?: AgentRequestedCapabilityId;
  externalSearchConfirmed: boolean;
};

export type CapabilityProviderContribution = {
  tools: readonly AgentToolDefinition[];
  selected: z.infer<typeof SelectedCapabilitySchema>[];
  rejected: z.infer<typeof RejectedCapabilitySchema>[];
};

export interface CapabilityProvider {
  readonly descriptor: z.infer<typeof CapabilityProviderDescriptorSchema>;
  resolve(input: CapabilityProviderInput): CapabilityProviderContribution;
}

export type CapabilityResolution = {
  tools: readonly AgentToolDefinition[];
  record: z.infer<typeof CapabilityResolutionRecordSchema>;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}

export function capabilityToolKey(tool: AgentToolDefinition) {
  return `${tool.descriptor.id}@${tool.descriptor.version}`;
}

export function compareCapabilityToolSets(
  legacy: readonly AgentToolDefinition[],
  provider: readonly AgentToolDefinition[],
) {
  const legacyKeys = legacy.map(capabilityToolKey);
  const providerKeys = provider.map(capabilityToolKey);
  return {
    equal: JSON.stringify(legacyKeys) === JSON.stringify(providerKeys),
    legacyKeys,
    providerKeys,
  };
}

const reasonRank = new Map(
  CapabilityResolutionReasonSchema.options.map((reason, index) => [reason, index]),
);

export function createCapabilityProviderSet(
  rawProviders: readonly CapabilityProvider[],
) {
  const providers = [...rawProviders].map((provider) => {
    CapabilityProviderDescriptorSchema.parse(provider.descriptor);
    return provider;
  }).sort((left, right) =>
    left.descriptor.id.localeCompare(right.descriptor.id));
  if (new Set(providers.map(({ descriptor }) => descriptor.id)).size !== providers.length) {
    throw new Error("CAPABILITY_PROVIDER_ID_DUPLICATE");
  }
  const providerSetVersion = providers
    .map(({ descriptor }) => `${descriptor.id}@${descriptor.version}`)
    .join(",");

  return {
    resolve(input: CapabilityProviderInput): CapabilityResolution {
      const contributions = providers.map((provider) => provider.resolve(input));
      const tools = contributions.flatMap(({ tools: items }) => [...items]);
      const keys = tools.map(capabilityToolKey);
      if (new Set(keys).size !== keys.length) {
        throw new Error("CAPABILITY_TOOL_KEY_DUPLICATE");
      }
      for (const tool of tools) {
        if (getAgentTool(tool.descriptor.id, tool.descriptor.version) !== tool) {
          throw new Error("CAPABILITY_TOOL_DEFINITION_MISMATCH");
        }
      }
      const selected = contributions.flatMap(({ selected: items }) => items)
        .map((item) => ({
          ...item,
          reasons: [...item.reasons].sort(
            (left, right) => reasonRank.get(left)! - reasonRank.get(right)!,
          ),
        }))
        .sort((left, right) => (
          left.capabilityId.localeCompare(right.capabilityId)
          || left.capabilityVersion.localeCompare(right.capabilityVersion)
          || left.ownerType.localeCompare(right.ownerType)
          || left.ownerId.localeCompare(right.ownerId)
          || left.toolId.localeCompare(right.toolId)
          || left.toolVersion.localeCompare(right.toolVersion)
        ));
      const selectedByTool = new Map(
        selected.map((item) => [`${item.toolId}@${item.toolVersion}`, item]),
      );
      if (selectedByTool.size !== selected.length || selected.length !== tools.length) {
        throw new Error("CAPABILITY_SELECTION_CARDINALITY_MISMATCH");
      }
      for (const tool of tools) {
        const item = selectedByTool.get(capabilityToolKey(tool));
        const owner = capabilityForTool(tool.descriptor.id);
        if (
          !item
          || item.capabilityId !== owner.id
          || item.capabilityVersion !== tool.descriptor.version
          || item.ownerType !== owner.type
          || item.ownerId !== owner.id
        ) {
          throw new Error("CAPABILITY_SELECTION_OWNER_MISMATCH");
        }
      }
      const rejected = contributions.flatMap(({ rejected: items }) => items)
        .sort((left, right) => (
          left.capabilityId.localeCompare(right.capabilityId)
          || left.code.localeCompare(right.code)
        ));
      const base = { providerSetVersion, selected, rejected };
      const canonicalHash = createHash("sha256")
        .update(JSON.stringify(canonical(base)))
        .digest("hex");
      const record = CapabilityResolutionRecordSchema.parse({
        ...base,
        canonicalHash,
      });
      return { tools: Object.freeze([...tools]), record };
    },
  };
}
