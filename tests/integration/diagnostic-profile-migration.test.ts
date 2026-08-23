// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

type Journal = {
  version: string;
  dialect: string;
  entries: Array<{ idx: number; tag: string }>;
};

async function copyMigrationsThrough0024(target: string) {
  const source = path.join(process.cwd(), "drizzle");
  const journal = JSON.parse(
    await readFile(path.join(source, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  const entries = journal.entries.filter(({ idx }) => idx <= 24);
  await mkdir(path.join(target, "meta"), { recursive: true });
  for (const { tag } of entries) {
    await copyFile(path.join(source, `${tag}.sql`), path.join(target, `${tag}.sql`));
  }
  await writeFile(
    path.join(target, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
    "utf8",
  );
}

async function currentMigrationCount() {
  const journal = JSON.parse(
    await readFile(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
  ) as Journal;
  return journal.entries.length;
}

describe("diagnostic profile integrity migration", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("rolls back an invalid legacy profile and succeeds unchanged after explicit correction", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-diagnostic-migration-"));
    roots.push(root);
    const partial = path.join(root, "through-0024");
    const databasePath = path.join(root, "profile.sqlite");
    await copyMigrationsThrough0024(partial);
    runMigrations(databasePath, partial);
    const legacy = createDb(databasePath);
    try {
      legacy.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','旧班级','OLD');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1','c1','STUDENT','匿名',1700000000);
        INSERT INTO learner_profiles(user_id,level,decomposition,signal_understanding,mapping_design,troubleshooting,transfer,updated_at)
          VALUES('s1','L3',3.25,3.5,3.5,3.5,3.5,1700000000);
      `);
    } finally { legacy.sqlite.close(); }

    expect(() => runMigrations(databasePath)).toThrow(/CHECK constraint failed/);
    const rolledBack = createDb(databasePath);
    try {
      expect(rolledBack.sqlite.prepare(
        "SELECT decomposition FROM learner_profiles WHERE user_id='s1'",
      ).get()).toEqual({ decomposition: 3.25 });
      expect(rolledBack.sqlite.prepare(
        "SELECT count(*) count FROM __drizzle_migrations",
      ).get()).toEqual({ count: 25 });
      const table = rolledBack.sqlite.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='learner_profiles'",
      ).get() as { sql: string };
      expect(table.sql).toContain("between 1 and 4");
      expect(rolledBack.sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE name='__new_learner_profiles'",
      ).get()).toBeUndefined();
      expect(rolledBack.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      rolledBack.sqlite.prepare(
        "UPDATE learner_profiles SET decomposition=3.5 WHERE user_id='s1'",
      ).run();
    } finally { rolledBack.sqlite.close(); }

    runMigrations(databasePath);
    const upgraded = createDb(databasePath);
    try {
      expect(upgraded.sqlite.prepare(
        "SELECT decomposition FROM learner_profiles WHERE user_id='s1'",
      ).get()).toEqual({ decomposition: 3.5 });
      expect(upgraded.sqlite.prepare(
        "SELECT count(*) count FROM __drizzle_migrations",
      ).get()).toEqual({ count: await currentMigrationCount() });
      const genericProfile = upgraded.sqlite.prepare(
        "SELECT course_pack_id coursePackId, course_pack_version coursePackVersion, level, dimensions_json dimensionsJson FROM course_pack_profiles WHERE user_id='s1'",
      ).get() as { coursePackId: string; coursePackVersion: string; level: string; dimensionsJson: string };
      expect(genericProfile.coursePackId).toBe("digital-interaction");
      expect(genericProfile.coursePackVersion).toBe("1");
      expect(genericProfile.level).toBe("L3");
      expect(JSON.parse(genericProfile.dimensionsJson)).toMatchObject({ decomposition: 3.5, transfer: 3.5 });
      const table = upgraded.sqlite.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='learner_profiles'",
      ).get() as { sql: string };
      expect(table.sql).toMatch(/decomposition[^,]+in \(1, ?1\.5, ?2, ?2\.5, ?3, ?3\.5, ?4\)/i);
      expect(() => upgraded.sqlite.prepare(
        "UPDATE learner_profiles SET mapping_design=3.25 WHERE user_id='s1'",
      ).run()).toThrow();
    } finally { upgraded.sqlite.close(); }
  });
});
