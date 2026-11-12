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
  missedOn: string | null; // last day it was planned but not finished (YYYY-MM-DD)
  /** Delegated: still yours, someone else is doing it. When it was handed over (ISO); null/absent = not delegated. */
  delegatedAt?: string | null;
  /** When an answer is expected: a day (YYYY-MM-DD) or an exact time (ISO). Optional. */
  expectBy?: string | null;
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
  /** Past midnight on a day that wasn't ended: "still working" is confirmed until this time (ISO). */
  workingUntil?: string | null;
};

export type DayStats = Omit<Day, "id" | "date" | "signedIn" | "signedOut" | "plannedIds" | "notes" | "workingUntil"> & {
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
    | "missedOn"
    | "delegatedAt"
    | "expectBy"
  >
>;

export type Change = { id: string; patch: TaskPatch };

/**
 * One item pulled out of a pop-up typed into the top bar (answer of /api/popup).
 * A pop-up can hold several things; each becomes a cleanly named task, mission or project.
 */
export type PopupItem = {
  key: string; // "n1", "n2"… unique within one answer
  name: string; // rewritten as a short action, not the words as typed
  level: Level;
  parentId: string | null; // an existing mission or project on the board
  parentKey: string | null; // or another item in this same answer (always listed before it)
  departmentIds: string[];
  due: string | null;
  where: string; // "Finance › Open the business bank account", or "" when unfiled
};

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
