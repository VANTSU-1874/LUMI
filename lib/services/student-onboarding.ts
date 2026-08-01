import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  agentStudentMemories,
  auditEvents,
  authUser,
  users,
} from "@/lib/db/schema";
import {
  StudentInterestsSchema,
  StudentNicknameSchema,
  StudentOnboardingProfileSchema,
  StudentOnboardingUpdateSchema,
  type StudentOnboardingProfile,
  type StudentOnboardingUpdate,
  type StudentSelfAssessedLevel,
} from "@/lib/domain/student-onboarding";
import {
  redactSensitiveText,
  studentNumberPolicyFromEnvironment,
} from "@/lib/security/redaction";

type CourseDatabase = DatabaseConnection["db"];
type CourseTransaction = Parameters<Parameters<CourseDatabase["transaction"]>[0]>[0];
type CourseExecutor = CourseDatabase | CourseTransaction;
type OnboardingSourceKey =
  | "ONBOARDING_SELF_ASSESSMENT"
  | "ONBOARDING_INTERESTS";

const ONBOARDING_SOURCE_KEYS = [
  "ONBOARDING_SELF_ASSESSMENT",
  "ONBOARDING_INTERESTS",
] as const satisfies readonly OnboardingSourceKey[];

const SELF_ASSESSMENT_CONTENT = {
  BEGINNER: "能力自评（仅作软提示）：刚开始接触",
  FOUNDATION: "能力自评（仅作软提示）：有一些基础",
  EXPERIENCED: "能力自评（仅作软提示）：能独立完成常见项目",
} as const satisfies Record<StudentSelfAssessedLevel, string>;

const SELF_ASSESSMENT_BY_CONTENT = new Map<string, StudentSelfAssessedLevel>(
  Object.entries(SELF_ASSESSMENT_CONTENT).map(([level, content]) => [
    content,
    level as StudentSelfAssessedLevel,
  ]),
);

const INTERESTS_PREFIX = "感兴趣的课程或方向（仅作软提示）：";

export class StudentOnboardingIdentityNotFoundError extends Error {
  constructor() {
    super("学生入门身份不存在");
    this.name = "StudentOnboardingIdentityNotFoundError";
  }
}

function readOwner(executor: CourseExecutor, actor: SessionPayload) {
  if (actor.role !== "STUDENT") throw new StudentOnboardingIdentityNotFoundError();
  const owner = executor.select({
    id: users.id,
    classId: users.classId,
    alias: users.alias,
    accountName: authUser.name,
    nickname: users.nickname,
    major: users.major,
    onboardingCompletedAt: users.onboardingCompletedAt,
  }).from(users)
    .leftJoin(authUser, eq(authUser.id, users.id))
    .where(and(eq(users.id, actor.userId), eq(users.role, "STUDENT")))
    .get();
  if (!owner?.classId) throw new StudentOnboardingIdentityNotFoundError();
  return { ...owner, classId: owner.classId };
}

function readProfile(executor: CourseExecutor, actor: SessionPayload): StudentOnboardingProfile {
  const owner = readOwner(executor, actor);
  let memories: Array<{ sourceKey: string | null; content: string }> = [];
  try {
    memories = executor.select({
      sourceKey: agentStudentMemories.sourceKey,
      content: agentStudentMemories.content,
    }).from(agentStudentMemories).where(and(
      eq(agentStudentMemories.studentId, owner.id),
      eq(agentStudentMemories.classId, owner.classId),
      inArray(agentStudentMemories.sourceKey, ONBOARDING_SOURCE_KEYS),
    )).all();
  } catch (error) {
    const missingOptionalMemoryStore = error instanceof Error
      && "code" in error
      && error.code === "SQLITE_ERROR"
      && error.message.includes("no such table: agent_student_memory");
    if (!missingOptionalMemoryStore) throw error;
  }
  const bySource = new Map(memories.map((memory) => [memory.sourceKey, memory.content]));
  const selfAssessmentContent = bySource.get("ONBOARDING_SELF_ASSESSMENT");
  const interestsContent = bySource.get("ONBOARDING_INTERESTS");
  const selfAssessedLevel = selfAssessmentContent
    ? SELF_ASSESSMENT_BY_CONTENT.get(selfAssessmentContent) ?? null
    : null;
  const interests = interestsContent?.startsWith(INTERESTS_PREFIX)
    ? StudentInterestsSchema.safeParse(interestsContent.slice(INTERESTS_PREFIX.length)).data ?? null
    : null;
  const displayName = owner.nickname ?? owner.accountName ?? owner.alias;

  return StudentOnboardingProfileSchema.parse({
    nickname: owner.nickname,
    displayName,
    major: owner.major,
    selfAssessedLevel,
    interests,
    completedAt: owner.onboardingCompletedAt?.toISOString() ?? null,
    completed: owner.onboardingCompletedAt !== null,
  });
}

function upsertPreferenceMemory(
  transaction: CourseTransaction,
  owner: { id: string; classId: string },
  sourceKey: OnboardingSourceKey,
  content: string | null,
  now: Date,
) {
  const existing = transaction.select({ id: agentStudentMemories.id })
    .from(agentStudentMemories)
    .where(and(
      eq(agentStudentMemories.studentId, owner.id),
      eq(agentStudentMemories.classId, owner.classId),
      eq(agentStudentMemories.sourceKey, sourceKey),
    ))
    .get();
  if (content === null) {
    if (existing) {
      transaction.delete(agentStudentMemories).where(and(
        eq(agentStudentMemories.id, existing.id),
        eq(agentStudentMemories.studentId, owner.id),
        eq(agentStudentMemories.classId, owner.classId),
        eq(agentStudentMemories.sourceKey, sourceKey),
      )).run();
    }
    return;
  }
  if (existing) {
    transaction.update(agentStudentMemories).set({
      content,
      salience: 1,
      embeddingJson: null,
      embeddingCacheKey: null,
      sourceTurnId: null,
      lastUsedAt: null,
    }).where(and(
      eq(agentStudentMemories.id, existing.id),
      eq(agentStudentMemories.studentId, owner.id),
      eq(agentStudentMemories.classId, owner.classId),
      eq(agentStudentMemories.sourceKey, sourceKey),
    )).run();
    return;
  }
  transaction.insert(agentStudentMemories).values({
    id: randomUUID(),
    studentId: owner.id,
    classId: owner.classId,
    kind: "PREFERENCE",
    content,
    salience: 1,
    sourceKey,
    sourceTurnId: null,
    createdAt: now,
    lastUsedAt: null,
  }).run();
}

export function readStudentOnboarding(
  db: CourseExecutor,
  actor: SessionPayload,
) {
  return readProfile(db, actor);
}

export function saveStudentOnboarding(
  db: CourseDatabase,
  actor: SessionPayload,
  rawInput: StudentOnboardingUpdate,
  options: {
    environment?: Record<string, string | undefined>;
    now?: Date;
  } = {},
) {
  const input = StudentOnboardingUpdateSchema.parse(rawInput);
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new TypeError("onboarding timestamp is invalid");
  const studentNumber = studentNumberPolicyFromEnvironment(options.environment ?? process.env);
  const nickname = input.nickname === null
    ? null
    : StudentNicknameSchema.parse(
        redactSensitiveText(input.nickname, { studentNumber }).trim(),
      );
  const interests = input.interests === null
    ? null
    : StudentInterestsSchema.parse(
        redactSensitiveText(input.interests, { studentNumber }).trim(),
      );

  return db.transaction((transaction) => {
    const owner = readOwner(transaction, actor);
    transaction.update(users).set({
      nickname,
      major: input.major,
      onboardingCompletedAt: input.markCompleted
        ? owner.onboardingCompletedAt ?? now
        : owner.onboardingCompletedAt,
    }).where(and(
      eq(users.id, owner.id),
      eq(users.classId, owner.classId),
      eq(users.role, "STUDENT"),
    )).run();

    upsertPreferenceMemory(
      transaction,
      owner,
      "ONBOARDING_SELF_ASSESSMENT",
      input.selfAssessedLevel === null
        ? null
        : SELF_ASSESSMENT_CONTENT[input.selfAssessedLevel],
      now,
    );
    upsertPreferenceMemory(
      transaction,
      owner,
      "ONBOARDING_INTERESTS",
      interests === null ? null : `${INTERESTS_PREFIX}${interests}`,
      now,
    );

    transaction.insert(auditEvents).values({
      id: randomUUID(),
      userId: owner.id,
      type: "STUDENT_ONBOARDING_UPDATED",
      payloadJson: {
        studentId: owner.id,
        classId: owner.classId,
        nicknameProvided: nickname !== null,
        majorProvided: input.major !== null,
        selfAssessmentProvided: input.selfAssessedLevel !== null,
        interestsProvided: interests !== null,
        markedCompleted: input.markCompleted,
      },
      createdAt: now,
    }).run();

    return readProfile(transaction, actor);
  }, { behavior: "immediate" });
}
