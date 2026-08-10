import type { NextRequest } from "next/server";

import { handleTeacherAuth } from "@/lib/auth/route-handler";

export async function POST(request: NextRequest) {
  return handleTeacherAuth(request);
}
