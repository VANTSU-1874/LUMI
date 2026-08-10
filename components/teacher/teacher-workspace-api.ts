import { z } from "zod";

export const ClassListSchema = z.object({
  aiMode: z.enum(["MODEL_ASSISTED", "DETERMINISTIC_FALLBACK"]).default("DETERMINISTIC_FALLBACK"),
  classes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    students: z.number().int().nonnegative(),
    dataType: z.literal("REAL"),
    realStudents: z.number().int().nonnegative().optional(),
    demoStudents: z.number().int().nonnegative().optional(),
  })).max(100),
  classesMeta: z.object({
    total: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
});

export type TeacherClassList = z.infer<typeof ClassListSchema>;
export type TeacherWorkspaceFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function jsonOrError(response: Response) {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : "请求失败";
    throw new Error(message);
  }
  return payload;
}
