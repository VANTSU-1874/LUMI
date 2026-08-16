import {
  P1CurrentAllowlistSnapshotSchema,
  P1SeedIndexInputSchema,
  P1SeedIndexSchema,
  P1SeedQueryContractSchema,
  P1SeedQueryInputSchema,
  P1SeedQueryResponseSchema,
  type P1SeedIndex,
  type P1SeedIndexInput,
  type P1SeedQueryContract,
  type P1SeedQueryResponse,
  type P1CurrentAllowlistSnapshot,
} from "./retrieval-contracts";
import {
  WikiContractIntegrityError,
  bindWikiRevision,
  canonicalInput,
  deepFreezeWikiValue,
  deriveCanonicalReleaseSemantics,
  deriveVerifiedWikiMaterial,
  hashWikiValue,
  parseImmutableReviewedWikiLink,
  stableWikiJson,
  wikiRevisionMatches,
} from "./integrity";
import { evaluateCompiledTruthReviewBinding, evaluateRoleDomainReviews } from "./governance";

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}

export function createP1SeedQueryContract(rawInput: unknown): P1SeedQueryContract {
  const input = P1SeedQueryInputSchema.parse(rawInput);
  const currentAllowlist = parseImmutableP1CurrentAllowlistSnapshot(input.currentAllowlist);
  if (stableWikiJson(input.expectedIndexRevision) !== stableWikiJson(currentAllowlist.indexRevision)) {
    throw new WikiContractIntegrityError("QUERY_CURRENT_ALLOWLIST_INDEX_MISMATCH");
  }
  const eligiblePageIds = uniqueSorted(input.eligiblePageIds);
  if (eligiblePageIds.length !== input.eligiblePageIds.length) {
    throw new WikiContractIntegrityError("QUERY_ELIGIBLE_PAGE_IDS_DUPLICATED");
  }
  const currentlyAllowedPageIds = new Set(currentAllowlist.entries.map((entry) => entry.pageId));
  if (eligiblePageIds.some((pageId) => !currentlyAllowedPageIds.has(pageId))) {
    throw new WikiContractIntegrityError("QUERY_ELIGIBLE_PAGE_IDS_NOT_ALLOWLIST_SUBSET");
  }
  assertCurrentAllowlistWindow(currentAllowlist, input.evaluatedAt);
  return deepFreezeWikiValue(P1SeedQueryContractSchema.parse({
    schemaVersion: "lumi-inspiration-p1-seed-query/v1",
    scope: "DRAFT_SHADOW",
    audience: "INTERNAL_REVIEWER_ONLY",
    normalizedQuery: normalize(input.query),
    eligiblePageIds,
    currentnessContract: "UPSTREAM_SNAPSHOT_REQUIRED_QUERY_ONLY_NARROWS",
    currentAllowlist,
    allowedPageTypes: uniqueSorted(input.allowedPageTypes),
    seedModes: ["FTS", "ALIAS", "FACET"],
    lexicalMatchContract: "EXACT_NORMALIZED_TERMS_NOT_SUBSTRING",
    graph: {
      scope: "ELIGIBLE_VISIBLE_SUBGRAPH",
      allowedLinkTypes: uniqueSorted(input.allowedLinkTypes),
      hopLimit: input.hopLimit,
      hiddenNodesAsBridges: false,
    },
    vector: { mode: "VECTOR_DISABLED", vectorCalls: 0, provider: null, index: null },
    resultLimit: input.resultLimit,
    evaluatedAt: input.evaluatedAt,
    evaluatedAtTrustBoundary: input.evaluatedAtTrustBoundary,
    expectedIndexRevision: input.expectedIndexRevision,
  }));
}

function currentAllowlistSnapshotMaterial(snapshot: P1CurrentAllowlistSnapshot) {
  return Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== "snapshotRevision"));
}

function currentAllowlistAuthorityReceiptMaterial(snapshot: P1CurrentAllowlistSnapshot) {
  return {
    source: snapshot.authority.source,
    trustBoundary: snapshot.authority.trustBoundary,
    indexRevision: snapshot.indexRevision,
    asOf: snapshot.asOf,
    validUntil: snapshot.validUntil,
    entries: snapshot.entries,
  };
}

export function parseImmutableP1CurrentAllowlistSnapshot(
  rawSnapshot: unknown,
): P1CurrentAllowlistSnapshot {
  const snapshot = P1CurrentAllowlistSnapshotSchema.parse(rawSnapshot);
  if (!wikiRevisionMatches(
    snapshot.authority.receipt,
    currentAllowlistAuthorityReceiptMaterial(snapshot),
  )) {
    throw new WikiContractIntegrityError("STALE_P1_CURRENT_ALLOWLIST_AUTHORITY_RECEIPT");
  }
  if (!wikiRevisionMatches(snapshot.snapshotRevision, currentAllowlistSnapshotMaterial(snapshot))) {
    throw new WikiContractIntegrityError("STALE_P1_CURRENT_ALLOWLIST_SNAPSHOT");
  }
  return deepFreezeWikiValue(snapshot);
}

function assertCurrentAllowlistWindow(snapshot: P1CurrentAllowlistSnapshot, evaluatedAt: string) {
  const evaluated = Date.parse(evaluatedAt);
  if (evaluated < Date.parse(snapshot.asOf)) {
    throw new WikiContractIntegrityError("P1_CURRENT_ALLOWLIST_NOT_YET_VALID");
  }
  if (evaluated > Date.parse(snapshot.validUntil)) {
    throw new WikiContractIntegrityError("P1_CURRENT_ALLOWLIST_EXPIRED");
  }
}

function indexBuildReceiptMaterial(receipt: P1SeedIndex["buildReceipt"]) {
  return Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receipt"));
}

function indexRevisionMaterial(index: P1SeedIndex) {
  return Object.fromEntries(Object.entries(index).filter(([key]) => key !== "indexRevision"));
}

function sourceReceiptKey(receipt: { readonly revisionId: string; readonly revisionHash: string }) {
  return stableWikiJson(receipt);
}

function lexicalTerms(values: readonly string[]) {
  const terms = values.flatMap((value) => {
    const normalized = normalize(value);
    const tokens = normalized.split(/[\s,，。；;、:：!?！？()[\]{}"'“”‘’]+/u).filter(Boolean);
    return normalized.length <= 240 ? [normalized, ...tokens] : tokens;
  }).filter((term) => term.length > 0 && term.length <= 240);
  return uniqueSorted(terms).slice(0, 200);
}

function termProjectionMaterial(page: P1SeedIndex["pages"][number]) {
  return Object.fromEntries(Object.entries(page).filter(([key]) => key !== "termProjectionReceipt"));
}

function deriveP1SourceAuthorization(
  source: P1SeedIndexInput["sources"][number],
  evaluatedAt: string,
) {
  const material = deriveVerifiedWikiMaterial(source.sourceMaterial);
  const truth = source.sourceMaterial.compiledTruth;
  const exactDraftMaterial = {
    canonicalInputBundle: source.sourceMaterial.canonicalInputBundle,
    compilation: source.sourceMaterial.compilation,
  };
  if (stableWikiJson(source.reviewGate.draftMaterial) !== stableWikiJson(exactDraftMaterial)) {
    throw new WikiContractIntegrityError("P1_REVIEW_GATE_SOURCE_MATERIAL_MISMATCH");
  }
  const reviewGateAtEvaluation = { ...source.reviewGate, evaluatedAt };
  const truthReviewBinding = evaluateCompiledTruthReviewBinding({
    compiledTruth: truth,
    reviewGate: reviewGateAtEvaluation,
    notAfter: evaluatedAt,
  });
  if (!truthReviewBinding.eligible || !truthReviewBinding.acceptedDecisionSetHash) {
    throw new WikiContractIntegrityError(
      `P1_TRUTH_REVIEW_BINDING_FAILED:${truthReviewBinding.reasons.join("|")}`,
    );
  }
  const semantics = deriveCanonicalReleaseSemantics(
    source.sourceMaterial.canonicalInputBundle,
    evaluatedAt,
  );
  if ((source.visibility === "ELIGIBLE" || source.visibility === "HIDDEN") && !semantics.eligible) {
    throw new WikiContractIntegrityError("P1_VISIBLE_SOURCE_BLOCKED_BY_CANONICAL_SEMANTICS");
  }
  if (source.visibility === "WITHDRAWN" && semantics.eligible) {
    throw new WikiContractIntegrityError("P1_WITHDRAWN_SOURCE_NOT_CANONICALLY_RESTRICTED");
  }
  return {
    material,
    truth,
    acceptedReviewDecisionSetHash: truthReviewBinding.acceptedDecisionSetHash,
    authorizationCheckedAt: evaluatedAt,
  };
}

function deriveP1SeedPage(
  source: P1SeedIndexInput["sources"][number],
  evaluatedAt: string,
) {
  const authorization = deriveP1SourceAuthorization(source, evaluatedAt);
  const { material, truth } = authorization;
  const candidate = canonicalInput(source.sourceMaterial.canonicalInputBundle, "CANDIDATE_REVISION");
  const analysis = canonicalInput(source.sourceMaterial.canonicalInputBundle, "ANALYSIS_REVISION");
  const termSourceDigest = hashWikiValue({
    candidate,
    analysis,
    pageRevision: material.pageRevision,
    compilationReceipt: material.compilationReceipt,
    compiledTruthHash: material.compiledTruthHash,
    rightsDecisionSetRevision: material.rightsDecisionSetRevision,
    withdrawalSnapshotRevision: material.withdrawalSnapshotRevision,
    acceptedReviewDecisionSetHash: authorization.acceptedReviewDecisionSetHash,
    authorizationCheckedAt: authorization.authorizationCheckedAt,
  });
  const pageMaterial = {
    projectionSource: "WIKI_PAGE_REVISION" as const,
    pageId: material.pageId,
    revision: material.pageRevision,
    compilationReceipt: material.compilationReceipt,
    sourceMaterialReceipt: material.materialReceipt,
    compiledTruthHash: material.compiledTruthHash,
    rightsDecisionSetRevision: material.rightsDecisionSetRevision,
    withdrawalSnapshotRevision: material.withdrawalSnapshotRevision,
    acceptedReviewDecisionSetHash: authorization.acceptedReviewDecisionSetHash,
    authorizationCheckedAt: authorization.authorizationCheckedAt,
    pageType: truth.pageType,
    visibility: source.visibility,
    title: truth.title,
    ftsTerms: lexicalTerms([truth.title, ...truth.claims.map((claim) => claim.text)]),
    aliases: uniqueSorted(truth.aliases),
    facets: uniqueSorted(truth.facets),
    termSourceDigest,
  };
  return {
    ...pageMaterial,
    termProjectionReceipt: bindWikiRevision(
      `wiki-term-projection:${hashWikiValue(pageMaterial).slice(7, 31)}`,
      pageMaterial,
    ),
  };
}

export function verifyReviewedWikiLinkAgainstSources(
  rawLink: unknown,
  rawSources: unknown,
  evaluatedAt?: string,
) {
  const link = parseImmutableReviewedWikiLink(rawLink);
  const sources = P1SeedIndexInputSchema.shape.sources.parse(rawSources);
  const sourceMaterials = sources.map((source) => ({
    source,
    material: deriveVerifiedWikiMaterial(source.sourceMaterial),
  }));
  const from = sourceMaterials.find(({ material }) => material.pageId === link.fromPageId);
  const to = sourceMaterials.find(({ material }) => material.pageId === link.toPageId);
  if (!from || !to
    || stableWikiJson(from.material.pageRevision) !== stableWikiJson(link.fromPageRevision)
    || stableWikiJson(to.material.pageRevision) !== stableWikiJson(link.toPageRevision)) {
    throw new WikiContractIntegrityError("REVIEWED_LINK_ENDPOINT_REVISION_MISMATCH");
  }
  const source = sourceMaterials.find(({ material }) => material.pageId === link.sourcePageId);
  if (!source) throw new WikiContractIntegrityError("REVIEWED_LINK_SOURCE_ENDPOINT_MISSING");
  if (stableWikiJson(source.material.pageRevision) !== stableWikiJson(link.sourcePageRevision)
    || stableWikiJson(source.material.canonicalInputBundle) !== stableWikiJson(link.sourceCanonicalInputBundle)
    || stableWikiJson(source.source.reviewGate.currentTarget.draftMaterialReceipt)
      !== stableWikiJson(link.sourceDraftMaterialReceipt)) {
    throw new WikiContractIntegrityError("REVIEWED_LINK_SOURCE_MATERIAL_BINDING_MISMATCH");
  }
  const draft = source.source.sourceMaterial.compilation.linkDecisionDrafts.find((candidate) => (
    candidate.linkId === link.linkId
    && stableWikiJson(candidate.revision) === stableWikiJson(link.linkDraftRevision)
    && candidate.fromPageId === link.fromPageId
    && candidate.toPageId === link.toPageId
    && candidate.relationType === link.relationType
    && stableWikiJson(candidate.evidenceRefs) === stableWikiJson(link.evidenceRefs)
  ));
  if (!draft) throw new WikiContractIntegrityError("REVIEWED_LINK_NOT_DERIVED_FROM_ENDPOINT_DRAFT");
  const reviewGate = evaluateRoleDomainReviews({
    ...source.source.reviewGate,
    evaluatedAt: evaluatedAt ?? source.source.reviewGate.evaluatedAt,
  });
  if (!reviewGate.eligible) throw new WikiContractIntegrityError("REVIEWED_LINK_SOURCE_REVIEW_GATE_FAILED");
  const curationReviewIds = reviewGate.acceptedDecisionIds.filter((decisionId) => (
    source.source.reviewGate.reviews.find((review) => review.decisionId === decisionId)?.reviewDomain === "CURATION"
  )).sort();
  if (stableWikiJson(curationReviewIds) !== stableWikiJson([...link.approvalReviewDecisionIds].sort())) {
    throw new WikiContractIntegrityError("REVIEWED_LINK_APPROVAL_NOT_CURRENT_CURATION_SET");
  }
  const latestCurationReviewAt = Math.max(...curationReviewIds.map((decisionId) => (
    Date.parse(source.source.reviewGate.reviews.find((review) => review.decisionId === decisionId)!.decidedAt)
  )));
  if (Date.parse(link.validFrom) < latestCurationReviewAt) {
    throw new WikiContractIntegrityError("REVIEWED_LINK_APPROVAL_PRECEDES_REVIEW");
  }
  return deepFreezeWikiValue(link);
}

export function createP1SeedIndex(rawInput: unknown): P1SeedIndex {
  const input = P1SeedIndexInputSchema.parse(rawInput);
  const sourcePages = input.sources.map((source) => ({
    source,
    page: deriveP1SeedPage(source, input.createdAt),
  }))
    .sort((left, right) => left.page.pageId.localeCompare(right.page.pageId));
  const sources = sourcePages.map(({ source }) => source);
  const pages = sourcePages.map(({ page }) => page);
  const links = input.links
    .map((link) => parseImmutableReviewedWikiLink(link))
    .sort((left, right) => left.linkId.localeCompare(right.linkId));
  const sourceMaterialReceipts = pages.map((page) => page.sourceMaterialReceipt)
    .sort((left, right) => sourceReceiptKey(left).localeCompare(sourceReceiptKey(right)));
  const buildMaterial = {
    schemaVersion: "lumi-inspiration-p1-seed-index-build-receipt/v1" as const,
    sourceMaterialReceipts,
    pageSetHash: hashWikiValue(pages),
    linkSetHash: hashWikiValue(links),
    vectorMode: "VECTOR_DISABLED" as const,
    createdAt: input.createdAt,
  };
  const buildReceipt = {
    ...buildMaterial,
    receipt: bindWikiRevision(`wiki-index-receipt:${hashWikiValue(buildMaterial).slice(7, 31)}`, buildMaterial),
  };
  const material = {
    schemaVersion: "lumi-inspiration-p1-seed-index/v1" as const,
    buildReceipt,
    sources,
    pages,
    links,
  };
  return parseImmutableP1SeedIndex({
    ...material,
    indexRevision: bindWikiRevision(`wiki-index-revision:${hashWikiValue(material).slice(7, 31)}`, material),
  });
}

export function parseImmutableP1SeedIndex(rawIndex: unknown): P1SeedIndex {
  const index = P1SeedIndexSchema.parse(rawIndex);
  if (!wikiRevisionMatches(index.buildReceipt.receipt, indexBuildReceiptMaterial(index.buildReceipt))) {
    throw new WikiContractIntegrityError("STALE_P1_INDEX_BUILD_RECEIPT");
  }
  if (!wikiRevisionMatches(index.indexRevision, indexRevisionMaterial(index))) {
    throw new WikiContractIntegrityError("STALE_P1_INDEX_REVISION");
  }
  if (index.buildReceipt.pageSetHash !== hashWikiValue(index.pages)
    || index.buildReceipt.linkSetHash !== hashWikiValue(index.links)) {
    throw new WikiContractIntegrityError("P1_INDEX_SET_HASH_MISMATCH");
  }
  const buildAt = Date.parse(index.buildReceipt.createdAt);
  if (index.sources.some((source) => (
    Date.parse(source.sourceMaterial.compilation.receipt.createdAt) > buildAt
    || Date.parse(source.sourceMaterial.compiledTruth.compiledAt) > buildAt
    || Date.parse(source.reviewGate.evaluatedAt) > buildAt
  )) || index.links.some((link) => Date.parse(link.validFrom) > buildAt)) {
    throw new WikiContractIntegrityError("P1_INDEX_BUILD_TIME_INVALID");
  }
  const derivedSourcePages = index.sources.map((source) => ({
    source,
    page: deriveP1SeedPage(source, index.buildReceipt.createdAt),
  }))
    .sort((left, right) => left.page.pageId.localeCompare(right.page.pageId));
  const expectedPages = derivedSourcePages.map(({ page }) => page);
  if (stableWikiJson(index.pages) !== stableWikiJson(expectedPages)) {
    throw new WikiContractIntegrityError("P1_TERMS_NOT_DERIVED_FROM_EXACT_SOURCE_MATERIAL");
  }
  const expectedSourceReceipts = expectedPages.map((page) => page.sourceMaterialReceipt)
    .sort((left, right) => sourceReceiptKey(left).localeCompare(sourceReceiptKey(right)));
  if (stableWikiJson(index.buildReceipt.sourceMaterialReceipts) !== stableWikiJson(expectedSourceReceipts)) {
    throw new WikiContractIntegrityError("P1_SOURCE_MATERIAL_RECEIPT_MISMATCH");
  }
  const sourceReceipts = new Set(index.buildReceipt.sourceMaterialReceipts.map(sourceReceiptKey));
  const pages = new Map<string, P1SeedIndex["pages"][number]>();
  for (const page of index.pages) {
    if (pages.has(page.pageId)) throw new WikiContractIntegrityError("DUPLICATE_P1_INDEX_PAGE");
    if (!wikiRevisionMatches(page.termProjectionReceipt, termProjectionMaterial(page))) {
      throw new WikiContractIntegrityError("STALE_P1_TERM_PROJECTION_RECEIPT");
    }
    if (!sourceReceipts.has(sourceReceiptKey(page.sourceMaterialReceipt))) {
      throw new WikiContractIntegrityError("P1_PAGE_SOURCE_MATERIAL_RECEIPT_MISMATCH");
    }
    pages.set(page.pageId, page);
  }
  const linkIds = new Set<string>();
  const logicalLinks = new Set<string>();
  const graphParent = new Map(index.pages.map((page) => [page.pageId, page.pageId]));
  const findRoot = (pageId: string): string => {
    const parent = graphParent.get(pageId);
    if (!parent || parent === pageId) return pageId;
    const root = findRoot(parent);
    graphParent.set(pageId, root);
    return root;
  };
  for (const rawLink of index.links) {
    const link = verifyReviewedWikiLinkAgainstSources(rawLink, index.sources, index.buildReceipt.createdAt);
    if (linkIds.has(link.linkId)) throw new WikiContractIntegrityError("DUPLICATE_REVIEWED_LINK_ID");
    linkIds.add(link.linkId);
    const endpoints = [link.fromPageId, link.toPageId].sort((left, right) => left.localeCompare(right));
    const logicalKey = stableWikiJson({ endpoints, relationType: link.relationType });
    if (logicalLinks.has(logicalKey)) throw new WikiContractIntegrityError("DUPLICATE_REVIEWED_LOGICAL_LINK");
    logicalLinks.add(logicalKey);
    const fromPage = pages.get(link.fromPageId);
    const toPage = pages.get(link.toPageId);
    if (!fromPage || !toPage
      || stableWikiJson(fromPage.revision) !== stableWikiJson(link.fromPageRevision)
      || stableWikiJson(toPage.revision) !== stableWikiJson(link.toPageRevision)) {
      throw new WikiContractIntegrityError("REVIEWED_LINK_ENDPOINT_REVISION_MISMATCH");
    }
    const fromRoot = findRoot(link.fromPageId);
    const toRoot = findRoot(link.toPageId);
    if (fromRoot === toRoot) throw new WikiContractIntegrityError("CYCLIC_REVIEWED_LINK_GRAPH");
    graphParent.set(fromRoot, toRoot);
  }
  return deepFreezeWikiValue(index);
}

function queryTokens(query: string) {
  const parts = query.split(" ").filter(Boolean);
  return uniqueSorted(parts.length > 1 ? [...parts, query] : parts);
}

function hasExactTerm(values: readonly string[], tokens: readonly string[]) {
  const normalizedValues = new Set(values.map(normalize));
  return tokens.some((token) => normalizedValues.has(token));
}

function linkIsCurrent(link: P1SeedIndex["links"][number], evaluatedAt: string) {
  const evaluated = Date.parse(evaluatedAt);
  return Date.parse(link.validFrom) <= evaluated
    && (!link.validUntil || evaluated <= Date.parse(link.validUntil));
}

function currentAllowlistEntryFromPage(page: P1SeedIndex["pages"][number]) {
  return {
    pageId: page.pageId,
    pageRevision: page.revision,
    sourceMaterialReceipt: page.sourceMaterialReceipt,
    compiledTruthHash: page.compiledTruthHash,
    rightsDecisionSetRevision: page.rightsDecisionSetRevision,
    withdrawalSnapshotRevision: page.withdrawalSnapshotRevision,
    acceptedReviewDecisionSetHash: page.acceptedReviewDecisionSetHash,
    indexAuthorizationCheckedAt: page.authorizationCheckedAt,
  };
}

function assertCurrentAllowlistAgainstIndex(
  snapshot: P1CurrentAllowlistSnapshot,
  index: P1SeedIndex,
  evaluatedAt: string,
  eligiblePageIds: readonly string[],
) {
  if (stableWikiJson(snapshot.indexRevision) !== stableWikiJson(index.indexRevision)) {
    throw new WikiContractIntegrityError("P1_CURRENT_ALLOWLIST_INDEX_MISMATCH");
  }
  assertCurrentAllowlistWindow(snapshot, evaluatedAt);
  if (Date.parse(snapshot.asOf) < Date.parse(index.buildReceipt.createdAt)) {
    throw new WikiContractIntegrityError("P1_CURRENT_ALLOWLIST_PREDATES_INDEX");
  }
  const eligible = uniqueSorted(eligiblePageIds);
  if (eligible.length === 0) throw new WikiContractIntegrityError("P1_QUERY_ELIGIBLE_PAGE_IDS_EMPTY");
  if (eligible.length !== eligiblePageIds.length) {
    throw new WikiContractIntegrityError("P1_QUERY_ELIGIBLE_PAGE_IDS_DUPLICATED");
  }
  const entries = new Map(snapshot.entries.map((entry) => [entry.pageId, entry]));
  if (eligible.some((pageId) => !entries.has(pageId))) {
    throw new WikiContractIntegrityError("P1_QUERY_ELIGIBLE_PAGE_IDS_NOT_ALLOWLIST_SUBSET");
  }
  const indexPages = new Map(index.pages.map((page) => [page.pageId, page]));
  for (const entry of snapshot.entries) {
    const page = indexPages.get(entry.pageId);
    if (!page || page.visibility !== "ELIGIBLE"
      || stableWikiJson(entry) !== stableWikiJson(currentAllowlistEntryFromPage(page))) {
      throw new WikiContractIntegrityError("P1_CURRENT_ALLOWLIST_ENTRY_MATERIAL_MISMATCH");
    }
    const source = index.sources.find((candidate) => (
      candidate.sourceMaterial.compiledTruth.pageId === entry.pageId
    ));
    if (!source) throw new WikiContractIntegrityError("P1_CURRENT_ALLOWLIST_SOURCE_MISSING");
    const currentAuthorization = deriveP1SourceAuthorization(source, evaluatedAt);
    if (stableWikiJson(currentAuthorization.material.pageRevision) !== stableWikiJson(entry.pageRevision)
      || stableWikiJson(currentAuthorization.material.materialReceipt)
        !== stableWikiJson(entry.sourceMaterialReceipt)
      || currentAuthorization.material.compiledTruthHash !== entry.compiledTruthHash
      || stableWikiJson(currentAuthorization.material.rightsDecisionSetRevision)
        !== stableWikiJson(entry.rightsDecisionSetRevision)
      || stableWikiJson(currentAuthorization.material.withdrawalSnapshotRevision)
        !== stableWikiJson(entry.withdrawalSnapshotRevision)
      || currentAuthorization.acceptedReviewDecisionSetHash !== entry.acceptedReviewDecisionSetHash) {
      throw new WikiContractIntegrityError("P1_CURRENT_ALLOWLIST_AUTHORIZATION_BINDING_MISMATCH");
    }
  }
}

export function runP1SeedQuery(rawContract: unknown, rawIndex: unknown): P1SeedQueryResponse {
  const contract = P1SeedQueryContractSchema.parse(rawContract);
  const index = parseImmutableP1SeedIndex(rawIndex);
  if (stableWikiJson(contract.expectedIndexRevision) !== stableWikiJson(index.indexRevision)) {
    throw new WikiContractIntegrityError("QUERY_INDEX_REVISION_MISMATCH");
  }
  const currentAllowlist = parseImmutableP1CurrentAllowlistSnapshot(contract.currentAllowlist);
  assertCurrentAllowlistAgainstIndex(
    currentAllowlist,
    index,
    contract.evaluatedAt,
    contract.eligiblePageIds,
  );
  const eligible = new Set(contract.eligiblePageIds);
  const pageTypes = new Set(contract.allowedPageTypes);
  const linkTypes = new Set(contract.graph.allowedLinkTypes);
  const pages = new Map(index.pages
    .filter((page) => eligible.has(page.pageId) && page.visibility === "ELIGIBLE" && pageTypes.has(page.pageType))
    .map((page) => [page.pageId, page]));
  const tokens = queryTokens(contract.normalizedQuery);
  const results = new Map<string, {
    pageId: string;
    revision: P1SeedIndex["pages"][number]["revision"];
    matchedBy: Array<"FTS" | "ALIAS" | "FACET" | "VISIBLE_GRAPH">;
    relationshipPaths: Array<{ fromPageId: string; toPageId: string; linkIds: string[] }>;
  }>();

  for (const page of pages.values()) {
    const matchedBy: Array<"FTS" | "ALIAS" | "FACET"> = [];
    if (hasExactTerm(page.ftsTerms, tokens)) matchedBy.push("FTS");
    if (hasExactTerm(page.aliases, tokens)) matchedBy.push("ALIAS");
    if (hasExactTerm(page.facets, tokens)) matchedBy.push("FACET");
    if (matchedBy.length > 0) {
      results.set(page.pageId, { pageId: page.pageId, revision: page.revision, matchedBy, relationshipPaths: [] });
    }
  }

  const frontier = [...results.keys()].map((pageId) => ({
    pageId,
    origin: pageId,
    linkIds: [] as string[],
    pageIds: [pageId],
  }));
  const visitedDepth = new Map(frontier.map(({ pageId }) => [pageId, 0]));
  for (let depth = 1; depth <= contract.graph.hopLimit; depth += 1) {
    const currentLevel = frontier.filter((item) => (visitedDepth.get(item.pageId) ?? 0) === depth - 1);
    for (const current of currentLevel) {
      for (const link of index.links) {
        if (!linkTypes.has(link.relationType)
          || link.audience !== contract.audience
          || !linkIsCurrent(link, contract.evaluatedAt)
          || !pages.has(link.fromPageId)
          || !pages.has(link.toPageId)) continue;
        const neighbor = link.fromPageId === current.pageId
          ? link.toPageId
          : link.toPageId === current.pageId ? link.fromPageId : null;
        if (!neighbor
          || !pages.has(neighbor)
          || current.pageIds.includes(neighbor)
          || current.linkIds.includes(link.linkId)) continue;
        const linkIds = [...current.linkIds, link.linkId];
        const pageIds = [...current.pageIds, neighbor];
        const page = pages.get(neighbor);
        if (!page) continue;
        const existing = results.get(neighbor) ?? {
          pageId: neighbor,
          revision: page.revision,
          matchedBy: [] as Array<"FTS" | "ALIAS" | "FACET" | "VISIBLE_GRAPH">,
          relationshipPaths: [],
        };
        if (!existing.matchedBy.includes("VISIBLE_GRAPH")) existing.matchedBy.push("VISIBLE_GRAPH");
        const path = { fromPageId: current.origin, toPageId: neighbor, linkIds };
        const pathKey = stableWikiJson(path);
        if (!existing.relationshipPaths.some((existingPath) => stableWikiJson(existingPath) === pathKey)) {
          existing.relationshipPaths.push(path);
        }
        results.set(neighbor, existing);
        if (!visitedDepth.has(neighbor)) {
          visitedDepth.set(neighbor, depth);
          frontier.push({ pageId: neighbor, origin: current.origin, linkIds, pageIds });
        }
      }
    }
  }

  const limited = [...results.values()]
    .sort((left, right) => {
      const leftSeed = left.matchedBy.some((mode) => mode !== "VISIBLE_GRAPH") ? 1 : 0;
      const rightSeed = right.matchedBy.some((mode) => mode !== "VISIBLE_GRAPH") ? 1 : 0;
      return rightSeed - leftSeed || left.pageId.localeCompare(right.pageId);
    })
    .slice(0, contract.resultLimit)
    .map((result) => ({
      ...result,
      matchedBy: uniqueSorted(result.matchedBy),
      relationshipPaths: result.relationshipPaths.slice(0, 8),
    }));
  return deepFreezeWikiValue(P1SeedQueryResponseSchema.parse({
    results: limited,
    vectorCalls: 0,
    noAnswer: limited.length === 0,
  }));
}
