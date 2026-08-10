import { capabilityForTool } from "@/lib/agent/capability-registry";
import { listAgentToolsForRequestedCapability } from "@/lib/agent/tool-registry";

import {
  createCapabilityProviderSet,
  type CapabilityProvider,
  type CapabilityProviderInput,
} from "./capability-provider";

function selectCurrentV3Tools(input: CapabilityProviderInput) {
  return listAgentToolsForRequestedCapability({
    pack: input.pack,
    capabilityId: input.capabilityId,
    externalSearchConfirmed: input.externalSearchConfirmed,
  });
}

export const builtinCapabilityProvider: CapabilityProvider = {
  descriptor: { id: "builtin-capabilities", version: "1" },
  resolve(input) {
    const tools = selectCurrentV3Tools(input);
    return {
      tools,
      selected: tools.map((tool) => {
        const owner = capabilityForTool(tool.descriptor.id);
        return {
          capabilityId: owner.id,
          capabilityVersion: tool.descriptor.version,
          ownerType: owner.type,
          ownerId: owner.id,
          toolId: tool.descriptor.id,
          toolVersion: tool.descriptor.version,
          reasons: tool.descriptor.id === "external-web.search"
            ? ["BUILTIN" as const, "CONSENT_CONFIRMED" as const]
            : input.capabilityId
              ? ["BUILTIN" as const, "STUDENT_REQUESTED" as const]
              : ["BUILTIN" as const, "COURSE_RECOMMENDED" as const],
        };
      }),
      rejected: [],
    };
  },
};

export const builtinCapabilityProviderSet = createCapabilityProviderSet([
  builtinCapabilityProvider,
]);
