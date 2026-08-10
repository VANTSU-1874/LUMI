// @vitest-environment node

import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LUMI_D017_STORYLINE } from "@/data/demo/lumi-d017";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { resetDemoAgentHistory } from "@/scripts/reset-demo-agent-history";
import { seedDemoDatabase } from "@/scripts/seed-demo";

const roots: string[] = [];
const RESET_PEPPER = "demo-reset-identity-pepper-at-least-32-characters";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function seededD017Database(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  const databasePath = path.join(root, "competition-demo.sqlite");
  const artworkRoot = path.join(root, "artworks");
  await seedDemoDatabase({
    databasePath,
    artworkRoot,
    identityCodePepper: RESET_PEPPER,
    allowDemoSeed: true,
    nodeEnv: "test",
  });
  const attachmentPaths = LUMI_D017_STORYLINE.artworks.map((artwork) => path.join(
    artworkRoot,
    `artwork-${artwork.taskId}`,
    `${artwork.id}.png`,
  ));
  return { root, databasePath, artworkRoot, attachmentPaths };
}

describe("demo agent history reset", () => {
  it("removes only demonstration conversations and cascades their turns and actions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chuying-demo-agent-reset-"));
    roots.push(root);
    const databasePath = path.join(root, "competition-demo.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','测试班','RESET');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('demo-student-a','c1','STUDENT','演示学生',1700000000),
          ('real-student','c1','STUDENT','真实学生',1700000000);
        INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type) VALUES
          ('demo-task','demo-student-a','c1','演示设计任务','ACTIVE',1700000000,1700000000,'DEMONSTRATION_DATA'),
          ('real-task','real-student','c1','真实设计任务','ACTIVE',1700000000,1700000000,'REAL');
        INSERT INTO agent_conversations(id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at) VALUES
          ('demo-conversation','demo-task','demo-student-a','c1',NULL,'digital-interaction','1',1700000000,1700000000),
          ('real-conversation','real-task','real-student','c1',NULL,'digital-interaction','1',1700000000,1700000000);
        INSERT INTO agent_turns(id,conversation_id,turn_sequence,student_message,episode,decision_code,policy_trace_json,reply_json,ai_mode,source_ids_json,created_at,data_type) VALUES
          ('demo-turn','demo-conversation',1,'演示问题','EXPLORE','EXPLORE_CLARIFY_GOAL','{"policyId":"competition-core","policyVersion":"1","budgets":{"modelDecisions":0,"maxModelDecisions":4,"toolCalls":0,"maxToolCalls":6,"turnTimeoutMs":30000},"autonomy":{"readOnlyTools":"AUTOMATIC","studentMutations":"STUDENT_CONFIRMATION","formalAuthority":"FORBIDDEN"},"appliedRules":["BOUND_EXECUTION"]}','{}','DETERMINISTIC_FALLBACK','[]',1700000000,'DEMONSTRATION_DATA'),
          ('real-turn','real-conversation',1,'真实问题','EXPLORE','EXPLORE_CLARIFY_GOAL','{"policyId":"competition-core","policyVersion":"1","budgets":{"modelDecisions":0,"maxModelDecisions":4,"toolCalls":0,"maxToolCalls":6,"turnTimeoutMs":30000},"autonomy":{"readOnlyTools":"AUTOMATIC","studentMutations":"STUDENT_CONFIRMATION","formalAuthority":"FORBIDDEN"},"appliedRules":["BOUND_EXECUTION"]}','{}','DETERMINISTIC_FALLBACK','[]',1700000000,'REAL');
        INSERT INTO agent_actions(id,turn_id,action_sequence,type,label,adapter_id,target,focus,payload_json,status,created_at,data_type) VALUES
          ('demo-action','demo-turn',1,'OPEN_RESOURCE','演示行动','knowledge-map','KNOWLEDGE_MAP',NULL,'{}','PROPOSED',1700000000,'DEMONSTRATION_DATA');
        INSERT INTO agent_student_memory(id,student_id,class_id,kind,content,salience,source_turn_id,created_at) VALUES
          ('11111111-1111-4111-8111-111111111111','demo-student-a','c1','PROJECT_FACT','演示项目事实',1,'demo-turn',1700000000),
          ('22222222-2222-4222-8222-222222222222','real-student','c1','PROJECT_FACT','真实项目事实',1,'real-turn',1700000000);
        INSERT INTO agent_session_summaries(task_id,student_id,class_id,summary,through_turn_id,through_created_at,covered_turn_count,created_at,updated_at) VALUES
          ('demo-task','demo-student-a','c1','演示摘要','demo-turn',1700000000,1,1700000000,1700000000),
          ('real-task','real-student','c1','真实摘要','real-turn',1700000000,1,1700000000,1700000000);
      `);

      await expect(resetDemoAgentHistory(connection, { artworkRoot: path.join(root, "artworks") })).resolves.toEqual({
        removed: {
          conversations: 1, turns: 1, actions: 1, reviews: 0, toolCalls: 0, steps: 0,
          runtimeEvents: 0, attachments: 0,
          critiques: 0, memories: 1, summaries: 1, privateArtworkFiles: 0,
        },
        realPreserved: {
          conversations: 1, turns: 1, actions: 0, reviews: 0, toolCalls: 0, steps: 0,
          runtimeEvents: 0, attachments: 0, critiques: 0, memories: 1, summaries: 1,
        },
      });
      expect(connection.sqlite.prepare("SELECT id FROM agent_conversations ORDER BY id").all()).toEqual([
        { id: "real-conversation" },
      ]);
      expect(connection.sqlite.prepare("SELECT id FROM agent_turns ORDER BY id").all()).toEqual([
        { id: "real-turn" },
      ]);
      expect(connection.sqlite.prepare("SELECT content FROM agent_student_memory").all()).toEqual([
        { content: "真实项目事实" },
      ]);
      expect(connection.sqlite.prepare("SELECT summary FROM agent_session_summaries").all()).toEqual([
        { summary: "真实摘要" },
      ]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("removes and restores the exact D-017 history without deleting its identity, project, audit, or files owned by real data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chuying-demo-agent-reset-d017-"));
    roots.push(root);
    const databasePath = path.join(root, "competition-demo.sqlite");
    const artworkRoot = path.join(root, "artworks");
    const seedOptions = {
      databasePath,
      artworkRoot,
      identityCodePepper: "demo-reset-identity-pepper-at-least-32-characters",
      allowDemoSeed: true,
      nodeEnv: "test",
    } as const;
    await seedDemoDatabase(seedOptions);

    const attachmentPaths = LUMI_D017_STORYLINE.artworks.map((artwork) => path.join(
      artworkRoot,
      `artwork-${artwork.taskId}`,
      `${artwork.id}.png`,
    ));
    for (const file of attachmentPaths) await expect(access(file)).resolves.toBeUndefined();

    const connection = createDb(databasePath);
    try {
      await expect(resetDemoAgentHistory(connection, { artworkRoot })).resolves.toEqual({
        removed: {
          conversations: 2, turns: 3, actions: 0, reviews: 0, toolCalls: 0, steps: 0,
          runtimeEvents: 0, attachments: 2,
          critiques: 2, memories: 3, summaries: 2, privateArtworkFiles: 2,
        },
        realPreserved: {
          conversations: 0, turns: 0, actions: 0, reviews: 0, toolCalls: 0, steps: 0,
          runtimeEvents: 0, attachments: 0, critiques: 0, memories: 0, summaries: 0,
        },
      });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM design_project_tasks WHERE student_id='demo-student-c'").get())
        .toEqual({ count: 2 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM users WHERE id='demo-student-c'").get())
        .toEqual({ count: 1 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM projects WHERE id='demo-project-c'").get())
        .toEqual({ count: 1 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM audit_events WHERE id='demo-audit-d017-agent-history'").get())
        .toEqual({ count: 1 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_conversations WHERE student_id='demo-student-c'").get())
        .toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
    for (const file of attachmentPaths) await expect(access(file)).rejects.toMatchObject({ code: "ENOENT" });

    await seedDemoDatabase(seedOptions);
    const restored = createDb(databasePath);
    try {
      expect(restored.sqlite.prepare("SELECT count(*) count FROM agent_conversations WHERE student_id='demo-student-c'").get())
        .toEqual({ count: 2 });
      expect(restored.sqlite.prepare("SELECT count(*) count FROM agent_turns t JOIN agent_conversations c ON c.id=t.conversation_id WHERE c.student_id='demo-student-c'").get())
        .toEqual({ count: 3 });
      expect(restored.sqlite.prepare("SELECT count(*) count FROM agent_artwork_attachments WHERE student_id='demo-student-c'").get())
        .toEqual({ count: 2 });
      expect(restored.sqlite.prepare("SELECT count(*) count FROM agent_critiques WHERE student_id='demo-student-c'").get())
        .toEqual({ count: 2 });
      expect(restored.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      restored.sqlite.close();
    }
    for (const file of attachmentPaths) await expect(access(file)).resolves.toBeUndefined();
  });

  it.each(["before-second-delete", "before-commit"] as const)(
    "restores private files and rolls back the database after an injected %s failure",
    async (stage) => {
      const { databasePath, artworkRoot, attachmentPaths } = await seededD017Database(
        `chuying-demo-agent-reset-${stage}-`,
      );
      const originalFiles = await Promise.all(attachmentPaths.map((file) => readFile(file)));
      const connection = createDb(databasePath);
      try {
        await expect(resetDemoAgentHistory(connection, {
          artworkRoot,
          faultInjection: stage === "before-second-delete" ? {
            beforeArtworkDelete(index) {
              if (index === 1) throw new Error("INJECTED_SECOND_DELETE_FAILURE");
            },
          } : {
            beforeCommit() {
              throw new Error("INJECTED_BEFORE_COMMIT_FAILURE");
            },
          },
        })).rejects.toThrow(/INJECTED_/);
        expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_conversations WHERE student_id='demo-student-c'").get())
          .toEqual({ count: 2 });
        expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_artwork_attachments WHERE student_id='demo-student-c'").get())
          .toEqual({ count: 2 });
        expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_critiques WHERE student_id='demo-student-c'").get())
          .toEqual({ count: 2 });
        expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
      } finally {
        connection.sqlite.close();
      }
      for (const [index, file] of attachmentPaths.entries()) {
        expect(await readFile(file)).toEqual(originalFiles[index]);
      }
    },
  );

  it("reports only private artwork files that actually existed before reset", async () => {
    const { databasePath, artworkRoot, attachmentPaths } = await seededD017Database(
      "chuying-demo-agent-reset-missing-artwork-",
    );
    await rm(attachmentPaths[0]!, { force: true });
    const connection = createDb(databasePath);
    try {
      const result = await resetDemoAgentHistory(connection, { artworkRoot });
      expect(result.removed.attachments).toBe(2);
      expect(result.removed.privateArtworkFiles).toBe(1);
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_artwork_attachments").get())
        .toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
    for (const file of attachmentPaths) await expect(access(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a REAL conversation containing a DEMONSTRATION turn and artwork before touching DB or files", async () => {
    const { databasePath, artworkRoot, attachmentPaths } = await seededD017Database(
      "chuying-demo-agent-reset-real-parent-",
    );
    const artwork = LUMI_D017_STORYLINE.artworks[0]!;
    const originalFile = await readFile(attachmentPaths[0]!);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO users(id,class_id,role,alias,created_at)
          VALUES('real-d017-student','demo-class-digi2026','STUDENT','真实学生',1700000000);
        INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type)
          VALUES('aaaaaaaa-0000-4000-8000-000000000001','real-d017-student','demo-class-digi2026','真实任务','ACTIVE',1700000000,1700000000,'REAL');
        INSERT INTO agent_conversations(id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at)
          VALUES('aaaaaaaa-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','real-d017-student','demo-class-digi2026',NULL,'digital-interaction','1',1700000000,1700000000);
      `);
      connection.sqlite.prepare("UPDATE agent_turns SET conversation_id=? WHERE id=?")
        .run("aaaaaaaa-0000-4000-8000-000000000002", artwork.turnId);

      await expect(resetDemoAgentHistory(connection, { artworkRoot }))
        .rejects.toThrow("DEMO_AGENT_RESET_CROSS_PROVENANCE:conversation-turn");
      expect(connection.sqlite.prepare("SELECT conversation_id conversationId,data_type dataType FROM agent_turns WHERE id=?").get(artwork.turnId))
        .toEqual({ conversationId: "aaaaaaaa-0000-4000-8000-000000000002", dataType: "DEMONSTRATION_DATA" });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_artwork_attachments").get())
        .toEqual({ count: 2 });
    } finally {
      connection.sqlite.close();
    }
    expect(await readFile(attachmentPaths[0]!)).toEqual(originalFile);
  });

  it("rejects a REAL child under a DEMONSTRATION turn before touching DB or files", async () => {
    const { databasePath, artworkRoot, attachmentPaths } = await seededD017Database(
      "chuying-demo-agent-reset-real-child-",
    );
    const artwork = LUMI_D017_STORYLINE.artworks[0]!;
    const originalFile = await readFile(attachmentPaths[0]!);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare(`INSERT INTO agent_actions(
        id,turn_id,action_sequence,type,label,adapter_id,target,focus,payload_json,status,
        effect,approval_mode,idempotency_key,created_at,executed_at,rejected_at,data_type
      ) VALUES(?, ?, 1, 'OPEN_RESOURCE', '真实标记行动', NULL, 'KNOWLEDGE_MAP', NULL, '{}', 'PROPOSED',
        'NAVIGATE', 'REQUIRES_CONFIRMATION', NULL, 1700000000, NULL, NULL, 'REAL')`)
        .run("aaaaaaaa-0000-4000-8000-000000000003", artwork.turnId);

      await expect(resetDemoAgentHistory(connection, { artworkRoot }))
        .rejects.toThrow("DEMO_AGENT_RESET_CROSS_PROVENANCE:turn-action");
      expect(connection.sqlite.prepare("SELECT turn_id turnId,data_type dataType FROM agent_actions WHERE id=?").get(
        "aaaaaaaa-0000-4000-8000-000000000003",
      )).toEqual({ turnId: artwork.turnId, dataType: "REAL" });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_artwork_attachments").get())
        .toEqual({ count: 2 });
    } finally {
      connection.sqlite.close();
    }
    expect(await readFile(attachmentPaths[0]!)).toEqual(originalFile);
  });
});
