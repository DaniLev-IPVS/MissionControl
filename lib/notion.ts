import "server-only";
import { Client, isFullPage } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client";
import {
  DAYS_DATA_SOURCE_ID,
  DEFAULT_ASSIGNEE_ID,
  DEPARTMENTS_DATA_SOURCE_ID,
  FOCUS_NOTION,
  SPRINTS_DATA_SOURCE_ID,
  TASKS_DATA_SOURCE_ID,
  focusFromNotion,
  levelFromNotion,
  levelToNotion,
} from "./config";
import type { Day, DayStats, Department, DoneItem, NewTask, Task, TaskPatch, TreeTask } from "./types";

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
    for (const r of res.results) if (isFullPage(r)) pages.push(r);
    cursor = res.has_more && pages.length < max ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return pages;
}

// True while the Task Level select still has the old "Checkpoint" option.
export async function levelsUseOldNames(): Promise<boolean> {
  const ds = await notion().dataSources.retrieve({ data_source_id: TASKS_DATA_SOURCE_ID });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prop = (ds as any).properties?.["Task Level"];
  const names: string[] = prop?.select?.options?.map((o: { name: string }) => o.name) ?? [];
  return names.includes("Checkpoint");
}

function toTask(p: PageObjectResponse, oldNames: boolean): Task {
  const pr = p.properties;
  return {
    id: p.id,
    url: p.url,
    name: plain(pr["Name"]) || "Untitled",
    status: status(pr["Status"]),
    priority: select(pr["Priority"]),
    level: levelFromNotion(select(pr["Task Level"]), oldNames),
    due: date(pr["Due Date"]),
    estMin: num(pr["Est. Time (min)"]),
    departmentIds: relation(pr["Departments"] ?? pr["My Projects"]),
    parentId: relation(pr["Parent item"])[0] ?? null,
    sprintId: relation(pr["Sprint"])[0] ?? null,
    focus: focusFromNotion(select(pr["Focus"])),
    focusOrder: num(pr["Focus Order"]),
    noise: check(pr["Noise"]),
    idleSince: date(pr["Idle Since"]),
    idleReminder: date(pr["Idle Reminder"]),
    idleMinutes: num(pr["Idle Minutes"]) ?? 0,
    idleLog: plain(pr["Idle Log"]),
    doneAt: date(pr["Done At"]),
    doneAs: (select(pr["Done As"]) as Task["doneAs"]) ?? null,
    createdAt: p.created_time,
    editedAt: p.last_edited_time,
  };
}

export async function fetchOpenTasks(): Promise<Task[]> {
  const [pages, oldNames] = await Promise.all([
    queryAll(TASKS_DATA_SOURCE_ID, {
      and: [
        { property: "Status", status: { does_not_equal: "Done" } },
        { property: "Status", status: { does_not_equal: "Cancelled" } },
      ],
    }),
    levelsUseOldNames(),
  ]);
  return pages.map((p) => toTask(p, oldNames));
}

export async function fetchDoneSince(sinceISO: string) {
  const pages = await queryAll(
    TASKS_DATA_SOURCE_ID,
    {
      and: [
        { property: "Status", status: { equals: "Done" } },
        { timestamp: "last_edited_time", last_edited_time: { on_or_after: sinceISO } },
      ],
    },
    50,
    50,
  );
  return pages.map(
    (p): DoneItem => ({
      id: p.id,
      name: plain(p.properties["Name"]) || "Untitled",
      doneAs: (select(p.properties["Done As"]) as DoneItem["doneAs"]) ?? null,
      focus: focusFromNotion(select(p.properties["Focus"])),
      noise: check(p.properties["Noise"]),
    }),
  );
}

/** Every ticket, finished ones included, for progress and the timeline. */
export async function fetchAllTasks(): Promise<TreeTask[]> {
  const [pages, oldNames] = await Promise.all([queryAll(TASKS_DATA_SOURCE_ID), levelsUseOldNames()]);
  return pages.map((p) => {
    const t = toTask(p, oldNames);
    const finished = t.status === "Done" || t.status === "Cancelled";
    return {
      id: t.id, name: t.name, status: t.status, level: t.level, parentId: t.parentId, departmentIds: t.departmentIds,
      due: t.due, createdAt: t.createdAt, url: t.url, doneAt: t.doneAt ?? (finished ? t.editedAt : null),
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
    plannedIds: relation(pr["Planned Tasks"]),
    notes: plain(pr["Notes"]),
  };
}

export async function fetchDays(sinceDay: string): Promise<Day[]> {
  const pages = await queryAll(DAYS_DATA_SOURCE_ID, { property: "Date", date: { on_or_after: sinceDay } });
  return pages.map(toDay).sort((a, b) => b.date.localeCompare(a.date));
}

const rel = (ids: string[]) => ({ relation: ids.slice(0, 100).map((id) => ({ id })) });

export async function createDay(day: string, signedIn: string, plannedIds: string[]): Promise<string> {
  const label = new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const page = await notion().pages.create({
    parent: { type: "data_source_id", data_source_id: DAYS_DATA_SOURCE_ID },
    properties: {
      Day: { title: richText(label) },
      Date: { date: { start: day } },
      "Signed In": { date: { start: signedIn } },
      Planned: { number: plannedIds.length },
      "Planned Tasks": rel(plannedIds),
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
    p["Planned Tasks"] = rel(patch.plannedIds);
    p["Planned"] = { number: patch.plannedIds.length };
  }
  const nums: [keyof DayStats, string][] = [
    ["done", "Done"], ["signalDone", "Signal Done"], ["noiseDone", "Noise Done"], ["plannedDone", "Planned Done"],
    ["carriedOver", "Carried Over"], ["idleMinutes", "Idle Minutes"],
  ];
  for (const [k, name] of nums) if (patch[k] !== undefined) p[name] = { number: patch[k] };
  if (patch.doneIds !== undefined) p["Done Tasks"] = rel(patch.doneIds);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await notion().pages.update({ page_id: id, properties: p as any });
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

const richText = (s: string) => [{ type: "text", text: { content: s.slice(0, 2000) } }];

function patchToProperties(patch: TaskPatch) {
  const p: Record<string, unknown> = {};
  if (patch.name !== undefined) p["Name"] = { title: richText(patch.name) };
  if (patch.status !== undefined && patch.status !== null) p["Status"] = { status: { name: patch.status } };
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
  return p;
}

export async function updateTaskInNotion(id: string, patch: TaskPatch) {
  await notion().pages.update({
    page_id: id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: patchToProperties(patch) as any,
  });
}

export async function createTaskInNotion(t: NewTask, sprintId: string | null): Promise<string> {
  const oldNames = await levelsUseOldNames();
  const properties: Record<string, unknown> = {
    ...patchToProperties({
      name: t.name,
      status: "To Start",
      priority: t.priority ?? null,
      due: t.due ?? null,
      focus: t.focus ?? null,
      focusOrder: t.focusOrder ?? null,
      noise: t.noise ?? false,
    }),
    "Task Level": { select: { name: levelToNotion(t.level, oldNames) } },
    Assigned: { people: [{ id: DEFAULT_ASSIGNEE_ID }] },
  };
  if (t.parentId) properties["Parent item"] = { relation: [{ id: t.parentId }] };
  if (t.departmentIds?.length) properties["Departments"] = { relation: t.departmentIds.map((id) => ({ id })) };
  if (sprintId) properties["Sprint"] = { relation: [{ id: sprintId }] };
  const page = await notion().pages.create({
    parent: { type: "data_source_id", data_source_id: TASKS_DATA_SOURCE_ID },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: properties as any,
  });
  return page.id;
}
