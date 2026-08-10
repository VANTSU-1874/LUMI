import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const operationsRoot = path.resolve("scripts/ops");
const wrapperPath = path.join(operationsRoot, "lumi-release");
const installerPath = path.join(operationsRoot, "install-lumi-release-wrapper.sh");

describe("constrained Lumi release wrapper", () => {
  it("pins the exact wrapper installed across the root boundary", () => {
    const wrapper = readFileSync(wrapperPath);
    const installer = readFileSync(installerPath, "utf8");
    const digest = createHash("sha256").update(wrapper).digest("hex");

    expect(installer).toContain(`readonly WRAPPER_SHA256='${digest}'`);
  });

  it("allows only the paired K8.4 and Knowledge V2 release policies", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain(
      "readonly DATABASE_MIGRATION_K84='agent-interventions-0048-additive'",
    );
    expect(wrapper).toContain(
      "readonly ENVIRONMENT_WRITE_K84='enable-agent-interventions'",
    );
    expect(wrapper).toContain(
      "readonly DATABASE_MIGRATION_KV2='knowledge-v2-0050-additive'",
    );
    expect(wrapper).toContain(
      "readonly ENVIRONMENT_WRITE_KV2='enable-knowledge-v2-text'",
    );
    expect(wrapper).toContain(
      '("knowledge-v2-0050-additive", "enable-knowledge-v2-text")',
    );
    expect(wrapper).toContain("MANIFEST_RELEASE_POLICY_PAIR_NOT_ALLOWED");
    expect(wrapper).toContain("RELEASE_POLICY_PAIR_NOT_ALLOWED");
    expect(wrapper).not.toContain("database_migration=required");
    expect(wrapper).not.toContain("environment_write=requested");
  });

  it("verifies every K8.4 schema object and restores the previous flag on rollback", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");
    const migration = readFileSync(
      path.resolve("drizzle/0048_aberrant_wallow.sql"),
      "utf8",
    );
    const migrationStatements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(migrationStatements).toHaveLength(8);
    expect(migrationStatements.every((statement) => (
      /^CREATE (?:TABLE|(?:UNIQUE )?INDEX|TRIGGER)\b/.test(statement)
    ))).toBe(true);
    for (const name of [
      "agent_run_interventions",
      "agent_run_interventions_student_key_unique",
      "agent_run_interventions_task_sequence_unique",
      "agent_run_interventions_message_unique",
      "agent_run_interventions_next_run_unique",
      "agent_run_interventions_task_status_idx",
      "agent_run_interventions_owner_insert_guard",
      "agent_run_interventions_owner_update_guard",
    ]) {
      expect(wrapper).toContain(name);
    }
    expect(wrapper).toContain(
      'write_agent_interventions_env_state "$ENVIRONMENT_PREVIOUS"',
    );
    expect(wrapper).toContain("ROLLBACK_DATABASE=ADDITIVE_SCHEMA_RETAINED");
  });

  it("activates the sealed Knowledge V2 generation and restores its flag tuple", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain("readonly HEALTH_STARTUP_TIMEOUT_SECONDS=180");
    expect(wrapper).toContain('export CHUYING_SERVICE_ENV="$1"');
    expect(wrapper).toContain(
      'activate-knowledge-v2-production-generation.ts',
    );
    expect(wrapper).toContain(
      "write_knowledge_v2_boolean_env_state 'true,true,false'",
    );
    expect(wrapper).toContain(
      'write_knowledge_v2_boolean_env_state "$ENVIRONMENT_PREVIOUS"',
    );
    expect(wrapper).toContain("KNOWLEDGE_V2_CANARY_REQUIRED");
    for (const [table, count] of [
      ["knowledge_documents_v2", 808],
      ["knowledge_nodes_v2", 5164],
      ["knowledge_assets_v2", 156],
      ["knowledge_index_entries_v2", 5164],
      ["knowledge_active_corpus_v2", 1],
      ["knowledge_active_index_bundle_v2", 1],
    ] as const) {
      expect(wrapper).toContain(`${table}: ${count}`);
    }
  });

  it("replays Next traced external-module aliases before release activation", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain("verify_next_external_module_aliases()");
    expect(wrapper).toContain("NEXT_EXTERNAL_MODULE_ALIAS_MISSING");
    expect(wrapper).toContain("NEXT_EXTERNAL_MODULE_ALIAS_NOT_SYMLINK");
    expect(wrapper).toContain("NEXT_EXTERNAL_MODULE_ALIAS_TARGET_ESCAPE");
    expect(wrapper).toContain("NEXT_EXTERNAL_MODULE_ALIAS_RESOLUTION_ESCAPE");
    expect(wrapper).toContain("NEXT_BETTER_SQLITE3_ALIAS_QUERY_FAILED");
    expect(wrapper).toContain("NEXT_EXTERNAL_MODULE_ALIASES=PASS:");
    expect(wrapper).toContain(
      'verify_next_external_module_aliases "$release" | tee -a "$ACTIVE_EVIDENCE/summary.log"',
    );
  });

  it("audits a prepared Knowledge V2 release before promoting quality reports", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");
    const agentEval = readFileSync(
      path.resolve("scripts/evaluate-agent.ts"),
      "utf8",
    );
    const harness = readFileSync(
      path.resolve("scripts/run-agent-harness.ts"),
      "utf8",
    );

    expect(wrapper).toContain("lumi-release audit <prepare-run-id>");
    expect(wrapper).toContain("audit_prepared()");
    expect(wrapper).toContain("PRODUCTION_REPORTS=NOT_CHANGED");
    expect(wrapper).toContain("verify_candidate_quality_reports");
    expect(wrapper).toContain("QUALITY_REPORT_PROMOTION=SUCCEEDED");
    expect(wrapper).toContain("ROLLBACK_QUALITY_REPORTS=RESTORED");
    expect(wrapper).toContain("RELEASE_SOURCE_BINDING_PATH");
    expect(agentEval).toContain(
      "LUMI_RELEASE_AUDIT_AGENT_EVAL_REPORT_PATH",
    );
    expect(harness).toContain(
      "LUMI_RELEASE_AUDIT_AGENT_HARNESS_REPORT_PATH",
    );
  });
});
