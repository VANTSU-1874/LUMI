// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EmbeddingProvider } from "@/lib/ai/embeddings";
import { getActiveAgentPolicy } from "@/lib/agent/policy-registry";
import { readStudentContext } from "@/lib/agent/orchestrator-context";
import { executeRegisteredAgentTool } from "@/lib/agent/tool-executor";
import { getCoursePack } from "@/lib/course-packs/registry";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { saveBookLayoutDraft } from "@/lib/services/book-layout";

const actor = { userId: "s1", role: "STUDENT" as const };
const roots: string[] = [];

describe("registered agent tools", () => {
  let connection: DatabaseConnection;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-tools-"));
    roots.push(root);
    const databasePath = path.join(root, "agent-tools.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','工具测试班','TOOLS001');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1','c1','STUDENT','学生',1700000000);
      INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES('m1','c1',1,'搭建',8,'信号');
      INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at)
        VALUES('a1','c1','m1','任务','测试','["TOUCHDESIGNER"]',1700000000);
      INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at,evidence_revision)
        VALUES('p1','c1','a1','s1','TROUBLESHOOT',1700000000,1700000000,2);
      INSERT INTO tool_path_plans(project_id,path,requirements_json,reasons_json,milestones_json,created_at,updated_at)
        VALUES('p1','TOUCHDESIGNER','{"needsRealtimeVisuals":true,"needsPhysicalControl":false,"hasOsc":false}','["本地实时视觉"]','[]',1700000000,1700000000);
      INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
        VALUES('e1','p1','c1','s1',1,'VALUE','INPUT','INPUT_OK','RULE_VERIFIED','READY','输入数值','10→80','${"a".repeat(64)}',NULL,NULL,1700000000),
          ('e2','p1','c1','s1',2,'TEXT','MAPPING',NULL,'SUBMITTED','READY','映射描述','待检查','${"b".repeat(64)}',NULL,NULL,1700000001),
          ('e3','p1','c1','s1',3,'PROBE','MAPPING','MAPPING_OK','RULE_VERIFIED','READY','映射范围验证','{"type":"MAPPING_RANGE","inputMin":0,"inputMax":1,"outputMin":0,"outputMax":360,"relationship":"DIRECT"}','${"c".repeat(64)}','{"type":"MAPPING_RANGE","inputMin":0,"inputMax":1,"outputMin":0,"outputMax":360,"relationship":"DIRECT"}',NULL,1700000002);
      INSERT INTO troubleshooting_runs(id,project_id,symptom,current_layer,state_json,status,revision,created_at,updated_at)
        VALUES('t1','p1','声音有值但画面不动','MAPPING','{"confirmedCodes":["INPUT_OK"],"usedEvidence":[{"recordId":"00000000-0000-4000-8000-000000000001","digest":"${"a".repeat(64)}"}],"noNewEvidenceRounds":0,"status":"ACTIVE","currentLayer":"MAPPING","confirmedFacts":["输入层已有服务端确认证据"],"unconfirmedHypotheses":["待验证假设：映射范围不正确"],"nextActions":["请记录映射前后的数值范围"]}','ACTIVE',1,1700000000,1700000001);
    `);
    await ingestCoursePackKnowledge(connection);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  function context(
    packId: "digital-interaction" | "book-design",
    embeddingProvider?: EmbeddingProvider,
  ) {
    const pack = getCoursePack(packId, "1");
    const question = "声音有数值但画面不动";
    return {
      connection,
      actor,
      pack,
      student: readStudentContext(connection, actor, packId, question),
      question,
      embeddingProvider,
      signal: new AbortController().signal,
    };
  }

  async function execute(
    toolId: string,
    argumentsValue: Record<string, string> = {},
    packId: "digital-interaction" | "book-design" = "digital-interaction",
    embeddingProvider?: EmbeddingProvider,
  ) {
    return executeRegisteredAgentTool({
      call: { toolId, arguments: argumentsValue },
      context: context(packId, embeddingProvider),
      policy: getActiveAgentPolicy(),
      seenFingerprints: new Set(),
    });
  }

  it("reads the owned project, tool path and five-layer evidence without private content", async () => {
    const result = await execute("project-evidence.read-state");
    expect(result.observation).toMatchObject({ status: "SUCCESS", toolId: "project-evidence.read-state" });
    expect(result.output).toMatchObject({
      project: { stage: "TROUBLESHOOT", toolPath: "TOUCHDESIGNER" },
    });
    expect((result.output as { layerCoverage: unknown[] }).layerCoverage).toEqual(expect.arrayContaining([
        { layer: "INPUT", submitted: 1, verified: 1 },
        { layer: "MAPPING", submitted: 2, verified: 1 },
    ]));
    expect(result.output).toMatchObject({
      verifiedFacts: [expect.objectContaining({
        sourceId: "evidence:e3",
        statement: "映射层已验证：输入范围0–1被映射到输出范围0–360，关系为正向关系。",
      })],
    });
    expect(JSON.stringify(result.output)).not.toContain("10→80");
    expect(JSON.stringify(result.output)).not.toContain("contentDigest");
  });

  it("reads the persisted troubleshooting observation instead of guessing a fault", async () => {
    const result = await execute("project-evidence.read-troubleshooting");
    expect(result).toMatchObject({
      observation: {
        status: "SUCCESS",
        facts: expect.arrayContaining([
          "输入层已有服务端确认证据",
          "待验证假设：映射范围不正确",
          "下一步：请记录映射前后的数值范围",
        ]),
      },
      output: { exists: true, state: { currentLayer: "MAPPING", status: "ACTIVE" } },
    });
  });

  it("retrieves versioned course concepts and a real TouchDesigner case network", async () => {
    const concepts = await execute("knowledge-map.search-concepts", { query: "声音驱动画面" });
    expect(concepts.observation.status).toBe("SUCCESS");
    expect(concepts.output).toMatchObject({
      retrieval: { strategy: "LEXICAL_FALLBACK", semanticStatus: "UNAVAILABLE", errorCode: null },
      items: expect.arrayContaining([expect.objectContaining({ title: expect.stringContaining("声音") })]),
    });

    const network = await execute("touchdesigner-cases.search-network", { query: "声音驱动画面" });
    expect(network).toMatchObject({
      observation: { status: "SUCCESS" },
      output: { match: { title: expect.stringContaining("声音驱动画面"), nodeCount: expect.any(Number), edgeCount: expect.any(Number) } },
    });
    expect(JSON.stringify(network.output)).not.toContain("relativePath");
  });

  it("uses the hybrid semantic retriever for a low-overlap internal knowledge query", async () => {
    const embeddingProvider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "tool-semantic-fixture",
      cacheKey: "tool-semantic-feedback-v1",
      async embed(inputs) {
        return inputs.map((value) => (
          /Feedback TOP：目标节点|旧画面一帧帧叠回去|残影越积越厚/.test(value)
            ? [1, 0]
            : [0, 1]
        ));
      },
    };
    const result = await execute(
      "knowledge-map.search-concepts",
      { query: "旧画面一帧帧叠回去，残影越积越厚" },
      "digital-interaction",
      embeddingProvider,
    );

    expect(result).toMatchObject({
      observation: { status: "SUCCESS" },
      output: {
        retrieval: { strategy: "HYBRID", semanticStatus: "USED", errorCode: null },
      },
    });
    expect((result.output as { items: unknown[] }).items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "td-feedback-top",
        authority: "OFFICIAL",
        locator: { kind: "URL", value: "https://docs.derivative.ca/Feedback_TOP" },
        retrieval: expect.objectContaining({
          method: expect.stringMatching(/SEMANTIC|HYBRID/),
          semanticScore: 1,
        }),
      }),
    ]));
  });

  it("reads the book draft and can use another registered Plugin when the goal requires it", async () => {
    saveBookLayoutDraft(connection, actor, {
      audience: "COMMUNITY_RESIDENTS",
      pageOrder: ["cover", "activity-map", "quick-start", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
      diagnosticAnswers: ["AUDIENCE_FIRST", null, null],
      transferChoices: ["COMMUNITY_ENTRY_FIRST"],
    });
    const book = await execute("book-layout-lab.read-state", {}, "book-design");
    expect(book).toMatchObject({
      observation: { status: "SUCCESS" },
      output: { exists: true, audience: "COMMUNITY_RESIDENTS", diagnosticCompleted: 1 },
    });
    const touchDesigner = await execute("touchdesigner-cases.search-network", { query: "声音" }, "book-design");
    expect(touchDesigner).toMatchObject({ observation: { status: "SUCCESS" } });
  });

  it("rejects the same call fingerprint before a second execution", async () => {
    const seenFingerprints = new Set<string>();
    const input = {
      call: { toolId: "knowledge-map.search-concepts", arguments: { query: "映射" } },
      context: context("digital-interaction"),
      policy: getActiveAgentPolicy(),
      seenFingerprints,
    };
    await executeRegisteredAgentTool(input);
    await expect(executeRegisteredAgentTool(input)).rejects.toMatchObject({ code: "TOOL_CALL_REPEATED" });
  });
});
