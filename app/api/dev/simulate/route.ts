import { revalidateTag } from "next/cache";
import { BOARD_TAG, USE_MOCK } from "@/lib/config";
import { mockStore, mockUpdate } from "@/lib/mock";

// Dev only: pretend someone edited a task in Notion, then fire the same
// invalidation the real webhook does.
export async function POST(request: Request) {
  if (!USE_MOCK) return Response.json({ error: "mock mode only" }, { status: 404 });
  const { id, status } = (await request.json()) as { id?: string; status?: string };
  const task = mockStore().tasks.find((t) => t.id === id) ?? mockStore().tasks[1];
  mockUpdate(task.id, { status: status ?? "Done" });
  revalidateTag(BOARD_TAG, { expire: 0 });
  return Response.json({ ok: true, id: task.id });
}
