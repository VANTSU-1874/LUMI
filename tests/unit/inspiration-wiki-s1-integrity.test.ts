import { describe, expect, it } from "vitest";

import { CompiledTruthSchema } from "@/lib/domain/inspiration-wiki/compilation-contracts";
import { CourseConceptReferenceSchema } from "@/lib/domain/inspiration-wiki/core-contracts";
import {
  compileWikiPageDraft,
  createCanonicalInputBundle,
  parseImmutableCompilationReceipt,
  parseImmutableCompiledTruth,
  parseImmutableCanonicalInputBundle,
  parseImmutableWikiPageDraft,
  reviseWikiPageDraft,
  type DeepReadonly,
} from "@/lib/domain/inspiration-wiki/integrity";
import {
  syntheticCanonicalInputBundle,
  syntheticCanonicalInputSeed,
  syntheticDraftCompilation,
  syntheticGovernanceFixture,
  syntheticWikiDraftSeed,
} from "@/tests/fixtures/inspiration-wiki-s1";

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("LLM Wiki S1 immutable compilation contracts", () => {
  it("binds every canonical revision and deeply freezes the deterministic bundle", () => {
    const first = syntheticCanonicalInputBundle();
    const second = syntheticCanonicalInputBundle();

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.inputs)).toBe(true);
    expect(Object.isFrozen(first.inputs[0]?.payload)).toBe(true);
    const mutableView = first as unknown as { caseId: string };
    expect(() => { mutableView.caseId = "inspiration-case:tampered"; }).toThrow(TypeError);
    expect(parseImmutableCanonicalInputBundle(first)).toEqual(first);
  });

  it("fails closed when a canonical payload or its bundle binding is stale", () => {
    const tamperedPayload = jsonClone(syntheticCanonicalInputBundle()) as unknown as {
      inputs: Array<{ payload: Record<string, unknown> }>;
    };
    tamperedPayload.inputs[0]!.payload.tampered = true;
    expect(() => parseImmutableCanonicalInputBundle(tamperedPayload)).toThrow();

    const tamperedBundle = jsonClone(syntheticCanonicalInputBundle()) as unknown as {
      bundle: { revisionId: string; revisionHash: string };
    };
    tamperedBundle.bundle.revisionHash = `sha256:${"0".repeat(64)}`;
    expect(() => parseImmutableCanonicalInputBundle(tamperedBundle)).toThrow(/STALE_CANONICAL_BUNDLE_HASH/);
  });

  it("emits only an internal draft preview and a zero-vector draft receipt", () => {
    const { compilation } = syntheticDraftCompilation();

    expect(compilation.pageDraft.state).toBe("DRAFT_COMPILED_PREVIEW");
    expect(compilation.pageDraft.audience).toBe("INTERNAL_REVIEWER_ONLY");
    expect(compilation.pageRevision.reviewState).toBe("PENDING_REVIEW");
    expect(compilation.receipt.receiptKind).toBe("DRAFT_COMPILATION_RECEIPT");
    expect(compilation.receipt.release).toBeNull();
    expect(compilation.receipt.vectorMode).toBe("VECTOR_DISABLED");
    expect(compilation.lint).toEqual({ passed: true, issues: [] });
    expect(Object.isFrozen(compilation.pageDraft.claimDrafts)).toBe(true);

    expect(() => parseImmutableCompilationReceipt({
      ...compilation.receipt,
      outputPageSetHash: `sha256:${"0".repeat(64)}`,
    })).toThrow(/STALE_COMPILATION_RECEIPT_HASH/);
  });

  it("creates a new immutable draft revision and rejects a stale edit race", () => {
    const { bundle, compilation } = syntheticDraftCompilation();
    const original = compilation.pageDraft;
    const revised = reviseWikiPageDraft(compilation, {
      createdAt: "2026-08-10T02:00:00.000Z",
    }, original.revision, bundle);

    expect(original.title).toBe("Synthetic grid rhythm");
    expect(revised.title).toBe(original.title);
    expect(revised.revisionNumber).toBe(2);
    expect(revised.supersedesRevision).toEqual(original.revision);
    expect(revised.revision).not.toEqual(original.revision);
    expect(parseImmutableWikiPageDraft(revised)).toEqual(revised);
    expect(() => reviseWikiPageDraft(compilation, {
      createdAt: "2026-08-10T03:00:00.000Z",
    }, revised.revision, bundle)).toThrow(/STALE_PAGE_DRAFT_REVISION/);
    expect(() => reviseWikiPageDraft(compilation, {
      title: "Caller-supplied semantic edit",
      createdAt: "2026-08-10T03:00:00.000Z",
    }, original.revision, bundle)).toThrow();
  });

  it("rejects unknown page/link types before a draft can be compiled", () => {
    const pageSeed = syntheticCanonicalInputSeed() as unknown as {
      inputs: Array<{ kind: string; payload: Record<string, unknown> }>;
    };
    pageSeed.inputs.find((input) => input.kind === "CANDIDATE_REVISION")!.payload.pageType = "FLAT_CANDIDATE";
    expect(() => createCanonicalInputBundle(pageSeed)).toThrow();

    const linkSeed = syntheticCanonicalInputSeed() as unknown as {
      inputs: Array<{ kind: string; payload: { linkDrafts?: Array<Record<string, unknown>> } }>;
    };
    linkSeed.inputs.find((input) => input.kind === "CANDIDATE_REVISION")!.payload.linkDrafts![0]!.relationType = "MODEL_INVENTED_RELATION";
    expect(() => createCanonicalInputBundle(linkSeed)).toThrow();
  });

  it("rejects model claim support outside the immutable canonical bundle", () => {
    const raw = syntheticCanonicalInputSeed() as unknown as {
      inputs: Array<{ kind: string; payload: { claims?: Array<{ supportObjectIds: string[] }> } }>;
    };
    raw.inputs.find((input) => input.kind === "ANALYSIS_REVISION")!.payload.claims![0]!.supportObjectIds = [
      "legacy-publication:unbound",
      "analysis:synthetic-grid-rhythm",
    ];
    const bundle = createCanonicalInputBundle(raw);
    expect(() => compileWikiPageDraft(bundle, syntheticWikiDraftSeed()))
      .toThrow(/CLAIM_SUPPORT_OUTSIDE_CANONICAL_BUNDLE/);
  });

  it("keeps model drafts and Course Knowledge V2 bodies outside Compiled Truth", () => {
    const { truth } = syntheticGovernanceFixture();
    expect(parseImmutableCompiledTruth(truth)).toEqual(truth);
    expect(() => parseImmutableCompiledTruth({ ...truth, title: "Stale title" }))
      .toThrow(/STALE_COMPILED_TRUTH_HASH/);
    expect(CompiledTruthSchema.safeParse({
      ...truth,
      claims: truth.claims.map((claim) => ({ ...claim, authorship: "MODEL_DRAFT" })),
    }).success).toBe(false);
    expect(CompiledTruthSchema.safeParse({ ...truth, courseBody: "Forbidden copied course authority." }).success).toBe(false);
    expect(CourseConceptReferenceSchema.safeParse({
      ...truth.courseConceptRefs[0],
      courseBody: "Forbidden copied Knowledge V2 body.",
      acl: "copied",
    }).success).toBe(false);
    expect(truth.courseConceptRefs[0]).toEqual({
      authority: "COURSE_KNOWLEDGE_V2",
      conceptId: "course-concept:digital-interaction-layout-hierarchy",
      displayLabel: "信息层级",
      referenceMode: "REFERENCE_ONLY",
    });
  });

  it("exposes deeply readonly return types to TypeScript callers", () => {
    const bundle: DeepReadonly<ReturnType<typeof syntheticCanonicalInputBundle>> = syntheticCanonicalInputBundle();
    expect(bundle.inputs).toHaveLength(6);
  });
});
