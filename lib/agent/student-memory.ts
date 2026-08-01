import { randomUUID } from "node:crypto";

import { and, count, desc, eq } from "drizzle-orm";

import { assertTeacherClassAccess } from "@/lib/auth/teacher-access";
import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { agentConversations, agentStudentMemories, agentTurns, auditEvents, users } from "@/lib/db/schema";
import {
  StudentMemoryContentSchema,
  StudentMemoryCollectionSchema,
  StudentMemoryCreateInputSchema,
  StudentMemoryDeleteInputSchema,
  StudentMemoryDisputeInputSchema,
  StudentMemoryDisputeNoteSchema,
  StudentMemoryKindSchema,
  StudentMemoryPublicSchema,
  StudentMemoryStudentDeleteInputSchema,
  isStudentMemoryTierOneKind,
  isStudentMemoryTierTwoKind,
  type StudentMemoryCreateInput,
  type StudentMemoryDeleteInput,
  type StudentMemoryDisputeInput,
  type StudentMemoryStudentDeleteInput,
} from "@/lib/domain/student-memory";
import { redactSensitiveText, studentNumberPolicyFromEnvironment } from "@/lib/security/redaction";

import type { StudentMemoryWriteCandidate } from "./student-memory-candidates";

type CourseDatabase = DatabaseConnection["db"];
type CourseTransaction = Parameters<Parameters<CourseDatabase["transaction"]>[0]>[0];
type CourseExecutor = CourseDatabase | CourseTransaction;

export class StudentMemoryOwnerNotFoundError extends Error {
  constructor() { super("STUDENT_MEMORY_OWNER_NOT_FOUND"); this.name = "StudentMemoryOwnerNotFoundError"; }
}

export class StudentMemorySourceTurnNotFoundError extends Error {
  constructor() { super("STUDENT_MEMORY_SOURCE_TURN_NOT_FOUND"); this.name = "StudentMemorySourceTurnNotFoundError"; }
}

export class StudentMemoryStudentIdentityNotFoundError extends Error {
  constructor() { super("学生记忆身份不存在"); this.name = "StudentMemoryStudentIdentityNotFoundError"; }
}

export class StudentMemoryStudentActionForbiddenError extends Error {
  readonly code:
    | "STUDENT_MEMORY_TIER_2_DELETE_FORBIDDEN"
    | "STUDENT_MEMORY_TIER_1_DISPUTE_FORBIDDEN";

  constructor(code: StudentMemoryStudentActionForbiddenError["code"]) {
    super(code === "STUDENT_MEMORY_TIER_2_DELETE_FORBIDDEN"
      ? "学习信号只能提出异议，不能由学生删除"
      : "个人化记忆可以直接删除，不使用异议标记");
    this.name = "StudentMemoryStudentActionForbiddenError";
    this.code = code;
  }
}

function canonicalMemoryContent(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function compactMemoryContent(value: string) {
  return canonicalMemoryContent(value).replace(/[\p{P}\p{S}\s]/gu, "");
}

function memoryFactCore(value: string) {
  return canonicalMemoryContent(value)
    .replace(/(?:我这次的|我这次|这次的|我的|目前|正在|项目|作品|课题|主要|使用|采用|面向|计划|聚焦|包含|已经|一直|总是|反复|每次|经常|卡住|卡在|搞不懂|出错|失败|都会|不会|一个|一份|这次|又|我|了|是|在|做|用|的|要)/g, "")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function memoryCoreTokens(value: string) {
  const core = memoryFactCore(value);
  const units = new Set<string>();
  const bigrams = new Set<string>();
  for (const token of core.match(/[a-z0-9][a-z0-9._+-]*/g) ?? []) {
    units.add(token);
  }
  for (const segment of core.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (const character of segment) units.add(character);
    for (let index = 0; index < segment.length - 1; index += 1) {
      bigrams.add(segment.slice(index, index + 2));
    }
  }
  return { units, bigrams };
}

function overlapRatios(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  const smallerSize = Math.min(left.size, right.size);
  if (smallerSize === 0) return { containment: 0, jaccard: 0 };
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return {
    containment: overlap / smallerSize,
    jaccard: overlap / (left.size + right.size - overlap),
  };
}

function isNearDuplicateMemory(left: string, right: string) {
  const canonicalLeft = canonicalMemoryContent(left);
  const canonicalRight = canonicalMemoryContent(right);
  if (canonicalLeft === canonicalRight) return true;
  const negativePattern = /(?:不再|不喜欢|讨厌|不想|不要|不希望|拒绝|避免|未能|尚未|没有|没能|不是|不能|不会|不懂)/;
  if (negativePattern.test(canonicalLeft) !== negativePattern.test(canonicalRight)) return false;
  const leftNumbers = canonicalLeft.match(/\d+(?:\.\d+)?/g) ?? [];
  const rightNumbers = canonicalRight.match(/\d+(?:\.\d+)?/g) ?? [];
  if (leftNumbers.join("\u0000") !== rightNumbers.join("\u0000")) return false;

  const leftTokens = memoryCoreTokens(left);
  const rightTokens = memoryCoreTokens(right);
  if (Math.min(leftTokens.units.size, rightTokens.units.size) < 3) return false;
  const units = overlapRatios(leftTokens.units, rightTokens.units);
  const bigrams = overlapRatios(leftTokens.bigrams, rightTokens.bigrams);
  return units.containment >= 0.9
    && units.jaccard >= 0.8
    && (Math.min(leftTokens.bigrams.size, rightTokens.bigrams.size) < 2
      || bigrams.containment >= 0.8);
}

function validCandidateEmbedding(candidate: StudentMemoryWriteCandidate) {
  const cacheKey = candidate.embedding?.cacheKey.trim() ?? "";
  const vector = candidate.embedding?.vector;
  if (
    !vector
    || cacheKey.length < 1
    || cacheKey.length > 128
    || vector.length < 1
    || vector.length > 16_384
    || vector.some((value) => !Number.isFinite(value))
    || vector.every((value) => value === 0)
  ) return null;
  const embeddingJson = JSON.stringify(vector);
  if (embeddingJson.length > 500_000) return null;
  return { cacheKey, embeddingJson };
}

function epochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

export function applyStudentMemoryWriteback(input: {
  connection: DatabaseConnection;
  studentId: string;
  classId: string;
  sourceTurnId: string;
  recalledMemoryIds: readonly string[];
  candidates: readonly StudentMemoryWriteCandidate[];
  now: Date;
  environment?: Record<string, string | undefined>;
}) {
  const timestamp = epochSeconds(input.now);
  const studentNumber = studentNumberPolicyFromEnvironment(input.environment ?? process.env);
  const owner = input.connection.sqlite.prepare(`
    SELECT 1 FROM users WHERE id=? AND class_id=? AND role='STUDENT'
  `).get(input.studentId, input.classId);
  if (!owner) throw new StudentMemoryOwnerNotFoundError();
  const source = input.connection.sqlite.prepare(`
    SELECT 1 FROM agent_turns t
    JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE t.id=? AND c.student_id=? AND c.class_id=?
  `).get(input.sourceTurnId, input.studentId, input.classId);
  if (!source) throw new StudentMemorySourceTurnNotFoundError();

  const recalledIds = Array.from(new Set(input.recalledMemoryIds)).slice(0, 5);
  if (recalledIds.length > 0) {
    const placeholders = recalledIds.map(() => "?").join(",");
    input.connection.sqlite.prepare(`
      UPDATE agent_student_memory
      SET last_used_at=max(created_at, ?)
      WHERE student_id=? AND class_id=? AND id IN (${placeholders})
    `).run(timestamp, input.studentId, input.classId, ...recalledIds);
  }

  for (const candidate of input.candidates.slice(0, 3)) {
    const parsedKind = StudentMemoryKindSchema.safeParse(candidate.kind);
    const parsedContent = StudentMemoryContentSchema.safeParse(
      redactSensitiveText(candidate.content, { studentNumber }).trim(),
    );
    if (!parsedKind.success || !parsedContent.success || !Number.isInteger(candidate.salience)) continue;
    const kind = parsedKind.data;
    const salience = Math.min(10, Math.max(1, candidate.salience));
    const existingRows = input.connection.sqlite.prepare(`
      SELECT id,content,salience FROM agent_student_memory
      WHERE student_id=? AND class_id=? AND kind=? AND source_key IS NULL
      ORDER BY created_at DESC, id DESC
    `).all(input.studentId, input.classId, kind) as Array<{
      id: string;
      content: string;
      salience: number;
    }>;
    const duplicate = existingRows.find((row) => isNearDuplicateMemory(row.content, parsedContent.data));
    const embedding = canonicalMemoryContent(candidate.content) === canonicalMemoryContent(parsedContent.data)
      ? validCandidateEmbedding(candidate)
      : null;
    if (duplicate) {
      const matchingEmbedding = compactMemoryContent(duplicate.content) === compactMemoryContent(parsedContent.data)
        ? embedding
        : null;
      input.connection.sqlite.prepare(matchingEmbedding ? `
        UPDATE agent_student_memory SET salience=?,source_turn_id=?,embedding_json=?,embedding_cache_key=?
        WHERE id=? AND student_id=? AND class_id=? AND kind=?
      ` : `
        UPDATE agent_student_memory SET salience=?,source_turn_id=?
        WHERE id=? AND student_id=? AND class_id=? AND kind=?
      `).run(
        Math.min(10, Math.max(duplicate.salience + 1, salience)),
        input.sourceTurnId,
        ...(matchingEmbedding ? [matchingEmbedding.embeddingJson, matchingEmbedding.cacheKey] : []),
        duplicate.id,
        input.studentId,
        input.classId,
        kind,
      );
      continue;
    }
    input.connection.sqlite.prepare(`
      INSERT INTO agent_student_memory(
        id,student_id,class_id,kind,content,salience,embedding_json,embedding_cache_key,
        source_turn_id,created_at,last_used_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)
    `).run(
      randomUUID(),
      input.studentId,
      input.classId,
      kind,
      parsedContent.data,
      salience,
      embedding?.embeddingJson ?? null,
      embedding?.cacheKey ?? null,
      input.sourceTurnId,
      timestamp,
    );
  }
}

function publicMemory(row: typeof agentStudentMemories.$inferSelect) {
  return StudentMemoryPublicSchema.parse({
    id: row.id,
    studentId: row.studentId,
    classId: row.classId,
    kind: row.kind,
    content: row.content,
    salience: row.salience,
    sourceTurnId: row.sourceTurnId,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    studentDisputed: row.studentDisputed,
    studentDisputeNote: row.studentDisputeNote,
    studentDisputedAt: row.studentDisputedAt?.toISOString() ?? null,
    dataType: row.dataType,
  });
}

function readStudentMemoryOwner(db: CourseExecutor, actor: SessionPayload) {
  if (actor.role !== "STUDENT") throw new StudentMemoryStudentIdentityNotFoundError();
  const owner = db.select({
    id: users.id,
    classId: users.classId,
    dataType: users.dataType,
  }).from(users).where(and(
    eq(users.id, actor.userId),
    eq(users.role, "STUDENT"),
  )).get();
  if (!owner?.classId) throw new StudentMemoryStudentIdentityNotFoundError();
  return { id: owner.id, classId: owner.classId, dataType: owner.dataType };
}

export function storeStudentMemory(
  db: CourseDatabase,
  rawInput: StudentMemoryCreateInput,
  options: { environment?: Record<string, string | undefined>; now?: Date } = {},
) {
  const input = StudentMemoryCreateInputSchema.parse(rawInput);
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new TypeError("student memory timestamp is invalid");
  const studentNumber = studentNumberPolicyFromEnvironment(options.environment ?? process.env);
  const content = StudentMemoryContentSchema.parse(redactSensitiveText(input.content, { studentNumber }).trim());

  return db.transaction((transaction) => {
    const student = transaction.select({ id: users.id }).from(users).where(and(
      eq(users.id, input.studentId),
      eq(users.classId, input.classId),
      eq(users.role, "STUDENT"),
    )).get();
    if (!student) throw new StudentMemoryOwnerNotFoundError();

    if (input.sourceTurnId) {
      const source = transaction.select({ id: agentTurns.id }).from(agentTurns)
        .innerJoin(agentConversations, eq(agentConversations.id, agentTurns.conversationId))
        .where(and(
          eq(agentTurns.id, input.sourceTurnId),
          eq(agentConversations.studentId, input.studentId),
          eq(agentConversations.classId, input.classId),
        )).get();
      if (!source) throw new StudentMemorySourceTurnNotFoundError();
    }

    const id = randomUUID();
    transaction.insert(agentStudentMemories).values({
      id,
      studentId: input.studentId,
      classId: input.classId,
      kind: input.kind,
      content,
      salience: input.salience,
      sourceTurnId: input.sourceTurnId ?? null,
      createdAt: now,
      lastUsedAt: null,
    }).run();
    const inserted = transaction.select().from(agentStudentMemories).where(eq(agentStudentMemories.id, id)).get();
    if (!inserted) throw new Error("student memory insert failed");
    return publicMemory(inserted);
  }, { behavior: "immediate" });
}

export function listStudentMemories(
  db: CourseExecutor,
  classId: string,
  studentId: string,
  options: { includeDemo?: boolean; limit?: number; offset?: number } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
  const offset = Number.isSafeInteger(options.offset) && (options.offset ?? 0) >= 0 ? options.offset! : 0;
  return db.select().from(agentStudentMemories).where(and(
    eq(agentStudentMemories.classId, classId),
    eq(agentStudentMemories.studentId, studentId),
    options.includeDemo ? undefined : eq(agentStudentMemories.dataType, "REAL"),
  )).orderBy(
    desc(agentStudentMemories.salience),
    desc(agentStudentMemories.lastUsedAt),
    desc(agentStudentMemories.createdAt),
    desc(agentStudentMemories.id),
  ).limit(limit).offset(offset).all().map(publicMemory);
}

export function readStudentMemoryCollection(
  db: CourseExecutor,
  classId: string,
  studentId: string,
  options: { includeDemo?: boolean; limit?: number; offset?: number } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
  const offset = Number.isSafeInteger(options.offset) && (options.offset ?? 0) >= 0 ? options.offset! : 0;
  const scope = and(
    eq(agentStudentMemories.classId, classId),
    eq(agentStudentMemories.studentId, studentId),
    options.includeDemo ? undefined : eq(agentStudentMemories.dataType, "REAL"),
  );
  const total = db.select({ value: count() }).from(agentStudentMemories).where(scope).get()?.value ?? 0;
  const items = listStudentMemories(db, classId, studentId, { ...options, limit, offset });
  return StudentMemoryCollectionSchema.parse({
    items,
    meta: { total, returned: items.length, truncated: total > offset + items.length },
  });
}

export function readOwnedStudentMemoryCollection(
  db: CourseExecutor,
  actor: SessionPayload,
  options: { limit?: number; offset?: number } = {},
) {
  const owner = readStudentMemoryOwner(db, actor);
  return readStudentMemoryCollection(db, owner.classId, owner.id, {
    ...options,
    includeDemo: owner.dataType === "DEMONSTRATION_DATA",
  });
}

export function deleteOwnedStudentMemory(
  db: CourseDatabase,
  actor: SessionPayload,
  rawInput: StudentMemoryStudentDeleteInput,
  options: { now?: Date } = {},
) {
  const input = StudentMemoryStudentDeleteInputSchema.parse(rawInput);
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new TypeError("student memory deletion timestamp is invalid");
  return db.transaction((transaction) => {
    const owner = readStudentMemoryOwner(transaction, actor);
    const target = transaction.select({
      id: agentStudentMemories.id,
      kind: agentStudentMemories.kind,
      dataType: agentStudentMemories.dataType,
    }).from(agentStudentMemories).where(and(
      eq(agentStudentMemories.id, input.memoryId),
      eq(agentStudentMemories.classId, owner.classId),
      eq(agentStudentMemories.studentId, owner.id),
    )).get();
    if (!target || target.kind !== input.kind) return false;
    if (!isStudentMemoryTierOneKind(target.kind)) {
      throw new StudentMemoryStudentActionForbiddenError("STUDENT_MEMORY_TIER_2_DELETE_FORBIDDEN");
    }
    const deleted = transaction.delete(agentStudentMemories).where(and(
      eq(agentStudentMemories.id, target.id),
      eq(agentStudentMemories.classId, owner.classId),
      eq(agentStudentMemories.studentId, owner.id),
      eq(agentStudentMemories.kind, target.kind),
    )).run();
    if (deleted.changes !== 1) return false;
    transaction.insert(auditEvents).values({
      id: randomUUID(),
      userId: owner.id,
      type: "STUDENT_MEMORY_DELETED_BY_STUDENT",
      payloadJson: {
        memoryId: target.id,
        studentId: owner.id,
        classId: owner.classId,
        kind: target.kind,
        targetDataType: target.dataType,
      },
      createdAt: now,
    }).run();
    return true;
  }, { behavior: "immediate" });
}

export function disputeOwnedStudentMemory(
  db: CourseDatabase,
  actor: SessionPayload,
  rawInput: StudentMemoryDisputeInput,
  options: {
    environment?: Record<string, string | undefined>;
    now?: Date;
  } = {},
) {
  const input = StudentMemoryDisputeInputSchema.parse(rawInput);
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new TypeError("student memory dispute timestamp is invalid");
  const studentNumber = studentNumberPolicyFromEnvironment(options.environment ?? process.env);
  const note = input.note === null
    ? null
    : StudentMemoryDisputeNoteSchema.parse(
        redactSensitiveText(input.note, { studentNumber }).trim(),
      );
  return db.transaction((transaction) => {
    const owner = readStudentMemoryOwner(transaction, actor);
    const target = transaction.select({
      id: agentStudentMemories.id,
      kind: agentStudentMemories.kind,
    }).from(agentStudentMemories).where(and(
      eq(agentStudentMemories.id, input.memoryId),
      eq(agentStudentMemories.classId, owner.classId),
      eq(agentStudentMemories.studentId, owner.id),
    )).get();
    if (!target || target.kind !== input.kind) return null;
    if (!isStudentMemoryTierTwoKind(target.kind)) {
      throw new StudentMemoryStudentActionForbiddenError("STUDENT_MEMORY_TIER_1_DISPUTE_FORBIDDEN");
    }
    transaction.update(agentStudentMemories).set({
      studentDisputed: true,
      studentDisputeNote: note,
      studentDisputedAt: now,
    }).where(and(
      eq(agentStudentMemories.id, target.id),
      eq(agentStudentMemories.classId, owner.classId),
      eq(agentStudentMemories.studentId, owner.id),
      eq(agentStudentMemories.kind, target.kind),
    )).run();
    transaction.insert(auditEvents).values({
      id: randomUUID(),
      userId: owner.id,
      type: "STUDENT_MEMORY_DISPUTED",
      payloadJson: {
        memoryId: target.id,
        studentId: owner.id,
        classId: owner.classId,
        kind: target.kind,
        hasNote: note !== null,
      },
      createdAt: now,
    }).run();
    const updated = transaction.select().from(agentStudentMemories).where(and(
      eq(agentStudentMemories.id, target.id),
      eq(agentStudentMemories.classId, owner.classId),
      eq(agentStudentMemories.studentId, owner.id),
    )).get();
    if (!updated) return null;
    return publicMemory(updated);
  }, { behavior: "immediate" });
}

export function deleteStudentMemoryForTeacher(
  db: CourseDatabase,
  actor: SessionPayload,
  rawInput: StudentMemoryDeleteInput,
) {
  const input = StudentMemoryDeleteInputSchema.parse(rawInput);
  return db.transaction((transaction) => {
    assertTeacherClassAccess(transaction, actor, input.classId);
    const target = transaction.select({
      id: agentStudentMemories.id,
      kind: agentStudentMemories.kind,
      dataType: agentStudentMemories.dataType,
    }).from(agentStudentMemories).where(and(
      eq(agentStudentMemories.id, input.memoryId),
      eq(agentStudentMemories.classId, input.classId),
      eq(agentStudentMemories.studentId, input.studentId),
    )).get();
    if (!target) return false;
    const deleted = transaction.delete(agentStudentMemories).where(and(
      eq(agentStudentMemories.id, input.memoryId),
      eq(agentStudentMemories.classId, input.classId),
      eq(agentStudentMemories.studentId, input.studentId),
    )).run();
    if (deleted.changes !== 1) return false;
    transaction.insert(auditEvents).values({
      id: randomUUID(),
      userId: actor.userId,
      type: "STUDENT_MEMORY_DELETED",
      payloadJson: {
        memoryId: target.id,
        studentId: input.studentId,
        classId: input.classId,
        kind: target.kind,
        targetDataType: target.dataType,
      },
      createdAt: new Date(),
    }).run();
    return true;
  }, { behavior: "immediate" });
}
