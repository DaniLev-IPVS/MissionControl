import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { BOARD_TAG, USE_MOCK } from "./config";
import { mockStore } from "./mock";
import {
  fetchCurrentSprintId,
  fetchDepartments,
  fetchDoneSince,
  fetchOpenTasks,
  fetchTitle,
} from "./notion";
import type { Board, Department, Task } from "./types";

// Shared (remote) cache in front of Notion: every viewer's 2s poll reads this,
// so Notion sees a couple of queries per ~5s no matter how many tabs are open.
// The webhook and every write from the site expire it immediately.

async function getOpenTasks(): Promise<Task[]> {
  "use cache: remote";
  cacheTag(BOARD_TAG, "tasks");
  cacheLife({ revalidate: 5, expire: 300 });
  if (USE_MOCK) return structuredClone(mockStore().tasks);
  return fetchOpenTasks();
}

async function getDoneSince(sinceISO: string) {
  "use cache: remote";
  cacheTag(BOARD_TAG, "done");
  cacheLife({ revalidate: 30, expire: 600 });
  if (USE_MOCK) return structuredClone(mockStore().done);
  return fetchDoneSince(sinceISO);
}

async function getDepartments(): Promise<Department[]> {
  "use cache: remote";
  cacheTag("departments");
  cacheLife("hours");
  if (USE_MOCK) return structuredClone(mockStore().departments);
  return fetchDepartments();
}

async function getCurrentSprintId(): Promise<string | null> {
  "use cache: remote";
  cacheTag("sprint");
  cacheLife({ revalidate: 600, expire: 86400 });
  if (USE_MOCK) return "s-cur";
  return fetchCurrentSprintId();
}

async function getTitle(pageId: string): Promise<string> {
  "use cache: remote";
  cacheTag("titles");
  cacheLife("hours");
  if (USE_MOCK) return pageId === "s-cur" ? "Sprint 11" : "Untitled";
  return fetchTitle(pageId);
}

// Midnight in the studio's time zone, as an ISO string.
function startOfToday(timeZone = "America/Toronto") {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset).toISOString();
}

export async function getBoard(): Promise<Board> {
  const [tasks, doneToday, departments, currentSprintId] = await Promise.all([
    getOpenTasks(),
    getDoneSince(startOfToday()),
    getDepartments(),
    getCurrentSprintId(),
  ]);

  const known = new Set(tasks.map((t) => t.id));
  const needed = new Set<string>();
  for (const t of tasks) {
    if (t.parentId && !known.has(t.parentId)) needed.add(t.parentId);
    if (t.sprintId) needed.add(t.sprintId);
  }
  const titles: Record<string, string> = {};
  await Promise.all([...needed].map(async (id) => (titles[id] = await getTitle(id))));

  return { tasks, doneToday, departments, titles, currentSprintId, fetchedAt: new Date().toISOString() };
}

export { getCurrentSprintId };
