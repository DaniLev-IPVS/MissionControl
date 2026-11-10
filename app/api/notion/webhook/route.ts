import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { BOARD_TAG } from "@/lib/config";

// Notion integration webhook. Any page or data source change expires the
// board cache, so the next 2s poll from every open tab pulls fresh data.
export async function POST(request: Request) {
  const raw = await request.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  // One-time handshake when the subscription is created in Notion.
  if (typeof body.verification_token === "string") {
    console.log(`[notion-webhook] verification_token: ${body.verification_token}`);
    return Response.json({ ok: true });
  }

  const secret = process.env.NOTION_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "NOTION_WEBHOOK_SECRET not set" }, { status: 503 });

  const signature = request.headers.get("x-notion-signature") ?? "";
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }

  revalidateTag(BOARD_TAG, { expire: 0 });
  return Response.json({ ok: true, type: body.type ?? null });
}
