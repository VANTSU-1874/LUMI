import { z } from "zod";

import type { ModelClient, ModelMessage } from "./client";

const DEFAULT_MAX_STRUCTURED_BYTES = 32 * 1024;

export function parseStructuredObject<T>(
  raw: string,
  schema: z.ZodType<T>,
  maxBytes = DEFAULT_MAX_STRUCTURED_BYTES,
): T {
  try {
    if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error("too large");
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) throw new Error("not object");
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not object");
    }
    return schema.parse(parsed);
  } catch {
    throw new Error("模型输出不是有效的结构化对象");
  }
}

export async function completeJson<T>(
  client: ModelClient,
  messages: ModelMessage[],
  schema: z.ZodType<T>,
  options?: { signal?: AbortSignal; maxBytes?: number },
) {
  const raw = await client.complete(messages, { signal: options?.signal });
  return parseStructuredObject(raw, schema, options?.maxBytes);
}
