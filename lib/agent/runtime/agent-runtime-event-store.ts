import type { DatabaseConnection } from "@/lib/db/client";

import { AgentRuntimeEventSchema } from "./trace-sink";

type RuntimeEventRow = {
  id: string;
  sequence: number;
  runtimeId: string;
  runtimeVersion: string;
  kind: string;
  status: string;
  label: string;
  summary: string;
  toolCallId: string | null;
  toolId: string | null;
  sourceIdsJson: string;
  policyRule: string | null;
  errorCode: string | null;
  modelProvider: string | null;
  modelId: string | null;
  usageStatus: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
};

export function readAgentRuntimeEvents(connection: DatabaseConnection, turnId: string) {
  const rows = connection.sqlite.prepare(`
    SELECT id, event_sequence sequence, runtime_id runtimeId, runtime_version runtimeVersion,
      kind, status, label, summary, tool_call_id toolCallId, tool_id toolId,
      source_ids_json sourceIdsJson, policy_rule policyRule, error_code errorCode,
      model_provider modelProvider, model_id modelId, usage_status usageStatus,
      input_tokens inputTokens, output_tokens outputTokens, total_tokens totalTokens,
      latency_ms latencyMs
    FROM agent_runtime_events WHERE turn_id=? ORDER BY event_sequence
  `).all(turnId) as RuntimeEventRow[];
  return rows.map((row) => AgentRuntimeEventSchema.parse({
    id: row.id,
    sequence: row.sequence,
    runtime: { id: row.runtimeId, version: row.runtimeVersion },
    kind: row.kind,
    status: row.status,
    label: row.label,
    summary: row.summary,
    toolCallId: row.toolCallId,
    toolId: row.toolId,
    sourceIds: JSON.parse(row.sourceIdsJson),
    policyRule: row.policyRule,
    errorCode: row.errorCode,
    modelProvider: row.modelProvider,
    modelId: row.modelId,
    usage: {
      status: row.usageStatus,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
    },
    latencyMs: row.latencyMs,
  }));
}
