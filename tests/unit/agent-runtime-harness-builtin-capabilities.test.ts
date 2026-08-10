import { describe, expect, it } from "vitest";

import { listCoursePacks } from "@/lib/course-packs/registry";
import { listAgentToolsForRequestedCapability } from "@/lib/agent/tool-registry";
import { builtinCapabilityProviderSet } from "@/lib/agent/runtime/harness/builtin-capability-provider";
import { capabilityToolKey } from "@/lib/agent/runtime/harness/capability-provider";

const requestedCapabilities = [
  undefined,
  "course-reference",
  "book-design",
  "public-research",
  "design-calculation",
] as const;

describe("BuiltinCapabilityProvider parity", () => {
  it("matches the current V3 selector for packs, requested capabilities, and consent", () => {
    for (const pack of listCoursePacks()) {
      for (const capabilityId of requestedCapabilities) {
        for (const externalSearchConfirmed of [false, true]) {
          const resolved = builtinCapabilityProviderSet.resolve({
            pack,
            capabilityId,
            externalSearchConfirmed,
          });
          const legacy = listAgentToolsForRequestedCapability({
            pack,
            capabilityId,
            externalSearchConfirmed,
          });
          expect(resolved.tools.map(capabilityToolKey), JSON.stringify({
            pack: pack.id,
            capabilityId,
            externalSearchConfirmed,
          })).toEqual(legacy.map(capabilityToolKey));
        }
      }
    }
  });

  it("requires current-turn consent before exposing the web tool", () => {
    const pack = listCoursePacks()[0]!;
    const denied = builtinCapabilityProviderSet.resolve({
      pack,
      capabilityId: "public-research",
      externalSearchConfirmed: false,
    });
    const allowed = builtinCapabilityProviderSet.resolve({
      pack,
      capabilityId: "public-research",
      externalSearchConfirmed: true,
    });
    expect(denied.tools.map((tool) => tool.descriptor.id))
      .not.toContain("external-web.search");
    expect(allowed.record.selected.find(
      ({ toolId }) => toolId === "external-web.search",
    )?.reasons).toEqual(["BUILTIN", "CONSENT_CONFIRMED"]);
  });
});
