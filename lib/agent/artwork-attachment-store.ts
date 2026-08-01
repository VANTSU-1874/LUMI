import type { DatabaseConnection } from "@/lib/db/client";

import {
  artworkAttachmentDescriptor,
  type StoredAgentArtwork,
} from "./artwork-attachment";

type ArtworkOwner = {
  taskId: string;
  studentId: string;
  classId: string;
  dataType: "REAL" | "DEMONSTRATION_DATA";
};

export function insertAgentArtworkAttachment(input: {
  connection: DatabaseConnection;
  owner: ArtworkOwner;
  turnId: string;
  artwork?: StoredAgentArtwork;
  createdAt: number;
}) {
  if (!input.artwork) return;
  input.connection.sqlite.prepare(`
    INSERT INTO agent_artwork_attachments(
      id,task_id,turn_id,student_id,class_id,mime_type,storage_path,digest,
      byte_size,width,height,created_at,updated_at,data_type
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    input.artwork.id,
    input.owner.taskId,
    input.turnId,
    input.owner.studentId,
    input.owner.classId,
    input.artwork.mimeType,
    input.artwork.storagePath,
    input.artwork.digest,
    input.artwork.byteSize,
    input.artwork.width,
    input.artwork.height,
    input.createdAt,
    input.createdAt,
    input.owner.dataType,
  );
}

export function readAgentArtworkAttachment(
  connection: DatabaseConnection,
  turnId: string,
) {
  const row = connection.sqlite.prepare(`
    SELECT id, mime_type mimeType, storage_path storagePath, digest,
      byte_size byteSize, width, height
    FROM agent_artwork_attachments WHERE turn_id=?
  `).get(turnId) as StoredAgentArtwork | undefined;
  return row ? artworkAttachmentDescriptor(row) : undefined;
}
