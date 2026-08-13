import { z } from "zod";

import { publicSourceUrlHasSafeShape } from "./inspiration-public-source";

const BrowserItemSchema = z.object({
  id: z.string().regex(/^inspiration:[a-f0-9]{24}$/),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1_000).nullable(),
  tags: z.array(z.string().trim().min(1).max(80)).max(24),
  courseAssociations: z.array(z.object({ coursePackId: z.string().min(1).max(64), facets: z.array(z.string().min(1).max(80)).max(12) }).strict()).max(20),
  source: z.object({
    label: z.string().trim().min(1).max(240),
    url: z.string().url().max(2048).refine(publicSourceUrlHasSafeShape, "来源链接必须是已批准的公开 HTTPS 地址").nullable(),
  }).strict(),
  attributionNotice: z.string().trim().min(1).max(280),
  preview: z.enum(["METADATA_ONLY", "CONTROLLED"]),
  previewUrl: z.string().regex(/^\/api\/inspiration\/previews\/inspiration:[a-f0-9]{24}$/).nullable(),
}).strict();

export const InspirationBrowseResponseSchema = z.object({
  items: z.array(BrowserItemSchema).max(30),
  nextCursor: z.string().max(240).nullable(),
  appliedFacets: z.array(z.string().min(1).max(80)).max(8),
}).strict();

export type InspirationBrowseItem = z.infer<typeof BrowserItemSchema>;
export type InspirationBrowseResponse = z.infer<typeof InspirationBrowseResponseSchema>;
