import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import { and, asc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";
import { DataTypeSchema } from "@/lib/domain/data-provenance";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { agentArtworkAttachments, agentRunArtworkInputs, evidence, projects, toolPathPlans, users } from "@/lib/db/schema";
import { EvidenceNumericValueSchema } from "@/lib/domain/evidence";
import {
  EvidenceProbeDraftSchema,
  EvidenceProbePathMismatchError,
  EvidenceProbeSchema,
  validateEvidenceProbe,
  validateEvidenceProbeForToolPath,
  type EvidenceProbeDraft,
} from "@/lib/domain/evidence-probe";

import { EvidenceCodeSchema, SignalLayerSchema } from "./troubleshooting";
import { ToolPathRequirementsSchema } from "@/lib/domain/tool-path";
import {
  InvalidImageError,
  MAX_IMAGE_BYTES,
  UnsafeEvidencePathError,
  inspectImage,
  validateStoredImage,
} from "@/lib/security/uploads";

export { ImageTooLargeError, InvalidImageError, MAX_IMAGE_BYTES, UnsafeEvidencePathError, inspectImage } from "@/lib/security/uploads";

type CourseDatabase = DatabaseConnection["db"];
type CourseTransaction = Parameters<Parameters<CourseDatabase["transaction"]>[0]>[0];
type Executor = CourseDatabase | CourseTransaction;

export function bumpEvidenceRevision(transaction: CourseTransaction, projectId: string) {
  const result = transaction.update(projects).set({ evidenceRevision: sql`${projects.evidenceRevision} + 1`, updatedAt: new Date() })
    .where(eq(projects.id, projectId)).run();
  if (result.changes !== 1) throw new Error("项目证据版本更新失败");
}

const LabelSchema = z.string().trim().min(1).max(80);
const SafeTextSchema = z.string().trim().min(1).max(2_000);
const HttpsUrlSchema = z.string().trim().max(2_000).url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    context.addIssue({ code: "custom", message: "外链必须为不含凭据的HTTPS地址" });
  }
});

const CommonDraft = { label: LabelSchema, signalLayer: SignalLayerSchema };
export const EvidenceDraftSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), ...CommonDraft, text: SafeTextSchema }).strict(),
  z.object({ kind: z.literal("VALUE"), ...CommonDraft, value: EvidenceNumericValueSchema }).strict(),
  z.object({ kind: z.literal("VIDEO_LINK"), ...CommonDraft, url: HttpsUrlSchema }).strict(),
  EvidenceProbeDraftSchema,
]);
export type EvidenceDraft = z.infer<typeof EvidenceDraftSchema>;
export type ImageEvidenceDraft = {
  kind: "IMAGE";
  label: string;
  signalLayer: z.infer<typeof SignalLayerSchema>;
  bytes: Uint8Array;
  declaredMime: string;
  originalName: string;
};

export const EvidenceVerificationStatusSchema = z.enum([
  "SUBMITTED",
  "RULE_VERIFIED",
  "TEACHER_VERIFIED",
  "REJECTED",
]);
export const EvidenceStorageStatusSchema = z.enum(["PENDING", "READY"]);

export const EvidenceRecordSchema = z.object({
  id: z.uuid(),
  projectId: z.string().min(1).max(128),
  classId: z.string().min(1).max(128),
  studentId: z.string().min(1).max(128),
  evidenceSequence: z.number().int().positive(),
  kind: z.enum(["TEXT", "IMAGE", "VALUE", "VIDEO_LINK", "PROBE"]),
  signalLayer: SignalLayerSchema,
  confirmedCode: EvidenceCodeSchema.nullable(),
  verificationStatus: EvidenceVerificationStatusSchema,
  storageStatus: EvidenceStorageStatusSchema,
  label: LabelSchema,
  content: z.string().min(1).max(4_000),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  probeJson: EvidenceProbeSchema.nullable(),
  originalName: z.string().min(1).max(120).nullable(),
  createdAt: z.coerce.date(),
  dataType: DataTypeSchema,
}).strict().superRefine((row, context) => {
  const verified = ["RULE_VERIFIED", "TEACHER_VERIFIED"].includes(row.verificationStatus);
  if (verified !== (row.confirmedCode !== null)) {
    context.addIssue({ code: "custom", message: "证据确认状态与代码不一致" });
  }
  if (row.kind === "PROBE" && !row.probeJson) {
    context.addIssue({ code: "custom", message: "结构化证据缺少probe" });
  }
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

export class EvidenceNotFoundError extends Error {
  constructor() { super("项目不存在"); this.name = "EvidenceNotFoundError"; }
}
export class EvidenceForbiddenError extends Error {
  constructor() { super("无权操作该项目"); this.name = "EvidenceForbiddenError"; }
}
export class EvidenceStageConflictError extends Error {
  constructor() { super("当前项目阶段不能添加证据"); this.name = "EvidenceStageConflictError"; }
}
export function sanitizeOriginalFilename(value: string) {
  const leaf = value.normalize("NFKC").replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g, "_");
  const collapsed = leaf.replace(/\.{2,}/g, ".").replace(/\s+/g, " ").trim();
  return (collapsed || "upload").slice(0, 120);
}

export function assertEvidenceOwnership(db: Executor, actor: SessionPayload, projectId: string) {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new EvidenceNotFoundError();
  if (actor.role !== "STUDENT") throw new EvidenceForbiddenError();
  const student = db.select({ id: users.id, classId: users.classId, role: users.role })
    .from(users).where(and(eq(users.id, actor.userId), eq(users.role, "STUDENT"))).get();
  if (!student?.classId || project.studentId !== student.id || project.classId !== student.classId) {
    throw new EvidenceForbiddenError();
  }
  return project;
}

function safeProjectSegment(projectId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) throw new EvidenceNotFoundError();
  return projectId;
}

function normalizedPath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

function assertContained(root: string, candidate: string) {
  const relative = path.relative(normalizedPath(root), normalizedPath(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new UnsafeEvidencePathError();
}

function pathsOverlap(left: string, right: string) {
  const normalizedLeft = normalizedPath(left);
  const normalizedRight = normalizedPath(right);
  const leftToRight = path.relative(normalizedLeft, normalizedRight);
  const rightToLeft = path.relative(normalizedRight, normalizedLeft);
  const contains = (relative: string) => relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  return contains(leftToRight) || contains(rightToLeft);
}

async function assertNoLinkedAncestors(target: string) {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  let current = root;
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new UnsafeEvidencePathError();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function assertOutsidePublic(resolvedRoot: string, canonicalRoot: string) {
  const lexicalCwd = path.resolve(/* turbopackIgnore: true */ process.cwd());
  const canonicalCwd = await realpath(lexicalCwd);
  const lexicalPublic = path.join(lexicalCwd, "public");
  let canonicalPublic = path.join(canonicalCwd, "public");
  try {
    canonicalPublic = await realpath(lexicalPublic);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const rootCandidate of [resolvedRoot, canonicalRoot]) {
    for (const publicCandidate of [lexicalPublic, canonicalPublic]) {
      if (pathsOverlap(rootCandidate, publicCandidate)) throw new UnsafeEvidencePathError();
    }
  }
}

export async function initializeEvidenceRoot(root: string) {
  const resolvedRoot = path.resolve(root);
  await assertOutsidePublic(resolvedRoot, resolvedRoot);
  await assertNoLinkedAncestors(resolvedRoot);
  await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
  await assertNoLinkedAncestors(resolvedRoot);
  const info = await lstat(resolvedRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new UnsafeEvidencePathError();
  const canonicalRoot = await realpath(resolvedRoot);
  if (normalizedPath(canonicalRoot) !== normalizedPath(resolvedRoot)) throw new UnsafeEvidencePathError();
  await assertOutsidePublic(resolvedRoot, canonicalRoot);
  return { resolvedRoot, canonicalRoot };
}

async function ensureProjectDirectory(root: string, projectId: string) {
  const initialized = await initializeEvidenceRoot(root);
  const segment = safeProjectSegment(projectId);
  const directory = path.join(initialized.resolvedRoot, segment);
  try {
    const existing = await lstat(directory);
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new UnsafeEvidencePathError();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      await mkdir(directory, { recursive: false, mode: 0o700 });
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
    }
  }
  const after = await lstat(directory);
  if (!after.isDirectory() || after.isSymbolicLink()) throw new UnsafeEvidencePathError();
  const canonicalDirectory = await realpath(directory);
  assertContained(initialized.canonicalRoot, canonicalDirectory);
  return { ...initialized, directory, canonicalDirectory };
}

export function digestEvidenceContent(kind: string, content: string) {
  return createHash("sha256").update(`${kind}\0${content}`, "utf8").digest("hex");
}

function nextEvidenceSequence(transaction: CourseTransaction, projectId: string, studentId: string) {
  const row = transaction.select({ value: max(evidence.evidenceSequence) }).from(evidence)
    .where(and(eq(evidence.projectId, projectId), eq(evidence.studentId, studentId))).get();
  return (row?.value ?? 0) + 1;
}

function assertWritableStage(stage: string) {
  if (!["BUILD", "TROUBLESHOOT"].includes(stage)) throw new EvidenceStageConflictError();
}

export async function writePrivateImage(
  root: string,
  projectId: string,
  id: string,
  extension: string,
  bytes: Uint8Array,
  beforeImageRename?: () => void | Promise<void>,
) {
  const before = await ensureProjectDirectory(root, projectId);
  const temporaryPath = path.join(before.directory, `.${id}.tmp`);
  const finalPath = path.join(before.directory, `${id}${extension}`);
  const noFollow = (constants as unknown as Record<string, number>).O_NOFOLLOW ?? 0;
  const handle = await open(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await beforeImageRename?.();
  const checked = await ensureProjectDirectory(root, projectId);
  if (
    normalizedPath(checked.resolvedRoot) !== normalizedPath(before.resolvedRoot) ||
    normalizedPath(checked.canonicalRoot) !== normalizedPath(before.canonicalRoot) ||
    normalizedPath(checked.canonicalDirectory) !== normalizedPath(before.canonicalDirectory)
  ) {
    throw new UnsafeEvidencePathError();
  }
  const tempInfo = await lstat(temporaryPath);
  if (!tempInfo.isFile() || tempInfo.isSymbolicLink()) throw new UnsafeEvidencePathError();
  try {
    await lstat(finalPath);
    throw new UnsafeEvidencePathError();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rename(temporaryPath, finalPath);
  const finalDirectory = await ensureProjectDirectory(root, projectId);
  if (
    normalizedPath(finalDirectory.resolvedRoot) !== normalizedPath(before.resolvedRoot) ||
    normalizedPath(finalDirectory.canonicalRoot) !== normalizedPath(before.canonicalRoot) ||
    normalizedPath(finalDirectory.canonicalDirectory) !== normalizedPath(before.canonicalDirectory)
  ) {
    throw new UnsafeEvidencePathError();
  }
  const finalInfo = await lstat(finalPath);
  if (!finalInfo.isFile() || finalInfo.isSymbolicLink()) throw new UnsafeEvidencePathError();
  return { temporaryPath, finalPath };
}

export async function removePrivateImageArtifacts(root: string, projectId: string, id: string, extension?: string) {
  try {
    const project = await ensureProjectDirectory(root, projectId);
    const candidates = [path.join(project.directory, `.${id}.tmp`)];
    if (extension) candidates.push(path.join(project.directory, `${id}${extension}`));
    for (const candidate of candidates) {
      try {
        const info = await lstat(candidate);
        if (info.isFile() && !info.isSymbolicLink()) await rm(candidate, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  } catch {
    // A path that no longer passes containment checks is never followed for cleanup.
  }
}

function parsePersistedEvidence(db: Executor, id: string) {
  return EvidenceRecordSchema.parse(db.select().from(evidence).where(eq(evidence.id, id)).get());
}

export async function saveEvidence(
  db: CourseDatabase,
  actor: SessionPayload,
  projectId: string,
  rawDraft: EvidenceDraft | ImageEvidenceDraft,
  options: { root: string; now?: Date; beforeImageRename?: () => void | Promise<void> },
): Promise<EvidenceRecord> {
  const project = assertEvidenceOwnership(db, actor, projectId);
  assertWritableStage(project.stage);
  const now = options.now ?? new Date();
  const id = randomUUID();

  if (rawDraft.kind !== "IMAGE") {
    const draft = EvidenceDraftSchema.parse(rawDraft);
    const content = draft.kind === "TEXT"
      ? draft.text
      : draft.kind === "VALUE"
        ? String(draft.value)
        : draft.kind === "VIDEO_LINK"
          ? draft.url
          : JSON.stringify(draft.probe);
    const probe = draft.kind === "PROBE" ? draft.probe : null;
    const validation = draft.kind === "PROBE"
      ? validateEvidenceProbe(draft as EvidenceProbeDraft)
      : { verificationStatus: "SUBMITTED" as const, confirmedCode: null };
    db.transaction((transaction) => {
      const current = assertEvidenceOwnership(transaction, actor, projectId);
      assertWritableStage(current.stage);
      if (draft.kind === "PROBE" && draft.signalLayer === "TRANSPORT") {
        const trustedPlan = transaction.select({ path: toolPathPlans.path, requirements: toolPathPlans.requirementsJson })
          .from(toolPathPlans).where(eq(toolPathPlans.projectId, projectId)).get();
        if (!trustedPlan) throw new EvidenceProbePathMismatchError();
        validateEvidenceProbeForToolPath(draft, trustedPlan.path, ToolPathRequirementsSchema.parse(trustedPlan.requirements));
      }
      transaction.insert(evidence).values({
        id,
        projectId,
        classId: current.classId,
        studentId: actor.userId,
        evidenceSequence: nextEvidenceSequence(transaction, projectId, actor.userId),
        kind: draft.kind,
        signalLayer: draft.signalLayer,
        confirmedCode: validation.confirmedCode,
        verificationStatus: validation.verificationStatus,
        storageStatus: "READY",
        label: draft.label,
        content,
        contentDigest: digestEvidenceContent(draft.kind, content),
        probeJson: probe,
        originalName: null,
        createdAt: now,
      }).run();
      transaction.update(projects).set({ stage: "TROUBLESHOOT", updatedAt: now, evidenceRevision: sql`${projects.evidenceRevision} + 1` })
        .where(eq(projects.id, projectId)).run();
    }, { behavior: "immediate" });
    return parsePersistedEvidence(db, id);
  }

  const label = LabelSchema.parse(rawDraft.label);
  const signalLayer = SignalLayerSchema.parse(rawDraft.signalLayer);
  const inspected = await inspectImage(rawDraft.bytes, rawDraft.declaredMime);
  const relativePath = path.posix.join(safeProjectSegment(projectId), `${id}${inspected.extension}`);
  await ensureProjectDirectory(options.root, projectId);
  db.transaction((transaction) => {
    const current = assertEvidenceOwnership(transaction, actor, projectId);
    assertWritableStage(current.stage);
    transaction.insert(evidence).values({
      id,
      projectId,
      classId: current.classId,
      studentId: actor.userId,
      evidenceSequence: nextEvidenceSequence(transaction, projectId, actor.userId),
      kind: "IMAGE",
      signalLayer,
      confirmedCode: null,
      verificationStatus: "SUBMITTED",
      storageStatus: "PENDING",
      label,
      content: relativePath,
      contentDigest: inspected.digest,
      probeJson: null,
      originalName: sanitizeOriginalFilename(rawDraft.originalName),
      createdAt: now,
    }).run();
  }, { behavior: "immediate" });

  try {
    await writePrivateImage(
      options.root,
      projectId,
      id,
      inspected.extension,
      inspected.bytes,
      options.beforeImageRename,
    );
    db.transaction((transaction) => {
      const current = assertEvidenceOwnership(transaction, actor, projectId);
      assertWritableStage(current.stage);
      const update = transaction.update(evidence).set({ storageStatus: "READY" })
        .where(and(eq(evidence.id, id), eq(evidence.storageStatus, "PENDING"))).run();
      if (update.changes !== 1) throw new Error("待完成证据状态已变更");
      transaction.update(projects).set({ stage: "TROUBLESHOOT", updatedAt: now, evidenceRevision: sql`${projects.evidenceRevision} + 1` })
        .where(eq(projects.id, projectId)).run();
    }, { behavior: "immediate" });
  } catch (error) {
    await removePrivateImageArtifacts(options.root, projectId, id, inspected.extension);
    db.transaction((transaction) => {
      transaction.delete(evidence)
        .where(and(eq(evidence.id, id), eq(evidence.storageStatus, "PENDING"))).run();
    }, { behavior: "immediate" });
    throw error;
  }
  return parsePersistedEvidence(db, id);
}

function mimeForPath(value: string) {
  if (value.endsWith(".png")) return "image/png";
  if (value.endsWith(".jpg")) return "image/jpeg";
  if (value.endsWith(".webp")) return "image/webp";
  throw new InvalidImageError();
}

export async function recoverPendingEvidence(
  db: CourseDatabase,
  options: {
    root: string;
    now?: Date;
    tempMaxAgeMs?: number;
    orphanGraceMs?: number;
    pendingGraceMs?: number;
    deletionGraceMs?: number;
    assertLease?: () => void;
  },
) {
  options.assertLease?.();
  const now = options.now ?? new Date();
  const root = await initializeEvidenceRoot(options.root);
  const referenced = db.select({ id: evidence.id, content: evidence.content, kind: evidence.kind, storageStatus: evidence.storageStatus })
    .from(evidence).all();
  const artworkPaths = db.select({ content: agentArtworkAttachments.storagePath })
    .from(agentArtworkAttachments).all();
  const runArtworkPaths = db.select({ content: agentRunArtworkInputs.storagePath })
    .from(agentRunArtworkInputs).all();
  const referencedPaths = new Set([
    ...referenced.map(({ content }) => content),
    ...artworkPaths.map(({ content }) => content),
    ...runArtworkPaths.map(({ content }) => content),
  ]);
  const referencedById = new Map(referenced.map((row) => [row.id.toLowerCase(), row]));
  const pending = db.select().from(evidence).where(eq(evidence.storageStatus, "PENDING")).all();
  let finalized = 0;
  let removed = 0;
  let skippedPending = 0;
  const pendingCutoff = now.getTime() - (options.pendingGraceMs ?? 60_000);
  for (const raw of pending) {
    options.assertLease?.();
    const row = EvidenceRecordSchema.parse(raw);
    if (row.createdAt.getTime() >= pendingCutoff) {
      skippedPending += 1;
      continue;
    }
    let valid = false;
    let finalPath: string | undefined;
    try {
      const project = await ensureProjectDirectory(options.root, row.projectId);
      finalPath = path.resolve(root.resolvedRoot, ...row.content.split("/"));
      assertContained(project.canonicalDirectory, await realpath(finalPath));
      const info = await lstat(finalPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_IMAGE_BYTES) {
        throw new UnsafeEvidencePathError();
      }
      if (info.mtimeMs >= pendingCutoff) {
        skippedPending += 1;
        continue;
      }
      const bytes = await readFile(finalPath);
      valid = (await validateStoredImage(bytes, mimeForPath(row.content))).digest === row.contentDigest;
    } catch {
      valid = false;
    }
    if (valid) {
      options.assertLease?.();
      db.transaction((transaction) => {
        const update = transaction.update(evidence).set({ storageStatus: "READY" })
          .where(and(eq(evidence.id, row.id), eq(evidence.storageStatus, "PENDING"))).run();
        if (update.changes !== 1) throw new Error("待恢复证据状态已变更");
        bumpEvidenceRevision(transaction, row.projectId);
        transaction.update(projects).set({ stage: "TROUBLESHOOT", updatedAt: now })
          .where(and(eq(projects.id, row.projectId), eq(projects.stage, "BUILD"))).run();
      }, { behavior: "immediate" });
      finalized += 1;
    } else {
      if (finalPath) {
        const extension = path.extname(row.content).toLowerCase();
        await removePrivateImageArtifacts(
          options.root,
          row.projectId,
          row.id,
          [".png", ".jpg", ".webp"].includes(extension) ? extension : undefined,
        );
      }
      options.assertLease?.();
      db.transaction((transaction) => {
        transaction.delete(evidence)
          .where(and(eq(evidence.id, row.id), eq(evidence.storageStatus, "PENDING"))).run();
      }, { behavior: "immediate" });
      removed += 1;
    }
  }

  const cutoff = now.getTime() - (options.tempMaxAgeMs ?? 60 * 60 * 1_000);
  const orphanCutoff = now.getTime() - (options.orphanGraceMs ?? 24 * 60 * 60 * 1_000);
  const deletionCutoff = now.getTime() - (options.deletionGraceMs ?? 60_000);
  let removedTemps = 0;
  let removedOrphans = 0;
  for (const directoryEntry of await readdir(root.resolvedRoot, { withFileTypes: true })) {
    options.assertLease?.();
    if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink()) continue;
    const directory = path.join(root.resolvedRoot, directoryEntry.name);
    try {
      assertContained(root.canonicalRoot, await realpath(directory));
    } catch {
      continue;
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      options.assertLease?.();
      const candidate = path.join(directory, entry.name);
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const info = await lstat(candidate);
      const tempMatch = /^\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$/i.exec(entry.name);
      if (tempMatch && info.mtimeMs < cutoff) {
        options.assertLease?.();
        await rm(candidate, { force: true });
        removedTemps += 1;
        continue;
      }
      const deletionTombstone = /^\.deleting-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\.(?:png|jpg|webp))?$/i.exec(entry.name);
      if (deletionTombstone) {
        options.assertLease?.();
        const referencedRow = referencedById.get(deletionTombstone[1].toLowerCase());
        if (!referencedRow) {
          await rm(candidate, { force: true });
          removedTemps += 1;
          continue;
        }
        if (referencedRow.storageStatus !== "READY" || referencedRow.kind !== "IMAGE") continue;
        const rowExtension = path.extname(referencedRow.content).toLowerCase();
        const tombstoneExtension = deletionTombstone[3]?.toLowerCase();
        const extension = tombstoneExtension ?? rowExtension;
        const expectedRelative = path.posix.join(directoryEntry.name, `${referencedRow.id}${extension}`);
        if (
          ![".png", ".jpg", ".webp"].includes(extension) ||
          rowExtension !== extension ||
          referencedRow.content !== expectedRelative ||
          info.mtimeMs >= deletionCutoff
        ) continue;
        const expectedPath = path.join(directory, `${referencedRow.id}${extension}`);
        try {
          await link(candidate, expectedPath);
          await rm(candidate, { force: true });
          finalized += 1;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") continue;
          try {
            const [tombstoneInfo, expectedInfo] = await Promise.all([lstat(candidate), lstat(expectedPath)]);
            if (
              tombstoneInfo.isFile() && !tombstoneInfo.isSymbolicLink() &&
              expectedInfo.isFile() && !expectedInfo.isSymbolicLink() &&
              tombstoneInfo.dev === expectedInfo.dev && tombstoneInfo.ino === expectedInfo.ino
            ) {
              await rm(candidate, { force: true });
              finalized += 1;
            }
          } catch { /* an unexpected target or concurrent mutation is left fail-closed */ }
        }
        continue;
      }
      const finalMatch = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(png|jpg|webp)$/i.exec(entry.name);
      const relativePath = path.posix.join(directoryEntry.name, entry.name);
      if (finalMatch && !referencedPaths.has(relativePath) && info.mtimeMs < orphanCutoff) {
        options.assertLease?.();
        await rm(candidate, { force: true });
        removedOrphans += 1;
      }
    }
  }
  return { finalized, removed, skippedPending, removedTemps, removedOrphans };
}

export function readProjectEvidence(db: Executor, actor: SessionPayload, projectId: string) {
  assertEvidenceOwnership(db, actor, projectId);
  return db.select().from(evidence)
    .where(and(
      eq(evidence.projectId, projectId),
      eq(evidence.studentId, actor.userId),
      eq(evidence.storageStatus, "READY"),
    ))
    .orderBy(asc(evidence.evidenceSequence)).all()
    .map((row) => EvidenceRecordSchema.parse(row));
}
