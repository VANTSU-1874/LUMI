import { describe, expect, it } from "vitest";

import {
  resolveKnowledgeV2CanaryScope,
} from "@/lib/knowledge/knowledge-v2-canary";

const allV2Flags = {
  knowledgeObjectV2: true,
  visualRetrieval: true,
  evidenceBundleV2: true,
};

describe("Knowledge V2 account canary scope", () => {
  it("fails closed for an empty allowlist", () => {
    expect(resolveKnowledgeV2CanaryScope({
      userId: "internal-1",
      canaryUserIds: [],
      flags: allV2Flags,
    })).toEqual({
      enrolled: false,
      flags: {
        knowledgeObjectV2: false,
        visualRetrieval: false,
        evidenceBundleV2: false,
      },
    });
  });

  it("enables only the exact authenticated canary account", () => {
    expect(resolveKnowledgeV2CanaryScope({
      userId: "internal-1",
      canaryUserIds: ["internal-1"],
      flags: allV2Flags,
    })).toEqual({ enrolled: true, flags: allV2Flags });

    expect(resolveKnowledgeV2CanaryScope({
      userId: "student-1",
      canaryUserIds: ["internal-1"],
      flags: allV2Flags,
    }).flags).toEqual({
      knowledgeObjectV2: false,
      visualRetrieval: false,
      evidenceBundleV2: false,
    });
  });

  it("preserves an intentionally text-only canary configuration", () => {
    expect(resolveKnowledgeV2CanaryScope({
      userId: "internal-1",
      canaryUserIds: ["internal-1"],
      flags: {
        knowledgeObjectV2: true,
        visualRetrieval: false,
        evidenceBundleV2: true,
      },
    })).toEqual({
      enrolled: true,
      flags: {
        knowledgeObjectV2: true,
        visualRetrieval: false,
        evidenceBundleV2: true,
      },
    });
  });
});
