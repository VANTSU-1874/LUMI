import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizePublicHttpsUrl } from "@/lib/security/public-web-url";
import { containsInlineCitationLocator } from "@/lib/agent/inline-citation-locator-guard";
type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
    : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;
const IdentifierSchema = z.string().min(1).max(160).refine(
  (value) => value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/u.test(value), "invalid identifier");
const ViewerSchema = z.object({ userId: IdentifierSchema, role: z.enum(["STUDENT", "TEACHER"]) }).strict();
function displayText(maxLength: number, options: { multiline?: boolean } = {}) {
  return z.string().max(maxLength).transform((value) => value.replace(/\r\n?/gu, "\n")).superRefine(
    (value, context) => {
      if (!value.trim()) context.addIssue({ code: "custom", message: "display text must not be empty" });
      if (!options.multiline && /\n/u.test(value)) {
        context.addIssue({ code: "custom", message: "display text must be one line" });
      }
      if (containsInlineCitationLocator(value)) {
        context.addIssue({ code: "custom", message: "display text must not contain locator tokens" });
      }
    },
  );
}
const DisplaySchema = z.object({ title: displayText(200), label: displayText(100) }).strict();
const RangeSchema = z.object({
  startLine: z.number().int().min(1).max(10_000_000), endLine: z.number().int().min(1).max(10_000_000),
}).strict().refine(({ startLine, endLine }) => endLine >= startLine, "invalid citation range");
const BlockSchema = z.object({
  blockId: IdentifierSchema, range: RangeSchema, excerpt: displayText(4_000, { multiline: true }),
}).strict();
function uniqueValues<T>(items: readonly T[], select: (item: T) => string) {
  return new Set(items.map(select)).size === items.length;
}
const SourceBase = {
  sourceId: IdentifierSchema, display: DisplaySchema,
  blocks: z.array(BlockSchema).min(1).max(128).refine(
    (blocks) => uniqueValues(blocks, ({ blockId }) => blockId), "duplicate block ID",
  ),
};
const PERCENT_ESCAPE = /%[0-9a-f]{2}/giu;
const INVALID_PERCENT_ESCAPE = /%(?![0-9a-f]{2})/iu;
const ASCII_UNRESERVED = /^[A-Za-z0-9._~-]$/u;
function canonicalPublicPageUrl(value: string) {
  const normalized = normalizePublicHttpsUrl(value);
  if (!normalized || INVALID_PERCENT_ESCAPE.test(normalized)) return null;
  const canonical = normalized.replace(PERCENT_ESCAPE, (escape) => {
    const hex = escape.slice(1).toUpperCase();
    const decoded = String.fromCharCode(Number.parseInt(hex, 16));
    return ASCII_UNRESERVED.test(decoded) ? decoded : `%${hex}`;
  });
  const reparsed = normalizePublicHttpsUrl(canonical);
  return reparsed?.replace(PERCENT_ESCAPE, (escape) => escape.toUpperCase()) ?? null;
}
function publicPageUrl(value: string, context: z.RefinementCtx) {
  const normalized = canonicalPublicPageUrl(value);
  if (normalized === null) {
    context.addIssue({ code: "custom", message: "web page must be a public HTTPS URL" });
    return z.NEVER;
  }
  return normalized;
}
function publicWebOrigin(value: string, context: z.RefinementCtx) {
  const normalized = normalizePublicHttpsUrl(value);
  if (!normalized) {
    context.addIssue({ code: "custom", message: "web origin must be public HTTPS" });
    return z.NEVER;
  }
  const url = new URL(normalized);
  if (url.pathname !== "/" || url.search || url.hash) {
    context.addIssue({ code: "custom", message: "web origin must not contain a path, query, or fragment" });
    return z.NEVER;
  }
  return url.origin;
}
const WebLocation = {
  origin: z.string().max(2_048).transform(publicWebOrigin), pageUrl: z.string().max(2_048).transform(publicPageUrl),
};
const MarkdownSourceSchema = z.object({
  ...SourceBase, sourceKind: z.literal("MARKDOWN"), documentId: IdentifierSchema,
}).strict();
const FileSourceSchema = z.object({
  ...SourceBase, sourceKind: z.literal("FILE"), fileId: IdentifierSchema,
}).strict();
const WebSourceSchema = z.object({
  ...SourceBase, sourceKind: z.literal("WEB"), ...WebLocation,
}).strict().refine(({ origin, pageUrl }) => new URL(pageUrl).origin === origin, {
  message: "web page must use the source origin",
});
const ManifestSourceSchema = z.discriminatedUnion("sourceKind", [MarkdownSourceSchema, FileSourceSchema, WebSourceSchema]);
const InlineCitationManifestSchema = z.object({
  format: z.literal("INLINE_CITATION_MANIFEST_V1"),
  manifestId: IdentifierSchema,
  revision: z.number().int().min(1).max(2_147_483_647),
  viewer: ViewerSchema,
  sources: z.array(ManifestSourceSchema).min(1).max(128).refine(
    (sources) => uniqueValues(sources, ({ sourceId }) => sourceId), "duplicate source ID",
  ),
}).strict();
const CandidateBase = {
  sourceId: IdentifierSchema, title: displayText(200), label: displayText(100),
  blockId: IdentifierSchema, range: RangeSchema,
  excerpt: displayText(4_000, { multiline: true }),
};
const MarkdownCitationSchema = z.object({
  ...CandidateBase, sourceKind: z.literal("MARKDOWN"), documentId: IdentifierSchema,
}).strict();
const FileCitationSchema = z.object({
  ...CandidateBase, sourceKind: z.literal("FILE"), fileId: IdentifierSchema,
}).strict();
const WebCitationSchema = z.object({
  ...CandidateBase, sourceKind: z.literal("WEB"), ...WebLocation,
}).strict().refine(({ origin, pageUrl }) => new URL(pageUrl).origin === origin, {
  message: "web page must use the citation origin",
});
const RawCandidateCitationSchema = z.discriminatedUnion("sourceKind", [
  MarkdownCitationSchema, FileCitationSchema, WebCitationSchema,
]);
const RawClaimSchema = z.object({
  claimId: IdentifierSchema, claim: displayText(16_000, { multiline: true }),
  citations: z.array(RawCandidateCitationSchema).min(1).max(16),
}).strict();
const RawCandidateSetSchema = z.object({
  manifestBinding: z.object({ manifestId: IdentifierSchema, revision: z.number().int().min(1) }).strict(),
  viewerBinding: ViewerSchema,
  claims: z.array(RawClaimSchema).min(1).max(32).refine(
    (claims) => uniqueValues(claims, ({ claimId }) => claimId), "duplicate claim ID",
  ),
}).strict();
const StageZeroInputSchema = z.object({
  manifest: InlineCitationManifestSchema, viewer: ViewerSchema, candidateSet: RawCandidateSetSchema,
}).strict();
type RawCitation = z.output<typeof RawCandidateCitationSchema>;
type ManifestSource = z.output<typeof ManifestSourceSchema>;
type Guard = {
  stage: "STAGE_0_CANDIDATE"; renderPolicy: "DO_NOT_RENDER";
  manifestBinding: { manifestId: string; revision: number; manifestDigest: string }; viewerBinding: z.output<typeof ViewerSchema>;
};
type BoundCitation = RawCitation & Guard;
type BoundClaim = z.output<typeof RawClaimSchema> & Guard & { citations: BoundCitation[] };
type BoundSet = Guard & { claims: BoundClaim[] };
export type InlineCitationViewer = DeepReadonly<z.input<typeof ViewerSchema>>;
export type InlineCitationManifest = DeepReadonly<z.input<typeof InlineCitationManifestSchema>>;
export type ManifestBoundInlineCitationCandidateSet = DeepReadonly<BoundSet>;
function sameViewer(left: z.output<typeof ViewerSchema>, right: z.output<typeof ViewerSchema>) {
  return left.userId === right.userId && left.role === right.role;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const STAGE_ZERO_ERROR_CODE = "INLINE_CITATION_STAGE_0_REJECTED";
class InlineCitationStage0Error extends Error {
  readonly name = "InlineCitationStage0Error";
  readonly code = STAGE_ZERO_ERROR_CODE;
  constructor(readonly reason: string) {
    super(STAGE_ZERO_ERROR_CODE);
  }
}
function fail(reason: string): never {
  throw new InlineCitationStage0Error(reason);
}
function bindCitation(citation: RawCitation, source: ManifestSource, guard: Guard): BoundCitation {
  if (citation.sourceKind !== source.sourceKind) fail("SOURCE_KIND_NOT_AUTHORIZED");
  if (citation.title !== source.display.title || citation.label !== source.display.label) {
    fail("DISPLAY_NOT_AUTHORIZED");
  }
  const block = source.blocks.find(({ blockId }) => blockId === citation.blockId);
  if (!block) fail("BLOCK_NOT_AUTHORIZED");
  if (citation.range.startLine !== block.range.startLine || citation.range.endLine !== block.range.endLine) {
    fail("RANGE_NOT_AUTHORIZED");
  }
  if (citation.excerpt !== block.excerpt) fail("EXCERPT_NOT_AUTHORIZED");
  if (citation.sourceKind === "MARKDOWN") {
    if (source.sourceKind !== "MARKDOWN" || citation.documentId !== source.documentId) {
      fail("DOCUMENT_NOT_AUTHORIZED");
    }
  } else if (citation.sourceKind === "FILE") {
    if (source.sourceKind !== "FILE" || citation.fileId !== source.fileId) {
      fail("FILE_NOT_AUTHORIZED");
    }
  } else {
    if (source.sourceKind !== "WEB" || citation.origin !== source.origin) {
      fail("WEB_ORIGIN_NOT_AUTHORIZED");
    }
    if (citation.pageUrl !== source.pageUrl) fail("WEB_PAGE_NOT_AUTHORIZED");
  }
  return { ...citation, ...guard };
}
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
export function parseManifestBoundInlineCitationCandidateSet(input: {
  manifest: InlineCitationManifest;
  viewer: InlineCitationViewer;
  candidateSet: unknown;
}): ManifestBoundInlineCitationCandidateSet {
  const parsed = StageZeroInputSchema.safeParse(input);
  if (!parsed.success) fail("INVALID_INPUT");
  const { manifest, viewer, candidateSet } = parsed.data;
  if (
    candidateSet.manifestBinding.manifestId !== manifest.manifestId
    || candidateSet.manifestBinding.revision !== manifest.revision
  ) fail("MANIFEST_NOT_AUTHORIZED");
  if (!sameViewer(viewer, manifest.viewer) || !sameViewer(candidateSet.viewerBinding, viewer)) {
    fail("VIEWER_NOT_AUTHORIZED");
  }
  const guard: Guard = {
    stage: "STAGE_0_CANDIDATE",
    renderPolicy: "DO_NOT_RENDER",
    manifestBinding: {
      manifestId: manifest.manifestId,
      revision: manifest.revision,
      manifestDigest: createHash("sha256").update(canonicalJson(manifest), "utf8").digest("hex"),
    },
    viewerBinding: viewer,
  };
  const claims = candidateSet.claims.map((claim) => ({
    ...claim,
    ...guard,
    citations: claim.citations.map((citation) => {
      const source = manifest.sources.find(({ sourceId }) => sourceId === citation.sourceId);
      if (!source) fail("SOURCE_NOT_AUTHORIZED");
      return bindCitation(citation, source, guard);
    }),
  }));
  return deepFreeze({ ...guard, claims });
}
