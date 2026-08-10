import type { NextRequest } from "next/server";

import {
  getKnowledgeAssetRoute,
} from "./handler";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  return getKnowledgeAssetRoute(
    request,
    context,
  );
}
