import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, StudentRoleForbiddenError, StudentSessionRequiredError, studentAwareForbiddenPayload } from "@/lib/auth/project-session";
import { parseLimitedRequestBody, validateRequestProtocol, validateRequestSource } from "@/lib/auth/route-handler";
import { StudentProjectUpdateSchema } from "@/lib/agent/student-project-contract";
import { deleteStudentProject, readStudentProject, StudentProjectForbiddenError, StudentProjectNotFoundError, updateStudentProject } from "@/lib/agent/student-project";
import { deleteStudentLibraryAsset } from "@/lib/agent/student-library";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";

type Context = { params: Promise<{ projectId: string }> };
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function failure(error: unknown, requestId: string) {
  if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ error: "项目信息无效" }, { status: 400, headers: HEADERS });
  if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
  if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
  if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
  if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof StudentProjectForbiddenError) return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
  if (error instanceof StudentProjectNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
  console.error({ requestId, route: "agent-project", errorName: error instanceof Error ? error.name : "UnknownError" }); return NextResponse.json({ error: "项目暂时不可用" }, { status: 500, headers: HEADERS });
}
export async function GET(request: NextRequest, context: Context) { const requestId=randomUUID(); let connection:DatabaseConnection|undefined; try { validateRequestSource(request); const config=readEnv(process.env); const session=await requireStudentSession(request,config.sessionSecret); const id=z.string().uuid().parse((await context.params).projectId); connection=createDb(config.databasePath); return NextResponse.json(readStudentProject(connection,session,id),{headers:HEADERS}); } catch(error){return failure(error,requestId);} finally{connection?.sqlite.close();} }
export async function PATCH(request: NextRequest, context: Context) { const requestId=randomUUID(); let connection:DatabaseConnection|undefined; try { validateRequestProtocol(request); const config=readEnv(process.env); const session=await requireStudentSession(request,config.sessionSecret); const input=await parseLimitedRequestBody(request,StudentProjectUpdateSchema,8*1024); const id=z.string().uuid().parse((await context.params).projectId); connection=createDb(config.databasePath); return NextResponse.json(updateStudentProject(connection,session,id,input),{headers:HEADERS}); } catch(error){return failure(error,requestId);} finally{connection?.sqlite.close();} }
export async function DELETE(request: NextRequest, context: Context) { const requestId=randomUUID(); let connection:DatabaseConnection|undefined; try { validateRequestSource(request); const config=readEnv(process.env); const session=await requireStudentSession(request,config.sessionSecret); const id=z.string().uuid().parse((await context.params).projectId); connection=createDb(config.databasePath); readStudentProject(connection,session,id); const assets=connection.sqlite.prepare("SELECT id FROM student_library_assets WHERE project_id=?").all(id) as Array<{id:string}>; for(const asset of assets) await deleteStudentLibraryAsset(connection,session,asset.id,config.evidenceRoot); return NextResponse.json({deleted:deleteStudentProject(connection,session,id)},{headers:HEADERS}); } catch(error){return failure(error,requestId);} finally{connection?.sqlite.close();} }
