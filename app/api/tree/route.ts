import { connection } from "next/server";
import { getTree } from "@/lib/board";

export async function GET() {
  await connection();
  try {
    return Response.json({ tasks: await getTree() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("tree fetch failed", err);
    return Response.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 502 });
  }
}
