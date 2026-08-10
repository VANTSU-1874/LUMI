import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import { DEMO_CASES, DEMO_PROFILES } from "@/data/demo/cases";
import { LUMI_D017_STORYLINE } from "@/data/demo/lumi-d017";
import {
  discardAgentArtwork,
  storeAgentArtwork,
  type PreparedAgentArtwork,
  type StoredAgentArtwork,
} from "@/lib/agent/artwork-attachment";
import { insertAgentArtworkAttachment } from "@/lib/agent/artwork-attachment-store";
import { AgentReplySchema } from "@/lib/agent/contracts";
import { CritiqueResultSchema, type CritiqueResult } from "@/lib/agent/critique-contract";
import { insertAgentCritique, readAgentCritique } from "@/lib/agent/critique-store";
import type { StudentContext } from "@/lib/agent/orchestrator-context";
import { digestIdentityCode } from "@/lib/auth/identity-code";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  inspectImage,
  resolveStoredEvidence,
  UnsafeEvidencePathError,
  validateStoredImage,
} from "@/lib/security/uploads";
import { createDeterministicChallenge, scoreTransferResponse } from "@/lib/services/transfer";
import { validateEvidenceProbeForToolPath } from "@/lib/domain/evidence-probe";
import { digestEvidenceContent } from "@/lib/services/evidence";
import type { TransferAnswer, TransferChallengeSnapshot } from "@/lib/domain/transfer";

const CLASS_ID = "demo-class-digi2026";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSIGNMENT_ID = "demo-assignment-cultural-interaction";
const TEACHER_ID = "demo-teacher";
const FIXED_TIME = 1_783_872_000;
const ASSIGNMENT_BRIEF = "演示任务：将文化意图转换为六元交互逻辑，并保留可审计证据。";
const ALLOWED_TOOLS = JSON.stringify(["DIGISHOW", "TOUCHDESIGNER", "COLLABORATIVE"]);
const STARTER_LEARNER = {
  studentId: "demo-student-e",
  projectId: "demo-project-e",
  identityCode: "4P6R-8T2W-Y5BC",
  alias: "互动体验学习者",
} as const;
const MODULES = [
  ["demo-module-1", 1, "感知与诊断", 8, "识别输入、输出与文化意图"],
  ["demo-module-2", 2, "六元交互逻辑", 16, "建立可验证的交互因果链"],
  ["demo-module-3", 3, "工具与原型", 24, "DigiShow与TouchDesigner分层制作"],
  ["demo-module-4", 4, "证据、排障与迁移", 16, "用结构证据排查并迁移交互逻辑"],
] as const;

export class DemoSeedConflictError extends Error {
  constructor(record: string) {
    super(`DEMO_SEED_CONFLICT:${record}`);
    this.name = "DemoSeedConflictError";
  }
}

export type DemoSeedOptions = {
  databasePath: string;
  artworkRoot: string;
  identityCodePepper: string;
  allowDemoSeed: boolean;
  nodeEnv?: string;
};

function assertSeedAllowed(options: DemoSeedOptions) {
  const resolved = path.resolve(options.databasePath);
  const explicitDemoLocation = [
    path.basename(resolved),
    path.basename(path.dirname(resolved)),
  ].some((segment) => /(^|[_-])(demo|dev|test)([_.-]|$)/i.test(segment));
  if (!explicitDemoLocation) {
    throw new Error("Demo seed database path must explicitly contain demo, dev, or test");
  }
  if (options.nodeEnv === "production" || !options.allowDemoSeed) {
    throw new Error("Production demo seed is disabled; ALLOW_DEMO_SEED=true is required outside production");
  }
  return resolved;
}

function digest(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function answerFor(challenge: TransferChallengeSnapshot, rationale: string): TransferAnswer {
  const range = challenge.unitPolicy.sourceRanges.find(({ unit }) => unit === challenge.unitPolicy.sourceUnit)
    ?? challenge.unitPolicy.sourceRanges[0];
  return {
    retainedStructure: {
      culturalIntent: challenge.mustRetain.culturalIntent,
      input: challenge.mustRetain.input,
      mapping: challenge.mustRetain.mapping,
      output: challenge.mustRetain.output,
    },
    changedParts: {
      dimension: challenge.changedDimension,
      from: challenge.change.from,
      to: challenge.change.to,
      rationale,
    },
    normalization: {
      sourceMin: range.minInclusive,
      sourceMax: range.maxInclusive,
      sourceUnit: range.unit,
      targetMin: 0,
      targetMax: 1,
      targetUnit: "normalized",
      relationship: challenge.unitPolicy.allowedRelationships[0],
    },
    culturalImpact: {
      audienceType: challenge.culturalPolicy.allowedAudienceTypes[0],
      behaviorBefore: challenge.culturalPolicy.allowedTransitions[0].before,
      behaviorAfter: challenge.culturalPolicy.allowedTransitions[0].after,
      intentAnchorId: challenge.culturalPolicy.intentAnchor.id,
      mechanism: challenge.culturalPolicy.allowedMechanisms[0],
    },
  };
}

function requiredRow(
  sqlite: ReturnType<typeof createDb>["sqlite"],
  record: string,
  sql: string,
  parameters: readonly unknown[],
  expected: Record<string, unknown>,
) {
  const row = sqlite.prepare(sql).get(...parameters) as Record<string, unknown> | undefined;
  if (!row || stableJson(row) !== stableJson(expected)) throw new DemoSeedConflictError(record);
}

type D017StorylineHashInput = {
  tasks: unknown;
  conversations: unknown;
  turns: unknown;
  artworks: readonly {
    id: string;
    taskId: string;
    turnId: string;
    studentId: string;
    classId: string;
    createdAt: string;
    seedAttachment: unknown;
  }[];
  critiques: unknown;
  sessionSummaries: unknown;
  growthMemories: unknown;
};

export function digestD017Storyline(storyline: D017StorylineHashInput) {
  return digest(stableJson({
    tasks: storyline.tasks,
    conversations: storyline.conversations,
    turns: storyline.turns,
    artworks: storyline.artworks.map(({
      id, taskId, turnId, studentId, classId, createdAt, seedAttachment,
    }) => ({ id, taskId, turnId, studentId, classId, createdAt, seedAttachment })),
    critiques: storyline.critiques,
    sessionSummaries: storyline.sessionSummaries,
    growthMemories: storyline.growthMemories,
  }));
}

function epochSeconds(value: string) {
  return Math.floor(new Date(value).getTime() / 1_000);
}

const DEMO_POLICY_TRACE = {
  policyId: "competition-core",
  policyVersion: "1",
  budgets: {
    modelDecisions: 0,
    maxModelDecisions: 4,
    toolCalls: 0,
    maxToolCalls: 6,
    turnTimeoutMs: 30_000,
  },
  autonomy: {
    readOnlyTools: "AUTOMATIC",
    studentMutations: "STUDENT_CONFIRMATION",
    formalAuthority: "FORBIDDEN",
  },
  appliedRules: ["BOUND_EXECUTION"],
} as const;

function demoReply(message: string) {
  return AgentReplySchema.parse({
    eyebrow: "D-017 · 预置",
    title: "跨会话学习轨迹",
    message,
    whyThisStep: "这是一条预置演示记录，用于展示导师如何把修改范围收束到可验证的一步。",
    uncertainty: "仅依据预置作品和预置学生自述，不代表真实课堂表现。",
    graph: {
      nodes: [
        { id: "student-intent", label: "预置学生意图", kind: "CONTEXT" },
        { id: "next-step", label: "可验证下一步", kind: "ACTION" },
      ],
      links: [["student-intent", "next-step"]],
    },
    sources: [],
    actions: [],
  });
}

async function prepareD017Artwork(artwork: typeof LUMI_D017_STORYLINE.artworks[number]) {
  try {
    const bytes = new Uint8Array(await readFile(path.resolve(REPOSITORY_ROOT, artwork.seedAttachment.sourcePath)));
    const sourceDigest = createHash("sha256").update(bytes).digest("hex");
    const inspected = await inspectImage(bytes, artwork.seedAttachment.mimeType);
    if (
      inspected.mime !== artwork.seedAttachment.mimeType
      || sourceDigest !== artwork.seedAttachment.sha256
      || bytes.byteLength !== artwork.seedAttachment.byteSize
      || inspected.width !== artwork.seedAttachment.width
      || inspected.height !== artwork.seedAttachment.height
      || inspected.extension !== ".png"
    ) throw new DemoSeedConflictError(`artwork-source:${artwork.id}`);
    return {
      id: artwork.id,
      mimeType: inspected.mime,
      extension: inspected.extension,
      byteSize: inspected.bytes.byteLength,
      width: inspected.width,
      height: inspected.height,
      digest: inspected.digest,
      bytes: inspected.bytes,
    } satisfies PreparedAgentArtwork;
  } catch (error) {
    if (error instanceof DemoSeedConflictError) throw error;
    throw new DemoSeedConflictError(`artwork-source:${artwork.id}`);
  }
}

async function readExistingD017Artwork(
  artworkRoot: string,
  taskId: string,
  prepared: PreparedAgentArtwork,
): Promise<StoredAgentArtwork | undefined> {
  const storagePath = path.posix.join(`artwork-${taskId}`, `${prepared.id}${prepared.extension}`);
  try {
    const stored = await resolveStoredEvidence(artworkRoot, storagePath);
    if (stored.size !== prepared.byteSize) throw new DemoSeedConflictError(`artwork-file:${prepared.id}`);
    const bytes = new Uint8Array(await readFile(stored.absolutePath));
    const inspected = await validateStoredImage(bytes, prepared.mimeType);
    if (
      inspected.digest !== prepared.digest
      || inspected.extension !== prepared.extension
    ) throw new DemoSeedConflictError(`artwork-file:${prepared.id}`);
    return {
      id: prepared.id,
      mimeType: prepared.mimeType,
      byteSize: prepared.byteSize,
      width: prepared.width,
      height: prepared.height,
      digest: prepared.digest,
      storagePath,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof DemoSeedConflictError) throw error;
    if (error instanceof UnsafeEvidencePathError) {
      throw new DemoSeedConflictError(`artwork-file:${prepared.id}`);
    }
    throw error;
  }
}

function databaseCritique(
  record: typeof LUMI_D017_STORYLINE.critiques[number],
  privatePreviewUrl: string,
  history?: { recordId: string; createdAt: string; comparison: string },
): CritiqueResult {
  return CritiqueResultSchema.parse({
    id: record.id,
    frameworkId: record.frameworkId,
    frameworkVersion: record.frameworkVersion,
    courseId: record.courseId,
    artworkId: record.artworkId,
    createdAt: record.createdAt,
    dimensions: record.dimensions.map((dimension) => ({
      ...dimension,
      evidence: dimension.evidence.map((evidence) => evidence.kind === "ARTWORK_REGION"
        ? { ...evidence, reference: privatePreviewUrl }
        : evidence),
    })),
    closure: {
      established: record.closure.established,
      nextStep: record.closure.nextStep,
      ...(history ? {
        historyReference: {
          recordId: history.recordId,
          label: `上一版会诊 · ${history.createdAt.slice(0, 10)}`,
          comparison: history.comparison,
        },
      } : {}),
    },
  });
}

type CreatedPrivateArtwork = {
  taskId: string;
  prepared: PreparedAgentArtwork;
};

async function seedD017History(input: {
  connection: ReturnType<typeof createDb>;
  artworkRoot: string;
  createdPrivateArtworks: CreatedPrivateArtwork[];
}) {
  const { sqlite } = input.connection;
  const storyline = LUMI_D017_STORYLINE;
  for (const task of storyline.tasks) {
    sqlite.prepare(`INSERT OR IGNORE INTO design_project_tasks(
      id,student_id,class_id,title,status,created_at,updated_at,data_type
    ) VALUES(?,?,?,?,?,?,?,?)`).run(
      task.id, task.studentId, task.classId, task.title, task.status,
      epochSeconds(task.createdAt), epochSeconds(task.updatedAt), task.dataType,
    );
    requiredRow(sqlite, `d017-task:${task.id}`, `SELECT id,student_id,class_id,title,status,created_at,updated_at,data_type
      FROM design_project_tasks WHERE id=?`, [task.id], {
      id: task.id, student_id: task.studentId, class_id: task.classId, title: task.title,
      status: task.status, created_at: epochSeconds(task.createdAt), updated_at: epochSeconds(task.updatedAt),
      data_type: task.dataType,
    });
  }

  for (const conversation of storyline.conversations) {
    sqlite.prepare(`INSERT OR IGNORE INTO agent_conversations(
      id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      conversation.id, conversation.taskId, conversation.studentId, conversation.classId,
      conversation.projectId, conversation.courseId, "1",
      epochSeconds(conversation.createdAt), epochSeconds(conversation.updatedAt),
    );
    requiredRow(sqlite, `d017-conversation:${conversation.id}`, `SELECT id,task_id,student_id,class_id,
      project_id,course_pack_id,course_pack_version,created_at,updated_at,data_type
      FROM agent_conversations WHERE id=?`, [conversation.id], {
      id: conversation.id, task_id: conversation.taskId, student_id: conversation.studentId,
      class_id: conversation.classId, project_id: conversation.projectId,
      course_pack_id: conversation.courseId, course_pack_version: "1",
      created_at: epochSeconds(conversation.createdAt), updated_at: epochSeconds(conversation.updatedAt),
      data_type: conversation.dataType,
    });
  }

  for (const turn of storyline.turns) {
    const decisionCode = turn.episode === "EXPLORE" ? "EXPLORE_CLARIFY_GOAL" : "REFLECT_EXPLAIN_EVIDENCE";
    const responseStrategy = turn.episode === "EXPLORE" ? "CLARIFY" : "REFLECTION_PROMPT";
    const reply = demoReply(turn.assistantMessage);
    sqlite.prepare(`INSERT OR IGNORE INTO agent_turns(
      id,run_id,conversation_id,turn_sequence,student_message,episode,decision_code,
      policy_id,policy_version,policy_trace_json,response_strategy,response_latency_ms,
      reply_json,ai_mode,source_ids_json,created_at,data_type
    ) VALUES(?,NULL,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?)`).run(
      turn.id, turn.conversationId, turn.sequence, turn.studentMessage, turn.episode, decisionCode,
      DEMO_POLICY_TRACE.policyId, DEMO_POLICY_TRACE.policyVersion, JSON.stringify(DEMO_POLICY_TRACE),
      responseStrategy, JSON.stringify(reply), turn.aiMode, JSON.stringify([]),
      epochSeconds(turn.createdAt), turn.dataType,
    );
    requiredRow(sqlite, `d017-turn:${turn.id}`, `SELECT id,run_id,conversation_id,turn_sequence,
      student_message,episode,decision_code,policy_id,policy_version,policy_trace_json,response_strategy,
      response_latency_ms,reply_json,ai_mode,source_ids_json,created_at,data_type FROM agent_turns WHERE id=?`,
    [turn.id], {
      id: turn.id, run_id: null, conversation_id: turn.conversationId, turn_sequence: turn.sequence,
      student_message: turn.studentMessage, episode: turn.episode, decision_code: decisionCode,
      policy_id: DEMO_POLICY_TRACE.policyId, policy_version: DEMO_POLICY_TRACE.policyVersion,
      policy_trace_json: JSON.stringify(DEMO_POLICY_TRACE), response_strategy: responseStrategy,
      response_latency_ms: 0, reply_json: JSON.stringify(reply), ai_mode: turn.aiMode,
      source_ids_json: JSON.stringify([]), created_at: epochSeconds(turn.createdAt), data_type: turn.dataType,
    });
  }

  const storedById = new Map<string, StoredAgentArtwork>();
  for (const artwork of storyline.artworks) {
    const prepared = await prepareD017Artwork(artwork);
    const expectedStoragePath = path.posix.join(`artwork-${artwork.taskId}`, `${artwork.id}${prepared.extension}`);
    const existingRow = sqlite.prepare("SELECT id FROM agent_artwork_attachments WHERE id=?").get(artwork.id);
    if (existingRow) {
      requiredRow(sqlite, `d017-artwork:${artwork.id}`, `SELECT id,task_id,turn_id,student_id,class_id,
        mime_type,storage_path,digest,byte_size,width,height,created_at,updated_at,data_type
        FROM agent_artwork_attachments WHERE id=?`, [artwork.id], {
        id: artwork.id, task_id: artwork.taskId, turn_id: artwork.turnId,
        student_id: artwork.studentId, class_id: artwork.classId, mime_type: prepared.mimeType,
        storage_path: expectedStoragePath, digest: prepared.digest, byte_size: prepared.byteSize,
        width: prepared.width, height: prepared.height, created_at: epochSeconds(artwork.createdAt),
        updated_at: epochSeconds(artwork.createdAt), data_type: artwork.dataType,
      });
    }
    let stored = await readExistingD017Artwork(input.artworkRoot, artwork.taskId, prepared);
    if (!stored) {
      stored = await storeAgentArtwork(input.artworkRoot, artwork.taskId, prepared);
      input.createdPrivateArtworks.push({
        taskId: artwork.taskId,
        prepared,
      });
    }
    if (!existingRow) {
      insertAgentArtworkAttachment({
        connection: input.connection,
        owner: {
          taskId: artwork.taskId,
          studentId: artwork.studentId,
          classId: artwork.classId,
          dataType: artwork.dataType,
        },
        turnId: artwork.turnId,
        artwork: stored,
        createdAt: epochSeconds(artwork.createdAt),
      });
    }
    requiredRow(sqlite, `d017-artwork:${artwork.id}`, `SELECT id,task_id,turn_id,student_id,class_id,
      mime_type,storage_path,digest,byte_size,width,height,created_at,updated_at,data_type
      FROM agent_artwork_attachments WHERE id=?`, [artwork.id], {
      id: artwork.id, task_id: artwork.taskId, turn_id: artwork.turnId,
      student_id: artwork.studentId, class_id: artwork.classId, mime_type: stored.mimeType,
      storage_path: stored.storagePath, digest: stored.digest, byte_size: stored.byteSize,
      width: stored.width, height: stored.height, created_at: epochSeconds(artwork.createdAt),
      updated_at: epochSeconds(artwork.createdAt), data_type: artwork.dataType,
    });
    storedById.set(artwork.id, stored);
  }

  for (const [index, record] of storyline.critiques.entries()) {
    const artwork = storyline.artworks[index]!;
    const previous = index === 0 ? undefined : storyline.critiques[0];
    const historyComparison = record.closure.historyReference?.comparison;
    const expected = databaseCritique(
      record,
      artwork.seedAttachment.privatePreviewUrl,
      previous && historyComparison ? {
        recordId: previous.id,
        createdAt: previous.createdAt,
        comparison: historyComparison,
      } : undefined,
    );
    const existing = sqlite.prepare("SELECT id FROM agent_critiques WHERE id=?").get(record.id);
    if (!existing) {
      insertAgentCritique({
        connection: input.connection,
        context: {
          taskId: artwork.taskId,
          studentId: record.studentId,
          classId: record.classId,
          dataType: record.dataType,
        } as StudentContext,
        turnId: record.turnId,
        critique: expected,
        historyComparison,
        historyRecordId: previous?.id,
        createdAt: new Date(record.createdAt),
      });
    }
    const stored = readAgentCritique(input.connection, record.turnId);
    if (!stored || stableJson(stored) !== stableJson(expected)) {
      throw new DemoSeedConflictError(`d017-critique:${record.id}`);
    }
  }

  for (const summary of storyline.sessionSummaries) {
    sqlite.prepare(`INSERT OR IGNORE INTO agent_session_summaries(
      task_id,student_id,class_id,summary,through_turn_id,through_created_at,covered_turn_count,
      revision,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      summary.taskId, summary.studentId, summary.classId, summary.summary, summary.throughTurnId,
      epochSeconds(summary.throughCreatedAt), summary.coveredTurnCount, summary.revision,
      epochSeconds(summary.createdAt), epochSeconds(summary.updatedAt),
    );
    requiredRow(sqlite, `d017-summary:${summary.taskId}`, `SELECT task_id,student_id,class_id,summary,
      through_turn_id,through_created_at,covered_turn_count,revision,created_at,updated_at,data_type
      FROM agent_session_summaries WHERE task_id=?`, [summary.taskId], {
      task_id: summary.taskId, student_id: summary.studentId, class_id: summary.classId,
      summary: summary.summary, through_turn_id: summary.throughTurnId,
      through_created_at: epochSeconds(summary.throughCreatedAt), covered_turn_count: summary.coveredTurnCount,
      revision: summary.revision, created_at: epochSeconds(summary.createdAt),
      updated_at: epochSeconds(summary.updatedAt), data_type: summary.dataType,
    });
  }

  for (const memory of storyline.growthMemories) {
    sqlite.prepare(`INSERT OR IGNORE INTO agent_student_memory(
      id,student_id,class_id,kind,content,salience,source_turn_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(
      memory.id, memory.studentId, memory.classId, memory.kind, memory.content,
      memory.salience, memory.sourceTurnId, epochSeconds(memory.createdAt),
    );
    requiredRow(sqlite, `d017-memory:${memory.id}`, `SELECT id,student_id,class_id,kind,content,
      salience,source_turn_id,created_at,data_type FROM agent_student_memory WHERE id=?`, [memory.id], {
      id: memory.id, student_id: memory.studentId, class_id: memory.classId, kind: memory.kind,
      content: memory.content, salience: memory.salience, source_turn_id: memory.sourceTurnId,
      created_at: epochSeconds(memory.createdAt), data_type: memory.dataType,
    });
  }

  const auditPayload = JSON.stringify({
    dataType: storyline.dataType,
    studentId: storyline.identity.studentId,
    projectId: storyline.identity.projectId,
    storylineVersion: 1,
    storylineHash: digestD017Storyline(storyline),
  });
  sqlite.prepare("INSERT OR IGNORE INTO audit_events(id,user_id,type,payload_json,created_at) VALUES(?,?,?,?,?)")
    .run("demo-audit-d017-agent-history", storyline.identity.studentId, "DEMO_AGENT_HISTORY_SEEDED", auditPayload, FIXED_TIME);
  requiredRow(sqlite, "d017-audit", "SELECT id,user_id,type,payload_json,data_type FROM audit_events WHERE id=?",
    ["demo-audit-d017-agent-history"], {
      id: "demo-audit-d017-agent-history", user_id: storyline.identity.studentId,
      type: "DEMO_AGENT_HISTORY_SEEDED", payload_json: auditPayload, data_type: storyline.dataType,
    });

  for (const [label, sql, expected] of [
    ["tasks", "SELECT count(*) count FROM design_project_tasks WHERE student_id='demo-student-c'", 2],
    ["conversations", "SELECT count(*) count FROM agent_conversations WHERE student_id='demo-student-c'", 2],
    ["turns", "SELECT count(*) count FROM agent_turns t JOIN agent_conversations c ON c.id=t.conversation_id WHERE c.student_id='demo-student-c'", 3],
    ["artworks", "SELECT count(*) count FROM agent_artwork_attachments WHERE student_id='demo-student-c'", 2],
    ["critiques", "SELECT count(*) count FROM agent_critiques WHERE student_id='demo-student-c'", 2],
    ["summaries", "SELECT count(*) count FROM agent_session_summaries WHERE student_id='demo-student-c'", 2],
    ["memories", "SELECT count(*) count FROM agent_student_memory WHERE student_id='demo-student-c'", 3],
  ] as const) requiredRow(sqlite, `d017-count:${label}`, sql, [], { count: expected });
  if (storedById.size !== 2 || (sqlite.pragma("foreign_key_check") as unknown[]).length !== 0) {
    throw new DemoSeedConflictError("d017-foreign-keys");
  }
}

export async function seedDemoDatabase(options: DemoSeedOptions) {
  const databasePath = assertSeedAllowed(options);
  const artworkRoot = path.resolve(options.artworkRoot);
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  const { sqlite } = connection;
  // Keep the original case manifest stable so an installed v2 demo database can
  // be upgraded by adding the starter learner without conflicting with its
  // append-only audit records.
  const manifestHash = digest(stableJson({ version: 2, modules: MODULES, profiles: DEMO_PROFILES, cases: DEMO_CASES }));
  const createdPrivateArtworks: CreatedPrivateArtwork[] = [];
  let transactionActive = false;

  try {
    sqlite.exec("BEGIN IMMEDIATE");
    transactionActive = true;
      sqlite.prepare("INSERT OR IGNORE INTO classes(id,name,access_code) VALUES(?,?,?)")
        .run(CLASS_ID, "数字交互文创设计·竞赛演示班", "DIGI2026");
      requiredRow(sqlite, "class", "SELECT id,name,access_code FROM classes WHERE id=?", [CLASS_ID], {
        id: CLASS_ID, name: "数字交互文创设计·竞赛演示班", access_code: "DIGI2026",
      });

      sqlite.prepare("INSERT OR IGNORE INTO users(id,class_id,role,alias,created_at) VALUES(?,?,?,?,?)")
        .run(TEACHER_ID, CLASS_ID, "TEACHER", "演示教师", FIXED_TIME);
      requiredRow(sqlite, "teacher", "SELECT id,class_id,role,alias,data_type FROM users WHERE id=?", [TEACHER_ID], {
        id: TEACHER_ID, class_id: CLASS_ID, role: "TEACHER", alias: "演示教师", data_type: "DEMONSTRATION_DATA",
      });

      for (const [id, sequence, title, hours, focus] of MODULES) {
        sqlite.prepare("INSERT OR IGNORE INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES(?,?,?,?,?,?)")
          .run(id, CLASS_ID, sequence, title, hours, focus);
        requiredRow(sqlite, `module:${id}`, "SELECT id,class_id,sequence,title,hours,focus FROM course_modules WHERE id=?", [id], {
          id, class_id: CLASS_ID, sequence, title, hours, focus,
        });
      }
      sqlite.prepare("INSERT OR IGNORE INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(ASSIGNMENT_ID, CLASS_ID, "demo-module-2", "文化意图到可验证交互", ASSIGNMENT_BRIEF, ALLOWED_TOOLS, FIXED_TIME);
      requiredRow(sqlite, "assignment", "SELECT id,class_id,module_id,title,brief,allowed_tools FROM assignments WHERE id=?", [ASSIGNMENT_ID], {
        id: ASSIGNMENT_ID, class_id: CLASS_ID, module_id: "demo-module-2", title: "文化意图到可验证交互",
        brief: ASSIGNMENT_BRIEF, allowed_tools: ALLOWED_TOOLS,
      });

      for (const profile of DEMO_PROFILES) {
        const codeDigest = digestIdentityCode(profile.identityCode, options.identityCodePepper);
        sqlite.prepare("INSERT OR IGNORE INTO users(id,class_id,role,alias,created_at) VALUES(?,?,?,?,?)")
          .run(profile.studentId, CLASS_ID, "STUDENT", profile.alias, FIXED_TIME);
        requiredRow(sqlite, `student:${profile.studentId}`, "SELECT id,class_id,role,alias,data_type FROM users WHERE id=?", [profile.studentId], {
          id: profile.studentId, class_id: CLASS_ID, role: "STUDENT", alias: profile.alias, data_type: profile.dataType,
        });
        sqlite.prepare("INSERT OR IGNORE INTO student_identity_codes(code_digest,class_id,claimed_user_id,created_at,claimed_at) VALUES(?,?,?,?,?)")
          .run(codeDigest, CLASS_ID, profile.studentId, FIXED_TIME, FIXED_TIME);
        requiredRow(sqlite, `identity:${profile.studentId}`, "SELECT class_id,claimed_user_id FROM student_identity_codes WHERE code_digest=?", [codeDigest], {
          class_id: CLASS_ID, claimed_user_id: profile.studentId,
        });
        sqlite.prepare("INSERT OR IGNORE INTO learner_profiles(user_id,level,decomposition,signal_understanding,mapping_design,troubleshooting,transfer,updated_at) VALUES(?,?,?,?,?,?,?,?)")
          .run(profile.studentId, profile.level, profile.decomposition, profile.signalUnderstanding, profile.mappingDesign, profile.troubleshooting, profile.transfer, FIXED_TIME);
        requiredRow(sqlite, `profile:${profile.studentId}`, "SELECT user_id,level,decomposition,signal_understanding,mapping_design,troubleshooting,transfer,data_type FROM learner_profiles WHERE user_id=?", [profile.studentId], {
          user_id: profile.studentId, level: profile.level, decomposition: profile.decomposition,
          signal_understanding: profile.signalUnderstanding, mapping_design: profile.mappingDesign,
          troubleshooting: profile.troubleshooting, transfer: profile.transfer, data_type: profile.dataType,
        });
      }

      const starterDigest = digestIdentityCode(STARTER_LEARNER.identityCode, options.identityCodePepper);
      sqlite.prepare("INSERT OR IGNORE INTO users(id,class_id,role,alias,created_at) VALUES(?,?,?,?,?)")
        .run(STARTER_LEARNER.studentId, CLASS_ID, "STUDENT", STARTER_LEARNER.alias, FIXED_TIME);
      requiredRow(sqlite, "student:starter", "SELECT id,class_id,role,alias,data_type FROM users WHERE id=?", [STARTER_LEARNER.studentId], {
        id: STARTER_LEARNER.studentId, class_id: CLASS_ID, role: "STUDENT", alias: STARTER_LEARNER.alias, data_type: "DEMONSTRATION_DATA",
      });
      sqlite.prepare("INSERT OR IGNORE INTO student_identity_codes(code_digest,class_id,claimed_user_id,created_at,claimed_at) VALUES(?,?,?,?,?)")
        .run(starterDigest, CLASS_ID, STARTER_LEARNER.studentId, FIXED_TIME, FIXED_TIME);
      requiredRow(sqlite, "identity:starter", "SELECT class_id,claimed_user_id FROM student_identity_codes WHERE code_digest=?", [starterDigest], {
        class_id: CLASS_ID, claimed_user_id: STARTER_LEARNER.studentId,
      });
      sqlite.prepare("INSERT OR IGNORE INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at,evidence_revision) VALUES(?,?,?,?,?,?,?,?)")
        .run(STARTER_LEARNER.projectId, CLASS_ID, ASSIGNMENT_ID, STARTER_LEARNER.studentId, "DIAGNOSTIC", FIXED_TIME, FIXED_TIME, 0);
      requiredRow(sqlite, "project:starter", "SELECT id,class_id,assignment_id,student_id,data_type FROM projects WHERE id=?", [STARTER_LEARNER.projectId], {
        id: STARTER_LEARNER.projectId, class_id: CLASS_ID, assignment_id: ASSIGNMENT_ID, student_id: STARTER_LEARNER.studentId,
        data_type: "DEMONSTRATION_DATA",
      });

      for (const item of DEMO_CASES) {
        sqlite.prepare("INSERT OR IGNORE INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at,evidence_revision) VALUES(?,?,?,?,?,?,?,?)")
          .run(item.projectId, CLASS_ID, ASSIGNMENT_ID, item.studentId, "COMPLETE", FIXED_TIME, FIXED_TIME, 5);
        requiredRow(sqlite, `project:${item.id}`, "SELECT id,class_id,assignment_id,student_id,stage,evidence_revision,data_type FROM projects WHERE id=?", [item.projectId], {
          id: item.projectId, class_id: CLASS_ID, assignment_id: ASSIGNMENT_ID, student_id: item.studentId, stage: "COMPLETE", evidence_revision: 5, data_type: item.dataType,
        });

        const cardHash = digest(stableJson(item.approvedLogicCard));
        const review = { status: "APPROVED", ready: true, issues: [], source: "DEMONSTRATION_DATA" };
        sqlite.prepare("INSERT OR IGNORE INTO logic_cards(project_id,payload_json,rule_ready,semantic_ready,semantic_review_json,revision,card_hash) VALUES(?,?,?,?,?,?,?)")
          .run(item.projectId, JSON.stringify(item.approvedLogicCard), 1, 1, JSON.stringify(review), 1, cardHash);
        requiredRow(sqlite, `logic:${item.id}`, "SELECT project_id,payload_json,rule_ready,semantic_ready,semantic_review_json,revision,card_hash,data_type FROM logic_cards WHERE project_id=?", [item.projectId], {
          project_id: item.projectId, payload_json: JSON.stringify(item.approvedLogicCard), rule_ready: 1, semantic_ready: 1,
          semantic_review_json: JSON.stringify(review), revision: 1, card_hash: cardHash, data_type: item.dataType,
        });

        sqlite.prepare("INSERT OR IGNORE INTO tool_path_plans(project_id,path,requirements_json,reasons_json,milestones_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
          .run(item.projectId, item.path, JSON.stringify(item.requirements), JSON.stringify(item.reasons), JSON.stringify(item.milestones), FIXED_TIME, FIXED_TIME);
        requiredRow(sqlite, `path:${item.id}`, "SELECT project_id,path,requirements_json,reasons_json,milestones_json,data_type FROM tool_path_plans WHERE project_id=?", [item.projectId], {
          project_id: item.projectId, path: item.path, requirements_json: JSON.stringify(item.requirements),
          reasons_json: JSON.stringify(item.reasons), milestones_json: JSON.stringify(item.milestones),
          data_type: item.dataType,
        });

        const verifiedEvidence = item.evidence.map((record, index) => {
          const validation = validateEvidenceProbeForToolPath(
            { kind: record.kind, label: record.label, signalLayer: record.signalLayer, probe: record.probe },
            item.path,
            item.requirements,
          );
          if (validation.confirmedCode !== record.code) throw new DemoSeedConflictError(`probe-code:${item.id}:${index + 1}`);
          const content = JSON.stringify(record.probe);
          const contentDigest = digestEvidenceContent(record.kind, content);
          sqlite.prepare(`INSERT OR IGNORE INTO evidence(
            id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,
            storage_status,label,content,content_digest,probe_json,original_name,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?,'READY',?,?,?,?,NULL,?)`).run(
            record.id, item.projectId, CLASS_ID, item.studentId, index + 1, record.kind, record.signalLayer,
            validation.confirmedCode, validation.verificationStatus, record.label, content, contentDigest,
            JSON.stringify(record.probe), FIXED_TIME,
          );
          requiredRow(sqlite, `evidence:${item.id}:${index + 1}`, "SELECT id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,data_type FROM evidence WHERE id=?", [record.id], {
            id: record.id, project_id: item.projectId, student_id: item.studentId, evidence_sequence: index + 1,
            class_id: CLASS_ID, kind: record.kind, signal_layer: record.signalLayer, confirmed_code: validation.confirmedCode,
            verification_status: validation.verificationStatus, storage_status: "READY", label: record.label,
            content, content_digest: contentDigest, probe_json: JSON.stringify(record.probe), original_name: null,
            data_type: item.dataType,
          });
          return { id: record.id, sequence: index + 1, layer: record.signalLayer, code: validation.confirmedCode, digest: contentDigest };
        });

        const faultIndex = ["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"].indexOf(item.injectedFault.expectedLayer);
        const confirmed = verifiedEvidence.slice(0, Math.max(0, faultIndex));
        const troubleshootingState = {
          confirmedCodes: confirmed.map(({ code }) => code),
          usedEvidence: confirmed.map(({ id, digest: evidenceDigest }) => ({ recordId: id, digest: evidenceDigest })),
          noNewEvidenceRounds: 0,
          status: "ACTIVE",
          currentLayer: item.injectedFault.expectedLayer,
          confirmedFacts: confirmed.map(({ layer }) => `${layer}层已有演示结构证据`),
          unconfirmedHypotheses: [`演示待验证假设：${item.injectedFault.symptom}`],
          nextActions: [item.injectedFault.deterministicNextAction],
        };
        const troubleshootingId = `40000000-0000-4000-800${item.id === "a" ? "1" : item.id === "b" ? "2" : "3"}-000000000001`;
        sqlite.prepare("INSERT OR IGNORE INTO troubleshooting_runs(id,project_id,symptom,current_layer,state_json,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
          .run(troubleshootingId, item.projectId, item.injectedFault.symptom, item.injectedFault.expectedLayer, JSON.stringify(troubleshootingState), "ACTIVE", 1, FIXED_TIME, FIXED_TIME);
        requiredRow(sqlite, `troubleshooting:${item.id}`, "SELECT id,project_id,symptom,current_layer,state_json,status,revision,data_type FROM troubleshooting_runs WHERE id=?", [troubleshootingId], {
          id: troubleshootingId, project_id: item.projectId, symptom: item.injectedFault.symptom,
          current_layer: item.injectedFault.expectedLayer, state_json: JSON.stringify(troubleshootingState),
          status: "ACTIVE", revision: 1, data_type: item.dataType,
        });

        const challenge = createDeterministicChallenge({
          projectId: item.projectId,
          challengeRevision: 1,
          logicCard: item.approvedLogicCard,
          path: item.path,
          verifiedEvidence,
        });
        const answer = answerFor(challenge, item.transfer.attempt.rationale);
        const rubric = scoreTransferResponse(challenge, answer);
        if (!rubric.passed) throw new DemoSeedConflictError(`transfer-score:${item.id}`);
        const challengeId = `demo-transfer-${item.id}`;
        sqlite.prepare("INSERT OR IGNORE INTO transfer_challenges(id,project_id,class_id,student_id,revision,snapshot_hash,snapshot_json,status,attempt_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
          .run(challengeId, item.projectId, CLASS_ID, item.studentId, 1, challenge.snapshotHash, JSON.stringify(challenge), "PASSED", 1, FIXED_TIME, FIXED_TIME);
        sqlite.prepare("INSERT OR IGNORE INTO transfer_attempts(id,challenge_id,project_id,class_id,student_id,challenge_revision,attempt_number,response_json,rubric_json,passed,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
          .run(`30000000-0000-4000-800${item.id === "a" ? "1" : item.id === "b" ? "2" : "3"}-000000000001`, challengeId, item.projectId, CLASS_ID, item.studentId, 1, 1, JSON.stringify(answer), JSON.stringify(rubric), 1, FIXED_TIME);
        requiredRow(sqlite, `transfer:${item.id}`, "SELECT id,project_id,class_id,student_id,revision,snapshot_hash,snapshot_json,status,attempt_count,data_type FROM transfer_challenges WHERE id=?", [challengeId], {
          id: challengeId, project_id: item.projectId, class_id: CLASS_ID, student_id: item.studentId, revision: 1,
          snapshot_hash: challenge.snapshotHash, snapshot_json: JSON.stringify(challenge), status: "PASSED", attempt_count: 1,
          data_type: item.dataType,
        });
        const attemptId = `30000000-0000-4000-800${item.id === "a" ? "1" : item.id === "b" ? "2" : "3"}-000000000001`;
        requiredRow(sqlite, `transfer-attempt:${item.id}`, "SELECT id,challenge_id,project_id,class_id,student_id,challenge_revision,attempt_number,response_json,rubric_json,passed,data_type FROM transfer_attempts WHERE id=?", [attemptId], {
          id: attemptId, challenge_id: challengeId, project_id: item.projectId, class_id: CLASS_ID,
          student_id: item.studentId, challenge_revision: 1, attempt_number: 1,
          response_json: JSON.stringify(answer), rubric_json: JSON.stringify(rubric), passed: 1, data_type: item.dataType,
        });

        const auditPayload = JSON.stringify({ dataType: item.dataType, caseId: item.id, projectId: item.projectId, manifestHash });
        sqlite.prepare("INSERT OR IGNORE INTO audit_events(id,user_id,type,payload_json,created_at) VALUES(?,?,?,?,?)")
          .run(`demo-audit-${item.id}`, item.studentId, "DEMO_RECORD_SEEDED", auditPayload, FIXED_TIME);
        requiredRow(sqlite, `audit:${item.id}`, "SELECT id,user_id,type,payload_json,data_type FROM audit_events WHERE id=?", [`demo-audit-${item.id}`], {
          id: `demo-audit-${item.id}`, user_id: item.studentId, type: "DEMO_RECORD_SEEDED",
          payload_json: auditPayload, data_type: item.dataType,
        });
      }
    await seedD017History({ connection, artworkRoot, createdPrivateArtworks });
    sqlite.exec("COMMIT");
    transactionActive = false;
  } catch (error) {
    if (transactionActive) sqlite.exec("ROLLBACK");
    await Promise.all(createdPrivateArtworks
      .reverse()
      .map(({ taskId, prepared }) => discardAgentArtwork(artworkRoot, taskId, prepared)));
    throw error;
  } finally {
    connection.sqlite.close();
  }

  return {
    classCode: "DIGI2026",
    identityCodes: [...DEMO_PROFILES.map(({ identityCode }) => identityCode), STARTER_LEARNER.identityCode],
    starterIdentityCode: STARTER_LEARNER.identityCode,
    notice: "仅供竞赛演示，不代表真实学生成效或统计结果",
  } as const;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  void seedDemoDatabase({
    databasePath: process.env.DATABASE_PATH ?? "./data/demo.sqlite",
    artworkRoot: process.env.EVIDENCE_ROOT ?? "./data/evidence-demo",
    identityCodePepper: process.env.IDENTITY_CODE_PEPPER ?? process.env.SESSION_SECRET ?? "",
    allowDemoSeed: process.env.ALLOW_DEMO_SEED === "true",
    nodeEnv: process.env.NODE_ENV,
  }).then((result) => {
    console.log(`演示班级码：${result.classCode}`);
    console.log(`演示匿名编号：${result.identityCodes.join("、")}`);
    console.log(result.notice);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "演示数据初始化失败");
    process.exitCode = 1;
  });
}
