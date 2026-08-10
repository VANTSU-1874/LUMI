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
  InvalidTeacherCodeError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import {
  parseLimitedRequestBody,
  validateRequestProtocol,
} from "@/lib/auth/route-handler";
import { classes } from "@/lib/db/schema";
import { enterTeacher } from "@/lib/services/access";

const registrationSchema = z
  .object({
    name: z.string().trim().min(2).max(50),
    email: z.email().trim().toLowerCase(),
    password: z.string().min(8).max(128),
    role: z.enum(["STUDENT", "TEACHER"]),
    classCode: z.string().trim().min(1).max(64).optional(),
    teacherCode: z.string().trim().min(1).max(128).optional(),
    rememberMe: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.role === "STUDENT" && !input.classCode) {
      context.addIssue({
        code: "custom",
        message: "请输入班级邀请码",
        path: ["classCode"],
      });
    }
    if (input.role === "TEACHER" && !input.teacherCode) {
      context.addIssue({
        code: "custom",
        message: "请输入教师访问码",
        path: ["teacherCode"],
      });
    }
  });

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
    const runtime = getLumiAuthRuntime();

    let classId: string | undefined;
    if (input.role === "STUDENT") {
      const courseClass = runtime.connection.db
        .select({ id: classes.id })
        .from(classes)
        .where(eq(classes.accessCode, input.classCode!))
        .get();
      if (!courseClass) {
        return NextResponse.json(
          { error: "班级邀请码无效" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      classId = courseClass.id;
    } else {
      enterTeacher(input.teacherCode!, runtime.config.teacherAccessCode);
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
          role: input.role,
          classId,
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
    if (error instanceof InvalidTeacherCodeError) {
      return NextResponse.json(
        { error: error.message },
        { status: 401, headers: NO_STORE_HEADERS },
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
