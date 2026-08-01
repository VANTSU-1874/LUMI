import { readFile } from "node:fs/promises";
import path from "node:path";

const PUBLIC_COURSE_HEADERS = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  try {
    const manifest = await readFile(path.join(process.cwd(), "data", "touchdesigner", "posters-cases.generated.json"), "utf8");
    return new Response(manifest, { status: 200, headers: PUBLIC_COURSE_HEADERS });
  } catch {
    return Response.json({ error: "TouchDesigner 案例库尚未生成" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
