import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  activateKnowledgeV2ProductionGeneration,
} from "@/lib/operations/knowledge-v2-production-generation";

type Journal = {
  version: string;
  dialect: string;
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};

export function parseKnowledgeV2ProductionRehearsalArguments(
  argv: readonly string[],
) {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  if (
    args.length !== 4
    || args[0] !== "--package-root"
    || !args[1]
    || args[2] !== "--expected-commit"
    || !/^[a-f0-9]{40}$/.test(args[3] ?? "")
  ) {
    throw new Error(
      "usage: rehearse-knowledge-v2-production-generation.ts --package-root <path> --expected-commit <40-lowercase-hex>",
    );
  }
  return {
    packageRoot: args[1]!,
    expectedCommit: args[3]!,
  };
}

async function migrationsThrough0049(root: string) {
  const source = path.resolve("drizzle");
  const journal = JSON.parse(await readFile(
    path.join(source, "meta", "_journal.json"),
    "utf8",
  )) as Journal;
  const entries = journal.entries.filter(({ idx }) => idx <= 49);
  if (
    entries.length !== 50
    || entries[49]?.tag !== "0049_legal_madrox"
  ) {
    throw new Error("KNOWLEDGE_V2_REHEARSAL_0049_LINEAGE_INVALID");
  }
  const destination = path.join(root, "migrations-through-0049");
  await mkdir(path.join(destination, "meta"), { recursive: true });
  await Promise.all(entries.map(({ tag }) => copyFile(
    path.join(source, `${tag}.sql`),
    path.join(destination, `${tag}.sql`),
  )));
  await writeFile(
    path.join(destination, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
    "utf8",
  );
  return destination;
}

function inspectDatabase(databasePath: string) {
  const connection = createDb(databasePath);
  try {
    const scalar = (sql: string) => (
      connection.sqlite.prepare(sql).get() as { count: number }
    ).count;
    return {
      migrationCount: scalar(
        "SELECT count(*) count FROM __drizzle_migrations",
      ),
      legacySentinelCount: scalar(
        "SELECT count(*) count FROM knowledge_chunks WHERE id='legacy-production-sentinel'",
      ),
      v2SchemaCount: scalar(`
        SELECT count(*) count FROM sqlite_master
        WHERE type='table' AND name='knowledge_corpora_v2'
      `),
      activeCorpusCount: scalar(`
        SELECT count(*) count FROM sqlite_master
        WHERE type='table' AND name='knowledge_active_corpus_v2'
      `) === 1
        ? scalar("SELECT count(*) count FROM knowledge_active_corpus_v2")
        : 0,
      foreignKeyViolations:
        (connection.sqlite.pragma("foreign_key_check") as unknown[]).length,
    };
  } finally {
    connection.sqlite.close();
  }
}

export async function rehearseKnowledgeV2ProductionGeneration(input: {
  packageRoot: string;
  expectedCommit: string;
}) {
  const packageRoot = path.resolve(input.packageRoot);
  const root = await mkdtemp(path.join(
    tmpdir(),
    "lumi-knowledge-v2-production-rehearsal-",
  ));
  try {
    const migrations = await migrationsThrough0049(root);
    const databasePath = path.join(root, "production-copy.sqlite");
    const restorePoint = path.join(root, "production-0049.restore.sqlite");
    runMigrations(databasePath, migrations);
    const baseline = createDb(databasePath);
    baseline.sqlite.prepare(`
      INSERT INTO knowledge_chunks(
        id,source,title,tags,content,course_pack_id,course_pack_version,
        namespace,authority,content_hash,verified_date
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      "legacy-production-sentinel",
      "{\"authority\":\"COURSE_DESIGN\"}",
      "生产旧知识回退哨兵",
      "[\"旧链\"]",
      "{\"id\":\"legacy-production-sentinel\"}",
      "general-design",
      "1",
      "general-design-principles",
      "COURSE_DESIGN",
      "a".repeat(64),
      "2026-08-08",
    );
    baseline.sqlite.pragma("wal_checkpoint(TRUNCATE)");
    baseline.sqlite.close();
    await copyFile(databasePath, restorePoint);

    const first = await activateKnowledgeV2ProductionGeneration({
      workspaceRoot: packageRoot,
      databasePath,
      expectedCommit: input.expectedCommit,
      now: 100,
    });
    const second = await activateKnowledgeV2ProductionGeneration({
      workspaceRoot: packageRoot,
      databasePath,
      expectedCommit: input.expectedCommit,
      now: 200,
    });
    if (
      first.generationKey !== second.generationKey
      || JSON.stringify(first.counts) !== JSON.stringify(second.counts)
    ) {
      throw new Error("KNOWLEDGE_V2_REHEARSAL_NOT_IDEMPOTENT");
    }
    const active = inspectDatabase(databasePath);
    if (
      active.migrationCount !== 51
      || active.legacySentinelCount !== 1
      || active.v2SchemaCount !== 1
      || active.activeCorpusCount !== 1
      || active.foreignKeyViolations !== 0
    ) {
      throw new Error("KNOWLEDGE_V2_REHEARSAL_ACTIVE_STATE_INVALID");
    }

    await copyFile(restorePoint, databasePath);
    const rolledBack = inspectDatabase(databasePath);
    if (
      rolledBack.migrationCount !== 50
      || rolledBack.legacySentinelCount !== 1
      || rolledBack.v2SchemaCount !== 0
      || rolledBack.activeCorpusCount !== 0
      || rolledBack.foreignKeyViolations !== 0
    ) {
      throw new Error("KNOWLEDGE_V2_REHEARSAL_ROLLBACK_STATE_INVALID");
    }

    const reapplied = await activateKnowledgeV2ProductionGeneration({
      workspaceRoot: packageRoot,
      databasePath,
      expectedCommit: input.expectedCommit,
      now: 300,
    });
    if (reapplied.generationKey !== first.generationKey) {
      throw new Error("KNOWLEDGE_V2_REHEARSAL_REAPPLY_DRIFT");
    }
    const final = inspectDatabase(databasePath);
    const report = {
      status: "KNOWLEDGE_V2_PRODUCTION_REHEARSAL_GO" as const,
      sourceCommit: input.expectedCommit,
      generationKey: first.generationKey,
      first: first.counts,
      idempotent: true,
      rollback: {
        restored0049MigrationCount: rolledBack.migrationCount,
        v2SchemaAbsent: rolledBack.v2SchemaCount === 0,
        legacySentinelPreserved: rolledBack.legacySentinelCount === 1,
      },
      reapply: {
        generationKeyStable:
          reapplied.generationKey === first.generationKey,
        final,
      },
      database: "TEMPORARY_ISOLATED_REMOVED_AFTER_REHEARSAL",
      productionDatabase: "NOT_USED" as const,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (invokedPath === import.meta.url) {
  rehearseKnowledgeV2ProductionGeneration(
    parseKnowledgeV2ProductionRehearsalArguments(process.argv.slice(2)),
  ).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : "KNOWLEDGE_V2_REHEARSAL_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
