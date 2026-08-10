import { randomUUID } from "node:crypto";

import {
  NextResponse,
  type NextRequest,
} from "next/server";

import {
  ForbiddenRequestError,
} from "@/lib/auth/errors";
import {
  requireStudentSession,
  StudentRoleForbiddenError,
  StudentSessionRequiredError,
} from "@/lib/auth/project-session";
import type { SessionPayload } from "@/lib/auth/session";
import {
  validateRequestSource,
} from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb } from "@/lib/db/client";
import {
  agentEvidenceRuntimeProfileV2,
} from "@/lib/knowledge/agent-evidence-runtime-v2";
import {
  createActiveKnowledgeGenerationLoaderV2,
} from "@/lib/knowledge/active-knowledge-generation-v2";
import {
  KnowledgeAssetIntegrityError,
  KnowledgeAssetNotFoundError,
  openKnowledgeAssetFileV2,
} from "@/lib/knowledge/knowledge-asset-file-v2";
import {
  resolveKnowledgeV2Enablement,
} from "@/lib/knowledge/knowledge-v2-enablement";
import {
  resolveKnowledgeV2CanaryScope,
} from "@/lib/knowledge/knowledge-v2-canary";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

type OpenAsset = typeof openKnowledgeAssetFileV2;

type Dependencies = {
  authenticate?: (
    request: NextRequest,
  ) => Promise<SessionPayload>;
  canaryEligible?: (
    actor: SessionPayload,
  ) => boolean;
  openAsset?: OpenAsset;
};

const PRIVATE_IMAGE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'none'; sandbox",
  "Accept-Ranges": "none",
};

async function authenticateStudent(
  request: NextRequest,
) {
  const config = readEnv(process.env);
  return requireStudentSession(
    request,
    config.sessionSecret,
  );
}

function isKnowledgeV2CanaryUser(actor: SessionPayload) {
  const config = readEnv(process.env);
  return resolveKnowledgeV2CanaryScope({
    userId: actor.userId,
    canaryUserIds: config.knowledgeV2CanaryUserIds,
    flags: {
      knowledgeObjectV2: config.knowledgeObjectV2Enabled,
      visualRetrieval: config.visualRetrievalEnabled,
      evidenceBundleV2: config.evidenceBundleV2Enabled,
    },
  }).enrolled;
}

async function openActiveKnowledgeAsset(
  assetId: string,
) {
  const config = readEnv(process.env);
  const enablement =
    resolveKnowledgeV2Enablement({
      knowledgeObjectV2:
        config.knowledgeObjectV2Enabled,
      visualRetrieval:
        config.visualRetrievalEnabled,
      evidenceBundleV2:
        config.evidenceBundleV2Enabled,
    });
  if (
    !enablement.effective.evidenceBundleV2
    || !enablement.effective.visualRetrieval
  ) {
    throw new KnowledgeAssetNotFoundError();
  }
  const connection = createDb(
    config.databasePath,
  );
  try {
    const profile =
      agentEvidenceRuntimeProfileV2();
    const generation =
      await createActiveKnowledgeGenerationLoaderV2({
        connection,
        workspaceRoot: process.cwd(),
        requiredProviderModels: [{
          modelId: profile.visualModel.id,
          modelRevision:
            profile.visualModel.revision,
        }],
      }).load();
    return openKnowledgeAssetFileV2(
      assetId,
      {
        workspaceRoot: process.cwd(),
        corpusBundle: generation.corpus,
      },
    );
  } finally {
    connection.sqlite.close();
  }
}

export async function getKnowledgeAssetRoute(
  request: NextRequest,
  context: RouteContext,
  dependencies: Dependencies = {},
) {
  const requestId = randomUUID();
  try {
    validateRequestSource(request);
    const actor = await (
      dependencies.authenticate
      ?? authenticateStudent
    )(request);
    if (!(dependencies.canaryEligible ?? isKnowledgeV2CanaryUser)(actor)) {
      throw new KnowledgeAssetNotFoundError();
    }
    if (request.headers.has("range")) {
      return NextResponse.json(
        { error: "不支持分段读取" },
        {
          status: 416,
          headers: PRIVATE_IMAGE_HEADERS,
        },
      );
    }
    const { assetId } = await context.params;
    const file = await (
      dependencies.openAsset
      ?? openActiveKnowledgeAsset
    )(assetId);
    return new NextResponse(
      new Uint8Array(file.bytes),
      {
        status: 200,
        headers: {
          ...PRIVATE_IMAGE_HEADERS,
          "Content-Type": file.contentType,
          "Content-Length": String(file.size),
          "Content-Disposition":
            `inline; filename="${file.assetId}.png"`,
        },
      },
    );
  } catch (error) {
    if (
      error
      instanceof StudentSessionRequiredError
    ) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 401,
          headers: PRIVATE_IMAGE_HEADERS,
        },
      );
    }
    if (
      error instanceof StudentRoleForbiddenError
      || error instanceof ForbiddenRequestError
    ) {
      return NextResponse.json(
        { error: "课程参考图不存在" },
        {
          status: 404,
          headers: PRIVATE_IMAGE_HEADERS,
        },
      );
    }
    if (
      error
      instanceof KnowledgeAssetNotFoundError
    ) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 404,
          headers: PRIVATE_IMAGE_HEADERS,
        },
      );
    }
    if (
      error
      instanceof KnowledgeAssetIntegrityError
    ) {
      console.error({
        requestId,
        route: "knowledge-asset-get",
        errorName: error.name,
        errorCode: error.message,
      });
      return NextResponse.json(
        { error: "课程参考图暂时不可用" },
        {
          status: 503,
          headers: PRIVATE_IMAGE_HEADERS,
        },
      );
    }
    console.error({
      requestId,
      route: "knowledge-asset-get",
      errorName:
        error instanceof Error
          ? error.name
          : "UnknownError",
    });
    return NextResponse.json(
      { error: "课程参考图暂时不可用" },
      {
        status: 500,
        headers: PRIVATE_IMAGE_HEADERS,
      },
    );
  }
}
