import { describe, expect, it } from "vitest";

import {
  ReleaseQualificationBoundarySchema,
  ReleaseQualificationDecisionInputSchema,
} from "@/lib/domain/inspiration-wiki/release-qualification-contracts";

const caseId = `release-qualification:${"1".repeat(32)}`;

describe("D-25 release qualification contracts", () => {
  it("requires verifiable evidence before student display rights can pass", () => {
    const base = {
      caseId,
      gate: "STUDENT_DISPLAY_RIGHTS",
      status: "SATISFIED",
      evidenceRef: null,
      note: "已核对展示范围",
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    } as const;
    expect(ReleaseQualificationDecisionInputSchema.safeParse(base).success).toBe(false);
    expect(ReleaseQualificationDecisionInputSchema.safeParse({ ...base, evidenceRef: "授权记录 rights-001" }).success).toBe(true);
  });

  it("keeps qualification private while D-24 remains Shadow", () => {
    expect(ReleaseQualificationBoundarySchema.parse({
      teacherPrivate: true,
      formalQualificationOnly: true,
      studentVisible: false,
      formalRelease: "DISABLED",
      currentPage: "DISABLED",
      browseRelease: "SHADOW",
      studentSearch: "SHADOW",
      wikiRetrieval: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
      productionDeployment: "DISABLED",
    })).toMatchObject({ studentVisible: false, formalRelease: "DISABLED", browseRelease: "SHADOW" });
  });
});
