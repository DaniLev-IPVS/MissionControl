import "server-only";
import { Client, isFullPage } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client";
import { SPRINTS_DATA_SOURCE_ID, TASKS_DATA_SOURCE_ID, levelFromNotion } from "./config";
import type { Sprint, Task, TaskPatch } from "./types";

let client: Client | null = null;
function notion() {
  if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN is not set");
  client ??= new Client({ auth: process.env.NOTION_TOKEN });
  return client;
}

type Props = PageObjectResponse["properties"];
type Prop = Props[string];

const text = (p?: Prop) =>
  p?.type === "title" ? p.title.map((t) => t.plain_text).join("") : "";
const status = (p?: Prop) => (p?.type === "status" ? (p.status?.name ?? null) : null);
const select = (p?: Prop) => (p?.type === "select" ? (p.select?.name ?? null) : null);
const date = (p?: Prop) => (p?.type === "date" ? (p.date?.start ?? null) : null);
const dateEnd = (p?: Prop) => (p?.type === "date" ? (p.date?.end ?? null) : null);
const relation = (p?: Prop) => (p?.type === "relation" ? p.relation.map((r) => r.id) : []);

function titleOf(page: PageObjectResponse) {
  const prop = Object.values(page.properties).find((p) => p.type === "title");
  return text(prop) || "Untitled";
}

async function queryAll(dataSourceId: string, filter?: object) {
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion().dataSources.query({
      data_source_id: dataSourceId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter: filter as any,
      page_size: 100,
      start_cursor: cursor,
    });
    for (const r of res.results) if (isFullPage(r)) pages.push(r);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return pages;
}

export async function fetchSprints(): Promise<Sprint[]> {
  const pages = await queryAll(SPRINTS_DATA_SOURCE_ID);
  return pages.map((p) => ({
    id: p.id,
    name: titleOf(p),
    status: status(p.properties["Sprint status"]),
    start: date(p.properties["Dates"]),
    end: dateEnd(p.properties["Dates"]),
  }));
}

export async function fetchTasks(sprintId: string): Promise<Task[]> {
  const pages = await queryAll(TASKS_DATA_SOURCE_ID, {
    property: "Sprint",
    relation: { contains: sprintId },
  });
  // Has the Task Level select been renamed in Notion yet? (see levelFromNotion)
  const oldNames = !pages.some((p) => select(p.properties["Task Level"]) === "Task");
  return pages.map((p) => {
    const pr = p.properties;
    return {
      id: p.id,
      url: p.url,
      name: text(pr["Name"]) || "Untitled",
      status: status(pr["Status"]),
      priority: select(pr["Priority"]),
      level: levelFromNotion(select(pr["Task Level"]), oldNames),
      due: date(pr["Due Date"]),
      projectIds: relation(pr["My Projects"]),
      parentId: relation(pr["Parent item"])[0] ?? null,
      hasChildren: relation(pr["Sub-item"]).length > 0,
      editedAt: p.last_edited_time,
    };
  });
}

export async function fetchTitle(pageId: string): Promise<string> {
  try {
    const page = await notion().pages.retrieve({ page_id: pageId });
    return isFullPage(page) ? titleOf(page) : "Untitled";
  } catch {
    return "(no access)";
  }
}

export async function updateTaskInNotion(id: string, patch: TaskPatch) {
  const properties: Record<string, unknown> = {};
  if (patch.status !== undefined) properties["Status"] = { status: { name: patch.status } };
  if (patch.priority !== undefined)
    properties["Priority"] = { select: patch.priority ? { name: patch.priority } : null };
  if (patch.due !== undefined)
    properties["Due Date"] = { date: patch.due ? { start: patch.due } : null };
  await notion().pages.update({
    page_id: id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: properties as any,
  });
}
