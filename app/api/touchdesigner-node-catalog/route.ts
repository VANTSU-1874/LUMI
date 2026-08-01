import { readTouchDesignerNodeCatalog } from "@/lib/touchdesigner/node-catalog";

export async function GET() {
  try {
    return Response.json(await readTouchDesignerNodeCatalog(), {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "TouchDesigner 节点目录尚未生成" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
