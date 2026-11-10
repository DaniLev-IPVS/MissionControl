import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { BOARD_TAG, USE_MOCK } from "./config";
import { mockStore } from "./mock";
import { fetchSprints, fetchTasks, fetchTitle } from "./notion";
import type { Board, Sprint, Task } from "./types";

// Shared (remote) cache in front of Notion: every viewer's 2s poll reads this,
// so Notion sees at most one query per ~5s no matter how many tabs are open.
// The webhook and every write from the site expire it immediately.

async function getSprints(): Promise<Sprint[]> {
  "use cache: remote";
  cacheTag(BOARD_TAG, "sprints");
  cacheLife({ revalidate: 30, expire: 600 });
  if (USE_MOCK) return structuredClone(mockStore().sprints);
  return fetchSprints();
}

async function getTasks(sprintId: string): Promise<Task[]> {
  "use cache: remote";
  cacheTag(BOARD_TAG, `tasks:${sprintId}`);
  cacheLife({ revalidate: 5, expire: 300 });
  if (USE_MOCK) return structuredClone(mockStore().tasks);
  return fetchTasks(sprintId);
}

async function getTitle(pageId: string): Promise<string> {
  "use cache: remote";
  cacheTag("titles");
  cacheLife("hours");
  if (USE_MOCK) return mockStore().titles[pageId] ?? "Untitled";
  return fetchTitle(pageId);
}

export async function getBoard(sprintId?: string | null): Promise<Board> {
  const sprints = await getSprints();
  const sprint =
    sprints.find((s) => s.id === sprintId) ?? sprints.find((s) => s.status === "Current") ?? null;
  const tasks = sprint ? await getTasks(sprint.id) : [];

  const byId = new Map(tasks.map((t) => [t.id, t.name]));
  const needed = new Set<string>();
  for (const t of tasks) {
    t.projectIds.forEach((id) => needed.add(id));
    if (t.parentId && !byId.has(t.parentId)) needed.add(t.parentId);
  }
  const titles: Record<string, string> = Object.fromEntries(byId);
  await Promise.all([...needed].map(async (id) => (titles[id] = await getTitle(id))));

  const order = { Current: 0, Next: 1, Last: 2, Future: 3, Past: 4 } as Record<string, number>;
  sprints.sort(
    (a, b) =>
      (order[a.status ?? ""] ?? 9) - (order[b.status ?? ""] ?? 9) ||
      (b.start ?? "").localeCompare(a.start ?? ""),
  );

  return { sprint, sprints, tasks, titles, fetchedAt: new Date().toISOString() };
}
