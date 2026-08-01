import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  assignments,
  auditEvents,
  learnerProfiles,
  logicCards,
  projects,
  toolPathPlans,
  users,
} from "@/lib/db/schema";
import {
  AllowedToolPathsSchema,
  ToolPathPlanRecordSchema,
  ToolPathRequirementsSchema,
} from "@/lib/domain/tool-path";
import { assertProjectStage } from "@/lib/services/project-workflow";
import { chooseToolPath } from "@/lib/services/tool-path";

export { ToolPathRequirementsSchema } from "@/lib/domain/tool-path";
export { NoAllowedToolPathError } from "@/lib/services/tool-path";

type CourseDatabase = DatabaseConnection["db"];
type CourseTransaction = Parameters<Parameters<CourseDatabase["transaction"]>[0]>[0];
type CourseQueryExecutor = CourseDatabase | CourseTransaction;

export class ToolPathForbiddenError extends Error {
  constructor() {
    super("你无权为该项目规划工具路径");
    this.name = "ToolPathForbiddenError";
  }
}

export class ToolPathNotFoundError extends Error {
  constructor() {
    super("项目不存在");
    this.name = "ToolPathNotFoundError";
  }
}

export class MissingLearnerProfileError extends Error {
  constructor() {
    super("请先完成学习诊断");
    this.name = "MissingLearnerProfileError";
  }
}

export class SemanticLogicGateError extends Error {
  constructor() {
    super("逻辑卡尚未通过完整性与语义审查");
    this.name = "SemanticLogicGateError";
  }
}

export class InvalidStoredToolConfigurationError extends Error {
  constructor() {
    super("课程工具限制配置无效");
    this.name = "InvalidStoredToolConfigurationError";
  }
}

export class InvalidStoredToolPlanError extends Error {
  constructor() {
    super("工具路径记录无效");
    this.name = "InvalidStoredToolPlanError";
  }
}

export function assertToolPathOwnership(
  db: CourseQueryExecutor,
  actor: SessionPayload,
  projectId: string,
) {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new ToolPathNotFoundError();
  if (actor.role !== "STUDENT") throw new ToolPathForbiddenError();
  const student = db
    .select({ id: users.id, classId: users.classId, role: users.role })
    .from(users)
    .where(and(eq(users.id, actor.userId), eq(users.role, "STUDENT")))
    .get();
  if (!student || !student.classId || project.studentId !== student.id || project.classId !== student.classId) {
    throw new ToolPathForbiddenError();
  }
  return project;
}

export function planToolPath(
  db: CourseDatabase,
  actor: SessionPayload,
  projectId: string,
  rawRequirements: unknown,
) {
  const requirements = ToolPathRequirementsSchema.parse(rawRequirements);
  const now = new Date();

  return db.transaction(
    (transaction) => {
      const project = assertToolPathOwnership(transaction, actor, projectId);
      assertProjectStage(project.stage, "TOOL_PATH");

      const profile = transaction
        .select({ level: learnerProfiles.level })
        .from(learnerProfiles)
        .where(eq(learnerProfiles.userId, project.studentId))
        .get();
      if (!profile) throw new MissingLearnerProfileError();

      const card = transaction
        .select({ ruleReady: logicCards.ruleReady, semanticReady: logicCards.semanticReady })
        .from(logicCards)
        .where(eq(logicCards.projectId, projectId))
        .get();
      if (!card?.ruleReady || !card.semanticReady) throw new SemanticLogicGateError();

      const assignment = transaction
        .select({ allowedTools: assignments.allowedTools })
        .from(assignments)
        .where(
          and(
            eq(assignments.id, project.assignmentId),
            eq(assignments.classId, project.classId),
          ),
        )
        .get();
      const allowedTools = AllowedToolPathsSchema.safeParse(assignment?.allowedTools);
      if (!allowedTools.success) throw new InvalidStoredToolConfigurationError();

      const recommendation = chooseToolPath(profile.level, requirements, allowedTools.data);
      transaction
        .insert(toolPathPlans)
        .values({
          projectId,
          path: recommendation.path,
          requirementsJson: requirements,
          reasonsJson: recommendation.reasons,
          milestonesJson: recommendation.milestones,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: toolPathPlans.projectId,
          set: {
            path: recommendation.path,
            requirementsJson: requirements,
            reasonsJson: recommendation.reasons,
            milestonesJson: recommendation.milestones,
            updatedAt: now,
          },
        })
        .run();

      transaction.update(projects).set({ stage: "BUILD", updatedAt: now }).where(eq(projects.id, projectId)).run();
      transaction.insert(auditEvents).values({
        id: randomUUID(),
        userId: actor.userId,
        type: "TOOL_PATH_PLANNED",
        payloadJson: {
          projectId,
          path: recommendation.path,
          milestoneCount: recommendation.milestones.length,
        },
        createdAt: now,
      }).run();

      const persisted = transaction
        .select()
        .from(toolPathPlans)
        .where(eq(toolPathPlans.projectId, projectId))
        .get();
      const validated = ToolPathPlanRecordSchema.safeParse(persisted);
      if (!validated.success) throw new InvalidStoredToolPlanError();

      return {
        projectId: validated.data.projectId,
        path: validated.data.path,
        requirements: validated.data.requirementsJson,
        reasons: validated.data.reasonsJson,
        milestones: validated.data.milestonesJson,
        stage: "BUILD" as const,
        createdAt: validated.data.createdAt,
        updatedAt: validated.data.updatedAt,
        dataType: validated.data.dataType,
      };
    },
    { behavior: "immediate" },
  );
}
