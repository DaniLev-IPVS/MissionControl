import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { BOARD_TAG, TIME_ZONE, USE_MOCK } from "./config";
import { DAY_LOOKBACK, workingDay } from "./days";
import { addDays } from "./flow";
import { mockStore, mockTree } from "./mock";
import { getWorkingUntil } from "./overtime";
import {
  fetchAllTasks,
  fetchCurrentSprintId,
  fetchDaysSafe,
  fetchDepartments,
  fetchDoneSince,
  fetchOpenTasks,
  fetchTitle,
} from "./notion";
import type { Soft } from "./notion";
import type { Board, Day, Department, Task, TreeTask } from "./types";

// Shared-board tasks have no department of their own here: file them under the
// department with the board's name (e.g. "Influity") so filters and the tree work.
function fileShared<T extends Pick<Task, "board" | "departmentIds">>(tasks: T[], departments: Department[]): T[] {
  const influity = departments.find((d) => d.name.trim().toLowerCase() === "influity")?.id;
  if (!influity) return tasks;
  return tasks.map((t) => (t.board === "influity" && !t.departmentIds.length ? { ...t, departmentIds: [influity] } : t));
}

// Shared (remote) cache in front of Notion: every viewer's 2s poll reads this,
// so Notion sees a couple of queries per ~5s no matter how many tabs are open.
// The webhook and every write from the site expire it immediately.

async function getOpenTasks(): Promise<Soft<Task[]>> {
  "use cache: remote";
  cacheTag(BOARD_TAG, "tasks");
  cacheLife({ revalidate: 5, expire: 300 });
  if (USE_MOCK) return { value: structuredClone(mockStore().tasks), warnings: [] };
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

async function getDaysSoft(sinceDay: string): Promise<Soft<Day[]>> {
  "use cache: remote";
  cacheTag(BOARD_TAG, "days");
  cacheLife({ revalidate: 30, expire: 600 });
  if (USE_MOCK) return { value: structuredClone(mockStore().days.filter((d) => d.date >= sinceDay)), warnings: [] };
  return fetchDaysSafe(sinceDay);
}

/** Throws when the day log can't be read (sign in / out need it). */
async function getDays(sinceDay: string): Promise<Day[]> {
  const { value, warnings } = await getDaysSoft(sinceDay);
  if (warnings.length) throw new Error(warnings[0]);
  return value;
}

/** "Still working" confirmed past midnight, for a day that wasn't ended. */
async function getOvertime(day: string): Promise<string | null> {
  "use cache: remote";
  cacheTag(BOARD_TAG, "overtime");
  cacheLife({ revalidate: 30, expire: 600 });
  return getWorkingUntil(day);
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

// Midnight at the start of `day` (YYYY-MM-DD) in the studio's time zone, as an ISO string.
function startOfDay(day: string, timeZone = TIME_ZONE) {
  const noon = new Date(`${day}T12:00:00Z`);
  const local = new Date(noon.toLocaleString("en-US", { timeZone }));
  const offset = noon.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset).toISOString();
}

export async function getBoard(): Promise<Board> {
  const today = todayInZone();
  const [open, departments, currentSprintId, days] = await Promise.all([
    getOpenTasks(),
    getDepartments(),
    getCurrentSprintId(),
    getDaysSoft(addDays(today, -DAY_LOOKBACK)),
  ]);
  const tasks = fileShared(open.value, departments);
  const warnings = [...open.warnings, ...days.warnings];
  // A day that wasn't ended keeps running past midnight: it stays the day on the board, with
  // everything finished since it began, until it is ended (by hand, or by the midnight check).
  let day = workingDay(days.value, today);
  const overnight = !!day && day.date < today;
  const [doneToday, workingUntil] = await Promise.all([
    getDoneSince(overnight ? startOfDay(day!.date) : startOfToday()),
    overnight ? getOvertime(day!.date) : null,
  ]);
  if (day && workingUntil) day = { ...day, workingUntil };

  const known = new Set(tasks.map((t) => t.id));
  const needed = new Set<string>();
  for (const t of tasks) {
    if (t.parentId && !known.has(t.parentId)) needed.add(t.parentId);
    if (t.sprintId) needed.add(t.sprintId);
  }
  const titles: Record<string, string> = {};
  await Promise.all([...needed].map(async (id) => (titles[id] = await getTitle(id))));

  return { tasks, doneToday, day, departments, titles, currentSprintId, warnings, fetchedAt: new Date().toISOString() };
}

export async function getHistory(days = 60) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return getDays(since);
}

async function getFiledTree(): Promise<TreeTask[]> {
  const [tree, departments] = await Promise.all([getTree(), getDepartments()]);
  return fileShared(tree, departments);
}

export { getCurrentSprintId, getFiledTree as getTree };
