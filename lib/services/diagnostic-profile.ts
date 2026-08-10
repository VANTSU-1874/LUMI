import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import type { DatabaseConnection } from "@/lib/db/client";
import { auditEvents, coursePackProfiles, learnerProfiles, projects, users } from "@/lib/db/schema";
import {
  gradeDiagnosticAnswers,
  type DiagnosticAnswer,
} from "@/lib/services/diagnostic";

type CourseDatabase = DatabaseConnection["db"];

export class DiagnosticProfileAccessError extends Error {
  constructor() {
    super("仅学生可以完成学习诊断");
    this.name = "DiagnosticProfileAccessError";
  }
}

export function completeDiagnosticProfile(
  db: CourseDatabase,
  userId: string,
  questionSetVersion: string,
  answers: DiagnosticAnswer[],
) {
  const result = gradeDiagnosticAnswers(questionSetVersion, answers);
  const now = new Date();

  return db.transaction(
    (transaction) => {
      const user = transaction
        .select({ role: users.role, classId: users.classId })
        .from(users)
        .where(eq(users.id, userId))
        .get();
      if (!user || user.role !== "STUDENT") {
        throw new DiagnosticProfileAccessError();
      }

      const profileValues = {
        userId,
        level: result.level,
        decomposition: result.decomposition,
        signalUnderstanding: result.signalUnderstanding,
        mappingDesign: result.mappingDesign,
        troubleshooting: result.troubleshooting,
        transfer: result.transfer,
        updatedAt: now,
      };
      transaction
        .insert(learnerProfiles)
        .values(profileValues)
        .onConflictDoUpdate({
          target: learnerProfiles.userId,
          set: {
            level: result.level,
            decomposition: result.decomposition,
            signalUnderstanding: result.signalUnderstanding,
            mappingDesign: result.mappingDesign,
            troubleshooting: result.troubleshooting,
            transfer: result.transfer,
            updatedAt: now,
          },
        })
        .run();

      if (user.classId) {
        transaction.insert(coursePackProfiles).values({
          id: `digital-interaction:1:${userId}`,
          userId,
          classId: user.classId,
          coursePackId: "digital-interaction",
          coursePackVersion: "1",
          level: result.level,
          dimensionsJson: {
            decomposition: result.decomposition,
            "signal-understanding": result.signalUnderstanding,
            "mapping-design": result.mappingDesign,
            troubleshooting: result.troubleshooting,
            transfer: result.transfer,
          },
          updatedAt: now,
        }).onConflictDoUpdate({
          target: [coursePackProfiles.userId, coursePackProfiles.coursePackId, coursePackProfiles.coursePackVersion],
          set: {
            level: result.level,
            dimensionsJson: {
              decomposition: result.decomposition,
              "signal-understanding": result.signalUnderstanding,
              "mapping-design": result.mappingDesign,
              troubleshooting: result.troubleshooting,
              transfer: result.transfer,
            },
            updatedAt: now,
          },
        }).run();
      }

      const currentProject = user.classId
        ? transaction
            .select({ id: projects.id, stage: projects.stage })
            .from(projects)
            .where(
              and(
                eq(projects.studentId, userId),
                eq(projects.classId, user.classId),
              ),
            )
            .orderBy(
              desc(projects.updatedAt),
              desc(projects.createdAt),
              desc(projects.id),
            )
            .limit(1)
            .get()
        : undefined;
      let stageTransition: {
        projectId: string;
        from: "DIAGNOSTIC";
        to: "LOGIC_CARD";
      } | null = null;
      if (currentProject?.stage === "DIAGNOSTIC" && user.classId) {
        const updateResult = transaction
          .update(projects)
          .set({ stage: "LOGIC_CARD", updatedAt: now })
          .where(
            and(
              eq(projects.id, currentProject.id),
              eq(projects.studentId, userId),
              eq(projects.classId, user.classId),
              eq(projects.stage, "DIAGNOSTIC"),
            ),
          )
          .run();
        if (updateResult.changes === 1) {
          stageTransition = {
            projectId: currentProject.id,
            from: "DIAGNOSTIC",
            to: "LOGIC_CARD",
          };
        }
      }

      transaction
        .insert(auditEvents)
        .values({
          id: randomUUID(),
          userId,
          type: "DIAGNOSTIC_COMPLETED",
          payloadJson: {
            level: result.level,
            decomposition: result.decomposition,
            signalUnderstanding: result.signalUnderstanding,
            mappingDesign: result.mappingDesign,
            troubleshooting: result.troubleshooting,
            transfer: result.transfer,
            questionSetVersion,
            stageTransition,
          },
          createdAt: now,
        })
        .run();

      return { ...result, updatedAt: now };
    },
    { behavior: "immediate" },
  );
}
