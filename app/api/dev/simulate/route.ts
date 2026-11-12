import { revalidateTag } from "next/cache";
import { BOARD_TAG, USE_MOCK } from "@/lib/config";
import { mockCreateDay, mockStore, mockUpdate } from "@/lib/mock";
import type { TaskPatch } from "@/lib/types";

// Dev only: pretend someone edited a task in Notion, then fire the same
// invalidation the real webhook does.
export async function POST(request: Request) {
  if (!USE_MOCK) return Response.json({ error: "mock mode only" }, { status: 404 });
  const { id, patch, openDay } = (await request.json()) as { id?: string; patch?: TaskPatch; openDay?: string };
  // { openDay: "YYYY-MM-DD" }: a day that was started on that date and never ended.
  if (openDay) {
    mockCreateDay(openDay, new Date(`${openDay}T09:00:00`).toISOString(), []);
    revalidateTag(BOARD_TAG, { expire: 0 });
    return Response.json({ ok: true, day: openDay });
  }
  const task = mockStore().tasks.find((t) => t.id === id) ?? mockStore().tasks[0];
  mockUpdate(task.id, patch ?? { status: "Done" });
  revalidateTag(BOARD_TAG, { expire: 0 });
  return Response.json({ ok: true, id: task.id });
}
