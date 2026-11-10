import { connection, type NextRequest } from "next/server";
import { getBoard } from "@/lib/board";

export async function GET(request: NextRequest) {
  await connection();
  const sprintId = request.nextUrl.searchParams.get("sprint");
  try {
    const board = await getBoard(sprintId);
    // ETag ignores fetchedAt so unchanged boards answer 304 with no body.
    const { fetchedAt, ...content } = board;
    void fetchedAt;
    const etag = `"${await hash(JSON.stringify(content))}"`;
    const headers = { ETag: etag, "Cache-Control": "no-store" };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return Response.json(board, { headers });
  } catch (err) {
    console.error("board fetch failed", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}

async function hash(s: string) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
