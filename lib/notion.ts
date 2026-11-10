import "server-only";
import { Client, isFullPage } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client";
import {
  DEFAULT_ASSIGNEE_ID,
  DEPARTMENTS_DATA_SOURCE_ID,
  FOCUS_NOTION,
  SPRINTS_DATA_SOURCE_ID,
  TASKS_DATA_SOURCE_ID,
  focusFromNotion,
  levelFromNotion,
  levelToNotion,
} from "./config";
import type { Department, NewTask, Task, TaskPatch } from "./types";

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
  return pages.map((p) => ({ id: p.id, name: plain(p.properties["Name"]) || "Untitled" }));
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
