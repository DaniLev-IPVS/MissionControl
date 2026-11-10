import type { Focus, Level } from "./config";

export type Task = {
  id: string;
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
  createdAt: string;
  editedAt: string;
};

export type Department = { id: string; name: string };

export type Board = {
  tasks: Task[]; // every open task (not Done / Cancelled)
  doneToday: { id: string; name: string }[];
  departments: Department[];
  titles: Record<string, string>; // parent / sprint titles for ids not in tasks
  currentSprintId: string | null;
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
