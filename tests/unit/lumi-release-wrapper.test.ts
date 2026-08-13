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

  it("allows only the paired K8.4, Knowledge V2, and D-27 release policies", () => {
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
      "readonly DATABASE_MIGRATION_INSPIRATION_D27='inspiration-wiki-0051-0063-d27'",
    );
    expect(wrapper).toContain(
      '("knowledge-v2-0050-additive", "enable-knowledge-v2-text")',
    );
    expect(wrapper).toContain(
      '("inspiration-wiki-0051-0063-d27", "not-requested")',
    );
    expect(wrapper).toContain("MANIFEST_RELEASE_POLICY_PAIR_NOT_ALLOWED");
    expect(wrapper).toContain("RELEASE_POLICY_PAIR_NOT_ALLOWED");
    expect(wrapper).not.toContain("database_migration=required");
    expect(wrapper).not.toContain("environment_write=requested");
  });

  it("runs the D-27 importer and requires an exact zero-write verification replay", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain("run_inspiration_wiki_d27_release()");
    expect(wrapper).toContain("verify_inspiration_wiki_d27_release()");
    expect(wrapper).toContain("apply-inspiration-wiki-production-release.ts");
    expect(wrapper).toContain('grep -Fq \'"databaseWrites": 0\'');
    expect(wrapper).toContain('grep -Fq \'"assetWrites": 0\'');
    expect(wrapper).toContain("INSPIRATION_WIKI_D27_VERIFY=PASS");
  });

  it("inherits the sealed Knowledge V2 runtime for D-27 before release verification", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain("inherit_knowledge_v2_runtime_for_d27()");
    expect(wrapper).toContain("reconstruct_knowledge_v2_corpus_for_d27()");
    expect(wrapper).toContain("KNOWLEDGE_V2_CORPUS_REPAIR=PASS");
    expect(wrapper).toContain("KNOWLEDGE_V2_CORPUS_REPAIR_HASH_DRIFT");
    expect(wrapper).toContain("WHERE bundle_hash=?");
    expect(wrapper).toContain('repair if relative == corpus_path else source');
    expect(wrapper).toContain("KNOWLEDGE_V2_RUNTIME_INHERIT=PASS");
    expect(wrapper).toContain('"$RELEASE_ROOT/$expected_current" "$release"');
    expect(wrapper).toContain('test -r "$release/runtime-manifest.json"');
    expect(wrapper).toContain(
      'test -x "$release/.runtime/knowledge-v2-linux/python/bin/python3"',
    );
    expect(wrapper).toContain("KNOWLEDGE_V2_INHERIT_SOURCE_HASH_DRIFT");
    expect(wrapper).toContain("EXPECTED_BYTES=");
    expect(wrapper).toContain("ACTUAL_SHA256=");
    expect(wrapper).toContain("KNOWLEDGE_V2_INHERIT_TARGET_ESCAPE");
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

  it("discards only a non-current release with matching failed cutover evidence", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain("lumi-release discard-failed <40-hex-commit>");
    expect(wrapper).toContain("discard_failed_release()");
    expect(wrapper).toContain('[[ "$release" != "$current" ]]');
    expect(wrapper).toContain('grep -Fqx "source_commit=$commit"');
    expect(wrapper).toContain('fields.get("PHASE") == "cutover"');
    expect(wrapper).toContain('fields.get("STATUS") == "FAILED"');
    expect(wrapper).toContain('rm -rf --one-file-system -- "$release"');
    expect(wrapper).toContain("FAILED_RELEASE_DISCARDED=YES");
    expect(wrapper).toContain("PRODUCTION_CHANGED=NO");
  });

  it("inventories releases and prunes only successful unreferenced retired commits", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain("lumi-release release-inventory");
    expect(wrapper).toContain(
      "lumi-release prune-retired <40-hex-commit> [<40-hex-commit> ...]",
    );
    expect(wrapper).toContain("successful_cutover_evidence_count()");
    expect(wrapper).toContain("release_reference_count()");
    expect(wrapper).toContain("release_seal_count()");
    expect(wrapper).toContain("prune_retired_releases()");
    expect(wrapper).toContain("PRUNE_RETIRED_REFUSES_CURRENT");
    expect(wrapper).toContain("PRUNE_RETIRED_HAS_NO_SUCCESSFUL_CUTOVER_EVIDENCE");
    expect(wrapper).toContain("PRUNE_RETIRED_RELEASE_STILL_REFERENCED");
    expect(wrapper).toContain("PRUNE_RETIRED_RELEASE_STILL_SEALED");
    expect(wrapper).toContain('grep -Fqx "source_commit=$commit" "$marker"');
    expect(wrapper).toContain('rm -rf --one-file-system -- "$release"');
    expect(wrapper).toContain("RETIRED_RELEASES_PRUNED=YES");
    expect(wrapper).toContain("PRODUCTION_CHANGED=NO");
  });

  it("discards only an incomplete non-current release with failed prepare evidence", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain(
      "lumi-release discard-incomplete-prepare <40-hex-commit>",
    );
    expect(wrapper).toContain("discard_incomplete_prepare_release()");
    expect(wrapper).toContain('fields.get("PHASE") == "prepare"');
    expect(wrapper).toContain('result.stat().st_size != 0');
    expect(wrapper).toContain('"STAGE=PREPARE_RELEASE" in summary_text');
    expect(wrapper).toContain(
      '[[ ! -e "$release/.lumi-deploy-complete"',
    );
    expect(wrapper).toContain(
      '"root:$SERVICE_GROUP:750"',
    );
    expect(wrapper).toContain("INCOMPLETE_PREPARE_HAS_SEAL");
    expect(wrapper).toContain('rm -rf --one-file-system -- "$release"');
    expect(wrapper).toContain("INCOMPLETE_PREPARE_DISCARDED=YES");
    expect(wrapper).toContain("PRODUCTION_CHANGED=NO");
  });

  it("reserves failure evidence space before disk-heavy operations", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain("readonly FAILURE_RESERVE_BYTES=1048576");
    expect(wrapper).toContain(
      'fallocate -l "$FAILURE_RESERVE_BYTES" "$path/.failure-reserve"',
    );
    expect(wrapper).toContain("release_failure_reserve()");
    expect(wrapper).toContain("release_failure_reserve\n  rollback_current");
  });

  it("discards only unsealed prepare work bound to a failed commit", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain("lumi-release discard-failed-work <40-hex-commit>");
    expect(wrapper).toContain("discard_failed_work()");
    expect(wrapper).toContain('grep -Fqx "source_commit=$commit" "$manifest"');
    expect(wrapper).toContain(
      '[[ -f "$manifest" && ! -L "$manifest" ]] || continue',
    );
    expect(wrapper).toContain('[[ ! -e "$SEAL_ROOT/$candidate_run_id.seal"');
    expect(wrapper).toContain('rm -rf --one-file-system -- "$candidate"');
    expect(wrapper).toContain("FAILED_WORK_DISCARDED=YES");
    expect(wrapper).toContain("PRODUCTION_CHANGED=NO");
  });

  it("consumes user input only after root copies and validates both archives", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");
    const sourceValidation = wrapper.indexOf(
      'validate_archive "$source_archive"',
    );
    const builtValidation = wrapper.indexOf(
      'validate_archive "$built_archive"',
    );
    const consume = wrapper.indexOf(
      'consume_verified_input_directory "$input_dir"',
    );

    expect(wrapper).toContain("consume_verified_input_directory()");
    expect(wrapper).toContain('[[ "$(find "$input_dir" -mindepth 1');
    expect(wrapper).toContain(
      '[[ "$(stat -c \'%U\' -- "$input_dir/$required")" == "$OPERATIONS_USER" ]]',
    );
    expect(sourceValidation).toBeGreaterThan(-1);
    expect(builtValidation).toBeGreaterThan(sourceValidation);
    expect(consume).toBeGreaterThan(builtValidation);
    expect(wrapper).toContain("SIGNED_INPUT_CONSUMED=YES");
  });

  it("keeps the cutover confirmation root-sealed and out of argv", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain("lumi-release cutover-sealed <prepare-run-id>");
    expect(wrapper).toContain("CUTOVER_CONFIRMATION=ROOT_SEALED");
    expect(wrapper).toContain("cutover_sealed()");
    expect(wrapper).toContain('token_file="$SEAL_ROOT/$run_id.token"');
    expect(wrapper).not.toContain("CUTOVER_CONFIRMATION_TOKEN=%s");
    expect(wrapper).not.toContain("cutover <prepare-run-id> <32-hex-confirmation-token>");
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

  it("recovers only fresh passing audit reports bound to exact failed evidence", () => {
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(wrapper).toContain(
      "lumi-release recover-audit <prepare-run-id> <failed-audit-run-id>",
    );
    expect(wrapper).toContain("recover_audit()");
    expect(wrapper).toContain('grep -Fqx "SOURCE_COMMIT=$commit"');
    expect(wrapper).toContain("verify_candidate_quality_reports");
    expect(wrapper).toContain("seal_audit_reports");
    expect(wrapper).toContain("REPORTS_REEXECUTED=NO");
    expect(wrapper).toContain("AUDIT_SEAL_RECOVERED=YES");
    expect(wrapper).toContain("PRODUCTION_REPORTS=NOT_CHANGED");
  });
});
