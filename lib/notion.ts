import "server-only";
import { Client, isFullPage } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client";
import {
  DAYS_DATA_SOURCE_ID,
  DEFAULT_ASSIGNEE_ID,
  DEPARTMENTS_DATA_SOURCE_ID,
  FOCUS_NOTION,
  INFLUITY_TASKS_DATA_SOURCE_ID,
  MC_DATA_PAGE_ID,
  MY_USER_IDS,
  SPRINTS_DATA_SOURCE_ID,
  TASKS_DATA_SOURCE_ID,
  TASK_STATE_DATA_SOURCE_ID,
  focusFromNotion,
  levelFromNotion,
  levelToNotion,
} from "./config";
import type { BoardKey, Day, DayStats, Department, DoneItem, NewTask, Task, TaskPatch, TreeTask } from "./types";

let client: Client | null = null;
function notion() {
  if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN is not set");
  client ??= new Client({ auth: process.env.NOTION_TOKEN });
  return client;
}

type Props = PageObjectResponse["properties"];
type Prop = Props[string];

const plain = (p?: Prop) =>
  p?.type === "title"
    ? p.title.map((t) => t.plain_text).join("")
    : p?.type === "rich_text"
      ? p.rich_text.map((t) => t.plain_text).join("")
      : "";
const status = (p?: Prop) => (p?.type === "status" ? (p.status?.name ?? null) : null);
const select = (p?: Prop) => (p?.type === "select" ? (p.select?.name ?? null) : null);
const date = (p?: Prop) => (p?.type === "date" ? (p.date?.start ?? null) : null);
const num = (p?: Prop) => (p?.type === "number" ? p.number : null);
const check = (p?: Prop) => (p?.type === "checkbox" ? p.checkbox : false);
const relation = (p?: Prop) => (p?.type === "relation" ? p.relation.map((r) => r.id) : []);

function titleOf(page: PageObjectResponse) {
  const prop = Object.values(page.properties).find((p) => p.type === "title");
  return plain(prop) || "Untitled";
}

const HIDDEN = MC_DATA_PAGE_ID.replace(/-/g, "").toLowerCase();

async function queryAll(dataSourceId: string, filter?: object, pageSize = 100, max = Infinity) {
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion().dataSources.query({
      data_source_id: dataSourceId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter: filter as any,
      page_size: pageSize,
      start_cursor: cursor,
    });
    for (const r of res.results) if (isFullPage(r) && normalizeId(r.id) !== HIDDEN) pages.push(r);
    cursor = res.has_more && pages.length < max ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return pages;
}

// ---- Boards -------------------------------------------------------------------
// The personal board carries Mission Control's fields as columns. The Influity
// board is shared with the team: only my tasks are read, its own status names are
// translated, and Mission Control's fields live in the private Task State database.

const BOARD_SOURCE: Record<BoardKey, string> = {
  personal: TASKS_DATA_SOURCE_ID,
  influity: INFLUITY_TASKS_DATA_SOURCE_ID,
};

const INFLUITY_STATUS_IN: Record<string, string> = { Completed: "Done", "In Progress": "Working on it" };
const INFLUITY_STATUS_OUT: Record<string, string> = {
  Done: "Completed",
  "Working on it": "In Progress",
  "Under Review": "In Progress",
  Fulfilled: "In Progress",
};
const statusIn = (board: BoardKey, s: string | null) => (board === "influity" && s ? (INFLUITY_STATUS_IN[s] ?? s) : s);
const statusOut = (board: BoardKey, s: string) => (board === "influity" ? (INFLUITY_STATUS_OUT[s] ?? s) : s);

/** Influity tasks where I'm in Assigned or Person. */
const mine = () => ({
  or: MY_USER_IDS.flatMap((id) => [
    { property: "Assigned", people: { contains: id } },
    { property: "Person", people: { contains: id } },
  ]),
});

// True while a board's Task Level select still has the old "Checkpoint" option.
const levelCache = new Map<string, { at: number; old: boolean }>();
export async function levelsUseOldNames(dataSourceId = TASKS_DATA_SOURCE_ID): Promise<boolean> {
  const hit = levelCache.get(dataSourceId);
  if (hit && Date.now() - hit.at < 600_000) return hit.old;
  const ds = await notion().dataSources.retrieve({ data_source_id: dataSourceId });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prop = (ds as any).properties?.["Task Level"];
  const names: string[] = prop?.select?.options?.map((o: { name: string }) => o.name) ?? [];
  const old = names.includes("Checkpoint");
  levelCache.set(dataSourceId, { at: Date.now(), old });
  return old;
}

function toTask(p: PageObjectResponse, oldNames: boolean, board: BoardKey = "personal"): Task {
  const pr = p.properties;
  return {
    id: p.id,
    board,
    url: p.url,
    name: plain(pr["Name"]) || "Untitled",
    status: statusIn(board, status(pr["Status"])),
    priority: select(pr["Priority"]),
    level: levelFromNotion(select(pr["Task Level"]), oldNames),
    due: date(pr["Due Date"]),
    estMin: num(pr["Est. Time (min)"]),
    // Influity's own department relation points elsewhere; board.ts files these under "Influity".
    departmentIds: board === "personal" ? relation(pr["Departments"] ?? pr["My Projects"]) : [],
    parentId: relation(pr["Parent item"])[0] ?? null,
    sprintId: board === "personal" ? (relation(pr["Sprint"])[0] ?? null) : null,
    focus: focusFromNotion(select(pr["Focus"])),
    focusOrder: num(pr["Focus Order"]),
    noise: check(pr["Noise"]),
    idleSince: date(pr["Idle Since"]),
    idleReminder: date(pr["Idle Reminder"]),
    idleMinutes: num(pr["Idle Minutes"]) ?? 0,
    idleLog: plain(pr["Idle Log"]),
    doneAt: date(pr["Done At"]),
    doneAs: (select(pr["Done As"]) as Task["doneAs"]) ?? null,
    missedOn: (date(pr["Missed On"]) ?? "").slice(0, 10) || null,
    createdAt: p.created_time,
    editedAt: p.last_edited_time,
  };
}

// ---- Task State (Mission Control fields for shared-board tasks) -------------------
type State = Pick<
  Task,
  | "focus" | "focusOrder" | "noise" | "idleSince" | "idleReminder" | "idleMinutes" | "idleLog" | "doneAt" | "doneAs"
  | "missedOn"
>;
const STATE_KEYS = [
  "focus", "focusOrder", "noise", "idleSince", "idleReminder", "idleMinutes", "idleLog", "doneAt", "doneAs", "missedOn",
] as const satisfies readonly (keyof State)[];

function toState(p: PageObjectResponse): State {
  const t = toTask(p, false);
  return Object.fromEntries(STATE_KEYS.map((k) => [k, t[k]])) as State;
}

/** State rows that can matter now: in a lane, flagged noise, or touched in the last 3 days.
 *  `finished` adds every row with a Done At, for the tree: without it a finished task's own done
 *  date is forgotten after 3 days and it falls back to the day the page was last edited. */
async function fetchStates(finished = false): Promise<Map<string, State>> {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const pages = await queryAll(TASK_STATE_DATA_SOURCE_ID, {
    or: [
      { property: "Focus", select: { is_not_empty: true } },
      { property: "Noise", checkbox: { equals: true } },
      { timestamp: "last_edited_time", last_edited_time: { on_or_after: since } },
      ...(finished ? [{ property: "Done At", date: { is_not_empty: true } }] : []),
    ],
  });
  const map = new Map<string, State>();
  for (const p of pages) {
    const id = plain(p.properties["Task ID"]).trim();
    if (id) map.set(normalizeId(id), toState(p));
  }
  return map;
}

const normalizeId = (id: string) => id.replace(/-/g, "").toLowerCase();
const withState = (t: Task, states: Map<string, State>): Task => ({ ...t, ...(states.get(normalizeId(t.id)) ?? {}) });

/** Reads that may fail on their own (a board not shared yet) without taking the rest down. */
export type Soft<T> = { value: T; warnings: string[] };

function accessWarning(name: string, err: unknown) {
  const code = (err as { code?: string }).code;
  console.error(`${name} fetch failed`, err);
  return code === "object_not_found" || code === "restricted_resource"
    ? `${name} isn't shared with your Notion integration (⋯ → Connections in Notion).`
    : `${name} couldn't load: ${err instanceof Error ? err.message : String(err)}`;
}

async function sharedTasks(filter: object, finishedStates = false) {
  const warnings: string[] = [];
  const [pages, oldNames, states] = await Promise.all([
    queryAll(INFLUITY_TASKS_DATA_SOURCE_ID, filter).catch((e) => (warnings.push(accessWarning("Influity Task Board", e)), [])),
    levelsUseOldNames(INFLUITY_TASKS_DATA_SOURCE_ID).catch(() => true),
    fetchStates(finishedStates).catch((e) => (warnings.push(accessWarning("Mission Control Task State", e)), new Map<string, State>())),
  ]);
  return { tasks: pages.map((p) => withState(toTask(p, oldNames, "influity"), states)), warnings };
}

export async function fetchOpenTasks(): Promise<Soft<Task[]>> {
  const [pages, oldNames, shared] = await Promise.all([
    queryAll(TASKS_DATA_SOURCE_ID, {
      and: [
        { property: "Status", status: { does_not_equal: "Done" } },
        { property: "Status", status: { does_not_equal: "Cancelled" } },
      ],
    }),
    levelsUseOldNames(),
    sharedTasks({
      and: [
        mine(),
        { property: "Status", status: { does_not_equal: "Completed" } },
        { property: "Status", status: { does_not_equal: "Cancelled" } },
      ],
    }),
  ]);
  return { value: [...pages.map((p) => toTask(p, oldNames)), ...shared.tasks], warnings: shared.warnings };
}

const toDoneItem = (t: Task): DoneItem => ({ id: t.id, name: t.name, doneAs: t.doneAs, focus: t.focus, noise: t.noise });

export async function fetchDoneSince(sinceISO: string): Promise<DoneItem[]> {
  const edited = { timestamp: "last_edited_time", last_edited_time: { on_or_after: sinceISO } };
  const [pages, shared] = await Promise.all([
    queryAll(TASKS_DATA_SOURCE_ID, { and: [{ property: "Status", status: { equals: "Done" } }, edited] }, 50, 50),
    sharedTasks({ and: [mine(), { property: "Status", status: { equals: "Completed" } }, edited] }),
  ]);
  // Found by edit time (Notion can't filter on a shared task's own done date), then narrowed:
  // a task with a Done At from an earlier day was only touched today, not finished today.
  const finishedSince = (t: Task) =>
    !t.doneAt || (t.doneAt.length <= 10 ? t.doneAt >= sinceISO.slice(0, 10) : Date.parse(t.doneAt) >= Date.parse(sinceISO));
  return [...pages.map((p) => toTask(p, false)), ...shared.tasks].filter(finishedSince).map(toDoneItem);
}

/** Every ticket, finished ones included, for progress and the timeline. */
export async function fetchAllTasks(): Promise<TreeTask[]> {
  const [pages, oldNames, shared] = await Promise.all([
    queryAll(TASKS_DATA_SOURCE_ID),
    levelsUseOldNames(),
    sharedTasks(mine(), true),
  ]);
  return [...pages.map((p) => toTask(p, oldNames)), ...shared.tasks].map((t) => {
    const finished = t.status === "Done" || t.status === "Cancelled";
    return {
      id: t.id, board: t.board, name: t.name, status: t.status, level: t.level, parentId: t.parentId,
      departmentIds: t.departmentIds, due: t.due, createdAt: t.createdAt, url: t.url,
      doneAt: t.doneAt ?? (finished ? t.editedAt : null),
    };
  });
}

// ---- Day log (Mission Control Days) ---------------------------------------------
function toDay(p: PageObjectResponse): Day {
  const pr = p.properties;
  return {
    id: p.id,
    date: (date(pr["Date"]) ?? "").slice(0, 10),
    signedIn: date(pr["Signed In"]),
    signedOut: date(pr["Signed Out"]),
    planned: num(pr["Planned"]) ?? 0,
    done: num(pr["Done"]) ?? 0,
    signalDone: num(pr["Signal Done"]) ?? 0,
    noiseDone: num(pr["Noise Done"]) ?? 0,
    plannedDone: num(pr["Planned Done"]) ?? 0,
    carriedOver: num(pr["Carried Over"]) ?? 0,
    idleMinutes: num(pr["Idle Minutes"]) ?? 0,
    plannedIds: [
      ...relation(pr["Planned Tasks"]),
      ...plain(pr["Other Planned"]).split(",").map((s) => s.trim()).filter(Boolean),
    ],
    notes: plain(pr["Notes"]),
  };
}

export async function fetchDays(sinceDay: string): Promise<Day[]> {
  const pages = await queryAll(DAYS_DATA_SOURCE_ID, { property: "Date", date: { on_or_after: sinceDay } });
  return pages.map(toDay).sort((a, b) => b.date.localeCompare(a.date));
}

export async function fetchDaysSafe(sinceDay: string): Promise<Soft<Day[]>> {
  try {
    return { value: await fetchDays(sinceDay), warnings: [] };
  } catch (err) {
    return { value: [], warnings: [accessWarning("Mission Control Days (inside the Mission Control data row on your Personal board)", err)] };
  }
}

const rel = (ids: string[]) => ({ relation: ids.slice(0, 100).map((id) => ({ id })) });

export async function createDay(day: string, signedIn: string, plannedIds: string[]): Promise<string> {
  const label = new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  // "Planned Tasks" relates to the personal board only; shared-board ids are kept in the count.
  const { personal, other } = await byBoard(plannedIds);
  const page = await notion().pages.create({
    parent: { type: "data_source_id", data_source_id: DAYS_DATA_SOURCE_ID },
    properties: {
      Day: { title: richText(label) },
      Date: { date: { start: day } },
      "Signed In": { date: { start: signedIn } },
      Planned: { number: plannedIds.length },
      "Planned Tasks": rel(personal),
      "Other Planned": { rich_text: richText(other.join(",")) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
  return page.id;
}

export async function updateDay(
  id: string,
  patch: Partial<DayStats> & { signedIn?: string | null; signedOut?: string | null; notes?: string; plannedIds?: string[] },
) {
  const p: Record<string, unknown> = {};
  if (patch.signedIn !== undefined) p["Signed In"] = { date: patch.signedIn ? { start: patch.signedIn } : null };
  if (patch.signedOut !== undefined) p["Signed Out"] = { date: patch.signedOut ? { start: patch.signedOut } : null };
  if (patch.notes !== undefined) p["Notes"] = { rich_text: richText(patch.notes) };
  if (patch.plannedIds !== undefined) {
    const { personal, other } = await byBoard(patch.plannedIds);
    p["Planned Tasks"] = rel(personal);
    p["Other Planned"] = { rich_text: richText(other.join(",")) };
    p["Planned"] = { number: patch.plannedIds.length };
  }
  const nums: [keyof DayStats, string][] = [
    ["done", "Done"], ["signalDone", "Signal Done"], ["noiseDone", "Noise Done"], ["plannedDone", "Planned Done"],
    ["carriedOver", "Carried Over"], ["idleMinutes", "Idle Minutes"],
  ];
  for (const [k, name] of nums) if (patch[k] !== undefined) p[name] = { number: patch[k] };
  if (patch.doneIds !== undefined) p["Done Tasks"] = rel((await byBoard(patch.doneIds)).personal);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await notion().pages.update({ page_id: id, properties: p as any });
}

async function byBoard(ids: string[]) {
  const personal: string[] = [];
  const other: string[] = [];
  for (const id of ids) ((await whichBoard(id)) === "personal" ? personal : other).push(id);
  return { personal, other };
}

export async function fetchDepartments(): Promise<Department[]> {
  const pages = await queryAll(DEPARTMENTS_DATA_SOURCE_ID);
  return pages.map((p) => ({ id: p.id, name: titleOf(p) }));
}

export async function fetchCurrentSprintId(): Promise<string | null> {
  const pages = await queryAll(SPRINTS_DATA_SOURCE_ID, {
    property: "Sprint status",
    status: { equals: "Current" },
  });
  return pages[0]?.id ?? null;
}

export async function fetchTitle(pageId: string): Promise<string> {
  try {
    const page = await notion().pages.retrieve({ page_id: pageId });
    return isFullPage(page) ? titleOf(page) : "Untitled";
  } catch {
    return "(no access)";
  }
}

// ---- Writes -----------------------------------------------------------------------
const richText = (s: string) => [{ type: "text", text: { content: s.slice(0, 2000) } }];

function patchToProperties(patch: TaskPatch, board: BoardKey = "personal") {
  const p: Record<string, unknown> = {};
  if (patch.name !== undefined) p["Name"] = { title: richText(patch.name) };
  if (patch.status !== undefined && patch.status !== null) p["Status"] = { status: { name: statusOut(board, patch.status) } };
  if (patch.priority !== undefined) p["Priority"] = { select: patch.priority ? { name: patch.priority } : null };
  if (patch.due !== undefined) p["Due Date"] = { date: patch.due ? { start: patch.due } : null };
  if (patch.focus !== undefined) p["Focus"] = { select: patch.focus ? { name: FOCUS_NOTION[patch.focus] } : null };
  if (patch.focusOrder !== undefined) p["Focus Order"] = { number: patch.focusOrder };
  if (patch.noise !== undefined) p["Noise"] = { checkbox: patch.noise };
  if (patch.idleSince !== undefined) p["Idle Since"] = { date: patch.idleSince ? { start: patch.idleSince } : null };
  if (patch.idleReminder !== undefined)
    p["Idle Reminder"] = { date: patch.idleReminder ? { start: patch.idleReminder } : null };
  if (patch.idleMinutes !== undefined) p["Idle Minutes"] = { number: patch.idleMinutes };
  if (patch.idleLog !== undefined) p["Idle Log"] = { rich_text: richText(patch.idleLog) };
  if (patch.doneAt !== undefined) p["Done At"] = { date: patch.doneAt ? { start: patch.doneAt } : null };
  if (patch.doneAs !== undefined) p["Done As"] = { select: patch.doneAs ? { name: patch.doneAs } : null };
  if (patch.missedOn !== undefined) p["Missed On"] = { date: patch.missedOn ? { start: patch.missedOn } : null };
  return p;
}

function splitPatch(patch: TaskPatch) {
  const native: TaskPatch = {};
  const state: TaskPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    if ((STATE_KEYS as readonly string[]).includes(k)) Object.assign(state, { [k]: v });
    else Object.assign(native, { [k]: v });
  }
  return { native, state };
}

// Which board a page lives on (pages never move between boards, so this is cached).
const boardCache = new Map<string, { board: BoardKey; name: string }>();
async function pageInfo(id: string) {
  const key = normalizeId(id);
  const hit = boardCache.get(key);
  if (hit) return hit;
  const page = await notion().pages.retrieve({ page_id: id });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parent = (page as any).parent ?? {};
  const ds = normalizeId(parent.data_source_id ?? parent.database_id ?? "");
  const board: BoardKey = ds === normalizeId(INFLUITY_TASKS_DATA_SOURCE_ID) ? "influity" : "personal";
  const info = { board, name: isFullPage(page) ? titleOf(page) : "Untitled" };
  boardCache.set(key, info);
  return info;
}
const whichBoard = async (id: string) => (await pageInfo(id)).board;

async function upsertState(taskId: string, patch: TaskPatch, name?: string) {
  if (!Object.keys(patch).length) return;
  const existing = await notion().dataSources.query({
    data_source_id: TASK_STATE_DATA_SOURCE_ID,
    filter: { property: "Task ID", rich_text: { equals: taskId } },
    page_size: 1,
  });
  const properties = patchToProperties(patch);
  const row = existing.results[0];
  if (row) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await notion().pages.update({ page_id: row.id, properties: properties as any });
  } else {
    await notion().pages.create({
      parent: { type: "data_source_id", data_source_id: TASK_STATE_DATA_SOURCE_ID },
      properties: {
        ...properties,
        Name: { title: richText(name ?? (await pageInfo(taskId)).name) },
        "Task ID": { rich_text: richText(taskId) },
        Board: { select: { name: "Influity" } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
  }
}

/** Returns a warning when only Mission Control's own fields couldn't be saved (the task itself was). */
export async function updateTaskInNotion(id: string, patch: TaskPatch): Promise<string | null> {
  const board = await whichBoard(id);
  if (board === "personal") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await notion().pages.update({ page_id: id, properties: patchToProperties(patch) as any });
    return null;
  }
  const { native, state } = splitPatch(patch);
  if (Object.keys(native).length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await notion().pages.update({ page_id: id, properties: patchToProperties(native, board) as any });
    if (native.name) boardCache.set(normalizeId(id), { board, name: native.name });
  }
  try {
    await upsertState(id, state, native.name);
    return null;
  } catch (err) {
    return stateWarning(err);
  }
}

function stateWarning(err: unknown) {
  return accessWarning("Mission Control Task State", err).replace(
    /\.$/,
    ", so lanes and Signal/Noise for Influity tasks weren't saved (the status was).",
  );
}

/** New tasks go to the parent's board (a split on an Influity task stays on Influity). */
export async function createTaskInNotion(t: NewTask, sprintId: string | null): Promise<string> {
  const board: BoardKey = t.parentId ? await whichBoard(t.parentId) : "personal";
  const oldNames = await levelsUseOldNames(BOARD_SOURCE[board]);
  const base: TaskPatch = { name: t.name, status: "To Start", priority: t.priority ?? null, due: t.due ?? null };
  const lane: TaskPatch = { focus: t.focus ?? null, focusOrder: t.focusOrder ?? null, noise: t.noise ?? false };
  const properties: Record<string, unknown> = {
    ...patchToProperties(board === "personal" ? { ...base, ...lane } : base, board),
    "Task Level": { select: { name: levelToNotion(t.level, oldNames) } },
    Assigned: { people: [{ id: DEFAULT_ASSIGNEE_ID }] },
  };
  if (t.parentId) properties["Parent item"] = { relation: [{ id: t.parentId }] };
  if (board === "personal") {
    if (t.departmentIds?.length) properties["Departments"] = { relation: t.departmentIds.map((id) => ({ id })) };
    if (sprintId) properties["Sprint"] = { relation: [{ id: sprintId }] };
  }
  const page = await notion().pages.create({
    parent: { type: "data_source_id", data_source_id: BOARD_SOURCE[board] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: properties as any,
  });
  boardCache.set(normalizeId(page.id), { board, name: t.name });
  if (board !== "personal" && (lane.focus || lane.noise)) {
    // The task exists either way; its lane is best effort.
    await upsertState(page.id, lane, t.name).catch((err) => console.error(stateWarning(err)));
  }
  return page.id;
}

// Run only after a failed load: production masks errors thrown inside cached
// functions, so check each database directly and say which one is the problem.
const SOURCES = [
  ["Personal Ticket Board", TASKS_DATA_SOURCE_ID],
  ["Departments", DEPARTMENTS_DATA_SOURCE_ID],
  ["Sprints", SPRINTS_DATA_SOURCE_ID],
  ["Influity Task Board", INFLUITY_TASKS_DATA_SOURCE_ID],
  ["Mission Control Days (inside the Mission Control data row on your Personal board)", DAYS_DATA_SOURCE_ID],
  ["Mission Control Task State (inside the Mission Control data row on your Personal board)", TASK_STATE_DATA_SOURCE_ID],
] as const;

let lastDiagnosis: { at: number; message: string } | null = null;

export async function diagnoseNotion(): Promise<string> {
  if (lastDiagnosis && Date.now() - lastDiagnosis.at < 30_000) return lastDiagnosis.message;
  let message: string;
  if (!process.env.NOTION_TOKEN) {
    message = "NOTION_TOKEN is not set in Vercel.";
  } else {
    const missing: string[] = [];
    let other: string | null = null;
    for (const [name, id] of SOURCES) {
      try {
        await notion().dataSources.retrieve({ data_source_id: id });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "object_not_found" || code === "restricted_resource") missing.push(name);
        else if (code === "unauthorized") other = "the NOTION_TOKEN in Vercel is invalid. Copy the integration secret again.";
        else other ??= err instanceof Error ? err.message : String(err);
      }
    }
    message = missing.length
      ? `your Notion integration can't see: ${missing.join(", ")}. In Notion, open each one, choose ⋯ → Connections, and add the integration.`
      : (other ?? "Notion didn't answer. Try again in a moment.");
  }
  lastDiagnosis = { at: Date.now(), message };
  return message;
}
