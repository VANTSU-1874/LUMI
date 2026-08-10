import { after, type NextRequest } from "next/server";

import { executeAgentRun } from "@/lib/agent/runtime/agent-run-executor";
import { createAgentRunRetryResponse, type ScheduleAgentRun } from "./handler";

const scheduleAfterResponse: ScheduleAgentRun = (runId) => { after(() => executeAgentRun(runId)); };

export function POST(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  return createAgentRunRetryResponse(request, context, scheduleAfterResponse);
}
