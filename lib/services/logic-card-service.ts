import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { auditEvents, logicCards, projects, toolPathPlans, users } from "@/lib/db/schema";
import { validateLogicCard } from "@/lib/domain/logic-card";
import { LogicCardSchema, type LogicCard } from "@/lib/domain/schemas";
import { assertProjectStage, nextStageAfterLogicReview } from "@/lib/services/project-workflow";
import {
  reviewSemanticLogic,
  type SemanticLogicReview,
  type SemanticLogicReviewer,
} from "@/lib/services/semantic-logic-review";

type CourseDatabase = DatabaseConnection["db"];
type CourseTransaction = Parameters<Parameters<CourseDatabase["transaction"]>[0]>[0];
type CourseQueryExecutor = CourseDatabase | CourseTransaction;

export class LogicCardForbiddenError extends Error {
  constructor() {
    super("你无权修改该项目");
    this.name = "LogicCardForbiddenError";
  }
}

export class LogicCardNotFoundError extends Error {
  constructor() {
    super("项目不存在");
    this.name = "LogicCardNotFoundError";
  }
}

export class StaleLogicReviewError extends Error {
  constructor(
    public readonly submittedRevision: number,
    public readonly currentRevision: number | null,
  ) {
    super("该逻辑卡已有更新版本，本次审查结果已丢弃");
    this.name = "StaleLogicReviewError";
  }
}

export function assertLogicCardOwnership(
  db: CourseQueryExecutor,
  actor: SessionPayload,
  projectId: string,
) {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new LogicCardNotFoundError();
  if (actor.role !== "STUDENT") throw new LogicCardForbiddenError();

  const student = db
    .select({ id: users.id, classId: users.classId, role: users.role })
    .from(users)
    .where(and(eq(users.id, actor.userId), eq(users.role, "STUDENT")))
    .get();
  if (
    !student ||
    !student.classId ||
    project.studentId !== student.id ||
    project.classId !== student.classId
  ) {
    throw new LogicCardForbiddenError();
  }
  return project;
}

function hashCard(card: LogicCard) {
  const canonical = JSON.stringify({
    culturalIntent: card.culturalIntent,
    participantAction: card.participantAction,
    inputSignal: card.inputSignal,
    mappingRule: card.mappingRule,
    outputMedium: card.outputMedium,
    experienceFeedback: card.experienceFeedback,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

const submittedPendingReview: SemanticLogicReview = {
  status: "PENDING",
  ready: false,
  issues: ["逻辑卡已保存，等待语义审查"],
  source: "submission-pending",
};

function ruleReview(issues: string[]): SemanticLogicReview {
  return {
    status: "NEEDS_REVISION",
    ready: false,
    issues,
    source: "rule-validator",
  };
}

function beginSubmission(
  db: CourseDatabase,
  actor: SessionPayload,
  projectId: string,
  card: LogicCard,
  ruleReady: boolean,
) {
  const cardHash = hashCard(card);
  const now = new Date();
  return db.transaction(
    (transaction) => {
      const project = assertLogicCardOwnership(transaction, actor, projectId);
      assertProjectStage(project.stage, ["LOGIC_CARD", "TOOL_PATH"]);
      const previous = transaction
        .select({ revision: logicCards.revision })
        .from(logicCards)
        .where(eq(logicCards.projectId, projectId))
        .get();
      const revision = (previous?.revision ?? 0) + 1;

      transaction
        .insert(logicCards)
        .values({
          projectId,
          payloadJson: card,
          ruleReady,
          semanticReady: false,
          semanticReviewJson: submittedPendingReview,
          revision,
          cardHash,
        })
        .onConflictDoUpdate({
          target: logicCards.projectId,
          set: {
            payloadJson: card,
            ruleReady,
            semanticReady: false,
            semanticReviewJson: submittedPendingReview,
            revision,
            cardHash,
          },
        })
        .run();

      if (project.stage === "TOOL_PATH") {
        transaction.delete(toolPathPlans).where(eq(toolPathPlans.projectId, projectId)).run();
      }
      transaction
        .update(projects)
        .set({ stage: "LOGIC_CARD", updatedAt: now })
        .where(eq(projects.id, projectId))
        .run();
      transaction.insert(auditEvents).values({
        id: randomUUID(),
        userId: actor.userId,
        type: "LOGIC_CARD_SUBMITTED",
        payloadJson: {
          projectId,
          revision,
          cardHash,
          stageBefore: project.stage,
          stageAfter: "LOGIC_CARD",
        },
        createdAt: now,
      }).run();

      return { revision, cardHash };
    },
    { behavior: "immediate" },
  );
}

function finishReview(
  db: CourseDatabase,
  actor: SessionPayload,
  projectId: string,
  submission: { revision: number; cardHash: string },
  ruleReady: boolean,
  review: SemanticLogicReview,
) {
  const semanticReady = ruleReady && review.status === "APPROVED" && review.ready;
  const stage = nextStageAfterLogicReview(ruleReady, semanticReady);
  const now = new Date();

  return db.transaction(
    (transaction) => {
      const current = transaction
        .select({
          revision: logicCards.revision,
          cardHash: logicCards.cardHash,
        })
        .from(logicCards)
        .where(eq(logicCards.projectId, projectId))
        .get();
      if (
        !current ||
        current.revision !== submission.revision ||
        current.cardHash !== submission.cardHash
      ) {
        throw new StaleLogicReviewError(submission.revision, current?.revision ?? null);
      }
      const project = transaction
        .select({ stage: projects.stage })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get();
      if (!project || project.stage !== "LOGIC_CARD") {
        throw new StaleLogicReviewError(submission.revision, current.revision);
      }

      const update = transaction
        .update(logicCards)
        .set({ semanticReady, semanticReviewJson: review })
        .where(
          and(
            eq(logicCards.projectId, projectId),
            eq(logicCards.revision, submission.revision),
            eq(logicCards.cardHash, submission.cardHash),
          ),
        )
        .run();
      if (update.changes !== 1) {
        throw new StaleLogicReviewError(submission.revision, current.revision);
      }
      transaction.update(projects).set({ stage, updatedAt: now }).where(eq(projects.id, projectId)).run();
      transaction.insert(auditEvents).values({
        id: randomUUID(),
        userId: actor.userId,
        type: "LOGIC_CARD_REVIEWED",
        payloadJson: {
          projectId,
          revision: submission.revision,
          cardHash: submission.cardHash,
          semanticStatus: review.status,
          semanticSource: review.source,
          stage,
        },
        createdAt: now,
      }).run();

      return {
        projectId,
        revision: submission.revision,
        cardHash: submission.cardHash,
        ruleReady,
        semanticReady,
        status: review.status,
        source: review.source,
        issues: review.issues,
        stage,
      };
    },
    { behavior: "immediate" },
  );
}

export async function submitLogicCard(
  db: CourseDatabase,
  actor: SessionPayload,
  projectId: string,
  card: LogicCard,
  reviewer: SemanticLogicReviewer,
  options: { timeoutMs?: number } = {},
) {
  const normalizedCard = LogicCardSchema.strict().parse(card);
  const validation = validateLogicCard(normalizedCard);
  const submission = beginSubmission(db, actor, projectId, normalizedCard, validation.ready);
  const review = validation.ready
    ? await reviewSemanticLogic(reviewer, normalizedCard, options)
    : ruleReview(validation.issues);
  return finishReview(
    db,
    actor,
    projectId,
    submission,
    validation.ready,
    review,
  );
}
