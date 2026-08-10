import { createHash } from "node:crypto";

import { z } from "zod";

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const RecordIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/);

const CurrentActionFields = {
  recordId: RecordIdSchema,
  reuseKey: HashSchema,
  targetOrdinal: z.number().int().nonnegative(),
} as const;

const ReuseActionSchema = z
  .object({
    action: z.literal("REUSE"),
    ...CurrentActionFields,
    baseOrdinal: z.number().int().nonnegative(),
  })
  .strict();

const RebuildActionSchema = z
  .object({
    action: z.literal("REBUILD"),
    ...CurrentActionFields,
  })
  .strict();

const DeleteActionSchema = z
  .object({
    action: z.literal("DELETE"),
    recordId: RecordIdSchema,
    reuseKey: HashSchema,
    baseOrdinal: z.number().int().nonnegative(),
  })
  .strict();

export const IncrementalIndexActionV2Schema = z.discriminatedUnion("action", [
  ReuseActionSchema,
  RebuildActionSchema,
  DeleteActionSchema,
]);

export const IncrementalIndexPlanV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    provider: z.enum(["bge-small-zh-v1-5", "siglip2", "colqwen2"]),
    baseIndexBundleHash: HashSchema.nullable(),
    targetCorpusBundleHash: HashSchema,
    compatibilityHash: HashSchema,
    baseCompatible: z.boolean(),
    outputIndexBundleHash: HashSchema.nullable(),
    actions: z.array(IncrementalIndexActionV2Schema),
    summary: z
      .object({
        reused: z.number().int().nonnegative(),
        rebuilt: z.number().int().nonnegative(),
        deleted: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, context) => {
    const current = plan.actions.filter(
      (action) => action.action !== "DELETE",
    );
    const deleted = plan.actions.filter(
      (action) => action.action === "DELETE",
    );
    const currentIds = current.map(({ recordId }) => recordId);
    const deletedIds = deleted.map(({ recordId }) => recordId);
    const targetOrdinals = current.map(({ targetOrdinal }) => targetOrdinal);
    const reused = current.filter(({ action }) => action === "REUSE");

    if (
      new Set(currentIds).size !== currentIds.length
      || new Set(deletedIds).size !== deletedIds.length
      || currentIds.some((recordId) => deletedIds.includes(recordId))
    ) {
      context.addIssue({
        code: "custom",
        message: "incremental index plan record ids must be disjoint and unique",
        path: ["actions"],
      });
    }
    if (
      [...targetOrdinals].sort((left, right) => left - right)
        .some((ordinal, index) => ordinal !== index)
    ) {
      context.addIssue({
        code: "custom",
        message: "incremental index target ordinals must be contiguous",
        path: ["actions"],
      });
    }
    if (
      plan.baseIndexBundleHash === null
      && (plan.baseCompatible || reused.length > 0 || deleted.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "incremental index plan cannot use a missing base index",
        path: ["baseIndexBundleHash"],
      });
    }
    if (!plan.baseCompatible && reused.length > 0) {
      context.addIssue({
        code: "custom",
        message: "incompatible base index cannot contribute reused records",
        path: ["baseCompatible"],
      });
    }
    const expected = {
      reused: reused.length,
      rebuilt: current.length - reused.length,
      deleted: deleted.length,
    };
    if (
      expected.reused !== plan.summary.reused
      || expected.rebuilt !== plan.summary.rebuilt
      || expected.deleted !== plan.summary.deleted
    ) {
      context.addIssue({
        code: "custom",
        message: "incremental index summary does not match actions",
        path: ["summary"],
      });
    }
  });

export type IncrementalIndexPlanV2 = z.infer<
  typeof IncrementalIndexPlanV2Schema
>;

export type IncrementalIndexRecordV2 = Readonly<{
  recordId: string;
  reuseKey: string;
  ordinal: number;
}>;

export type CreateIncrementalIndexPlanV2Input = Readonly<{
  provider: IncrementalIndexPlanV2["provider"];
  baseIndexBundleHash: string | null;
  targetCorpusBundleHash: string;
  compatibilityHash: string;
  baseCompatible: boolean;
  baseRecords: readonly IncrementalIndexRecordV2[];
  targetRecords: readonly IncrementalIndexRecordV2[];
  outputIndexBundleHash?: string | null;
}>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("incremental.index.stable.json.invalid");
  }
  return serialized;
}

export function incrementalIndexCompatibilityHashV2(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function crossLanguageNumericIdentity(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("incremental.index.numeric.identity.invalid");
    }
    const fixed = value.toFixed(12).replace(/\.?0+$/, "");
    return { $number: fixed === "" || fixed === "-0" ? "0" : fixed };
  }
  if (Array.isArray(value)) {
    return value.map((item) => crossLanguageNumericIdentity(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        crossLanguageNumericIdentity(item),
      ]),
    );
  }
  return value;
}

export function visualIncrementalReuseKeyV2(input: Readonly<{
  sourceSha256: string;
  regions: unknown;
  config: unknown;
  modelRevision: string;
}>) {
  return incrementalIndexCompatibilityHashV2(
    crossLanguageNumericIdentity(input),
  );
}

function assertRecords(
  records: readonly IncrementalIndexRecordV2[],
  label: string,
) {
  const ids = new Set<string>();
  const ordinals = new Set<number>();
  for (const record of records) {
    RecordIdSchema.parse(record.recordId);
    HashSchema.parse(record.reuseKey);
    if (
      !Number.isInteger(record.ordinal)
      || record.ordinal < 0
      || ids.has(record.recordId)
      || ordinals.has(record.ordinal)
    ) {
      throw new Error(`incremental.index.${label}.records.invalid`);
    }
    ids.add(record.recordId);
    ordinals.add(record.ordinal);
  }
  if (
    [...ordinals].sort((left, right) => left - right)
      .some((ordinal, index) => ordinal !== index)
  ) {
    throw new Error(`incremental.index.${label}.ordinals.invalid`);
  }
}

export function createIncrementalIndexPlanV2(
  input: CreateIncrementalIndexPlanV2Input,
): IncrementalIndexPlanV2 {
  assertRecords(input.baseRecords, "base");
  assertRecords(input.targetRecords, "target");
  if (input.baseIndexBundleHash === null && input.baseRecords.length > 0) {
    throw new Error("incremental.index.base.hash.required");
  }
  const baseById = new Map(
    input.baseRecords.map((record) => [record.recordId, record]),
  );
  const targetIds = new Set(input.targetRecords.map(({ recordId }) => recordId));
  const currentActions = [...input.targetRecords]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((record) => {
      const base = baseById.get(record.recordId);
      if (
        input.baseCompatible
        && base
        && base.reuseKey === record.reuseKey
      ) {
        return {
          action: "REUSE" as const,
          recordId: record.recordId,
          reuseKey: record.reuseKey,
          targetOrdinal: record.ordinal,
          baseOrdinal: base.ordinal,
        };
      }
      return {
        action: "REBUILD" as const,
        recordId: record.recordId,
        reuseKey: record.reuseKey,
        targetOrdinal: record.ordinal,
      };
    });
  const deleteActions = [...input.baseRecords]
    .filter(({ recordId }) => !targetIds.has(recordId))
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((record) => ({
      action: "DELETE" as const,
      recordId: record.recordId,
      reuseKey: record.reuseKey,
      baseOrdinal: record.ordinal,
    }));
  const reused = currentActions.filter(({ action }) => action === "REUSE")
    .length;
  return IncrementalIndexPlanV2Schema.parse({
    schemaVersion: 2,
    provider: input.provider,
    baseIndexBundleHash: input.baseIndexBundleHash,
    targetCorpusBundleHash: input.targetCorpusBundleHash,
    compatibilityHash: input.compatibilityHash,
    baseCompatible: input.baseCompatible,
    outputIndexBundleHash: input.outputIndexBundleHash ?? null,
    actions: [...currentActions, ...deleteActions],
    summary: {
      reused,
      rebuilt: currentActions.length - reused,
      deleted: deleteActions.length,
    },
  });
}

export function attachIncrementalIndexOutputV2(
  plan: IncrementalIndexPlanV2,
  outputIndexBundleHash: string,
) {
  return IncrementalIndexPlanV2Schema.parse({
    ...plan,
    outputIndexBundleHash,
  });
}

export function validatePackagedIncrementalPlanV2(input: Readonly<{
  plan: unknown;
  provider: IncrementalIndexPlanV2["provider"];
  corpusBundleHash: string;
  providerIndexBundleHash: string;
  currentRecords: readonly IncrementalIndexRecordV2[];
}>) {
  const plan = IncrementalIndexPlanV2Schema.parse(input.plan);
  const expectedIds = input.currentRecords
    .slice()
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(({ recordId, reuseKey, ordinal }) => ({
      recordId,
      reuseKey,
      targetOrdinal: ordinal,
    }));
  const plannedIds = plan.actions
    .filter((action) => action.action !== "DELETE")
    .sort((left, right) => left.targetOrdinal - right.targetOrdinal)
    .map(({ recordId, reuseKey, targetOrdinal }) => ({
      recordId,
      reuseKey,
      targetOrdinal,
    }));
  if (
    plan.provider !== input.provider
    || plan.targetCorpusBundleHash !== input.corpusBundleHash
    || plan.outputIndexBundleHash !== input.providerIndexBundleHash
    || expectedIds.length !== plannedIds.length
    || expectedIds.some((record, index) =>
      record.recordId !== plannedIds[index]?.recordId
      || record.reuseKey !== plannedIds[index]?.reuseKey
      || record.targetOrdinal !== plannedIds[index]?.targetOrdinal
    )
  ) {
    throw new Error("incremental.index.plan.provider.binding.invalid");
  }
  return plan;
}
