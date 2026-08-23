import { readFile } from "node:fs/promises";
import path from "node:path";

import { prepareAgentArtwork } from "@/lib/agent/artwork-attachment";

import { attachmentForId, type PreviewAttachment } from "./attachments";

const assetFiles: Record<PreviewAttachment["id"], { fileName: string; mimeType: "image/png" | "image/webp" }> = {
  COVER_01: { fileName: "cover-layout/cover-01.webp", mimeType: "image/webp" },
  COVER_02: { fileName: "cover-layout/cover-02.webp", mimeType: "image/webp" },
  COVER_03: { fileName: "cover-layout/cover-03.webp", mimeType: "image/webp" },
  COVER_04: { fileName: "cover-layout/cover-04.webp", mimeType: "image/webp" },
  COVER_05: { fileName: "cover-layout/cover-05.webp", mimeType: "image/webp" },
  POSTER_01: { fileName: "poster-fusion/poster-01.png", mimeType: "image/png" },
  POSTER_02: { fileName: "poster-fusion/poster-02.png", mimeType: "image/png" },
  POSTER_03: { fileName: "poster-fusion/poster-03.png", mimeType: "image/png" },
};

export async function loadPreviewAttachments(attachments: readonly PreviewAttachment[]) {
  return Promise.all(attachments.map(async (attachment) => {
    const registered = attachmentForId(attachment.id);
    const asset = assetFiles[registered.id];
    const absolutePath = path.join(process.cwd(), "public", "preview-assets", asset.fileName);
    const bytes = new Uint8Array(await readFile(absolutePath));
    return prepareAgentArtwork({ bytes, declaredMime: asset.mimeType });
  }));
}
