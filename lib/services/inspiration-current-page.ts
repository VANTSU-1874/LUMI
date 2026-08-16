import { desc, sql } from "drizzle-orm";

import type { DatabaseConnection } from "@/lib/db/client";
import { inspirationWikiCurrentPageEvents } from "@/lib/db/schema";

export type InspirationCurrentPageState = "ACTIVATED" | "WITHDRAWN";

/** SQLite rowid is the append-only causal tiebreaker when events share a second. */
export function readLatestInspirationCurrentPageStates(db: DatabaseConnection["db"]) {
  const events = db.select({
    canonicalPageId: inspirationWikiCurrentPageEvents.canonicalPageId,
    eventType: inspirationWikiCurrentPageEvents.eventType,
  }).from(inspirationWikiCurrentPageEvents)
    .orderBy(
      desc(inspirationWikiCurrentPageEvents.createdAt),
      desc(sql<number>`rowid`),
    ).all();
  const latest = new Map<string, InspirationCurrentPageState>();
  for (const event of events) {
    if (!latest.has(event.canonicalPageId)) {
      latest.set(event.canonicalPageId, event.eventType);
    }
  }
  return latest;
}
