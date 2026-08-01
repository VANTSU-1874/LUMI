import type { NextRequest } from "next/server";

import { handleStudentAuth } from "@/lib/auth/route-handler";

export async function POST(request: NextRequest) {
  return handleStudentAuth(request);
}
