import { z } from "zod";

export const StudentLibraryAssetSourceSchema = z.enum([
  "DIRECT_UPLOAD",
  "CHAT_ATTACHMENT",
]);

export const StudentLibraryProjectSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(80),
}).strict();

export const StudentLibraryAssetSchema = z.object({
  id: z.string().uuid(),
  source: StudentLibraryAssetSourceSchema,
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteSize: z.number().int().min(1).max(5 * 1024 * 1024),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
  createdAt: z.string().datetime(),
  project: StudentLibraryProjectSchema.nullable(),
  previewUrl: z.string().startsWith("/api/agent/"),
  downloadUrl: z.string().startsWith("/api/agent/"),
  canDelete: z.boolean(),
}).strict();

export const StudentLibraryListResponseSchema = z.object({
  assets: z.array(StudentLibraryAssetSchema).max(200),
}).strict();

export const StudentLibraryUploadResponseSchema = z.object({
  asset: StudentLibraryAssetSchema,
}).strict();

export type StudentLibraryAsset = z.infer<typeof StudentLibraryAssetSchema>;
export type StudentLibraryListResponse = z.infer<typeof StudentLibraryListResponseSchema>;
