import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  BadRequestError,
  ForbiddenRequestError,
  PayloadTooLargeError,
  RateLimitedError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import {
  requireStudentSession,
  StudentRoleForbiddenError,
  StudentSessionRequiredError,
} from "@/lib/auth/project-session";
import {
  assertDeclaredBodyWithinLimit,
  parseLimitedRequestBody,
  validateRequestProtocol,
} from "@/lib/auth/route-handler";
import { resolveTrustedSource } from "@/lib/auth/trusted-source";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { TransferRequestSchema } from "@/lib/domain/transfer";
import { consumeActionRateLimit, createActionRateLimitKey } from "@/lib/services/action-rate-limit";
import {
  EvidenceForbiddenError,
  EvidenceNotFoundError,
  assertEvidenceOwnership,
} from "@/lib/services/evidence";
import {
  InvalidStoredTransferError,
  TransferAttemptConflictError,
  TransferChallengeGenerationError,
  TransferEvidenceStaleError,
  TransferEvidenceUnavailableError,
  TransferForbiddenError,
  TransferLockedError,
  TransferNotFoundError,
  TransferPrerequisiteError,
  TransferStageError,
  getOrCreateTransferChallenge,
  submitTransferChallenge,
} from "@/lib/services/transfer";

type RouteContext = { params: Promise<{ projectId: string }> };

export function createTransferHandler(options: { maxRequests?: number } = {}) {
  return async function POST(request: NextRequest, context: RouteContext) {
    const requestId = randomUUID();
    let connection: DatabaseConnection | undefined;
    try {
      validateRequestProtocol(request);
      const config = readEnv(process.env);
      const session = await requireStudentSession(request, config.sessionSecret);
      const { projectId } = await context.params;
      connection = createDb(config.databasePath);
      assertEvidenceOwnership(connection.db, session, projectId);
      assertDeclaredBodyWithinLimit(request, 16 * 1024);
      const source = resolveTrustedSource(request.headers, {
        nodeEnv: process.env.NODE_ENV,
        secret: config.authProxySecret,
      });
      consumeActionRateLimit(
        connection.db,
        createActionRateLimitKey(source.id, session.userId, projectId, "transfer"),
        { maxRequests: options.maxRequests ?? 20, windowSeconds: 60 },
      );
      const input = await parseLimitedRequestBody(request, TransferRequestSchema, 16 * 1024);
      const state = input.action === "START"
        ? getOrCreateTransferChallenge(connection.db, session, projectId)
        : await submitTransferChallenge(connection.db, session, projectId, {
            challengeRevision: input.challengeRevision,
            expectedAttempt: input.expectedAttempt,
            answer: input.answer,
          });
      return NextResponse.json(state);
    } catch (error) {
      if (error instanceof StudentSessionRequiredError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
      }
      if (
        error instanceof StudentRoleForbiddenError ||
        error instanceof ForbiddenRequestError ||
        error instanceof TransferForbiddenError
      ) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
      }
      if (
        error instanceof EvidenceForbiddenError ||
        error instanceof EvidenceNotFoundError ||
        error instanceof TransferNotFoundError
      ) {
        return NextResponse.json({ ok: false, error: "项目不存在" }, { status: 404 });
      }
      if (error instanceof PayloadTooLargeError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 413 });
      }
      if (error instanceof UnsupportedMediaTypeError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 415 });
      }
      if (error instanceof RateLimitedError) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
        );
      }
      if (error instanceof BadRequestError) {
        return NextResponse.json({ ok: false, error: "迁移挑战请求无效" }, { status: 400 });
      }
      if (
        error instanceof TransferStageError ||
        error instanceof TransferPrerequisiteError ||
        error instanceof TransferChallengeGenerationError ||
        error instanceof TransferEvidenceUnavailableError ||
        error instanceof TransferEvidenceStaleError ||
        error instanceof TransferAttemptConflictError ||
        error instanceof TransferLockedError
      ) {
        return NextResponse.json(
          {
            ok: false,
            code: error instanceof TransferEvidenceUnavailableError ? "TRANSFER_EVIDENCE_UNAVAILABLE" :
              error instanceof TransferEvidenceStaleError ? "TRANSFER_EVIDENCE_STALE" :
              error instanceof TransferChallengeGenerationError ? "TRANSFER_GENERATION_UNAVAILABLE" :
              error instanceof TransferAttemptConflictError ? "TRANSFER_STALE" :
              error instanceof TransferLockedError ? "TRANSFER_LOCKED" : "TRANSFER_STAGE_CONFLICT",
            error: error.message,
          },
          { status: 409 },
        );
      }
      if (error instanceof InvalidStoredTransferError) {
        console.error({ requestId, route: "transfer", errorName: error.name });
      } else {
        console.error({ requestId, route: "transfer", errorName: error instanceof Error ? error.name : "UnknownError" });
      }
      return NextResponse.json({ ok: false, error: "服务暂时不可用" }, { status: 500 });
    } finally {
      connection?.sqlite.close();
    }
  };
}

export const POST = createTransferHandler();
