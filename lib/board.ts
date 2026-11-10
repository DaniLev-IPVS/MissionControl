import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { BOARD_TAG, TIME_ZONE, USE_MOCK } from "./config";
import { mockStore, mockTree } from "./mock";
import {
  fetchAllTasks,
  fetchCurrentSprintId,
  fetchDays,
  fetchDepartments,
  fetchDoneSince,
  fetchOpenTasks,
  fetchTitle,
} from "./notion";
import type { Board, Day, Department, Task, TreeTask } from "./types";

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

async function getDays(sinceDay: string): Promise<Day[]> {
  "use cache: remote";
  cacheTag(BOARD_TAG, "days");
  cacheLife({ revalidate: 30, expire: 600 });
  if (USE_MOCK) return structuredClone(mockStore().days.filter((d) => d.date >= sinceDay));
  return fetchDays(sinceDay);
}

async function getTree(): Promise<TreeTask[]> {
  "use cache: remote";
  cacheTag(BOARD_TAG, "tree");
  cacheLife({ revalidate: 60, expire: 900 });
  if (USE_MOCK) return structuredClone(mockTree());
  return fetchAllTasks();
}

async function getTitle(pageId: string): Promise<string> {
  "use cache: remote";
  cacheTag("titles");
  cacheLife("hours");
  if (USE_MOCK) return pageId === "s-cur" ? "Sprint 11" : "Untitled";
  return fetchTitle(pageId);
}

/** Today's date (YYYY-MM-DD) in the studio's time zone. */
export function todayInZone(timeZone = TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Midnight in the studio's time zone, as an ISO string.
function startOfToday(timeZone = TIME_ZONE) {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset).toISOString();
}

export async function getBoard(): Promise<Board> {
  const today = todayInZone();
  const [tasks, doneToday, departments, currentSprintId, days] = await Promise.all([
    getOpenTasks(),
    getDoneSince(startOfToday()),
    getDepartments(),
    getCurrentSprintId(),
    getDays(today),
  ]);
  const day = days.find((d) => d.date === today) ?? null;

  const known = new Set(tasks.map((t) => t.id));
  const needed = new Set<string>();
  for (const t of tasks) {
    if (t.parentId && !known.has(t.parentId)) needed.add(t.parentId);
    if (t.sprintId) needed.add(t.sprintId);
  }
  const titles: Record<string, string> = {};
  await Promise.all([...needed].map(async (id) => (titles[id] = await getTitle(id))));

  return { tasks, doneToday, day, departments, titles, currentSprintId, fetchedAt: new Date().toISOString() };
}

export async function getHistory(days = 60) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return getDays(since);
}

export { getCurrentSprintId, getTree };
