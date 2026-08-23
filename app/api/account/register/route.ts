import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  getLumiAuthRuntime,
  LUMI_INTERNAL_REGISTRATION_HEADER,
} from "@/lib/auth/better-auth";
import {
  BadRequestError,
  ForbiddenRequestError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import {
  parseLimitedRequestBody,
  validateRequestProtocol,
} from "@/lib/auth/route-handler";
import { classes } from "@/lib/db/schema";

const registrationSchema = z
  .object({
    name: z.string().trim().min(2).max(50),
    email: z.email().trim().toLowerCase(),
    password: z.string().min(8).max(128),
    role: z.enum(["STUDENT", "TEACHER"]),
    rememberMe: z.boolean().optional(),
  })
  .strict();

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

export async function POST(request: NextRequest) {
  try {
    validateRequestProtocol(request);
    const input = await parseLimitedRequestBody(
      request,
      registrationSchema,
      8 * 1024,
    );
    if (input.role === "TEACHER") {
      return NextResponse.json(
        { error: "教师账号由课程管理员预置，请使用已有账号登录" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    const runtime = getLumiAuthRuntime();

    const selfRegistrationClassId = runtime.config.studentSelfRegistrationClassId;
    if (!selfRegistrationClassId) {
      return NextResponse.json(
        { error: "学生注册暂未开放，请联系课程教师" },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    const courseClass = runtime.connection.db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.id, selfRegistrationClassId))
      .get();
    if (!courseClass) {
      return NextResponse.json(
        { error: "学生注册暂未开放，请联系课程教师" },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.set(
      LUMI_INTERNAL_REGISTRATION_HEADER,
      runtime.registrationToken,
    );
    headers.delete("content-length");

    return runtime.auth.handler(
      new Request(new URL("/api/auth/sign-up/email", request.url), {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: input.name,
          email: input.email,
          password: input.password,
          rememberMe: input.rememberMe ?? true,
          role: "STUDENT",
          classId: courseClass.id,
          alias: "pending",
        }),
      }),
    );
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) {
      return NextResponse.json(
        { error: error.message },
        { status: 415, headers: NO_STORE_HEADERS },
      );
    }
    if (error instanceof ForbiddenRequestError) {
      return NextResponse.json(
        { error: error.message },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    if (
      error instanceof BadRequestError
      || error instanceof PayloadTooLargeError
      || error instanceof z.ZodError
    ) {
      return NextResponse.json(
        { error: "注册信息无效" },
        {
          status: error instanceof PayloadTooLargeError ? 413 : 400,
          headers: NO_STORE_HEADERS,
        },
      );
    }
    console.error({
      route: "account-register",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "暂时无法创建账号" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
