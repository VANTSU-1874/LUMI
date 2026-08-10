import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DatabaseConnection } from "@/lib/db/client";

import {
  canonicalKnowledgeItem,
  knowledgeItemContentHash,
  knowledgePlacementForTopic,
  loadCoursePackKnowledgeItems,
  writeCoursePackKnowledge,
} from "./course-pack-store";
import {
  KNOWLEDGE_V2_BUNDLE_PATH,
  KNOWLEDGE_V2_REPORT_PATH,
  verifyKnowledgeCorpusAssetFilesV2,
  verifyKnowledgeV2ConversionReport,
  type KnowledgeV2ConversionReport,
} from "./knowledge-v2-corpus";
import { verifyKnowledgeIndexPayloadsV2 } from "./knowledge-index-v2";
import {
  stableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  verifyKnowledgeIndexBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeIndexBundleV2,
} from "./knowledge-object-v2";
import type { KnowledgeItem } from "./retrieve";

type CountRow = { count: number };

export type PreparedKnowledgeV2Ingestion = {
  legacyItems: KnowledgeItem[];
  bundle: KnowledgeCorpusBundleV2;
  report: KnowledgeV2ConversionReport;
};

export type KnowledgeV2StorageAudit = {
  corpusHash: string;
  documentCount: number;
  nodeCount: number;
  assetCount: number;
  documentAssetCount: number;
  relationCount: number;
  parentChildRelationCount: number;
  relatedRelationCount: number;
  annotationCount: number;
  annotationInputCount: number;
  explicitlyUnreferencedAssetCount: number;
  legacyChunkCount: number;
  activeCorpusCount: number;
  indexBundleCount: number;
  indexVersionCount: number;
  indexPayloadCount: number;
  indexEntryCount: number;
  activeIndexBundleCount: number;
  bySourceCoursePack: Record<string, number>;
  byLegacyCoursePack: Record<string, number>;
};

type CorpusWriteOptions = {
  now?: number;
  afterLegacyWrite?: () => void;
  beforeActivation?: () => void;
};

type IndexWriteOptions = {
  configsByVersionId: Readonly<Record<string, Record<string, unknown>>>;
  activate?: boolean;
  now?: number;
  /**
   * An explicitly isolated formal-V2 materialization may have no legacy
   * Markdown projection. Standard ingestion must retain the default parity
   * audit; callers may opt out only for that detached, local storage path.
   */
  requireLegacyProjection?: boolean;
  workspaceRoot?: string;
  /**
   * Allows an explicitly staged activation to verify only the provider
   * payloads required by the enabled runtime. Omit this field for the
   * historical all-provider gate. An empty or duplicate list is rejected.
   */
  activationRequiredProviderIndexHashes?: readonly string[];
};

function parseJson(text: string, code: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(code);
  }
}

function count(
  connection: DatabaseConnection,
  sql: string,
  ...parameters: unknown[]
) {
  return (connection.sqlite.prepare(sql).get(...parameters) as CountRow).count;
}

function assertRowsEqual(
  code: string,
  actual: readonly unknown[],
  expected: readonly unknown[],
) {
  if (stableJsonV2(actual) !== stableJsonV2(expected)) {
    throw new Error(code);
  }
}

function sortedCountRecord(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0),
  );
}

function assertLegacyParity(
  legacyItems: readonly KnowledgeItem[],
  bundle: KnowledgeCorpusBundleV2,
) {
  const legacyById = new Map(legacyItems.map((item) => [item.id, item]));
  const objectsById = new Map(bundle.objects.map((object) => [object.id, object]));
  if (
    legacyById.size !== legacyItems.length
    || objectsById.size !== bundle.objects.length
    || legacyById.size !== objectsById.size
  ) {
    throw new Error("KNOWLEDGE_V2_LEGACY_ID_SET_DRIFT");
  }
  for (const [id, item] of legacyById) {
    const object = objectsById.get(id);
    if (!object) throw new Error(`KNOWLEDGE_V2_LEGACY_ITEM_MISSING:${id}`);
    if (stableJsonV2(item) !== stableJsonV2(object.legacyItem)) {
      throw new Error(`KNOWLEDGE_V2_LEGACY_ITEM_DRIFT:${id}`);
    }
    const placement = knowledgePlacementForTopic(item.topic);
    if (
      placement.coursePackId !== object.legacyPlacement.coursePack.id
      || placement.coursePackVersion !== object.legacyPlacement.coursePack.version
      || placement.namespace !== object.legacyPlacement.namespace
    ) {
      throw new Error(`KNOWLEDGE_V2_LEGACY_PLACEMENT_DRIFT:${id}`);
    }
  }
}

export async function prepareKnowledgeV2Ingestion(
  workspaceRoot = process.cwd(),
): Promise<PreparedKnowledgeV2Ingestion> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const [legacyItems, bundleText, reportText] = await Promise.all([
    loadCoursePackKnowledgeItems(path.join(resolvedRoot, "data", "knowledge")),
    readFile(path.join(resolvedRoot, KNOWLEDGE_V2_BUNDLE_PATH), "utf8"),
    readFile(path.join(resolvedRoot, KNOWLEDGE_V2_REPORT_PATH), "utf8"),
  ]);
  const bundle = verifyKnowledgeCorpusBundleV2(
    parseJson(bundleText, "KNOWLEDGE_V2_BUNDLE_JSON_INVALID"),
  );
  const report = verifyKnowledgeV2ConversionReport(
    parseJson(reportText, "KNOWLEDGE_V2_REPORT_JSON_INVALID"),
    bundle,
  );
  assertLegacyParity(legacyItems, bundle);
  await verifyKnowledgeCorpusAssetFilesV2({
    workspaceRoot: resolvedRoot,
    bundle,
  });
  return { legacyItems, bundle, report };
}

function insertKnowledgeCorpusRows(
  connection: DatabaseConnection,
  bundle: KnowledgeCorpusBundleV2,
  now: number,
) {
  const corpusHash = bundle.bundleHash;
  connection.sqlite.prepare(`
    INSERT INTO knowledge_corpora_v2(
      bundle_hash, schema_version, corpus_version, parser_id, parser_version,
      content_version, object_count, asset_count, canonical_json, created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(bundle_hash) DO NOTHING
  `).run(
    corpusHash,
    bundle.schemaVersion,
    bundle.corpusVersion,
    bundle.parser.id,
    bundle.parser.version,
    bundle.contentVersion,
    bundle.objects.length,
    bundle.assets.length,
    stableJsonV2(bundle),
    now,
  );

  const insertDocument = connection.sqlite.prepare(`
    INSERT INTO knowledge_documents_v2(
      corpus_hash, id, title, topic, tags_json, source_course_pack_id,
      source_course_pack_version, source_identity_basis, legacy_course_pack_id,
      legacy_course_pack_version, legacy_namespace, provenance_json, parser_id,
      parser_version, content_version, root_node_id, content_hash,
      annotation_hash, legacy_item_json, canonical_json
    ) VALUES(
      @corpusHash, @id, @title, @topic, @tagsJson, @sourceCoursePackId,
      @sourceCoursePackVersion, @sourceIdentityBasis, @legacyCoursePackId,
      @legacyCoursePackVersion, @legacyNamespace, @provenanceJson, @parserId,
      @parserVersion, @contentVersion, @rootNodeId, @contentHash,
      @annotationHash, @legacyItemJson, @canonicalJson
    )
    ON CONFLICT(corpus_hash,id) DO NOTHING
  `);
  for (const object of bundle.objects) {
    insertDocument.run({
      corpusHash,
      id: object.id,
      title: object.title,
      topic: object.topic,
      tagsJson: stableJsonV2(object.tags),
      sourceCoursePackId: object.sourceCoursePack.id,
      sourceCoursePackVersion: object.sourceCoursePack.version,
      sourceIdentityBasis: object.sourceIdentityBasis,
      legacyCoursePackId: object.legacyPlacement.coursePack.id,
      legacyCoursePackVersion: object.legacyPlacement.coursePack.version,
      legacyNamespace: object.legacyPlacement.namespace,
      provenanceJson: stableJsonV2(object.provenance),
      parserId: object.parser.id,
      parserVersion: object.parser.version,
      contentVersion: object.contentVersion,
      rootNodeId: object.rootNodeId,
      contentHash: object.contentHash,
      annotationHash: object.annotationHash,
      legacyItemJson: stableJsonV2(object.legacyItem),
      canonicalJson: stableJsonV2(object),
    });
  }

  const explicitlyUnreferenced = new Set(bundle.unreferencedAssetIds);
  const insertAsset = connection.sqlite.prepare(`
    INSERT INTO knowledge_assets_v2(
      corpus_hash, id, kind, locator_root, locator_path, mime_type, size_bytes,
      width_px, height_px, sha256, explicitly_unreferenced, canonical_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(corpus_hash,id) DO NOTHING
  `);
  for (const asset of bundle.assets) {
    insertAsset.run(
      corpusHash,
      asset.id,
      asset.kind,
      asset.locator.root,
      asset.locator.path,
      asset.mimeType,
      asset.sizeBytes,
      asset.dimensions.widthPx,
      asset.dimensions.heightPx,
      asset.sha256,
      explicitlyUnreferenced.has(asset.id) ? 1 : 0,
      stableJsonV2(asset),
    );
  }

  const insertNode = connection.sqlite.prepare(`
    INSERT INTO knowledge_nodes_v2(
      corpus_hash, id, document_id, kind, asset_id, content_hash, canonical_json
    ) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(corpus_hash,id) DO NOTHING
  `);
  const insertDocumentAsset = connection.sqlite.prepare(`
    INSERT INTO knowledge_document_assets_v2(
      corpus_hash, document_id, asset_id, ordinal
    ) VALUES(?,?,?,?)
    ON CONFLICT(corpus_hash,document_id,asset_id) DO NOTHING
  `);
  const insertRelation = connection.sqlite.prepare(`
    INSERT INTO knowledge_node_relations_v2(
      corpus_hash, source_node_id, target_node_id, kind, ordinal
    ) VALUES(?,?,?,?,?)
    ON CONFLICT(corpus_hash,source_node_id,kind,target_node_id) DO NOTHING
  `);
  const insertAnnotation = connection.sqlite.prepare(`
    INSERT INTO knowledge_annotations_v2(
      corpus_hash, id, document_id, target_node_id, kind, origin, producer_id,
      producer_version, model_id, model_revision, annotation_hash, canonical_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(corpus_hash,id) DO NOTHING
  `);
  const insertAnnotationInput = connection.sqlite.prepare(`
    INSERT INTO knowledge_annotation_inputs_v2(
      corpus_hash, annotation_id, ordinal, kind, input_hash, asset_id, canonical_json
    ) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(corpus_hash,annotation_id,ordinal) DO NOTHING
  `);

  for (const object of bundle.objects) {
    for (const [ordinal, assetId] of object.assetIds.entries()) {
      insertDocumentAsset.run(corpusHash, object.id, assetId, ordinal);
    }
    for (const node of object.nodes) {
      const assetId = node.kind === "IMAGE" || node.kind === "REGION"
        ? node.assetId
        : null;
      insertNode.run(
        corpusHash,
        node.id,
        object.id,
        node.kind,
        assetId,
        node.contentHash,
        stableJsonV2(node),
      );
    }
    for (const node of object.nodes) {
      for (const [ordinal, childId] of node.childrenIds.entries()) {
        insertRelation.run(
          corpusHash,
          node.id,
          childId,
          "PARENT_CHILD",
          ordinal,
        );
      }
      for (const [ordinal, relatedId] of node.relatedIds.entries()) {
        insertRelation.run(corpusHash, node.id, relatedId, "RELATED", ordinal);
      }
    }
    for (const annotation of object.annotations) {
      insertAnnotation.run(
        corpusHash,
        annotation.id,
        object.id,
        annotation.targetNodeId,
        annotation.kind,
        annotation.origin,
        annotation.producer.id,
        annotation.producer.version,
        annotation.producer.modelId,
        annotation.producer.modelRevision,
        annotation.annotationHash,
        stableJsonV2(annotation),
      );
      for (const [ordinal, input] of annotation.inputs.entries()) {
        insertAnnotationInput.run(
          corpusHash,
          annotation.id,
          ordinal,
          input.kind,
          input.sha256,
          input.kind === "ASSET" ? input.assetId : null,
          stableJsonV2(input),
        );
      }
    }
  }
}

function expectedDocumentRows(bundle: KnowledgeCorpusBundleV2) {
  return bundle.objects.map((object) => ({
    id: object.id,
    title: object.title,
    topic: object.topic,
    tagsJson: stableJsonV2(object.tags),
    sourceCoursePackId: object.sourceCoursePack.id,
    sourceCoursePackVersion: object.sourceCoursePack.version,
    sourceIdentityBasis: object.sourceIdentityBasis,
    legacyCoursePackId: object.legacyPlacement.coursePack.id,
    legacyCoursePackVersion: object.legacyPlacement.coursePack.version,
    legacyNamespace: object.legacyPlacement.namespace,
    provenanceJson: stableJsonV2(object.provenance),
    parserId: object.parser.id,
    parserVersion: object.parser.version,
    contentVersion: object.contentVersion,
    rootNodeId: object.rootNodeId,
    contentHash: object.contentHash,
    annotationHash: object.annotationHash,
    legacyItemJson: stableJsonV2(object.legacyItem),
    canonicalJson: stableJsonV2(object),
  })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function expectedNodeRows(bundle: KnowledgeCorpusBundleV2) {
  return bundle.objects.flatMap((object) =>
    object.nodes.map((node) => ({
      id: node.id,
      documentId: object.id,
      kind: node.kind,
      assetId: node.kind === "IMAGE" || node.kind === "REGION"
        ? node.assetId
        : null,
      contentHash: node.contentHash,
      canonicalJson: stableJsonV2(node),
    }))).sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function expectedAssetRows(bundle: KnowledgeCorpusBundleV2) {
  const explicitlyUnreferenced = new Set(bundle.unreferencedAssetIds);
  return bundle.assets.map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    locatorRoot: asset.locator.root,
    locatorPath: asset.locator.path,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    widthPx: asset.dimensions.widthPx,
    heightPx: asset.dimensions.heightPx,
    sha256: asset.sha256,
    explicitlyUnreferenced: explicitlyUnreferenced.has(asset.id) ? 1 : 0,
    canonicalJson: stableJsonV2(asset),
  })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function expectedDocumentAssetRows(bundle: KnowledgeCorpusBundleV2) {
  return bundle.objects.flatMap((object) =>
    object.assetIds.map((assetId, ordinal) => ({
      documentId: object.id,
      assetId,
      ordinal,
    }))).sort((left, right) =>
      left.documentId < right.documentId
        ? -1
        : left.documentId > right.documentId
          ? 1
          : left.ordinal - right.ordinal);
}

function expectedRelationRows(bundle: KnowledgeCorpusBundleV2) {
  return bundle.objects.flatMap((object) =>
    object.nodes.flatMap((node) => [
      ...node.childrenIds.map((targetNodeId, ordinal) => ({
        sourceNodeId: node.id,
        targetNodeId,
        kind: "PARENT_CHILD",
        ordinal,
      })),
      ...node.relatedIds.map((targetNodeId, ordinal) => ({
        sourceNodeId: node.id,
        targetNodeId,
        kind: "RELATED",
        ordinal,
      })),
    ])).sort((left, right) => {
      const leftKey = `${left.sourceNodeId}:${left.kind}:${String(left.ordinal).padStart(8, "0")}`;
      const rightKey = `${right.sourceNodeId}:${right.kind}:${String(right.ordinal).padStart(8, "0")}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

function expectedAnnotationRows(bundle: KnowledgeCorpusBundleV2) {
  return bundle.objects.flatMap((object) =>
    object.annotations.map((annotation) => ({
      id: annotation.id,
      documentId: object.id,
      targetNodeId: annotation.targetNodeId,
      kind: annotation.kind,
      origin: annotation.origin,
      producerId: annotation.producer.id,
      producerVersion: annotation.producer.version,
      modelId: annotation.producer.modelId,
      modelRevision: annotation.producer.modelRevision,
      annotationHash: annotation.annotationHash,
      canonicalJson: stableJsonV2(annotation),
    }))).sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function expectedAnnotationInputRows(bundle: KnowledgeCorpusBundleV2) {
  return bundle.objects.flatMap((object) =>
    object.annotations.flatMap((annotation) =>
      annotation.inputs.map((input, ordinal) => ({
        annotationId: annotation.id,
        ordinal,
        kind: input.kind,
        inputHash: input.sha256,
        assetId: input.kind === "ASSET" ? input.assetId : null,
        canonicalJson: stableJsonV2(input),
      })))).sort((left, right) =>
    left.annotationId < right.annotationId
      ? -1
      : left.annotationId > right.annotationId
        ? 1
        : left.ordinal - right.ordinal);
}

function expectedLegacyRows(bundle: KnowledgeCorpusBundleV2) {
  return bundle.objects.map((object) => {
    const item = object.legacyItem;
    return {
      id: item.id,
      source: stableJsonV2(item.source),
      title: item.title,
      tags: JSON.stringify(item.tags),
      content: canonicalKnowledgeItem(item),
      coursePackId: object.legacyPlacement.coursePack.id,
      coursePackVersion: object.legacyPlacement.coursePack.version,
      namespace: object.legacyPlacement.namespace,
      authority: item.source.authority,
      contentHash: knowledgeItemContentHash(item),
      verifiedDate: item.source.verifiedDate,
    };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function assertStorageGraphIntegrity(
  connection: DatabaseConnection,
  corpusHash: string,
) {
  const violations = connection.sqlite.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    throw new Error(`KNOWLEDGE_V2_STORAGE_FOREIGN_KEY:${stableJsonV2(violations)}`);
  }
  const checks: Array<[string, string]> = [
    [
      "ROOT",
      `SELECT count(*) count
       FROM knowledge_documents_v2 d
       LEFT JOIN knowledge_nodes_v2 n
         ON n.corpus_hash=d.corpus_hash AND n.id=d.root_node_id
       WHERE d.corpus_hash=?
         AND (n.id IS NULL OR n.document_id<>d.id OR n.kind<>'DOCUMENT')`,
    ],
    [
      "PARENT_CARDINALITY",
      `SELECT count(*) count FROM (
         SELECT n.id
         FROM knowledge_nodes_v2 n
         JOIN knowledge_documents_v2 d
           ON d.corpus_hash=n.corpus_hash AND d.id=n.document_id
         LEFT JOIN knowledge_node_relations_v2 r
           ON r.corpus_hash=n.corpus_hash
          AND r.target_node_id=n.id
          AND r.kind='PARENT_CHILD'
         WHERE n.corpus_hash=?
         GROUP BY n.corpus_hash,n.id,d.root_node_id
         HAVING (n.id=d.root_node_id AND count(r.target_node_id)<>0)
             OR (n.id<>d.root_node_id AND count(r.target_node_id)<>1)
       )`,
    ],
    [
      "RELATION_DOCUMENT",
      `SELECT count(*) count
       FROM knowledge_node_relations_v2 r
       JOIN knowledge_nodes_v2 source
         ON source.corpus_hash=r.corpus_hash AND source.id=r.source_node_id
       JOIN knowledge_nodes_v2 target
         ON target.corpus_hash=r.corpus_hash AND target.id=r.target_node_id
       WHERE r.corpus_hash=? AND source.document_id<>target.document_id`,
    ],
    [
      "RELATED_SYMMETRY",
      `SELECT count(*) count
       FROM knowledge_node_relations_v2 r
       LEFT JOIN knowledge_node_relations_v2 reverse
         ON reverse.corpus_hash=r.corpus_hash
        AND reverse.source_node_id=r.target_node_id
        AND reverse.target_node_id=r.source_node_id
        AND reverse.kind='RELATED'
       WHERE r.corpus_hash=? AND r.kind='RELATED' AND reverse.source_node_id IS NULL`,
    ],
    [
      "ASSET_REFERENCE",
      `SELECT count(*) count FROM (
         SELECT a.id,a.explicitly_unreferenced,count(da.asset_id) references_count
         FROM knowledge_assets_v2 a
         LEFT JOIN knowledge_document_assets_v2 da
           ON da.corpus_hash=a.corpus_hash AND da.asset_id=a.id
         WHERE a.corpus_hash=?
         GROUP BY a.corpus_hash,a.id,a.explicitly_unreferenced
         HAVING (a.explicitly_unreferenced=1 AND count(da.asset_id)<>0)
             OR (a.explicitly_unreferenced=0 AND count(da.asset_id)=0)
       )`,
    ],
    [
      "ANNOTATION_DOCUMENT",
      `SELECT count(*) count
       FROM knowledge_annotations_v2 a
       JOIN knowledge_nodes_v2 n
         ON n.corpus_hash=a.corpus_hash AND n.id=a.target_node_id
       WHERE a.corpus_hash=? AND a.document_id<>n.document_id`,
    ],
    [
      "UNREACHABLE_NODE",
      `WITH RECURSIVE reachable(corpus_hash,document_id,node_id) AS (
         SELECT d.corpus_hash,d.id,d.root_node_id
         FROM knowledge_documents_v2 d
         WHERE d.corpus_hash=?
         UNION
         SELECT r.corpus_hash,reachable.document_id,r.target_node_id
         FROM reachable
         JOIN knowledge_node_relations_v2 r
           ON r.corpus_hash=reachable.corpus_hash
          AND r.source_node_id=reachable.node_id
          AND r.kind='PARENT_CHILD'
       )
       SELECT count(*) count
       FROM knowledge_nodes_v2 n
       LEFT JOIN reachable
         ON reachable.corpus_hash=n.corpus_hash
        AND reachable.document_id=n.document_id
        AND reachable.node_id=n.id
       WHERE n.corpus_hash=? AND reachable.node_id IS NULL`,
    ],
  ];
  for (const [name, sql] of checks) {
    const parameters = name === "UNREACHABLE_NODE"
      ? [corpusHash, corpusHash]
      : [corpusHash];
    const found = count(connection, sql, ...parameters);
    if (found !== 0) {
      throw new Error(`KNOWLEDGE_V2_STORAGE_${name}:${found}`);
    }
  }
}

function assertGlobalActivationIntegrity(connection: DatabaseConnection) {
  const activeCorpora = connection.sqlite.prepare(
    "SELECT bundle_hash bundleHash FROM knowledge_active_corpus_v2",
  ).all() as Array<{ bundleHash: string }>;
  const activeIndexes = connection.sqlite.prepare(
    "SELECT corpus_hash corpusHash FROM knowledge_active_index_bundle_v2",
  ).all() as Array<{ corpusHash: string }>;
  if (
    activeCorpora.length > 1
    || activeIndexes.length > 1
    || (
      activeIndexes.length === 1
      && (
        activeCorpora.length !== 1
        || activeIndexes[0]!.corpusHash !== activeCorpora[0]!.bundleHash
      )
    )
  ) {
    throw new Error("KNOWLEDGE_V2_ACTIVE_INDEX_CORPUS_MISMATCH");
  }
}

export function auditKnowledgeV2Storage(
  connection: DatabaseConnection,
  bundleInput: unknown,
  options: { requireActive?: boolean; requireLegacyProjection?: boolean } = {},
): KnowledgeV2StorageAudit {
  const bundle = verifyKnowledgeCorpusBundleV2(bundleInput);
  const corpusHash = bundle.bundleHash;
  const corpusRows = connection.sqlite.prepare(`
    SELECT bundle_hash bundleHash, schema_version schemaVersion,
      corpus_version corpusVersion, parser_id parserId,
      parser_version parserVersion, content_version contentVersion,
      object_count objectCount, asset_count assetCount,
      canonical_json canonicalJson
    FROM knowledge_corpora_v2 WHERE bundle_hash=?
  `).all(corpusHash);
  assertRowsEqual("KNOWLEDGE_V2_STORAGE_CORPUS_DRIFT", corpusRows, [{
    bundleHash: corpusHash,
    schemaVersion: bundle.schemaVersion,
    corpusVersion: bundle.corpusVersion,
    parserId: bundle.parser.id,
    parserVersion: bundle.parser.version,
    contentVersion: bundle.contentVersion,
    objectCount: bundle.objects.length,
    assetCount: bundle.assets.length,
    canonicalJson: stableJsonV2(bundle),
  }]);

  const documentRows = connection.sqlite.prepare(`
    SELECT id,title,topic,tags_json tagsJson,
      source_course_pack_id sourceCoursePackId,
      source_course_pack_version sourceCoursePackVersion,
      source_identity_basis sourceIdentityBasis,
      legacy_course_pack_id legacyCoursePackId,
      legacy_course_pack_version legacyCoursePackVersion,
      legacy_namespace legacyNamespace,provenance_json provenanceJson,
      parser_id parserId,parser_version parserVersion,
      content_version contentVersion,root_node_id rootNodeId,
      content_hash contentHash,annotation_hash annotationHash,
      legacy_item_json legacyItemJson,canonical_json canonicalJson
    FROM knowledge_documents_v2 WHERE corpus_hash=? ORDER BY id
  `).all(corpusHash);
  assertRowsEqual(
    "KNOWLEDGE_V2_STORAGE_DOCUMENT_DRIFT",
    documentRows,
    expectedDocumentRows(bundle),
  );

  const nodeRows = connection.sqlite.prepare(`
    SELECT id,document_id documentId,kind,asset_id assetId,
      content_hash contentHash,canonical_json canonicalJson
    FROM knowledge_nodes_v2 WHERE corpus_hash=? ORDER BY id
  `).all(corpusHash);
  assertRowsEqual(
    "KNOWLEDGE_V2_STORAGE_NODE_DRIFT",
    nodeRows,
    expectedNodeRows(bundle),
  );

  const assetRows = connection.sqlite.prepare(`
    SELECT id,kind,locator_root locatorRoot,locator_path locatorPath,
      mime_type mimeType,size_bytes sizeBytes,width_px widthPx,height_px heightPx,
      sha256,explicitly_unreferenced explicitlyUnreferenced,
      canonical_json canonicalJson
    FROM knowledge_assets_v2 WHERE corpus_hash=? ORDER BY id
  `).all(corpusHash);
  assertRowsEqual(
    "KNOWLEDGE_V2_STORAGE_ASSET_DRIFT",
    assetRows,
    expectedAssetRows(bundle),
  );

  const documentAssetRows = connection.sqlite.prepare(`
    SELECT document_id documentId,asset_id assetId,ordinal
    FROM knowledge_document_assets_v2
    WHERE corpus_hash=? ORDER BY document_id,ordinal
  `).all(corpusHash);
  assertRowsEqual(
    "KNOWLEDGE_V2_STORAGE_DOCUMENT_ASSET_DRIFT",
    documentAssetRows,
    expectedDocumentAssetRows(bundle),
  );

  const relationRows = connection.sqlite.prepare(`
    SELECT source_node_id sourceNodeId,target_node_id targetNodeId,kind,ordinal
    FROM knowledge_node_relations_v2
    WHERE corpus_hash=? ORDER BY source_node_id,kind,ordinal
  `).all(corpusHash);
  assertRowsEqual(
    "KNOWLEDGE_V2_STORAGE_RELATION_DRIFT",
    relationRows,
    expectedRelationRows(bundle),
  );

  const annotationRows = connection.sqlite.prepare(`
    SELECT id,document_id documentId,target_node_id targetNodeId,kind,origin,
      producer_id producerId,producer_version producerVersion,model_id modelId,
      model_revision modelRevision,annotation_hash annotationHash,
      canonical_json canonicalJson
    FROM knowledge_annotations_v2 WHERE corpus_hash=? ORDER BY id
  `).all(corpusHash);
  assertRowsEqual(
    "KNOWLEDGE_V2_STORAGE_ANNOTATION_DRIFT",
    annotationRows,
    expectedAnnotationRows(bundle),
  );

  const annotationInputRows = connection.sqlite.prepare(`
    SELECT annotation_id annotationId,ordinal,kind,input_hash inputHash,
      asset_id assetId,canonical_json canonicalJson
    FROM knowledge_annotation_inputs_v2
    WHERE corpus_hash=? ORDER BY annotation_id,ordinal
  `).all(corpusHash);
  assertRowsEqual(
    "KNOWLEDGE_V2_STORAGE_ANNOTATION_INPUT_DRIFT",
    annotationInputRows,
    expectedAnnotationInputRows(bundle),
  );

  const legacyRows = connection.sqlite.prepare(`
    SELECT k.id,k.source,k.title,k.tags,k.content,
      k.course_pack_id coursePackId,k.course_pack_version coursePackVersion,
      k.namespace,k.authority,k.content_hash contentHash,
      k.verified_date verifiedDate
    FROM knowledge_documents_v2 d
    JOIN knowledge_chunks k ON k.id=d.id
    WHERE d.corpus_hash=? ORDER BY k.id
  `).all(corpusHash);
  if (options.requireLegacyProjection !== false) {
    assertRowsEqual(
      "KNOWLEDGE_V2_STORAGE_LEGACY_DRIFT",
      legacyRows,
      expectedLegacyRows(bundle),
    );
  }

  assertGlobalActivationIntegrity(connection);
  assertStorageGraphIntegrity(connection, corpusHash);
  const activeCorpusCount = count(
    connection,
    "SELECT count(*) count FROM knowledge_active_corpus_v2 WHERE bundle_hash=?",
    corpusHash,
  );
  if (options.requireActive && activeCorpusCount !== 1) {
    throw new Error(`KNOWLEDGE_V2_STORAGE_ACTIVE_CORPUS:${activeCorpusCount}`);
  }
  const relationCount = relationRows.length;
  const parentChildRelationCount = relationRows.filter((row) =>
    (row as { kind: string }).kind === "PARENT_CHILD").length;
  const relatedRelationCount = relationCount - parentChildRelationCount;
  return {
    corpusHash,
    documentCount: documentRows.length,
    nodeCount: nodeRows.length,
    assetCount: assetRows.length,
    documentAssetCount: documentAssetRows.length,
    relationCount,
    parentChildRelationCount,
    relatedRelationCount,
    annotationCount: annotationRows.length,
    annotationInputCount: annotationInputRows.length,
    explicitlyUnreferencedAssetCount: assetRows.filter((row) =>
      (row as { explicitlyUnreferenced: number }).explicitlyUnreferenced === 1).length,
    legacyChunkCount: legacyRows.length,
    activeCorpusCount,
    indexBundleCount: count(
      connection,
      "SELECT count(*) count FROM knowledge_index_bundles_v2 WHERE corpus_hash=?",
      corpusHash,
    ),
    indexVersionCount: count(
      connection,
      `SELECT count(*) count
       FROM knowledge_index_versions_v2 v
       JOIN knowledge_index_bundles_v2 b
         ON b.index_bundle_hash=v.index_bundle_hash
       WHERE b.corpus_hash=?`,
      corpusHash,
    ),
    indexPayloadCount: count(
      connection,
      `SELECT count(*) count
       FROM knowledge_index_payloads_v2 p
       JOIN knowledge_index_bundles_v2 b
         ON b.index_bundle_hash=p.index_bundle_hash
       WHERE b.corpus_hash=?`,
      corpusHash,
    ),
    indexEntryCount: count(
      connection,
      `SELECT count(*) count
       FROM knowledge_index_entries_v2 e
       JOIN knowledge_index_bundles_v2 b
         ON b.index_bundle_hash=e.index_bundle_hash
       WHERE b.corpus_hash=?`,
      corpusHash,
    ),
    activeIndexBundleCount: count(
      connection,
      "SELECT count(*) count FROM knowledge_active_index_bundle_v2 WHERE corpus_hash=?",
      corpusHash,
    ),
    bySourceCoursePack: sortedCountRecord(
      bundle.objects.map((object) => object.sourceCoursePack.id),
    ),
    byLegacyCoursePack: sortedCountRecord(
      bundle.objects.map((object) => object.legacyPlacement.coursePack.id),
    ),
  };
}

function activateKnowledgeCorpus(
  connection: DatabaseConnection,
  corpusHash: string,
  now: number,
) {
  connection.sqlite.prepare(
    "DELETE FROM knowledge_active_index_bundle_v2 WHERE corpus_hash<>?",
  ).run(corpusHash);
  connection.sqlite.prepare(`
    INSERT INTO knowledge_active_corpus_v2(id,bundle_hash,activated_at)
    VALUES(1,?,?)
    ON CONFLICT(id) DO UPDATE SET
      bundle_hash=excluded.bundle_hash,
      activated_at=excluded.activated_at
    WHERE knowledge_active_corpus_v2.bundle_hash<>excluded.bundle_hash
  `).run(corpusHash, now);
}

export function ingestPreparedKnowledgeV2(
  connection: DatabaseConnection,
  prepared: PreparedKnowledgeV2Ingestion,
  options: CorpusWriteOptions = {},
) {
  const bundle = verifyKnowledgeCorpusBundleV2(prepared.bundle);
  verifyKnowledgeV2ConversionReport(prepared.report, bundle);
  assertLegacyParity(prepared.legacyItems, bundle);
  const now = options.now ?? Date.now();
  return connection.sqlite.transaction(() => {
    const legacy = writeCoursePackKnowledge(connection, prepared.legacyItems);
    options.afterLegacyWrite?.();
    insertKnowledgeCorpusRows(connection, bundle, now);
    const beforeActivation = auditKnowledgeV2Storage(connection, bundle);
    options.beforeActivation?.();
    activateKnowledgeCorpus(connection, bundle.bundleHash, now);
    const v2 = auditKnowledgeV2Storage(connection, bundle, {
      requireActive: true,
    });
    return { ...legacy, v2: { ...v2, preActivation: beforeActivation } };
  }).immediate();
}

/**
 * Stores an already verified formal corpus without the legacy-course dual write.
 * This is for isolated, explicitly scoped V2 generations whose source is not a
 * course-pack Markdown conversion. It deliberately shares the same storage
 * audit and active-pointer transaction as the standard ingestion path.
 */
export function ingestVerifiedKnowledgeCorpusBundleV2(
  connection: DatabaseConnection,
  corpusInput: unknown,
  options: Pick<CorpusWriteOptions, "now" | "beforeActivation"> = {},
) {
  const bundle = verifyKnowledgeCorpusBundleV2(corpusInput);
  const now = options.now ?? Date.now();
  return connection.sqlite.transaction(() => {
    insertKnowledgeCorpusRows(connection, bundle, now);
    const beforeActivation = auditKnowledgeV2Storage(connection, bundle, {
      requireLegacyProjection: false,
    });
    options.beforeActivation?.();
    activateKnowledgeCorpus(connection, bundle.bundleHash, now);
    const v2 = auditKnowledgeV2Storage(connection, bundle, {
      requireActive: true,
      requireLegacyProjection: false,
    });
    return { v2: { ...v2, preActivation: beforeActivation } };
  }).immediate();
}

export function deactivateKnowledgeV2Storage(connection: DatabaseConnection) {
  return connection.sqlite.transaction(() => {
    const activeIndexes = connection.sqlite.prepare(
      "DELETE FROM knowledge_active_index_bundle_v2",
    ).run().changes;
    const activeCorpora = connection.sqlite.prepare(
      "DELETE FROM knowledge_active_corpus_v2",
    ).run().changes;
    return {
      activeCorpora,
      activeIndexes,
      legacyChunkCount: count(
        connection,
        "SELECT count(*) count FROM knowledge_chunks",
      ),
    };
  }).immediate();
}

function assertIndexTargetRows(
  connection: DatabaseConnection,
  corpusHash: string,
  indexBundle: KnowledgeIndexBundleV2,
) {
  for (const representation of indexBundle.representations) {
    const table = representation.target.kind === "OBJECT"
      ? "knowledge_documents_v2"
      : representation.target.kind === "NODE"
        ? "knowledge_nodes_v2"
        : representation.target.kind === "ASSET"
          ? "knowledge_assets_v2"
          : "knowledge_annotations_v2";
    const found = count(
      connection,
      `SELECT count(*) count FROM ${table} WHERE corpus_hash=? AND id=?`,
      corpusHash,
      representation.target.id,
    );
    if (found !== 1) {
      throw new Error(
        `KNOWLEDGE_V2_INDEX_TARGET_MISSING:${representation.id}`,
      );
    }
  }
}

export async function storeKnowledgeIndexBundleV2(
  connection: DatabaseConnection,
  corpusInput: unknown,
  indexInput: unknown,
  options: IndexWriteOptions,
) {
  const corpus = verifyKnowledgeCorpusBundleV2(corpusInput);
  if (options.activate && !options.workspaceRoot) {
    throw new Error("KNOWLEDGE_V2_INDEX_WORKSPACE_ROOT_REQUIRED");
  }
  const activationProviderHashes =
    options.activationRequiredProviderIndexHashes;
  if (
    activationProviderHashes !== undefined
    && (
      activationProviderHashes.length === 0
      || new Set(activationProviderHashes).size
        !== activationProviderHashes.length
      || activationProviderHashes.some(
        (hash) => !/^[a-f0-9]{64}$/.test(hash),
      )
    )
  ) {
    throw new Error(
      "KNOWLEDGE_V2_ACTIVATION_PROVIDER_SET_INVALID",
    );
  }
  const indexBundle = options.activate
    ? await verifyKnowledgeIndexPayloadsV2({
      workspaceRoot: options.workspaceRoot!,
      indexBundle: indexInput,
      corpusBundle: corpus,
      ...(activationProviderHashes === undefined
        ? {}
        : {
            providerIndexHashes:
              activationProviderHashes,
          }),
    })
    : verifyKnowledgeIndexBundleV2(indexInput, corpus);
  const now = options.now ?? Date.now();
  const versions = new Map(
    indexBundle.representations.map((representation) => [
      representation.indexVersion.id,
      representation.indexVersion,
    ]),
  );
  for (const [versionId, version] of versions) {
    const config = options.configsByVersionId[versionId];
    if (!config || stableJsonV2(config) === undefined) {
      throw new Error(`KNOWLEDGE_V2_INDEX_CONFIG_MISSING:${versionId}`);
    }
    const configHash = createHash("sha256")
      .update(stableJsonV2(config))
      .digest("hex");
    if (configHash !== version.configHash) {
      throw new Error(`KNOWLEDGE_V2_INDEX_CONFIG_HASH_DRIFT:${versionId}`);
    }
  }
  return connection.sqlite.transaction(() => {
    auditKnowledgeV2Storage(connection, corpus, {
      requireActive: true,
      requireLegacyProjection: options.requireLegacyProjection,
    });
    assertIndexTargetRows(connection, corpus.bundleHash, indexBundle);
    connection.sqlite.prepare(`
      INSERT INTO knowledge_index_bundles_v2(
        index_bundle_hash,corpus_hash,representation_count,shared_payload_count,
        canonical_json,created_at
      ) VALUES(?,?,?,?,?,?)
      ON CONFLICT(index_bundle_hash) DO NOTHING
    `).run(
      indexBundle.indexBundleHash,
      corpus.bundleHash,
      indexBundle.representations.length,
      indexBundle.sharedPayloads?.length ?? 0,
      stableJsonV2(indexBundle),
      now,
    );
    const insertVersion = connection.sqlite.prepare(`
      INSERT INTO knowledge_index_versions_v2(
        index_bundle_hash,id,builder_id,builder_version,model_id,model_revision,
        config_json,config_hash
      ) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(index_bundle_hash,id) DO NOTHING
    `);
    for (const [versionId, version] of versions) {
      insertVersion.run(
        indexBundle.indexBundleHash,
        versionId,
        version.builderId,
        version.builderVersion,
        version.modelId,
        version.modelRevision,
        stableJsonV2(options.configsByVersionId[versionId]),
        version.configHash,
      );
    }
    const insertPayload = connection.sqlite.prepare(`
      INSERT INTO knowledge_index_payloads_v2(
        index_bundle_hash,id,role,format,provider_index_hash,storage_kind,
        storage_key,byte_length,payload_sha256,tensor_layout_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(index_bundle_hash,id) DO NOTHING
    `);
    for (const payload of indexBundle.sharedPayloads ?? []) {
      insertPayload.run(
        indexBundle.indexBundleHash,
        payload.id,
        payload.role,
        payload.format,
        payload.role === "PROVIDER_MANIFEST"
          ? payload.providerIndexHash
          : null,
        payload.storageKind,
        payload.storageKey,
        payload.byteLength,
        payload.sha256,
        payload.role === "VECTOR_TENSORS"
          ? stableJsonV2(payload.tensors)
          : null,
      );
    }
    const insertEntry = connection.sqlite.prepare(`
      INSERT INTO knowledge_index_entries_v2(
        index_bundle_hash,id,index_version_id,channel,target_kind,target_id,
        representation_json,dimensions,vector_count,storage_kind,storage_key,
        byte_length,payload_sha256,manifest_payload_id,tensor_payload_id,
        locator_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(index_bundle_hash,id) DO NOTHING
    `);
    for (const representation of indexBundle.representations) {
      insertEntry.run(
        indexBundle.indexBundleHash,
        representation.id,
        representation.indexVersion.id,
        representation.channel,
        representation.target.kind,
        representation.target.id,
        stableJsonV2(representation),
        representation.dimensions,
        representation.vectorCount,
        representation.payload?.storageKind ?? null,
        representation.payload?.storageKey ?? null,
        representation.payload?.byteLength ?? null,
        representation.payload?.sha256 ?? null,
        representation.locator?.manifestPayloadId ?? null,
        representation.locator?.tensorPayloadId ?? null,
        representation.locator === undefined
          ? null
          : stableJsonV2(representation.locator),
      );
    }
    const storedBundle = connection.sqlite.prepare(`
      SELECT corpus_hash corpusHash,representation_count representationCount,
        shared_payload_count sharedPayloadCount,canonical_json canonicalJson
      FROM knowledge_index_bundles_v2 WHERE index_bundle_hash=?
    `).all(indexBundle.indexBundleHash);
    assertRowsEqual("KNOWLEDGE_V2_INDEX_BUNDLE_STORAGE_DRIFT", storedBundle, [{
      corpusHash: corpus.bundleHash,
      representationCount: indexBundle.representations.length,
      sharedPayloadCount: indexBundle.sharedPayloads?.length ?? 0,
      canonicalJson: stableJsonV2(indexBundle),
    }]);
    const storedVersions = connection.sqlite.prepare(`
      SELECT id,builder_id builderId,builder_version builderVersion,
        model_id modelId,model_revision modelRevision,config_json configJson,
        config_hash configHash
      FROM knowledge_index_versions_v2
      WHERE index_bundle_hash=? ORDER BY id
    `).all(indexBundle.indexBundleHash);
    const expectedVersions = [...versions.entries()].map(([id, version]) => ({
      id,
      builderId: version.builderId,
      builderVersion: version.builderVersion,
      modelId: version.modelId,
      modelRevision: version.modelRevision,
      configJson: stableJsonV2(options.configsByVersionId[id]),
      configHash: version.configHash,
    })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    assertRowsEqual(
      "KNOWLEDGE_V2_INDEX_VERSION_STORAGE_DRIFT",
      storedVersions,
      expectedVersions,
    );
    const storedPayloads = connection.sqlite.prepare(`
      SELECT id,role,format,provider_index_hash providerIndexHash,
        storage_kind storageKind,storage_key storageKey,byte_length byteLength,
        payload_sha256 payloadSha256,
        tensor_layout_json tensorLayoutJson
      FROM knowledge_index_payloads_v2
      WHERE index_bundle_hash=? ORDER BY id
    `).all(indexBundle.indexBundleHash);
    const expectedPayloads = (indexBundle.sharedPayloads ?? []).map((payload) => ({
      id: payload.id,
      role: payload.role,
      format: payload.format,
      providerIndexHash: payload.role === "PROVIDER_MANIFEST"
        ? payload.providerIndexHash
        : null,
      storageKind: payload.storageKind,
      storageKey: payload.storageKey,
      byteLength: payload.byteLength,
      payloadSha256: payload.sha256,
      tensorLayoutJson: payload.role === "VECTOR_TENSORS"
        ? stableJsonV2(payload.tensors)
        : null,
    })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    assertRowsEqual(
      "KNOWLEDGE_V2_INDEX_PAYLOAD_STORAGE_DRIFT",
      storedPayloads,
      expectedPayloads,
    );
    const storedEntries = connection.sqlite.prepare(`
      SELECT id,index_version_id indexVersionId,channel,target_kind targetKind,
        target_id targetId,representation_json representationJson,
        dimensions,vector_count vectorCount,storage_kind storageKind,
        storage_key storageKey,byte_length byteLength,payload_sha256 payloadSha256,
        manifest_payload_id manifestPayloadId,tensor_payload_id tensorPayloadId,
        locator_json locatorJson
      FROM knowledge_index_entries_v2
      WHERE index_bundle_hash=? ORDER BY id
    `).all(indexBundle.indexBundleHash);
    const expectedEntries = indexBundle.representations.map((representation) => ({
      id: representation.id,
      indexVersionId: representation.indexVersion.id,
      channel: representation.channel,
      targetKind: representation.target.kind,
      targetId: representation.target.id,
      representationJson: stableJsonV2(representation),
      dimensions: representation.dimensions,
      vectorCount: representation.vectorCount,
      storageKind: representation.payload?.storageKind ?? null,
      storageKey: representation.payload?.storageKey ?? null,
      byteLength: representation.payload?.byteLength ?? null,
      payloadSha256: representation.payload?.sha256 ?? null,
      manifestPayloadId: representation.locator?.manifestPayloadId ?? null,
      tensorPayloadId: representation.locator?.tensorPayloadId ?? null,
      locatorJson: representation.locator === undefined
        ? null
        : stableJsonV2(representation.locator),
    })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    assertRowsEqual(
      "KNOWLEDGE_V2_INDEX_ENTRY_STORAGE_DRIFT",
      storedEntries,
      expectedEntries,
    );
    if (options.activate) {
      connection.sqlite.prepare(`
        INSERT INTO knowledge_active_index_bundle_v2(
          id,corpus_hash,index_bundle_hash,activated_at
        ) VALUES(1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          corpus_hash=excluded.corpus_hash,
          index_bundle_hash=excluded.index_bundle_hash,
          activated_at=excluded.activated_at
        WHERE knowledge_active_index_bundle_v2.index_bundle_hash
          <>excluded.index_bundle_hash
      `).run(corpus.bundleHash, indexBundle.indexBundleHash, now);
    }
    return {
      indexBundleHash: indexBundle.indexBundleHash,
      representationCount: storedEntries.length,
      versionCount: storedVersions.length,
      ...(indexBundle.sharedPayloads === undefined
        ? {}
        : {
            sharedPayloadCount: storedPayloads.length,
            providerIndexHashes: indexBundle.sharedPayloads.flatMap((payload) =>
              payload.role === "PROVIDER_MANIFEST"
                ? [payload.providerIndexHash]
                : []),
          }),
      active: count(
        connection,
        "SELECT count(*) count FROM knowledge_active_index_bundle_v2 WHERE index_bundle_hash=?",
        indexBundle.indexBundleHash,
      ) === 1,
    };
  }).immediate();
}
