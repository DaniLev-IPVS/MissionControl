// Notion data sources (collection ids). Not secrets: they only work with a
// token that has been shared into the databases.
export const TASKS_DATA_SOURCE_ID =
  process.env.NOTION_TASKS_DATA_SOURCE_ID ?? "2c463a9c-0965-816d-a00d-000b07b5c00a";
export const SPRINTS_DATA_SOURCE_ID =
  process.env.NOTION_SPRINTS_DATA_SOURCE_ID ?? "31163a9c-0965-804d-a7fc-000b570f0c20";

export const BOARD_TAG = "board";

// No token in development = run against an in-memory mock board.
export const USE_MOCK = !process.env.NOTION_TOKEN && process.env.NODE_ENV !== "production";

// Status options in the Personal Ticket Board, grouped the way Notion groups them.
export const STATUS_GROUPS = {
  todo: ["To Start", "Unblocked", "Groom", "Backlog"],
  blocked: ["Blocked", "BLOCKING"],
  doing: ["Working on it", "Under Review", "Fulfilled"],
  done: ["Done", "Cancelled"],
} as const;

export const COLUMNS = [
  { key: "todo", title: "To do", dropStatus: "To Start" },
  { key: "blocked", title: "Blocked", dropStatus: "Blocked" },
  { key: "doing", title: "In progress", dropStatus: "Working on it" },
  { key: "done", title: "Done", dropStatus: "Done" },
] as const;

// Task levels, renamed for the site. Notion still stores the old names
// (Mission / Checkpoint / Bite); the new names are accepted too, so renaming
// the options in Notion later needs no code change.
export const LEVELS = ["project", "mission", "task"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABELS: Record<Level, string> = { project: "Project", mission: "Mission", task: "Task" };
const LEVEL_FROM_NOTION: Record<string, Level> = {
  Mission: "project", // old top level
  Checkpoint: "mission",
  Bite: "task",
  Project: "project",
  Task: "task",
};
// "Mission" is ambiguous after a rename in Notion, so it is resolved by the
// option set: if Notion has no "Checkpoint" option any more, "Mission" means mission.
export function levelFromNotion(name: string | null, notionStillUsesOldNames = true): Level | null {
  if (!name) return null;
  if (name === "Mission" && !notionStillUsesOldNames) return "mission";
  return LEVEL_FROM_NOTION[name] ?? null;
}

export const ALL_STATUSES = Object.values(STATUS_GROUPS).flat();
export const PRIORITIES = ["P0", "P1", "P2"] as const;
