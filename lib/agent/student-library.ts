import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { resolveStoredEvidence, validateStoredImage } from "@/lib/security/uploads";
import {
  removePrivateImageArtifacts,
  sanitizeOriginalFilename,
  writePrivateImage,
} from "@/lib/services/evidence";

import type { PreparedAgentArtwork } from "./artwork-attachment";
import { readDesignTask } from "./design-project-task";
import {
  StudentLibraryAssetSchema,
  StudentLibraryListResponseSchema,
  StudentLibraryUploadResponseSchema,
  type StudentLibraryAsset,
} from "./student-library-contract";

const LIBRARY_STORAGE_SEGMENT = "student-library-assets";

type StudentIdentity = { studentId: string; classId: string };
type LibraryRow = {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  originalName: string | null;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  storagePath: string;
  digest: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: number;
};

export class StudentLibraryNotFoundError extends Error {
  constructor() { super("文件不存在"); this.name = "StudentLibraryNotFoundError"; }
}

export class StudentLibraryForbiddenError extends Error {
  constructor() { super("无权访问文件库"); this.name = "StudentLibraryForbiddenError"; }
}

export class StudentLibraryCleanupError extends Error {
  constructor() { super("文件清理失败"); this.name = "StudentLibraryCleanupError"; }
}

function studentIdentity(connection: DatabaseConnection, actor: SessionPayload): StudentIdentity {
  if (actor.role !== "STUDENT") throw new StudentLibraryForbiddenError();
  const row = connection.sqlite.prepare(`
    SELECT id studentId, class_id classId
    FROM users WHERE id=? AND role='STUDENT'
  `).get(actor.userId) as StudentIdentity | undefined;
  if (!row?.classId) throw new StudentLibraryNotFoundError();
  return row;
}

function extensionForMime(mimeType: LibraryRow["mimeType"]) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  return ".webp";
}

function safeOriginalName(value: string, mimeType: LibraryRow["mimeType"]) {
  const extension = extensionForMime(mimeType);
  const base = sanitizeOriginalFilename(path.basename(value.replaceAll("\\", "/")));
  const stem = base.replace(/\.[^.]+$/, "").trim() || "作品图片";
  return `${stem.slice(0, 160 - extension.length)}${extension}`;
}

function chatAttachmentName(row: LibraryRow) {
  const stamp = new Date(row.createdAt).toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return `对话作品-${stamp}${extensionForMime(row.mimeType)}`;
}

function publicAsset(row: LibraryRow, source: "DIRECT_UPLOAD" | "CHAT_ATTACHMENT"): StudentLibraryAsset {
  const contentPath = source === "DIRECT_UPLOAD"
    ? `/api/agent/library/${row.id}/content`
    : `/api/agent/artworks/${row.id}`;
  return StudentLibraryAssetSchema.parse({
    id: row.id,
    source,
    fileName: row.originalName || chatAttachmentName(row),
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    createdAt: new Date(row.createdAt).toISOString(),
    project: row.projectId && row.projectName ? { id: row.projectId, title: row.projectName } : null,
    previewUrl: contentPath,
    downloadUrl: `${contentPath}?download=1`,
    canDelete: source === "DIRECT_UPLOAD",
  });
}

export function listStudentLibraryAssets(
  connection: DatabaseConnection,
  actor: SessionPayload,
) {
  const student = studentIdentity(connection, actor);
  const direct = connection.sqlite.prepare(`
    SELECT a.id, a.task_id taskId, t.title taskTitle, a.project_id projectId, p.name projectName, a.original_name originalName,
      a.mime_type mimeType, a.storage_path storagePath, a.digest, a.byte_size byteSize,
      a.width, a.height, a.created_at createdAt
    FROM student_library_assets a
    LEFT JOIN design_project_tasks t ON t.id=a.task_id
      AND t.student_id=a.student_id AND t.class_id=a.class_id
    LEFT JOIN student_projects p ON p.id=a.project_id
      AND p.student_id=a.student_id AND p.class_id=a.class_id
    WHERE a.student_id=? AND a.class_id=?
    ORDER BY a.created_at DESC, a.id DESC LIMIT 200
  `).all(student.studentId, student.classId) as LibraryRow[];
  const chat = connection.sqlite.prepare(`
    SELECT a.id, a.task_id taskId, t.title taskTitle, pt.project_id projectId, p.name projectName, NULL originalName,
      a.mime_type mimeType, a.storage_path storagePath, a.digest, a.byte_size byteSize,
      a.width, a.height, a.created_at createdAt
    FROM agent_artwork_attachments a
    JOIN design_project_tasks t ON t.id=a.task_id
      AND t.student_id=a.student_id AND t.class_id=a.class_id
    LEFT JOIN student_project_threads pt ON pt.task_id=a.task_id
      AND pt.student_id=a.student_id AND pt.class_id=a.class_id
    LEFT JOIN student_projects p ON p.id=pt.project_id
    WHERE a.student_id=? AND a.class_id=?
    ORDER BY a.created_at DESC, a.id DESC LIMIT 200
  `).all(student.studentId, student.classId) as LibraryRow[];
  const assets = [
    ...direct.map((row) => publicAsset(row, "DIRECT_UPLOAD")),
    ...chat.map((row) => publicAsset(row, "CHAT_ATTACHMENT")),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 200);
  return StudentLibraryListResponseSchema.parse({ assets });
}

export async function createStudentLibraryAsset(
  connection: DatabaseConnection,
  actor: SessionPayload,
  input: {
    artwork: PreparedAgentArtwork;
    originalName: string;
    taskId: string | null;
  },
  root: string,
  now = new Date(),
) {
  const student = studentIdentity(connection, actor);
  if (input.taskId) readDesignTask(connection, actor, input.taskId);
  const projectId = input.taskId ? (connection.sqlite.prepare(`
    SELECT project_id projectId FROM student_project_threads
    WHERE task_id=? AND student_id=? AND class_id=?
  `).get(input.taskId, student.studentId, student.classId) as { projectId: string } | undefined)?.projectId ?? null : null;
  const id = randomUUID();
  const extension = extensionForMime(input.artwork.mimeType);
  const storagePath = path.posix.join(LIBRARY_STORAGE_SEGMENT, `${id}${extension}`);
  const originalName = safeOriginalName(input.originalName, input.artwork.mimeType);
  try {
    await writePrivateImage(root, LIBRARY_STORAGE_SEGMENT, id, extension, input.artwork.bytes);
    connection.sqlite.prepare(`
      INSERT INTO student_library_assets(
        id,student_id,class_id,task_id,project_id,source,original_name,mime_type,storage_path,
        digest,byte_size,width,height,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, student.studentId, student.classId, input.taskId, projectId, "DIRECT_UPLOAD",
      originalName, input.artwork.mimeType, storagePath, input.artwork.digest,
      input.artwork.byteSize, input.artwork.width, input.artwork.height,
      now.getTime(), now.getTime(),
    );
  } catch (error) {
    await removePrivateImageArtifacts(root, LIBRARY_STORAGE_SEGMENT, id, extension);
    throw error;
  }
  const row = readDirectLibraryRow(connection, student, id);
  return StudentLibraryUploadResponseSchema.parse({ asset: publicAsset(row, "DIRECT_UPLOAD") });
}

function readDirectLibraryRow(
  connection: DatabaseConnection,
  student: StudentIdentity,
  assetId: string,
) {
  const row = connection.sqlite.prepare(`
    SELECT a.id, a.task_id taskId, t.title taskTitle, a.project_id projectId, p.name projectName, a.original_name originalName,
      a.mime_type mimeType, a.storage_path storagePath, a.digest, a.byte_size byteSize,
      a.width, a.height, a.created_at createdAt
    FROM student_library_assets a
    LEFT JOIN design_project_tasks t ON t.id=a.task_id
      AND t.student_id=a.student_id AND t.class_id=a.class_id
    LEFT JOIN student_projects p ON p.id=a.project_id
      AND p.student_id=a.student_id AND p.class_id=a.class_id
    WHERE a.id=? AND a.student_id=? AND a.class_id=?
  `).get(assetId, student.studentId, student.classId) as LibraryRow | undefined;
  if (!row) throw new StudentLibraryNotFoundError();
  return row;
}

export async function openStudentLibraryAsset(
  connection: DatabaseConnection,
  actor: SessionPayload,
  assetId: string,
  root: string,
) {
  const student = studentIdentity(connection, actor);
  const row = readDirectLibraryRow(connection, student, assetId);
  const expectedPath = path.posix.join(
    LIBRARY_STORAGE_SEGMENT,
    `${row.id}${extensionForMime(row.mimeType)}`,
  );
  if (row.storagePath !== expectedPath) throw new StudentLibraryNotFoundError();
  try {
    const stored = await resolveStoredEvidence(root, row.storagePath);
    if (stored.size !== row.byteSize) throw new StudentLibraryNotFoundError();
    const bytes = new Uint8Array(await readFile(stored.absolutePath));
    const inspected = await validateStoredImage(bytes, row.mimeType);
    if (inspected.digest !== row.digest) throw new StudentLibraryNotFoundError();
    return {
      bytes,
      size: stored.size,
      contentType: row.mimeType,
      fileName: row.originalName || `${row.id}${extensionForMime(row.mimeType)}`,
    };
  } catch (error) {
    if (error instanceof StudentLibraryNotFoundError) throw error;
    throw new StudentLibraryNotFoundError();
  }
}

export async function deleteStudentLibraryAsset(
  connection: DatabaseConnection,
  actor: SessionPayload,
  assetId: string,
  root: string,
) {
  const student = studentIdentity(connection, actor);
  const row = readDirectLibraryRow(connection, student, assetId);
  const stored = await resolveStoredEvidence(root, row.storagePath).catch(() => undefined);
  const deleted = connection.sqlite.prepare(`
    DELETE FROM student_library_assets
    WHERE id=? AND student_id=? AND class_id=?
  `).run(assetId, student.studentId, student.classId);
  if (deleted.changes !== 1) throw new StudentLibraryNotFoundError();
  if (stored) {
    try {
      await rm(stored.absolutePath, { force: false });
    } catch {
      throw new StudentLibraryCleanupError();
    }
  }
  return { deleted: assetId };
}
