// Notion data sources (collection ids). Not secrets: they only work with a
// token that has been shared into the databases.
export const TASKS_DATA_SOURCE_ID =
  process.env.NOTION_TASKS_DATA_SOURCE_ID ?? "2c463a9c-0965-816d-a00d-000b07b5c00a";
export const SPRINTS_DATA_SOURCE_ID =
  process.env.NOTION_SPRINTS_DATA_SOURCE_ID ?? "31163a9c-0965-804d-a7fc-000b570f0c20";
export const DAYS_DATA_SOURCE_ID =
  process.env.NOTION_DAYS_DATA_SOURCE_ID ?? "774940d5-dec4-4416-94f1-32e8a05108f8";
export const DEPARTMENTS_DATA_SOURCE_ID =
  process.env.NOTION_DEPARTMENTS_DATA_SOURCE_ID ?? "2c463a9c-0965-816b-85c1-000baa6065d1";
// Influity Task Board (shared with the team): only tasks for MY_USER_IDS show up.
export const INFLUITY_TASKS_DATA_SOURCE_ID =
  process.env.NOTION_INFLUITY_DATA_SOURCE_ID ?? "0d95c9cd-9cf0-4419-b9a5-8a3e3a7f3075";
// Lanes / Signal-Noise / idle state for shared-board tasks, kept in the private
// Mission Control data row (Personal board) so the shared board needs no extra columns.
export const TASK_STATE_DATA_SOURCE_ID =
  process.env.NOTION_TASK_STATE_DATA_SOURCE_ID ?? "c02dca98-5938-4ffe-bc62-95470c727744";
// The Personal board row that holds Mission Control's own databases (Days, Task State).
// Kept there so the integration reaches them without an extra share; hidden in the site.
export const MC_DATA_PAGE_ID = process.env.NOTION_MC_DATA_PAGE_ID ?? "41563a9c-0965-811d-9217-ff907b3001e8";
// New tasks are assigned to this Notion user so they show in "assigned to me" views.
export const DEFAULT_ASSIGNEE_ID =
  process.env.NOTION_DEFAULT_ASSIGNEE_ID ?? "e89eed68-ee97-4241-ab9b-7588b0e4bad8";

// Notion users that count as "me" on shared boards (Dani Lev; not Dan).
export const MY_USER_IDS = (process.env.NOTION_MY_USER_IDS ?? DEFAULT_ASSIGNEE_ID)
  .split(",").map((s) => s.trim()).filter(Boolean);

export const BOARD_TAG = "board";

// No token in development = run against an in-memory mock board.
export const USE_MOCK = !process.env.NOTION_TOKEN && process.env.NODE_ENV !== "production";

// ---- Status ---------------------------------------------------------------
export const STATUS_GROUPS = {
  todo: ["To Start", "Unblocked", "Groom", "Backlog"],
  blocked: ["Blocked", "BLOCKING"],
  doing: ["Working on it", "Under Review", "Fulfilled"],
  done: ["Done", "Cancelled"],
} as const;
export const ALL_STATUSES = Object.values(STATUS_GROUPS).flat();
export const PRIORITIES = ["P0", "P1", "P2"] as const;

export const isBlockedStatus = (s: string | null) =>
  (STATUS_GROUPS.blocked as readonly string[]).includes(s ?? "");
export const isDoneStatus = (s: string | null) =>
  (STATUS_GROUPS.done as readonly string[]).includes(s ?? "");
export const isTodoStatus = (s: string | null) =>
  !s || (STATUS_GROUPS.todo as readonly string[]).includes(s);

// ---- Levels: Project > Mission > Task ---------------------------------------
// Notion was renamed from Mission > Checkpoint > Bite on 2026-11-10; the old
// names are still read while the option rename is in progress.
export const LEVELS = ["project", "mission", "task"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABELS: Record<Level, string> = { project: "Project", mission: "Mission", task: "Task" };
export const CHILD_LEVEL: Record<Level, Level> = { project: "mission", mission: "task", task: "task" };

// "Mission" changed meaning (old top level -> new middle level), so it is
// resolved from the Task Level options: while "Checkpoint" exists, Notion uses the old names.
export function levelFromNotion(name: string | null, oldNames: boolean): Level | null {
  switch (name) {
    case "Project": return "project";
    case "Mission": return oldNames ? "project" : "mission";
    case "Checkpoint": return "mission";
    case "Task":
    case "Bite": return "task";
    default: return null;
  }
}
export function levelToNotion(level: Level, oldNames: boolean): string {
  if (oldNames) return { project: "Mission", mission: "Checkpoint", task: "Bite" }[level];
  return LEVEL_LABELS[level];
}

// ---- Focus stages (Signal / Noise) -----------------------------------------
// "detour" is not signal: it's a pop-up you chose to work on anyway ("Working on noise").
// Notion adds the select option the first time it is written.
export const FOCUS = ["main", "dashboard", "today", "detour"] as const;
export type Focus = (typeof FOCUS)[number];
export const FOCUS_NOTION: Record<Focus, string> = {
  main: "Main",
  dashboard: "Dashboard",
  today: "Today",
  detour: "Working on noise",
};
/** The lanes that make up the day's plan. */
export type SignalFocus = Exclude<Focus, "detour">;
export const focusFromNotion = (name: string | null): Focus | null =>
  (Object.entries(FOCUS_NOTION).find(([, v]) => v === name)?.[0] as Focus) ?? null;

export const DASHBOARD_SLOTS = 3;
export const TIME_ZONE = "America/Toronto";
export const TODAY_TARGET = { min: 2, max: 6 };
// Unplanned tasks due within this many days count as noise.
export const NOISE_DUE_DAYS = 2;
