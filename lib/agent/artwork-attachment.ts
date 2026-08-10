import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  inspectImage,
  resolveStoredEvidence,
  streamStoredEvidence,
  type TrustedImageExtension,
  UnsafeEvidencePathError,
  validateStoredImage,
} from "@/lib/security/uploads";
import {
  removePrivateImageArtifacts,
  writePrivateImage,
} from "@/lib/services/evidence";

import { AgentArtworkAttachmentSchema } from "./contracts";

export type PreparedAgentArtwork = {
  id: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  extension: TrustedImageExtension;
  byteSize: number;
  width: number;
  height: number;
  digest: string;
  bytes: Uint8Array;
};

export type StoredAgentArtwork = Omit<PreparedAgentArtwork, "bytes" | "extension"> & {
  storagePath: string;
};

export type StagedAgentRunArtwork = StoredAgentArtwork;

const RUN_ARTWORK_SEGMENT = "agent-run-artwork-inputs";

function extensionForMime(mimeType: PreparedAgentArtwork["mimeType"]): TrustedImageExtension {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  return ".webp";
}

export class AgentArtworkNotFoundError extends Error {
  constructor() {
    super("作品图片不存在");
    this.name = "AgentArtworkNotFoundError";
  }
}

export class AgentArtworkCleanupError extends Error {
  constructor() {
    super("作品图片私有文件清理失败");
    this.name = "AgentArtworkCleanupError";
  }
}

function storageSegment(taskId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new AgentArtworkNotFoundError();
  return `artwork-${taskId}`;
}

export async function prepareAgentArtwork(input: {
  bytes: Uint8Array;
  declaredMime: string;
}) {
  const inspected = await inspectImage(input.bytes, input.declaredMime);
  return {
    id: randomUUID(),
    mimeType: inspected.mime,
    extension: inspected.extension,
    byteSize: inspected.bytes.byteLength,
    width: inspected.width,
    height: inspected.height,
    digest: inspected.digest,
    bytes: inspected.bytes,
  } satisfies PreparedAgentArtwork;
}

export async function storeAgentArtwork(
  root: string,
  taskId: string,
  artwork: PreparedAgentArtwork,
): Promise<StoredAgentArtwork> {
  const segment = storageSegment(taskId);
  try {
    await writePrivateImage(
      root,
      segment,
      artwork.id,
      artwork.extension,
      artwork.bytes,
    );
  } catch (error) {
    await removePrivateImageArtifacts(root, segment, artwork.id, artwork.extension);
    throw error;
  }
  return {
    id: artwork.id,
    mimeType: artwork.mimeType,
    byteSize: artwork.byteSize,
    width: artwork.width,
    height: artwork.height,
    digest: artwork.digest,
    storagePath: path.posix.join(segment, `${artwork.id}${artwork.extension}`),
  };
}

export async function stageAgentRunArtwork(
  root: string,
  artwork: PreparedAgentArtwork,
): Promise<StagedAgentRunArtwork> {
  try {
    await writePrivateImage(
      root,
      RUN_ARTWORK_SEGMENT,
      artwork.id,
      artwork.extension,
      artwork.bytes,
    );
  } catch (error) {
    await removePrivateImageArtifacts(root, RUN_ARTWORK_SEGMENT, artwork.id, artwork.extension);
    throw error;
  }
  return {
    id: artwork.id,
    mimeType: artwork.mimeType,
    byteSize: artwork.byteSize,
    width: artwork.width,
    height: artwork.height,
    digest: artwork.digest,
    storagePath: path.posix.join(RUN_ARTWORK_SEGMENT, `${artwork.id}${artwork.extension}`),
  };
}

export async function loadStagedAgentRunArtwork(
  root: string,
  artwork: StagedAgentRunArtwork,
): Promise<PreparedAgentArtwork> {
  const expectedPath = path.posix.join(
    RUN_ARTWORK_SEGMENT,
    `${artwork.id}${extensionForMime(artwork.mimeType)}`,
  );
  if (artwork.storagePath !== expectedPath) throw new AgentArtworkNotFoundError();
  try {
    const stored = await resolveStoredEvidence(root, artwork.storagePath);
    if (stored.size !== artwork.byteSize) throw new AgentArtworkNotFoundError();
    const bytes = new Uint8Array(await readFile(stored.absolutePath));
    const inspected = await validateStoredImage(bytes, artwork.mimeType);
    if (inspected.digest !== artwork.digest || inspected.extension !== extensionForMime(artwork.mimeType)) {
      throw new AgentArtworkNotFoundError();
    }
    return {
      id: artwork.id,
      mimeType: artwork.mimeType,
      extension: inspected.extension,
      byteSize: artwork.byteSize,
      width: artwork.width,
      height: artwork.height,
      digest: artwork.digest,
      bytes,
    };
  } catch (error) {
    if (
      error instanceof AgentArtworkNotFoundError ||
      error instanceof UnsafeEvidencePathError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) throw new AgentArtworkNotFoundError();
    throw error;
  }
}

export async function discardStagedAgentRunArtwork(
  root: string,
  artwork: StagedAgentRunArtwork,
) {
  await removePrivateImageArtifacts(
    root,
    RUN_ARTWORK_SEGMENT,
    artwork.id,
    extensionForMime(artwork.mimeType),
  );
}

export async function discardAgentArtwork(
  root: string,
  taskId: string,
  artwork: PreparedAgentArtwork,
) {
  await removePrivateImageArtifacts(
    root,
    storageSegment(taskId),
    artwork.id,
    artwork.extension,
  );
}

export async function discardStoredAgentArtwork(
  root: string,
  input: Pick<StoredAgentArtwork, "id" | "mimeType" | "storagePath"> & { taskId: string },
) {
  const segment = storageSegment(input.taskId);
  const extension = extensionForMime(input.mimeType);
  const expectedPath = path.posix.join(segment, `${input.id}${extension}`);
  if (input.storagePath !== expectedPath) throw new AgentArtworkCleanupError();
  await removePrivateImageArtifacts(root, segment, input.id, extension);
  try {
    await resolveStoredEvidence(root, expectedPath);
    throw new AgentArtworkCleanupError();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (error instanceof AgentArtworkCleanupError) throw error;
    throw new AgentArtworkCleanupError();
  }
}

export async function loadStoredAgentArtworkForRecovery(
  root: string,
  input: StoredAgentArtwork & { taskId: string },
): Promise<PreparedAgentArtwork | undefined> {
  const segment = storageSegment(input.taskId);
  const extension = extensionForMime(input.mimeType);
  const expectedPath = path.posix.join(segment, `${input.id}${extension}`);
  if (input.storagePath !== expectedPath) throw new AgentArtworkCleanupError();
  try {
    const stored = await resolveStoredEvidence(root, expectedPath);
    if (stored.size !== input.byteSize) throw new AgentArtworkCleanupError();
    const bytes = new Uint8Array(await readFile(stored.absolutePath));
    const inspected = await validateStoredImage(bytes, input.mimeType);
    if (inspected.digest !== input.digest || inspected.extension !== extension) {
      throw new AgentArtworkCleanupError();
    }
    return {
      id: input.id,
      mimeType: input.mimeType,
      extension,
      byteSize: input.byteSize,
      width: input.width,
      height: input.height,
      digest: input.digest,
      bytes,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof AgentArtworkCleanupError) throw error;
    throw new AgentArtworkCleanupError();
  }
}

export function artworkAttachmentDescriptor(artwork: StoredAgentArtwork) {
  return AgentArtworkAttachmentSchema.parse({
    id: artwork.id,
    mimeType: artwork.mimeType,
    byteSize: artwork.byteSize,
    width: artwork.width,
    height: artwork.height,
    previewUrl: `/api/agent/artworks/${artwork.id}`,
  });
}

export async function openAgentArtwork(
  connection: DatabaseConnection,
  actor: SessionPayload,
  attachmentId: string,
  root: string,
) {
  if (actor.role !== "STUDENT") throw new AgentArtworkNotFoundError();
  const row = connection.sqlite.prepare(`
    SELECT id, task_id taskId, student_id studentId, mime_type mimeType,
      storage_path storagePath, byte_size byteSize
    FROM agent_artwork_attachments WHERE id=?
  `).get(attachmentId) as {
    id: string;
    taskId: string;
    studentId: string;
    mimeType: PreparedAgentArtwork["mimeType"];
    storagePath: string;
    byteSize: number;
  } | undefined;
  if (!row || row.studentId !== actor.userId) throw new AgentArtworkNotFoundError();
  const expectedPrefix = `${storageSegment(row.taskId)}/${row.id}.`;
  if (!row.storagePath.startsWith(expectedPrefix)) throw new AgentArtworkNotFoundError();
  try {
    const file = await resolveStoredEvidence(root, row.storagePath);
    if (file.size !== row.byteSize) throw new AgentArtworkNotFoundError();
    return {
      stream: streamStoredEvidence(file.absolutePath),
      size: file.size,
      contentType: row.mimeType,
    };
  } catch (error) {
    if (
      error instanceof UnsafeEvidencePathError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new AgentArtworkNotFoundError();
    }
    throw error;
  }
}
