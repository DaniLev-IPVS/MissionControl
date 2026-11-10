import type { Focus, Level } from "./config";

export type BoardKey = "personal" | "influity";

export type Task = {
  id: string;
  board?: BoardKey; // which Notion board the task lives on (default personal)
  url: string;
  name: string;
  status: string | null;
  priority: string | null;
  level: Level | null; // project > mission > task
  due: string | null;
  estMin: number | null;
  departmentIds: string[];
  parentId: string | null;
  sprintId: string | null;
  // Mission Control
  focus: Focus | null; // null = to-do list (or noise)
  focusOrder: number | null;
  noise: boolean; // pop-up / unplanned
  idleSince: string | null; // ISO datetime
  idleReminder: string | null; // ISO datetime
  idleMinutes: number;
  idleLog: string;
  doneAt: string | null;
  doneAs: "Signal" | "Noise" | null;
  createdAt: string;
  editedAt: string;
};

/** Slim task used by the timeline (includes finished tasks). */
export type TreeTask = Pick<
  Task,
  "id" | "board" | "name" | "status" | "level" | "parentId" | "departmentIds" | "due" | "createdAt" | "doneAt" | "url"
>;

export type DoneItem = { id: string; name: string; doneAs: "Signal" | "Noise" | null; focus: Focus | null; noise: boolean };

export type Day = {
  id: string;
  date: string; // YYYY-MM-DD
  signedIn: string | null;
  signedOut: string | null;
  planned: number;
  done: number;
  signalDone: number;
  noiseDone: number;
  plannedDone: number;
  carriedOver: number;
  idleMinutes: number;
  plannedIds: string[];
  notes: string;
};

export type DayStats = Omit<Day, "id" | "date" | "signedIn" | "signedOut" | "plannedIds" | "notes"> & {
  doneIds: string[];
};

export type Department = { id: string; name: string };

export type Board = {
  tasks: Task[]; // every open task (not Done / Cancelled)
  doneToday: DoneItem[];
  day: Day | null; // today's row in Mission Control Days
  departments: Department[];
  titles: Record<string, string>; // parent / sprint titles for ids not in tasks
  currentSprintId: string | null;
  warnings: string[]; // parts that couldn't load (the rest of the board still works)
  fetchedAt: string;
};

export type TaskPatch = Partial<
  Pick<
    Task,
    | "name"
    | "status"
    | "priority"
    | "due"
    | "focus"
    | "focusOrder"
    | "noise"
    | "idleSince"
    | "idleReminder"
    | "idleMinutes"
    | "idleLog"
    | "doneAt"
    | "doneAs"
  >
>;

export type Change = { id: string; patch: TaskPatch };

export type NewTask = {
  tempId: string;
  name: string;
  level: Level;
  parentId?: string | null;
  departmentIds?: string[];
  focus?: Focus | null;
  focusOrder?: number | null;
  noise?: boolean;
  due?: string | null;
  priority?: string | null;
};
