import { z } from "zod";

export const DataTypeSchema = z.enum(["REAL", "DEMONSTRATION_DATA"]);
export type DataType = z.infer<typeof DataTypeSchema>;

export const AiModeSchema = z.enum(["MODEL_ASSISTED", "DETERMINISTIC_FALLBACK"]);
export type AiMode = z.infer<typeof AiModeSchema>;

export function aiModeFromConfiguration(enabled: boolean): AiMode {
  return enabled ? "MODEL_ASSISTED" : "DETERMINISTIC_FALLBACK";
}
