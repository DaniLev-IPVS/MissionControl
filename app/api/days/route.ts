import { diagnoseNotion } from "@/lib/notion";
import { connection } from "next/server";
import { getHistory } from "@/lib/board";

export async function GET() {
  await connection();
  try {
    return Response.json({ days: await getHistory(90) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("days fetch failed", err);
    return Response.json({ error: await diagnoseNotion() }, { status: 502 });
  }
}
