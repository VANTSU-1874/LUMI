import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";
import { TransferRubricSchema } from "../domain/transfer";

export function createDb(databasePath: string) {
  const sqlite = new Database(databasePath);

  try {
    sqlite.function("tonggan_sha256", { deterministic: true }, (value: string) => {
      if (typeof value !== "string") throw new TypeError("tonggan_sha256 expects text");
      return createHash("sha256").update(value, "utf8").digest("hex");
    });
    sqlite.function("tonggan_validate_transfer_rubric", { deterministic: true }, (value: string | null) => {
      try {
        if (typeof value !== "string") return 0;
        return TransferRubricSchema.safeParse(JSON.parse(value)).success ? 1 : 0;
      } catch { return 0; }
    });
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");

    return {
      db: drizzle(sqlite, { schema }),
      sqlite,
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

export type DatabaseConnection = ReturnType<typeof createDb>;
