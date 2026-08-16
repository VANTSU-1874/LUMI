// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  p2StudentChannelBlocksStudentRead,
  persistP2StudentChannelShadowSnapshot,
  readLatestP2StudentChannelShadowSnapshot,
} from "@/lib/services/inspiration-wiki-p2-student-channels";
import { p2StudentChannelShadowFixture } from "@/tests/fixtures/inspiration-p2-shadow";

describe("P2 student-channel Shadow persistence", () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lumi-p2-shadow-test-"));
    const databasePath = path.join(directory, "p2.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("persists a zero-exposure snapshot and replays the same material", () => {
    expect(p2StudentChannelBlocksStudentRead(connection.db)).toBe(false);
    const snapshot = p2StudentChannelShadowFixture();
    expect(persistP2StudentChannelShadowSnapshot(connection, snapshot).replayed).toBe(false);
    expect(persistP2StudentChannelShadowSnapshot(connection, snapshot).replayed).toBe(true);
    expect(p2StudentChannelBlocksStudentRead(connection.db)).toBe(true);
    expect(readLatestP2StudentChannelShadowSnapshot(connection.db)).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toContain("title");
    expect(JSON.stringify(snapshot)).not.toContain("previewUrl");
    const row = connection.sqlite.prepare(
      "SELECT student_visible AS studentVisible,formal_release AS formalRelease,current_page AS currentPage,wiki_retrieval AS wikiRetrieval FROM inspiration_wiki_p2_channel_snapshots",
    ).get();
    expect(row).toEqual({ studentVisible: 0, formalRelease: "DISABLED", currentPage: "DISABLED", wikiRetrieval: "DISABLED" });
  });

  it("keeps the snapshot append-only in SQLite", () => {
    const snapshot = p2StudentChannelShadowFixture();
    persistP2StudentChannelShadowSnapshot(connection, snapshot);
    expect(() => connection.sqlite.prepare(
      "UPDATE inspiration_wiki_p2_channel_snapshots SET blocked_count=0 WHERE snapshot_id=?",
    ).run(snapshot.snapshotId)).toThrow(/P2_CHANNEL_SNAPSHOT_APPEND_ONLY/);
    expect(() => connection.sqlite.prepare(
      "DELETE FROM inspiration_wiki_p2_channel_snapshots WHERE snapshot_id=?",
    ).run(snapshot.snapshotId)).toThrow(/P2_CHANNEL_SNAPSHOT_APPEND_ONLY/);
  });

  it("rejects a changed payload that reuses a snapshot identity", () => {
    const snapshot = p2StudentChannelShadowFixture();
    persistP2StudentChannelShadowSnapshot(connection, snapshot);
    expect(() => persistP2StudentChannelShadowSnapshot(connection, {
      ...snapshot,
      snapshotHash: `sha256:${"f".repeat(64)}`,
    })).toThrow(/P2_SHADOW_HASH_MISMATCH/);
  });
});
