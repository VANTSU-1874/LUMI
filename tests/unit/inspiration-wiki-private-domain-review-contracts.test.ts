import { describe, expect, it } from "vitest";

import {
  derivePrivateDomainReviewStage,
  PrivateDomainReviewDecisionBodySchema,
  PrivateDomainNonTeachingBaselineBodySchema,
  PrivateDomainReviewStateSchema,
  PrivateDomainTeachingBatchBodySchema,
} from "@/lib/domain/inspiration-wiki/private-domain-review-contracts";

const pending = () => ({ status: "PENDING" as const, decisionId: null, reviewerId: null, note: null, decidedAt: null });
const approved = (id: string) => ({ status: "APPROVED" as const, decisionId: id, reviewerId: "teacher", note: null, decidedAt: "2026-08-12T16:35:00.000Z" });

describe("private domain review contracts", () => {
  it("derives pending, hold, rejected, and complete stages from four independent domains", () => {
    const initial = PrivateDomainReviewStateSchema.parse({ CURATION: pending(), TEACHING: pending(), RIGHTS: pending(), SAFETY: pending() });
    expect(derivePrivateDomainReviewStage(initial)).toBe("PENDING_DOMAIN_REVIEW");
    expect(derivePrivateDomainReviewStage({ ...initial, CURATION: { ...approved("curation"), status: "HOLD" } })).toBe("DOMAIN_REVIEW_HOLD");
    expect(derivePrivateDomainReviewStage({ ...initial, SAFETY: { ...approved("safety"), status: "REJECTED" } })).toBe("PRIVATE_DRAFT_REJECTED");
    expect(derivePrivateDomainReviewStage({ CURATION: approved("c"), TEACHING: approved("t"), RIGHTS: approved("r"), SAFETY: approved("s") })).toBe("DOMAIN_REVIEW_COMPLETE");
  });

  it("treats rights approval as unknown and private-only, never formal republication", () => {
    const base = {
      expectedRevision: 1,
      expectedStateHash: "a".repeat(64),
      reviewDomain: "RIGHTS",
      decision: "APPROVE",
      note: "",
      idempotencyKey: "rights-private-001",
    } as const;
    expect(PrivateDomainReviewDecisionBodySchema.parse({
      ...base,
      assessment: { domain: "RIGHTS", rightsState: "UNKNOWN", privateUseOnlyAcknowledged: true, formalRepublicationAllowed: false },
    }).assessment).toMatchObject({ rightsState: "UNKNOWN", formalRepublicationAllowed: false });
    expect(() => PrivateDomainReviewDecisionBodySchema.parse({
      ...base,
      assessment: { domain: "CURATION", representativeValue: "YES", redundancyAcceptable: "YES" },
    })).toThrow();
  });

  it("requires reasons for hold or rejection and positive criteria for approval", () => {
    const base = { expectedRevision: 1, expectedStateHash: "b".repeat(64), reviewDomain: "CURATION", idempotencyKey: "curation-private-001" } as const;
    expect(() => PrivateDomainReviewDecisionBodySchema.parse({ ...base, decision: "HOLD", note: "", assessment: { domain: "CURATION", representativeValue: "UNCERTAIN", redundancyAcceptable: "YES" } })).toThrow();
    expect(() => PrivateDomainReviewDecisionBodySchema.parse({ ...base, decision: "APPROVE", note: "", assessment: { domain: "CURATION", representativeValue: "UNCERTAIN", redundancyAcceptable: "YES" } })).toThrow();
  });

  it("accepts at most twelve teaching decisions and requires structured exception reasons", () => {
    const item = { reviewCaseId: `private-domain-review:${"1".repeat(32)}`, expectedRevision: 1, expectedStateHash: "c".repeat(64), decision: "APPROVE", issueKeys: [], note: "" } as const;
    expect(PrivateDomainTeachingBatchBodySchema.parse({ items: [item], idempotencyKey: "teaching-batch-001" }).items).toHaveLength(1);
    expect(() => PrivateDomainTeachingBatchBodySchema.parse({ items: [{ ...item, decision: "HOLD" }], idempotencyKey: "teaching-batch-002" })).toThrow();
    expect(() => PrivateDomainTeachingBatchBodySchema.parse({ items: [{ ...item, decision: "REJECT" }], idempotencyKey: "teaching-batch-003" })).toThrow();
    expect(() => PrivateDomainTeachingBatchBodySchema.parse({ items: Array.from({ length: 13 }, (_, index) => ({ ...item, reviewCaseId: `private-domain-review:${index.toString(16).padStart(32, "0")}` })), idempotencyKey: "teaching-batch-004" })).toThrow();
  });

  it("uses an explicit current-queue scope for non-teaching baseline confirmation", () => {
    expect(PrivateDomainNonTeachingBaselineBodySchema.parse({ scope: "CURRENT_PRIVATE_REVIEW_QUEUE", idempotencyKey: "baseline-001" }).scope).toBe("CURRENT_PRIVATE_REVIEW_QUEUE");
    expect(() => PrivateDomainNonTeachingBaselineBodySchema.parse({ scope: "ALL_FUTURE_CASES", idempotencyKey: "baseline-002" })).toThrow();
  });
});
