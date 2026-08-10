// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildAgentHarnessReport, REQUIRED_AGENT_HARNESS_CASES } from "@/lib/agent/harness";
import { runAgentHarness } from "@/lib/agent/harness-runner";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { saveBookLayoutDraft } from "@/lib/services/book-layout";
import {
  CLEAN_RELEASE_SOURCE,
  V3_RELEASE_RUNTIME,
} from "@/tests/helpers/release-source-binding";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Agent abnormal-path release Harness", () => {
  it("replays all required policy, tool, action and migration scenarios against real services", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-harness-integration-"));
    roots.push(root);
    const databasePath = path.join(root, "harness.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    const previousV3 = process.env.AGENT_V3_ENABLED;
    try {
      Object.assign(process.env, { AGENT_V3_ENABLED: "true" });
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('harness-class','Agent Harness','HARNESS');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('harness-student','harness-class','STUDENT','Harness Student',1700000000),
          ('harness-other-student','harness-class','STUDENT','Harness Other Student',1700000000);
      `);
      await ingestCoursePackKnowledge(connection);
      saveBookLayoutDraft(connection, { userId: "harness-student", role: "STUDENT" }, {
        audience: "COMMUNITY_RESIDENTS",
        pageOrder: ["cover", "activity-map", "quick-start", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
        diagnosticAnswers: ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"],
        transferChoices: ["COMMUNITY_ENTRY_FIRST", "VOLUNTEER_CALL_TO_ACTION", "RETAIN_ACTIVITY_CORE"],
      });

      const report = buildAgentHarnessReport(
        await runAgentHarness(connection),
        CLEAN_RELEASE_SOURCE,
        V3_RELEASE_RUNTIME,
      );

      expect(report.passed).toBe(true);
      expect(report.caseCount).toBe(REQUIRED_AGENT_HARNESS_CASES.length);
      expect(report.passedCaseCount).toBe(REQUIRED_AGENT_HARNESS_CASES.length);
      expect(report.results.map(({ caseId }) => caseId).sort())
        .toEqual([...REQUIRED_AGENT_HARNESS_CASES].sort());
      expect(report.results.every(({ failures }) => failures.length === 0)).toBe(true);
    } finally {
      if (previousV3 === undefined) delete process.env.AGENT_V3_ENABLED;
      else Object.assign(process.env, { AGENT_V3_ENABLED: previousV3 });
      connection.sqlite.close();
    }
  });
});
