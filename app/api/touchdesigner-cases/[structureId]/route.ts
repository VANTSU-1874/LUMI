import { readFile } from "node:fs/promises";
import path from "node:path";

type RouteContext = { params: Promise<{ structureId: string }> };

const PUBLIC_COURSE_HEADERS = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(_request: Request, context: RouteContext) {
  const { structureId } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(structureId)) return Response.json({ error: "案例结构编号无效" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const structure = await readFile(path.join(process.cwd(), "data", "touchdesigner", "structures", `${structureId}.json`), "utf8");
    return new Response(structure, { status: 200, headers: PUBLIC_COURSE_HEADERS });
  } catch {
    return Response.json({ error: "未找到对应的案例结构" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
