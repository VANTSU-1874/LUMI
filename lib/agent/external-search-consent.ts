import type { DatabaseConnection } from "@/lib/db/client";

import {
  externalSearchMessageDigest,
  type AgentTurnRequest,
} from "./contracts";
import type { StudentContext } from "./orchestrator-context";

const CONSENT_TTL_MS = 10 * 60 * 1_000;
const CLOCK_SKEW_MS = 30_000;

export type ExternalSearchConsentDecision = {
  confirmed: boolean;
  reason: "NOT_REQUESTED" | "CONFIRMED" | "SAME_RUN_RETRY" | "MESSAGE_MISMATCH" | "EXPIRED" | "REPLAYED";
};

type StoredConsent = {
  studentId: string;
  classId: string;
  taskId: string;
  messageDigest: string;
  issuedAtMs: number;
  runId: string | null;
  usedAtMs: number | null;
  dataType: string;
};

function validConsentWindow(issuedAt: number, nowMs: number) {
  const ageMs = nowMs - issuedAt;
  return ageMs >= -CLOCK_SKEW_MS && ageMs <= CONSENT_TTL_MS;
}

export function reserveExternalSearchConsent(input: {
  connection: DatabaseConnection;
  context: StudentContext;
  request: AgentTurnRequest;
  runId?: string;
  nowMs?: number;
}): ExternalSearchConsentDecision {
  const consent = input.request.externalSearchConsent;
  if (!consent) return { confirmed: false, reason: "NOT_REQUESTED" };
  if (consent.messageDigest !== externalSearchMessageDigest(input.request.message)) {
    return { confirmed: false, reason: "MESSAGE_MISMATCH" };
  }
  const nowMs = input.nowMs ?? Date.now();
  if (!validConsentWindow(consent.issuedAt, nowMs)) {
    return { confirmed: false, reason: "EXPIRED" };
  }
  const inserted = input.connection.sqlite.prepare(`
    INSERT OR IGNORE INTO agent_external_search_consents(
      nonce,student_id,class_id,task_id,message_digest,issued_at_ms,consumed_at_ms,run_id,used_at_ms,data_type
    ) VALUES(?,?,?,?,?,?,?,?,NULL,?)
  `).run(
    consent.nonce,
    input.context.studentId,
    input.context.classId,
    input.context.taskId,
    consent.messageDigest,
    consent.issuedAt,
    nowMs,
    input.runId ?? null,
    input.context.dataType,
  );
  if (inserted.changes === 1) return { confirmed: true, reason: "CONFIRMED" };

  const stored = input.connection.sqlite.prepare(`
    SELECT student_id studentId,class_id classId,task_id taskId,message_digest messageDigest,
      issued_at_ms issuedAtMs,run_id runId,used_at_ms usedAtMs,data_type dataType
    FROM agent_external_search_consents WHERE nonce=?
  `).get(consent.nonce) as StoredConsent | undefined;
  const sameDurableRun = Boolean(
    input.runId
    && stored
    && stored.runId === input.runId
    && stored.usedAtMs === null
    && stored.studentId === input.context.studentId
    && stored.classId === input.context.classId
    && stored.taskId === input.context.taskId
    && stored.messageDigest === consent.messageDigest
    && stored.issuedAtMs === consent.issuedAt
    && stored.dataType === input.context.dataType
  );
  return sameDurableRun
    ? { confirmed: true, reason: "SAME_RUN_RETRY" }
    : { confirmed: false, reason: "REPLAYED" };
}

export function claimExternalSearchConsent(input: {
  connection: DatabaseConnection;
  context: StudentContext;
  request: AgentTurnRequest;
  runId?: string;
  nowMs?: number;
}) {
  const consent = input.request.externalSearchConsent;
  if (!consent) return false;
  const nowMs = input.nowMs ?? Date.now();
  if (
    consent.messageDigest !== externalSearchMessageDigest(input.request.message)
    || !validConsentWindow(consent.issuedAt, nowMs)
  ) return false;
  const runClause = input.runId ? "run_id=?" : "run_id is null";
  const parameters = [
    nowMs,
    consent.nonce,
    input.context.studentId,
    input.context.classId,
    input.context.taskId,
    consent.messageDigest,
    consent.issuedAt,
    input.context.dataType,
    ...(input.runId ? [input.runId] : []),
    nowMs,
    nowMs,
  ];
  const claimed = input.connection.sqlite.prepare(`
    UPDATE agent_external_search_consents SET used_at_ms=?
    WHERE nonce=? AND student_id=? AND class_id=? AND task_id=?
      AND message_digest=? AND issued_at_ms=? AND data_type=?
      AND ${runClause} AND used_at_ms is null
      AND ? >= issued_at_ms - ${CLOCK_SKEW_MS}
      AND ? <= issued_at_ms + ${CONSENT_TTL_MS}
  `).run(...parameters);
  return claimed.changes === 1;
}
