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
// New tasks are assigned to this Notion user so they show in "assigned to me" views.
export const DEFAULT_ASSIGNEE_ID =
  process.env.NOTION_DEFAULT_ASSIGNEE_ID ?? "e89eed68-ee97-4241-ab9b-7588b0e4bad8";

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
export const FOCUS = ["main", "dashboard", "today"] as const;
export type Focus = (typeof FOCUS)[number];
export const FOCUS_NOTION: Record<Focus, string> = { main: "Main", dashboard: "Dashboard", today: "Today" };
export const focusFromNotion = (name: string | null): Focus | null =>
  (Object.entries(FOCUS_NOTION).find(([, v]) => v === name)?.[0] as Focus) ?? null;

export const DASHBOARD_SLOTS = 3;
export const TIME_ZONE = "America/Toronto";
// The AI planner (via Vercel AI Gateway).
export const PLANNER_MODEL = process.env.PLANNER_MODEL ?? "anthropic/claude-sonnet-5.5";
export const TODAY_TARGET = { min: 2, max: 6 };
// Unplanned tasks due within this many days count as noise.
export const NOISE_DUE_DAYS = 2;
