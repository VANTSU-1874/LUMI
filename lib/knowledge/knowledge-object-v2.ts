import { createHash } from "node:crypto";
import { z } from "zod";

import {
  KnowledgeAuthoritySchema,
  KnowledgeItemSchema,
  KnowledgeTopicSchema,
} from "./retrieve";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

const HashSchema = z.string().regex(HASH_PATTERN, "expected a lowercase sha256 hash");
const IdSchema = z.string().regex(ID_PATTERN, "expected a stable lowercase identifier");
const VersionSchema = z.string().trim().min(1).max(80);
const MOVING_REVISIONS = new Set(["latest", "main", "master", "head", "stable", "current"]);
const ImmutableRevisionSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) => !MOVING_REVISIONS.has(value.toLowerCase()),
    "model revision must be immutable",
  );
const ParserSchema = z
  .object({
    id: IdSchema,
    version: z.string().regex(SEMVER_PATTERN, "expected a fixed semantic version"),
  })
  .strict();

export const CoursePackReferenceV2Schema = z
  .object({
    id: z.enum([
      "general-design",
      "digital-interaction",
      "book-design",
      "layout-design",
      "brand-vi-design",
    ]),
    version: z.literal("1"),
  })
  .strict();

function isSafeRelativePath(value: string) {
  if (
    !value
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || /[\u0000-\u001f\u007f<>:"|?*]/.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => {
    if (
      segment.length === 0
      || segment === "."
      || segment === ".."
      || /[ .]$/.test(segment)
    ) {
      return false;
    }
    const deviceStem = segment.split(".")[0]?.toLowerCase();
    return !deviceStem || !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(deviceStem);
  });
}

export const WorkspaceRelativePathV2Schema = z
  .string()
  .max(500)
  .refine(
    (value) => value === value.trim() && isSafeRelativePath(value),
    "path must be a safe workspace-relative POSIX path",
  );

export const CourseAssetPathV2Schema = WorkspaceRelativePathV2Schema.refine(
  (value) => /^assets\/[a-z0-9][a-z0-9-]*(?:\/[A-Za-z0-9._-]+)*\.png$/.test(value),
  "asset path must stay below data/courses/assets and end in .png",
);

const NormalizedBboxV2Schema = z
  .object({
    coordinateSpace: z.literal("NORMALIZED"),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().gt(0).max(1),
    height: z.number().finite().gt(0).max(1),
  })
  .strict()
  .superRefine((bbox, context) => {
    if (bbox.x + bbox.width > 1 || bbox.y + bbox.height > 1) {
      context.addIssue({
        code: "custom",
        message: "normalized bbox must stay inside the image",
        path: ["bbox"],
      });
    }
  });

const PixelBboxV2Schema = z
  .object({
    coordinateSpace: z.literal("PIXELS"),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const KnowledgeLocationV2Schema = z
  .object({
    pageNumber: z.number().int().positive().nullable(),
    bbox: z.discriminatedUnion("coordinateSpace", [
      NormalizedBboxV2Schema,
      PixelBboxV2Schema,
    ]).nullable(),
    sourceSpan: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
      })
      .strict()
      .refine(({ start, end }) => end > start, "source span end must follow start")
      .nullable(),
  })
  .strict();

export const KnowledgeAssetV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: IdSchema,
    kind: z.literal("IMAGE"),
    locator: z
      .object({
        root: z.literal("data/courses"),
        path: CourseAssetPathV2Schema,
      })
      .strict(),
    mimeType: z.literal("image/png"),
    sizeBytes: z.number().int().positive(),
    dimensions: z
      .object({
        widthPx: z.number().int().positive(),
        heightPx: z.number().int().positive(),
      })
      .strict(),
    sha256: HashSchema,
  })
  .strict();

const NodeRelationshipShape = {
  id: IdSchema,
  parentId: IdSchema.nullable(),
  childrenIds: z.array(IdSchema),
  relatedIds: z.array(IdSchema),
  location: KnowledgeLocationV2Schema.nullable(),
} as const;

const TableCellV2Schema = z
  .object({
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    rowSpan: z.number().int().positive(),
    columnSpan: z.number().int().positive(),
    text: z.string().max(8_000),
    header: z.boolean(),
  })
  .strict();

const KnowledgeNodeV2InputSchema = z.discriminatedUnion("kind", [
  z.object({
    ...NodeRelationshipShape,
    kind: z.literal("DOCUMENT"),
    title: z.string().trim().min(1).max(300),
  }).strict(),
  z.object({
    ...NodeRelationshipShape,
    kind: z.literal("SECTION"),
    title: z.string().trim().min(1).max(300),
    level: z.number().int().min(1).max(6),
  }).strict(),
  z.object({
    ...NodeRelationshipShape,
    kind: z.literal("TEXT"),
    text: z.string().trim().min(1).max(16_000),
    role: z.enum(["CONTENT", "FACT", "ACTION", "CAPTION", "OCR", "TABLE_TEXT"]),
    legacyStatementId: IdSchema.nullable(),
  }).strict(),
  z.object({
    ...NodeRelationshipShape,
    kind: z.literal("IMAGE"),
    assetId: IdSchema,
  }).strict(),
  z.object({
    ...NodeRelationshipShape,
    kind: z.literal("TABLE"),
    plainText: z.string().trim().min(1).max(32_000),
    rowCount: z.number().int().positive(),
    columnCount: z.number().int().positive(),
    cells: z.array(TableCellV2Schema).min(1),
  }).strict().superRefine((table, context) => {
    for (const [index, cell] of table.cells.entries()) {
      if (
        cell.row + cell.rowSpan > table.rowCount
        || cell.column + cell.columnSpan > table.columnCount
      ) {
        context.addIssue({
          code: "custom",
          message: "table cell must stay inside declared rows and columns",
          path: ["cells", index],
        });
      }
    }
    for (let leftIndex = 0; leftIndex < table.cells.length; leftIndex += 1) {
      const left = table.cells[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < table.cells.length; rightIndex += 1) {
        const right = table.cells[rightIndex]!;
        const rowsOverlap = left.row < right.row + right.rowSpan
          && right.row < left.row + left.rowSpan;
        const columnsOverlap = left.column < right.column + right.columnSpan
          && right.column < left.column + left.columnSpan;
        if (rowsOverlap && columnsOverlap) {
          context.addIssue({
            code: "custom",
            message: "table cells must not overlap",
            path: ["cells", rightIndex],
          });
        }
      }
    }
  }),
  z.object({
    ...NodeRelationshipShape,
    kind: z.literal("REGION"),
    location: KnowledgeLocationV2Schema.refine(
      (location) => location.bbox !== null,
      "REGION requires a bbox",
    ),
    assetId: IdSchema,
    label: z.string().trim().min(1).max(300),
  }).strict(),
]);

export const KnowledgeNodeV2Schema = z.intersection(
  KnowledgeNodeV2InputSchema,
  z.object({ contentHash: HashSchema }).strict(),
);

const AnnotationProducerV2Schema = z
  .object({
    id: IdSchema,
    version: z.string().regex(SEMVER_PATTERN, "expected a fixed semantic version"),
    modelId: z.string().trim().min(1).max(300).nullable(),
    modelRevision: ImmutableRevisionSchema.nullable(),
  })
  .strict();

const AnnotationPayloadV2Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("CAPTION"),
    text: z.string().trim().min(1).max(8_000),
  }).strict(),
  z.object({
    kind: z.literal("OCR"),
    text: z.string().trim().min(1).max(32_000),
    language: z.string().trim().min(1).max(30).nullable(),
  }).strict(),
  z.object({
    kind: z.literal("VISUAL_TAGS"),
    tags: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  }).strict(),
]);

const AnnotationInputV2Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SOURCE_DOCUMENT"),
    path: WorkspaceRelativePathV2Schema,
    sha256: HashSchema,
  }).strict(),
  z.object({
    kind: z.literal("SOURCE_SECTION"),
    headingPath: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
    sha256: HashSchema,
  }).strict(),
  z.object({
    kind: z.literal("ASSET"),
    assetId: IdSchema,
    sha256: HashSchema,
  }).strict(),
]);

const KnowledgeAnnotationV2InputSchema = z
  .object({
    id: IdSchema,
    targetNodeId: IdSchema,
    kind: z.enum(["CAPTION", "OCR", "VISUAL_TAGS"]),
    origin: z.enum(["SOURCE", "MODEL_DERIVED", "HUMAN_REVIEWED"]),
    payload: AnnotationPayloadV2Schema,
    producer: AnnotationProducerV2Schema,
    inputs: z.array(AnnotationInputV2Schema).min(1),
    sourceMapping: z
      .object({
        method: z.enum(["ROLE_ALIAS", "DOCUMENT_FALLBACK", "EXPLICIT"]),
        headingPath: z.array(z.string().trim().min(1).max(300)).max(20),
        sourceOrdinal: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((annotation, context) => {
    if (annotation.payload.kind !== annotation.kind) {
      context.addIssue({
        code: "custom",
        message: "annotation kind must match payload kind",
        path: ["payload", "kind"],
      });
    }
    const inputKeys = annotation.inputs.map((input) => {
      if (input.kind === "ASSET") return `${input.kind}:${input.assetId}`;
      if (input.kind === "SOURCE_DOCUMENT") return `${input.kind}:${input.path}`;
      return `${input.kind}:${stableJsonV2(input.headingPath)}`;
    });
    if (new Set(inputKeys).size !== inputKeys.length) {
      context.addIssue({
        code: "custom",
        message: "annotation inputs must be unique",
        path: ["inputs"],
      });
    }
    if (annotation.origin === "SOURCE" && annotation.sourceMapping === null) {
      context.addIssue({
        code: "custom",
        message: "source annotations require a source mapping",
        path: ["sourceMapping"],
      });
    }
    if (annotation.origin === "SOURCE") {
      for (const requiredKind of ["SOURCE_DOCUMENT", "ASSET"] as const) {
        if (!annotation.inputs.some(({ kind }) => kind === requiredKind)) {
          context.addIssue({
            code: "custom",
            message: `source annotations require ${requiredKind} input`,
            path: ["inputs"],
          });
        }
      }
      if (
        annotation.kind === "CAPTION"
        && !annotation.inputs.some(({ kind }) => kind === "SOURCE_SECTION")
      ) {
        context.addIssue({
          code: "custom",
          message: "source captions require a SOURCE_SECTION input",
          path: ["inputs"],
        });
      }
      if (annotation.kind === "CAPTION" && annotation.sourceMapping) {
        const sourceSections = annotation.inputs.filter((input) =>
          input.kind === "SOURCE_SECTION");
        if (
          sourceSections.length !== 1
          || stableJsonV2(sourceSections[0]?.headingPath)
            !== stableJsonV2(annotation.sourceMapping.headingPath)
        ) {
          context.addIssue({
            code: "custom",
            message: "source caption section input must match sourceMapping headingPath",
            path: ["inputs"],
          });
        }
      }
    }
    if (
      annotation.origin === "MODEL_DERIVED"
      && !annotation.inputs.some(({ kind }) => kind === "ASSET")
    ) {
      context.addIssue({
        code: "custom",
        message: "model-derived visual annotations require an ASSET input",
        path: ["inputs"],
      });
    }
    if (
      annotation.origin !== "MODEL_DERIVED"
      && (
        annotation.producer.modelId !== null
        || annotation.producer.modelRevision !== null
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "only model-derived annotations may declare a model and revision",
        path: ["producer"],
      });
    }
    if (
      annotation.origin === "MODEL_DERIVED"
      && (
        annotation.producer.modelId === null
        || annotation.producer.modelRevision === null
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "model-derived annotations require a model id and immutable revision",
        path: ["producer"],
      });
    }
  });

export const KnowledgeAnnotationV2Schema = KnowledgeAnnotationV2InputSchema.extend({
  annotationHash: HashSchema,
}).strict();

const ProvenanceLocatorV2Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("LOCAL_DOCUMENT"),
    path: WorkspaceRelativePathV2Schema,
  }).strict(),
  z.object({
    kind: z.literal("URL"),
    url: z.url().refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    }, "source URL must use http or https"),
  }).strict(),
]);

const KnowledgeObjectV2InputSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: IdSchema,
    title: z.string().trim().min(1).max(300),
    topic: KnowledgeTopicSchema,
    tags: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    sourceCoursePack: CoursePackReferenceV2Schema,
    sourceIdentityBasis: z.enum(["COURSE_DIRECTORY", "TRACKED_LEGACY_MAP"]),
    legacyPlacement: z
      .object({
        coursePack: CoursePackReferenceV2Schema,
        namespace: IdSchema,
      })
      .strict(),
    provenance: z
      .object({
        authority: KnowledgeAuthoritySchema,
        verifiedDate: z.iso.date(),
        scope: z.string().trim().min(1).max(1_000),
        locators: z.array(ProvenanceLocatorV2Schema).min(1).max(20),
      })
      .strict(),
    parser: ParserSchema,
    contentVersion: VersionSchema,
    rootNodeId: IdSchema,
    nodes: z.array(KnowledgeNodeV2Schema).min(1),
    assetIds: z.array(IdSchema),
    annotations: z.array(KnowledgeAnnotationV2Schema),
    legacyItem: KnowledgeItemSchema,
  })
  .strict();

export const KnowledgeObjectV2Schema = KnowledgeObjectV2InputSchema.extend({
  contentHash: HashSchema,
  annotationHash: HashSchema,
}).strict();

const KnowledgeCorpusBundleV2InputSchema = z
  .object({
    schemaVersion: z.literal(2),
    corpusVersion: VersionSchema,
    parser: ParserSchema,
    contentVersion: VersionSchema,
    objects: z.array(KnowledgeObjectV2Schema),
    assets: z.array(KnowledgeAssetV2Schema),
    unreferencedAssetIds: z.array(IdSchema),
  })
  .strict();

export const KnowledgeCorpusBundleV2Schema = KnowledgeCorpusBundleV2InputSchema.extend({
  bundleHash: HashSchema,
}).strict();

const ControlledIndexStorageKeySchema = WorkspaceRelativePathV2Schema.refine(
  (value) => /^(?:data\/knowledge-index|\.runtime\/knowledge-index)\//.test(value),
  "index storage key must stay inside a controlled knowledge-index directory",
);

const IndexPayloadFileShapeV2 = {
  storageKind: z.literal("CONTROLLED_FILE"),
  storageKey: ControlledIndexStorageKeySchema,
  byteLength: z.number().int().positive(),
  sha256: HashSchema,
} as const;

const DedicatedIndexPayloadV2Schema = z
  .object(IndexPayloadFileShapeV2)
  .strict();

const TensorKeyV2Schema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/,
    "tensor key must be a stable safetensors key",
  );

const SharedIndexPayloadV2Schema = z.discriminatedUnion("role", [
  z.object({
    schemaVersion: z.literal(2),
    id: IdSchema,
    role: z.literal("PROVIDER_MANIFEST"),
    format: z.literal("JSON"),
    providerIndexHash: HashSchema,
    ...IndexPayloadFileShapeV2,
  }).strict(),
  z.object({
    schemaVersion: z.literal(2),
    id: IdSchema,
    role: z.literal("VECTOR_TENSORS"),
    format: z.literal("SAFETENSORS"),
    tensors: z.array(z.object({
      key: TensorKeyV2Schema,
      dimensions: z.number().int().positive(),
      vectorCount: z.number().int().positive(),
    }).strict()).min(1),
    ...IndexPayloadFileShapeV2,
  }).strict().superRefine((payload, context) => {
    const tensorKeys = payload.tensors.map(({ key }) => key);
    if (new Set(tensorKeys).size !== tensorKeys.length) {
      context.addIssue({
        code: "custom",
        message: "shared tensor payload contains duplicate tensor keys",
        path: ["tensors"],
      });
    }
  }),
]);

const SharedTensorLocatorV2Schema = z
  .object({
    kind: z.literal("SHARED_TENSOR_SLICES"),
    manifestPayloadId: IdSchema,
    tensorPayloadId: IdSchema,
    slices: z.array(z.object({
      tensorKey: TensorKeyV2Schema,
      vectorOffset: z.number().int().nonnegative(),
      vectorCount: z.number().int().positive(),
    }).strict()).min(1).max(100),
  })
  .strict()
  .superRefine((locator, context) => {
    const sliceKeys = locator.slices.map((slice) =>
      `${slice.tensorKey}:${slice.vectorOffset}:${slice.vectorCount}`);
    if (new Set(sliceKeys).size !== sliceKeys.length) {
      context.addIssue({
        code: "custom",
        message: "shared tensor locator contains duplicate slices",
        path: ["slices"],
      });
    }
  });

const KnowledgeIndexInputV2Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TARGET"), hash: HashSchema }).strict(),
  z.object({ kind: z.literal("OBJECT"), id: IdSchema, hash: HashSchema }).strict(),
  z.object({ kind: z.literal("NODE"), id: IdSchema, hash: HashSchema }).strict(),
  z.object({ kind: z.literal("ASSET"), id: IdSchema, hash: HashSchema }).strict(),
  z.object({ kind: z.literal("ANNOTATION"), id: IdSchema, hash: HashSchema }).strict(),
]);

export const KnowledgeIndexRepresentationV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: IdSchema,
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("OBJECT"), id: IdSchema }).strict(),
      z.object({ kind: z.literal("NODE"), id: IdSchema }).strict(),
      z.object({ kind: z.literal("ASSET"), id: IdSchema }).strict(),
      z.object({ kind: z.literal("ANNOTATION"), id: IdSchema }).strict(),
    ]),
    channel: z.enum(["LEXICAL", "TEXT_VECTOR", "VISUAL_VECTOR", "MULTIMODAL_VECTOR"]),
    inputs: z.array(KnowledgeIndexInputV2Schema).min(1),
    indexVersion: z
      .object({
        id: IdSchema,
        builderId: IdSchema,
        builderVersion: z.string().regex(SEMVER_PATTERN, "expected a fixed semantic version"),
        modelId: z.string().trim().min(1).max(300).nullable(),
        modelRevision: ImmutableRevisionSchema.nullable(),
        configHash: HashSchema,
      })
      .strict(),
    dimensions: z.number().int().positive().nullable(),
    vectorCount: z.number().int().positive(),
    payload: DedicatedIndexPayloadV2Schema.optional(),
    locator: SharedTensorLocatorV2Schema.optional(),
  })
  .strict()
  .superRefine((representation, context) => {
    if ((representation.payload === undefined) === (representation.locator === undefined)) {
      context.addIssue({
        code: "custom",
        message: "index representation requires exactly one dedicated payload or shared locator",
        path: ["payload"],
      });
    }
    if (representation.inputs.filter(({ kind }) => kind === "TARGET").length !== 1) {
      context.addIssue({
        code: "custom",
        message: "index representation requires exactly one TARGET input",
        path: ["inputs"],
      });
    }
    const dependencyKeys = representation.inputs.map((input) =>
      input.kind === "TARGET" ? "TARGET" : `${input.kind}:${input.id}`);
    if (new Set(dependencyKeys).size !== dependencyKeys.length) {
      context.addIssue({
        code: "custom",
        message: "index representation inputs must be unique",
        path: ["inputs"],
      });
    }
    const vectorChannel = representation.channel !== "LEXICAL";
    if (
      (representation.indexVersion.modelId === null)
      !== (representation.indexVersion.modelRevision === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "index model id and revision must be declared together",
        path: ["indexVersion"],
      });
    }
    if (vectorChannel !== (representation.dimensions !== null)) {
      context.addIssue({
        code: "custom",
        message: "vector channels require dimensions; lexical channels must not declare them",
        path: ["dimensions"],
      });
    }
    if (vectorChannel && (
      representation.indexVersion.modelId === null
      || representation.indexVersion.modelRevision === null
    )) {
      context.addIssue({
        code: "custom",
        message: "vector channels require an immutable model id and revision",
        path: ["indexVersion"],
      });
    }
  });

const KnowledgeIndexBundleV2InputSchema = z
  .object({
    schemaVersion: z.literal(2),
    corpusBundleHash: HashSchema,
    sharedPayloads: z.array(SharedIndexPayloadV2Schema).min(2).optional(),
    representations: z.array(KnowledgeIndexRepresentationV2Schema),
  })
  .strict();

export const KnowledgeIndexBundleV2Schema = KnowledgeIndexBundleV2InputSchema.extend({
  indexBundleHash: HashSchema,
}).strict();

export type KnowledgeAssetV2 = z.infer<typeof KnowledgeAssetV2Schema>;
export type KnowledgeNodeV2 = z.infer<typeof KnowledgeNodeV2Schema>;
export type KnowledgeAnnotationV2 = z.infer<typeof KnowledgeAnnotationV2Schema>;
export type KnowledgeObjectV2 = z.infer<typeof KnowledgeObjectV2Schema>;
export type KnowledgeCorpusBundleV2 = z.infer<typeof KnowledgeCorpusBundleV2Schema>;
export type SharedIndexPayloadV2 = z.infer<typeof SharedIndexPayloadV2Schema>;
export type KnowledgeIndexRepresentationV2 = z.infer<typeof KnowledgeIndexRepresentationV2Schema>;
export type KnowledgeIndexBundleV2 = z.infer<typeof KnowledgeIndexBundleV2Schema>;

export function stableJsonV2(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJsonV2).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonV2(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256StableJsonV2(value: unknown): string {
  return createHash("sha256").update(stableJsonV2(value)).digest("hex");
}

function nodePayloadForHash(node: z.infer<typeof KnowledgeNodeV2InputSchema>) {
  return objectWithout<Record<string, unknown>>(node, [
    "id",
    "parentId",
    "childrenIds",
    "relatedIds",
  ]);
}

function objectContentForHash(object: unknown) {
  return objectWithout<Record<string, unknown>>(object, [
    "schemaVersion",
    "parser",
    "contentVersion",
    "annotations",
    "contentHash",
    "annotationHash",
  ]);
}

function objectWithout<T extends Record<string, unknown>>(
  value: unknown,
  omittedKeys: readonly string[],
): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  const result = { ...(value as Record<string, unknown>) };
  for (const key of omittedKeys) delete result[key];
  return result as T;
}

export function sealKnowledgeNodeV2(input: unknown): KnowledgeNodeV2 {
  const parsed = KnowledgeNodeV2InputSchema.parse(
    objectWithout(input, ["contentHash"]),
  );
  return KnowledgeNodeV2Schema.parse({
    ...parsed,
    contentHash: sha256StableJsonV2(nodePayloadForHash(parsed)),
  });
}

export function sealKnowledgeAnnotationV2(input: unknown): KnowledgeAnnotationV2 {
  const parsed = KnowledgeAnnotationV2InputSchema.parse(
    objectWithout(input, ["annotationHash"]),
  );
  return KnowledgeAnnotationV2Schema.parse({
    ...parsed,
    annotationHash: sha256StableJsonV2(parsed),
  });
}

function validateKnowledgeGraph(object: z.infer<typeof KnowledgeObjectV2InputSchema>) {
  const nodesById = new Map(object.nodes.map((node) => [node.id, node]));
  if (nodesById.size !== object.nodes.length) {
    throw new Error(`knowledge object ${object.id}: duplicate node id`);
  }
  const roots = object.nodes.filter((node) => node.parentId === null);
  const documents = object.nodes.filter((node) => node.kind === "DOCUMENT");
  if (
    roots.length !== 1
    || roots[0]?.id !== object.rootNodeId
    || roots[0]?.kind !== "DOCUMENT"
    || documents.length !== 1
  ) {
    throw new Error(`knowledge object ${object.id}: graph requires one DOCUMENT root`);
  }
  for (const node of object.nodes) {
    if (new Set(node.childrenIds).size !== node.childrenIds.length) {
      throw new Error(`knowledge node ${node.id}: duplicate child id`);
    }
    if (new Set(node.relatedIds).size !== node.relatedIds.length) {
      throw new Error(`knowledge node ${node.id}: duplicate related id`);
    }
    if (node.childrenIds.includes(node.id) || node.relatedIds.includes(node.id)) {
      throw new Error(`knowledge node ${node.id}: self relationship is illegal`);
    }
    if (["TEXT", "TABLE", "REGION"].includes(node.kind) && node.childrenIds.length > 0) {
      throw new Error(`knowledge node ${node.id}: ${node.kind} must be a leaf`);
    }
    for (const childId of node.childrenIds) {
      const child = nodesById.get(childId);
      if (!child) throw new Error(`knowledge node ${node.id}: child ${childId} is missing`);
      if (child.parentId !== node.id) {
        throw new Error(`knowledge node ${child.id}: parent-child relationship is not reciprocal`);
      }
      if (node.kind === "IMAGE" && child.kind !== "REGION") {
        throw new Error(`knowledge node ${node.id}: IMAGE children must be REGION nodes`);
      }
    }
    if (node.parentId !== null) {
      const parent = nodesById.get(node.parentId);
      if (!parent) throw new Error(`knowledge node ${node.id}: parent is missing`);
      if (!parent.childrenIds.includes(node.id)) {
        throw new Error(`knowledge node ${node.id}: parent-child relationship is not reciprocal`);
      }
      if (node.kind === "REGION") {
        if (parent.kind !== "IMAGE" || parent.assetId !== node.assetId) {
          throw new Error(`knowledge node ${node.id}: REGION must belong to its matching IMAGE`);
        }
      }
    }
    for (const relatedId of node.relatedIds) {
      const related = nodesById.get(relatedId);
      if (!related) throw new Error(`knowledge node ${node.id}: related node is missing`);
      if (!related.relatedIds.includes(node.id)) {
        throw new Error(`knowledge node ${node.id}: related relationship is not symmetric`);
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(nodeId: string) {
    if (visiting.has(nodeId)) throw new Error(`knowledge object ${object.id}: graph contains a cycle`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) throw new Error(`knowledge object ${object.id}: reachable node is missing`);
    for (const childId of node.childrenIds) visit(childId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  visit(object.rootNodeId);
  if (visited.size !== object.nodes.length) {
    throw new Error(`knowledge object ${object.id}: graph contains unreachable nodes`);
  }

  const referencedAssetIds = object.nodes.flatMap((node) =>
    node.kind === "IMAGE" || node.kind === "REGION" ? [node.assetId] : []);
  const expectedAssetIds = [...new Set(referencedAssetIds)].sort();
  const declaredAssetIds = [...object.assetIds];
  if (
    new Set(declaredAssetIds).size !== declaredAssetIds.length
    || stableJsonV2([...declaredAssetIds].sort()) !== stableJsonV2(expectedAssetIds)
  ) {
    throw new Error(`knowledge object ${object.id}: assetIds do not match graph references`);
  }

  const annotationIds = new Set<string>();
  for (const annotation of object.annotations) {
    if (annotationIds.has(annotation.id)) {
      throw new Error(`knowledge object ${object.id}: duplicate annotation id`);
    }
    annotationIds.add(annotation.id);
    const target = nodesById.get(annotation.targetNodeId);
    if (!target) {
      throw new Error(`knowledge annotation ${annotation.id}: target node is missing`);
    }
    if (
      annotation.kind === "CAPTION"
      || annotation.kind === "OCR"
      || annotation.kind === "VISUAL_TAGS"
    ) {
      if (target.kind !== "IMAGE" && target.kind !== "REGION") {
        throw new Error(`knowledge annotation ${annotation.id}: visual annotation target is invalid`);
      }
    }
    const targetAssetId = target.kind === "IMAGE" || target.kind === "REGION"
      ? target.assetId
      : null;
    for (const annotationInput of annotation.inputs) {
      if (
        annotationInput.kind === "ASSET"
        && annotationInput.assetId !== targetAssetId
      ) {
        throw new Error(
          `knowledge annotation ${annotation.id}: ASSET input must match its target`,
        );
      }
      if (annotationInput.kind === "SOURCE_DOCUMENT") {
        const provenancePaths = object.provenance.locators.flatMap((locator) =>
          locator.kind === "LOCAL_DOCUMENT" ? [locator.path] : []);
        if (!provenancePaths.includes(annotationInput.path)) {
          throw new Error(
            `knowledge annotation ${annotation.id}: source document input is not provenance`,
          );
        }
      }
    }
  }
}

function sortedCanonical(values: readonly unknown[]) {
  return values.map(stableJsonV2).sort();
}

function validateLegacyProjection(object: z.infer<typeof KnowledgeObjectV2InputSchema>) {
  const legacy = object.legacyItem;
  if (
    object.id !== legacy.id
    || object.title !== legacy.title
    || object.topic !== legacy.topic
    || stableJsonV2(object.tags) !== stableJsonV2(legacy.tags)
  ) {
    throw new Error(`knowledge object ${object.id}: metadata must match legacy KnowledgeItem`);
  }
  if (
    object.provenance.authority !== legacy.source.authority
    || object.provenance.verifiedDate !== legacy.source.verifiedDate
    || object.provenance.scope !== legacy.source.scope
  ) {
    throw new Error(`knowledge object ${object.id}: provenance must match legacy KnowledgeItem`);
  }
  const expectedLocators = [
    ...(legacy.source.url ? [{ kind: "URL" as const, url: legacy.source.url }] : []),
    ...(legacy.source.localDocument
      ? [{ kind: "LOCAL_DOCUMENT" as const, path: legacy.source.localDocument }]
      : []),
  ];
  if (
    stableJsonV2(sortedCanonical(object.provenance.locators))
    !== stableJsonV2(sortedCanonical(expectedLocators))
  ) {
    throw new Error(`knowledge object ${object.id}: source locators must match legacy KnowledgeItem`);
  }

  const contentNodes = object.nodes.flatMap((node) =>
    node.kind === "TEXT" && node.role === "CONTENT" ? [node] : []);
  if (
    contentNodes.length !== 1
    || contentNodes[0]?.text !== legacy.content
    || contentNodes[0]?.legacyStatementId !== null
  ) {
    throw new Error(`knowledge object ${object.id}: CONTENT node must preserve legacy content`);
  }
  for (const [role, statements] of [
    ["FACT", legacy.facts],
    ["ACTION", legacy.actions],
  ] as const) {
    const actual = object.nodes.flatMap((node) =>
      node.kind === "TEXT" && node.role === role
        ? [{ id: node.legacyStatementId, text: node.text }]
        : []);
    const expected = statements.map(({ id, text }) => ({ id, text }));
    if (stableJsonV2(actual) !== stableJsonV2(expected)) {
      throw new Error(`knowledge object ${object.id}: ${role} nodes must preserve legacy statements`);
    }
  }
}

export function sealKnowledgeObjectV2(input: unknown): KnowledgeObjectV2 {
  const raw = objectWithout<Record<string, unknown>>(input, ["contentHash", "annotationHash"]);
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawAnnotations = Array.isArray(raw.annotations) ? raw.annotations : [];
  const parsed = KnowledgeObjectV2InputSchema.parse({
    ...raw,
    nodes: rawNodes.map(sealKnowledgeNodeV2),
    annotations: rawAnnotations.map(sealKnowledgeAnnotationV2),
  });
  validateLegacyProjection(parsed);
  validateKnowledgeGraph(parsed);

  const annotationHash = sha256StableJsonV2(parsed.annotations);
  return KnowledgeObjectV2Schema.parse({
    ...parsed,
    contentHash: sha256StableJsonV2(objectContentForHash(parsed)),
    annotationHash,
  });
}

function validatePixelBbox(
  objectId: string,
  node: KnowledgeNodeV2,
  asset: KnowledgeAssetV2,
) {
  const bbox = node.location?.bbox;
  if (!bbox || bbox.coordinateSpace !== "PIXELS") return;
  if (
    bbox.x + bbox.width > asset.dimensions.widthPx
    || bbox.y + bbox.height > asset.dimensions.heightPx
  ) {
    throw new Error(`knowledge object ${objectId}: pixel bbox exceeds asset ${asset.id}`);
  }
}

export function sealKnowledgeCorpusBundleV2(input: unknown): KnowledgeCorpusBundleV2 {
  const raw = objectWithout<Record<string, unknown>>(input, ["bundleHash"]);
  const rawObjects = Array.isArray(raw.objects) ? raw.objects : [];
  const parsed = KnowledgeCorpusBundleV2InputSchema.parse({
    ...raw,
    objects: rawObjects.map(sealKnowledgeObjectV2),
  });

  const objectIds = parsed.objects.map(({ id }) => id);
  if (new Set(objectIds).size !== objectIds.length) {
    throw new Error("knowledge bundle contains duplicate object ids");
  }
  const nodeIds = parsed.objects.flatMap(({ nodes }) => nodes.map(({ id }) => id));
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new Error("knowledge bundle contains duplicate global node ids");
  }
  const annotationIds = parsed.objects.flatMap(({ annotations }) =>
    annotations.map(({ id }) => id));
  if (new Set(annotationIds).size !== annotationIds.length) {
    throw new Error("knowledge bundle contains duplicate global annotation ids");
  }
  const assetIds = parsed.assets.map(({ id }) => id);
  const assetPaths = parsed.assets.map(({ locator }) => locator.path);
  if (new Set(assetIds).size !== assetIds.length) {
    throw new Error("knowledge bundle contains duplicate asset ids");
  }
  if (new Set(assetPaths).size !== assetPaths.length) {
    throw new Error("knowledge bundle contains duplicate asset paths");
  }
  const assetsById = new Map(parsed.assets.map((asset) => [asset.id, asset]));
  const referencedAssetIds = new Set(parsed.objects.flatMap(({ assetIds: ids }) => ids));
  const unreferencedAssetIds = new Set(parsed.unreferencedAssetIds);
  if (unreferencedAssetIds.size !== parsed.unreferencedAssetIds.length) {
    throw new Error("knowledge bundle contains duplicate unreferenced asset ids");
  }
  for (const assetId of referencedAssetIds) {
    if (!assetsById.has(assetId)) throw new Error(`knowledge bundle asset reference is missing: ${assetId}`);
    if (unreferencedAssetIds.has(assetId)) {
      throw new Error(`knowledge bundle asset cannot be both referenced and unreferenced: ${assetId}`);
    }
  }
  for (const assetId of unreferencedAssetIds) {
    if (!assetsById.has(assetId)) {
      throw new Error(`knowledge bundle unreferenced asset is missing: ${assetId}`);
    }
  }
  for (const assetId of assetIds) {
    if (!referencedAssetIds.has(assetId) && !unreferencedAssetIds.has(assetId)) {
      throw new Error(`knowledge bundle asset must be referenced or explicitly unreferenced: ${assetId}`);
    }
  }
  for (const object of parsed.objects) {
    if (
      object.parser.id !== parsed.parser.id
      || object.parser.version !== parsed.parser.version
      || object.contentVersion !== parsed.contentVersion
    ) {
      throw new Error(`knowledge object ${object.id}: parser/content version disagrees with bundle`);
    }
    for (const node of object.nodes) {
      if (node.kind !== "IMAGE" && node.kind !== "REGION") continue;
      const asset = assetsById.get(node.assetId);
      if (!asset) throw new Error(`knowledge object ${object.id}: asset ${node.assetId} is missing`);
      validatePixelBbox(object.id, node, asset);
    }
    for (const annotation of object.annotations) {
      for (const annotationInput of annotation.inputs) {
        if (annotationInput.kind !== "ASSET") continue;
        const asset = assetsById.get(annotationInput.assetId);
        if (!asset) {
          throw new Error(
            `knowledge annotation ${annotation.id}: input asset is missing`,
          );
        }
        if (annotationInput.sha256 !== asset.sha256) {
          throw new Error(
            `knowledge annotation ${annotation.id}: input asset hash drift`,
          );
        }
      }
    }
  }

  return KnowledgeCorpusBundleV2Schema.parse({
    ...parsed,
    bundleHash: sha256StableJsonV2(parsed),
  });
}

export function verifyKnowledgeNodeV2(input: unknown): KnowledgeNodeV2 {
  const parsed = KnowledgeNodeV2Schema.parse(input);
  const unhashed = KnowledgeNodeV2InputSchema.parse(objectWithout(parsed, ["contentHash"]));
  const expected = sha256StableJsonV2(nodePayloadForHash(unhashed));
  if (parsed.contentHash !== expected) {
    throw new Error(`KNOWLEDGE_NODE_HASH_DRIFT:${parsed.id}`);
  }
  return parsed;
}

export function verifyKnowledgeAnnotationV2(input: unknown): KnowledgeAnnotationV2 {
  const parsed = KnowledgeAnnotationV2Schema.parse(input);
  const unhashed = KnowledgeAnnotationV2InputSchema.parse(
    objectWithout(parsed, ["annotationHash"]),
  );
  const expected = sha256StableJsonV2(unhashed);
  if (parsed.annotationHash !== expected) {
    throw new Error(`KNOWLEDGE_ANNOTATION_HASH_DRIFT:${parsed.id}`);
  }
  return parsed;
}

export function verifyKnowledgeObjectV2(input: unknown): KnowledgeObjectV2 {
  const parsed = KnowledgeObjectV2Schema.parse(input);
  for (const node of parsed.nodes) verifyKnowledgeNodeV2(node);
  for (const annotation of parsed.annotations) verifyKnowledgeAnnotationV2(annotation);
  validateLegacyProjection(parsed);
  validateKnowledgeGraph(parsed);
  const expectedContentHash = sha256StableJsonV2(objectContentForHash(parsed));
  const expectedAnnotationHash = sha256StableJsonV2(parsed.annotations);
  if (parsed.contentHash !== expectedContentHash) {
    throw new Error(`KNOWLEDGE_OBJECT_CONTENT_HASH_DRIFT:${parsed.id}`);
  }
  if (parsed.annotationHash !== expectedAnnotationHash) {
    throw new Error(`KNOWLEDGE_OBJECT_ANNOTATION_HASH_DRIFT:${parsed.id}`);
  }
  return parsed;
}

export function verifyKnowledgeCorpusBundleV2(input: unknown): KnowledgeCorpusBundleV2 {
  const parsed = KnowledgeCorpusBundleV2Schema.parse(input);
  for (const object of parsed.objects) verifyKnowledgeObjectV2(object);
  const resealed = sealKnowledgeCorpusBundleV2(parsed);
  if (parsed.bundleHash !== resealed.bundleHash) {
    throw new Error("KNOWLEDGE_BUNDLE_HASH_DRIFT");
  }
  return parsed;
}

function targetInfoForIndex(
  target: KnowledgeIndexRepresentationV2["target"],
  corpus: KnowledgeCorpusBundleV2,
) {
  if (target.kind === "OBJECT") {
    const object = corpus.objects.find(({ id }) => id === target.id);
    return object
      ? { hash: object.contentHash, modalities: ["TEXT"] as const }
      : null;
  }
  if (target.kind === "NODE") {
    const node = corpus.objects.flatMap(({ nodes }) => nodes)
      .find(({ id }) => id === target.id);
    if (!node) return null;
    return {
      hash: node.contentHash,
      modalities: node.kind === "IMAGE" || node.kind === "REGION"
        ? ["VISUAL"] as const
        : ["TEXT"] as const,
    };
  }
  if (target.kind === "ANNOTATION") {
    const annotation = corpus.objects.flatMap(({ annotations }) => annotations)
      .find(({ id }) => id === target.id);
    return annotation
      ? { hash: annotation.annotationHash, modalities: ["TEXT"] as const }
      : null;
  }
  const asset = corpus.assets.find(({ id }) => id === target.id);
  return asset
    ? { hash: asset.sha256, modalities: ["VISUAL"] as const }
    : null;
}

function validateIndexBundleAgainstCorpus(
  bundle: z.infer<typeof KnowledgeIndexBundleV2InputSchema>,
  corpus: KnowledgeCorpusBundleV2,
) {
  if (bundle.corpusBundleHash !== corpus.bundleHash) {
    throw new Error("KNOWLEDGE_INDEX_CORPUS_HASH_DRIFT");
  }
  const representationIds = bundle.representations.map(({ id }) => id);
  if (new Set(representationIds).size !== representationIds.length) {
    throw new Error("knowledge index contains duplicate representation ids");
  }
  const sharedPayloads = bundle.sharedPayloads ?? [];
  const sharedPayloadIds = sharedPayloads.map(({ id }) => id);
  if (new Set(sharedPayloadIds).size !== sharedPayloadIds.length) {
    throw new Error("knowledge index contains duplicate shared payload ids");
  }
  if (sharedPayloads.length > 0) {
    const manifestCount = sharedPayloads.filter(
      ({ role }) => role === "PROVIDER_MANIFEST",
    ).length;
    const tensorCount = sharedPayloads.filter(
      ({ role }) => role === "VECTOR_TENSORS",
    ).length;
    if (manifestCount < 1 || tensorCount < 1) {
      throw new Error(
        "knowledge index shared payloads require provider manifests and tensor payloads",
      );
    }
    const providerIndexHashes = sharedPayloads.flatMap((payload) =>
      payload.role === "PROVIDER_MANIFEST" ? [payload.providerIndexHash] : []);
    if (new Set(providerIndexHashes).size !== providerIndexHashes.length) {
      throw new Error("knowledge index contains duplicate provider index hashes");
    }
  }
  const storageKeys = [
    ...sharedPayloads.map(({ storageKey }) => storageKey),
    ...bundle.representations.flatMap(({ payload }) =>
      payload === undefined ? [] : [payload.storageKey]),
  ];
  if (new Set(storageKeys).size !== storageKeys.length) {
    throw new Error("knowledge index contains duplicate storage keys");
  }
  const sharedPayloadsById = new Map(
    sharedPayloads.map((payload) => [payload.id, payload]),
  );
  const referencedSharedPayloadIds = new Set<string>();
  const providerBindingByVersionId = new Map<string, string>();
  const versionBindingByManifestId = new Map<string, string>();
  const activeKeys = bundle.representations.map((representation) =>
    [
      representation.target.kind,
      representation.target.id,
      representation.channel,
      representation.indexVersion.id,
    ].join(":"));
  if (new Set(activeKeys).size !== activeKeys.length) {
    throw new Error("knowledge index contains duplicate target/channel/version entries");
  }
  const versionsById = new Map<string, string>();
  for (const representation of bundle.representations) {
    const canonicalVersion = stableJsonV2(representation.indexVersion);
    const existing = versionsById.get(representation.indexVersion.id);
    if (existing !== undefined && existing !== canonicalVersion) {
      throw new Error(
        `knowledge index version id has conflicting definitions: ${
          representation.indexVersion.id
        }`,
      );
    }
    versionsById.set(representation.indexVersion.id, canonicalVersion);
  }
  for (const representation of bundle.representations) {
    if (representation.locator !== undefined) {
      const manifestPayload = sharedPayloadsById.get(
        representation.locator.manifestPayloadId,
      );
      if (!manifestPayload) {
        throw new Error(
          `KNOWLEDGE_INDEX_PROVIDER_MANIFEST_MISSING:${representation.id}:`
          + representation.locator.manifestPayloadId,
        );
      }
      if (manifestPayload.role !== "PROVIDER_MANIFEST") {
        throw new Error(
          `KNOWLEDGE_INDEX_PROVIDER_MANIFEST_ROLE_INVALID:${representation.id}`,
        );
      }
      const tensorPayload = sharedPayloadsById.get(
        representation.locator.tensorPayloadId,
      );
      if (!tensorPayload) {
        throw new Error(
          `KNOWLEDGE_INDEX_TENSOR_PAYLOAD_MISSING:${representation.id}:`
          + representation.locator.tensorPayloadId,
        );
      }
      if (tensorPayload.role !== "VECTOR_TENSORS") {
        throw new Error(
          `KNOWLEDGE_INDEX_TENSOR_PAYLOAD_ROLE_INVALID:${representation.id}`,
        );
      }
      referencedSharedPayloadIds.add(manifestPayload.id);
      referencedSharedPayloadIds.add(tensorPayload.id);
      const providerBinding = providerBindingByVersionId.get(
        representation.indexVersion.id,
      );
      if (
        providerBinding !== undefined
        && providerBinding !== manifestPayload.id
      ) {
        throw new Error(
          `KNOWLEDGE_INDEX_VERSION_PROVIDER_CONFLICT:`
          + representation.indexVersion.id,
        );
      }
      providerBindingByVersionId.set(
        representation.indexVersion.id,
        manifestPayload.id,
      );
      const versionBinding = versionBindingByManifestId.get(
        manifestPayload.id,
      );
      if (
        versionBinding !== undefined
        && versionBinding !== representation.indexVersion.id
      ) {
        throw new Error(
          `KNOWLEDGE_INDEX_PROVIDER_VERSION_CONFLICT:`
          + manifestPayload.id,
        );
      }
      versionBindingByManifestId.set(
        manifestPayload.id,
        representation.indexVersion.id,
      );
      const tensorsByKey = new Map(
        tensorPayload.tensors.map((tensor) => [tensor.key, tensor]),
      );
      let locatedVectorCount = 0;
      for (const [sliceIndex, slice] of representation.locator.slices.entries()) {
        const tensor = tensorsByKey.get(slice.tensorKey);
        if (!tensor) {
          throw new Error(
            `KNOWLEDGE_INDEX_LOCATOR_TENSOR_MISSING:${representation.id}:`
            + `${sliceIndex}:${slice.tensorKey}`,
          );
        }
        if (representation.dimensions !== tensor.dimensions) {
          throw new Error(
            `KNOWLEDGE_INDEX_LOCATOR_DIMENSION_DRIFT:${representation.id}:`
            + `${sliceIndex}:${slice.tensorKey}`,
          );
        }
        if (slice.vectorOffset + slice.vectorCount > tensor.vectorCount) {
          throw new Error(
            `KNOWLEDGE_INDEX_LOCATOR_BOUNDS:${representation.id}:`
            + `${sliceIndex}:${slice.tensorKey}`,
          );
        }
        locatedVectorCount += slice.vectorCount;
      }
      if (locatedVectorCount !== representation.vectorCount) {
        throw new Error(
          `KNOWLEDGE_INDEX_LOCATOR_VECTOR_COUNT_DRIFT:${representation.id}`,
        );
      }
    } else {
      const providerBinding = providerBindingByVersionId.get(
        representation.indexVersion.id,
      );
      if (providerBinding !== undefined && providerBinding !== "DEDICATED") {
        throw new Error(
          `KNOWLEDGE_INDEX_VERSION_PROVIDER_CONFLICT:`
          + representation.indexVersion.id,
        );
      }
      providerBindingByVersionId.set(
        representation.indexVersion.id,
        "DEDICATED",
      );
    }
    const modalities = new Set<"TEXT" | "VISUAL">();
    for (const input of representation.inputs) {
      const dependencyTarget = input.kind === "TARGET"
        ? representation.target
        : { kind: input.kind, id: input.id };
      const targetInfo = targetInfoForIndex(dependencyTarget, corpus);
      if (!targetInfo) {
        throw new Error(
          `KNOWLEDGE_INDEX_INPUT_TARGET_MISSING:${representation.id}:`
          + `${dependencyTarget.kind}:${dependencyTarget.id}`,
        );
      }
      for (const modality of targetInfo.modalities) modalities.add(modality);
      if (input.hash !== targetInfo.hash) {
        throw new Error(
          `KNOWLEDGE_INDEX_INPUT_HASH_DRIFT:${representation.id}:`
          + `${dependencyTarget.kind}:${dependencyTarget.id}`,
        );
      }
    }
    if (
      (representation.channel === "LEXICAL" || representation.channel === "TEXT_VECTOR")
      && !modalities.has("TEXT")
    ) {
      throw new Error(`KNOWLEDGE_INDEX_TEXT_INPUT_REQUIRED:${representation.id}`);
    }
    if (
      representation.channel === "VISUAL_VECTOR"
      && !modalities.has("VISUAL")
    ) {
      throw new Error(`KNOWLEDGE_INDEX_VISUAL_INPUT_REQUIRED:${representation.id}`);
    }
    if (
      representation.channel === "VISUAL_VECTOR"
      && modalities.has("TEXT")
    ) {
      throw new Error(`KNOWLEDGE_INDEX_VISUAL_PIXEL_INPUTS_ONLY:${representation.id}`);
    }
    if (
      representation.channel === "MULTIMODAL_VECTOR"
      && (!modalities.has("TEXT") || !modalities.has("VISUAL"))
    ) {
      throw new Error(`KNOWLEDGE_INDEX_MULTIMODAL_INPUTS_REQUIRED:${representation.id}`);
    }
  }
  for (const payload of sharedPayloads) {
    if (!referencedSharedPayloadIds.has(payload.id)) {
      throw new Error(`KNOWLEDGE_INDEX_SHARED_PAYLOAD_UNUSED:${payload.id}`);
    }
  }
}

export function sealKnowledgeIndexBundleV2(
  input: unknown,
  corpusInput: unknown,
): KnowledgeIndexBundleV2 {
  const corpus = verifyKnowledgeCorpusBundleV2(corpusInput);
  const raw = objectWithout<Record<string, unknown>>(input, ["indexBundleHash"]);
  const parsed = KnowledgeIndexBundleV2InputSchema.parse(raw);
  validateIndexBundleAgainstCorpus(parsed, corpus);
  return KnowledgeIndexBundleV2Schema.parse({
    ...parsed,
    indexBundleHash: sha256StableJsonV2(parsed),
  });
}

export function verifyKnowledgeIndexBundleV2(
  input: unknown,
  corpusInput: unknown,
): KnowledgeIndexBundleV2 {
  const corpus = verifyKnowledgeCorpusBundleV2(corpusInput);
  const parsed = KnowledgeIndexBundleV2Schema.parse(input);
  validateIndexBundleAgainstCorpus(parsed, corpus);
  const expectedHash = sha256StableJsonV2(
    objectWithout(parsed, ["indexBundleHash"]),
  );
  if (parsed.indexBundleHash !== expectedHash) {
    throw new Error("KNOWLEDGE_INDEX_BUNDLE_HASH_DRIFT");
  }
  return parsed;
}
