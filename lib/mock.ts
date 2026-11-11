import "server-only";
import type { Day, DayStats, Department, DoneItem, NewTask, Task, TaskPatch, TreeTask } from "./types";

// Fake data for local development without a Notion token.
type Store = { tasks: Task[]; done: DoneItem[]; archive: TreeTask[]; days: Day[]; departments: Department[] };

const g = globalThis as unknown as { __mockStore?: Store };

function day(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function seed(): Store {
  const now = new Date().toISOString();
  let n = 0;
  const t = (name: string, extra: Partial<Task> = {}): Task => ({
    id: extra.id ?? `m${++n}`, url: "https://www.notion.so", name, status: "To Start", priority: "P1",
    level: "task", due: null, estMin: null, departmentIds: ["d-ops"], parentId: null, sprintId: "s-cur",
    focus: null, focusOrder: null, noise: false, idleSince: null, idleReminder: null, idleMinutes: 0,
    idleLog: "", doneAt: null, doneAs: null, missedOn: null, createdAt: now, editedAt: now, ...extra,
  });
  const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  const fin = (name: string, parentId: string, dept: string, created: number, done: number): TreeTask => ({
    id: `a${++n}`, name, status: "Done", level: "task", parentId, departmentIds: [dept], due: null,
    createdAt: ago(created), doneAt: ago(done), url: "https://www.notion.so",
  });
  const dayRow = (offset: number, sig: number, noi: number, planned: number, pDone: number): Day => {
    const d = day(-offset);
    return {
      id: `day-${d}`, date: d, signedIn: `${d}T09:0${offset}:00.000Z`, signedOut: `${d}T17:4${offset}:00.000Z`,
      planned, done: sig + noi, signalDone: sig, noiseDone: noi, plannedDone: pDone, carriedOver: planned - pDone,
      idleMinutes: 20 + offset * 7, plannedIds: [], notes: offset === 1 ? "Good focus day, bank stuff dragged." : "",
    };
  };
  return {
    departments: [
      { id: "d-ops", name: "Studio Ops" },
      { id: "d-sales", name: "Sales" },
      { id: "d-prod", name: "Production" },
      { id: "d-fin", name: "Finance" },
    ],
    done: [{ id: "x1", name: "Send the weekly update", doneAs: "Noise", focus: null, noise: true }],
    archive: [
      fin("Outline the pilot scope", "ms-deal", "d-sales", 20, 12),
      fin("First call with the client", "ms-deal", "d-sales", 21, 15),
      fin("Storyboard batch 4", "ms-batch", "d-prod", 14, 6),
      fin("Record voice-over", "ms-batch", "d-prod", 14, 4),
      fin("Edit rough cut", "ms-batch", "d-prod", 13, 2),
      fin("Pick the bank", "ms-bank", "d-fin", 9, 3),
      fin("Write the job post", "ms-hire", "d-prod", 30, 25),
    ],
    days: [dayRow(1, 6, 2, 8, 5), dayRow(2, 4, 4, 7, 4), dayRow(3, 7, 1, 8, 7), dayRow(4, 3, 3, 6, 3), dayRow(5, 5, 2, 7, 5)],
    tasks: [
      // Projects
      t("Sales", { id: "p-sales", level: "project", departmentIds: ["d-sales"], status: "Working on it", priority: "P0" }),
      t("Production", { id: "p-prod", level: "project", departmentIds: ["d-prod"], status: "Working on it" }),
      t("Brand refresh", { id: "p-brand", level: "project", departmentIds: ["d-ops"], status: "Groom", priority: "P2" }),
      // Missions
      t("Close the pilot deal", { id: "ms-deal", level: "mission", parentId: "p-sales", departmentIds: ["d-sales"], priority: "P0", due: day(3) }),
      t("Ship the next video batch", { id: "ms-batch", level: "mission", parentId: "p-prod", departmentIds: ["d-prod"] }),
      t("Open the business bank account", { id: "ms-bank", level: "mission", departmentIds: ["d-fin"], priority: "P0", due: day(1) }),
      t("Hire a second editor", { id: "ms-hire", level: "mission", parentId: "p-prod", departmentIds: ["d-prod"], priority: "P2" }),
      // Tasks
      t("Draft the pilot proposal", { parentId: "ms-deal", departmentIds: ["d-sales"], priority: "P0", focus: "main", focusOrder: 1, status: "Working on it", estMin: 45 }),
      t("Render the three hero shots", { parentId: "ms-batch", departmentIds: ["d-prod"], focus: "dashboard", focusOrder: 1, idleSince: new Date(Date.now() - 7 * 60000).toISOString(), idleReminder: new Date(Date.now() + 8 * 60000).toISOString(), status: "Working on it" }),
      t("Write captions for batch 4", { parentId: "ms-batch", departmentIds: ["d-prod"], focus: "dashboard", focusOrder: 2, estMin: 20 }),
      t("Price the pilot options", { parentId: "ms-deal", departmentIds: ["d-sales"], focus: "dashboard", focusOrder: 3, priority: "P0" }),
      t("Collect company documents", { parentId: "ms-bank", departmentIds: ["d-fin"], focus: "today", focusOrder: 1, priority: "P0", due: day(0) }),
      t("Book the review call", { parentId: "ms-deal", departmentIds: ["d-sales"], focus: "today", focusOrder: 2, estMin: 10 }),
      t("Wait on the bank's answer", { parentId: "ms-bank", departmentIds: ["d-fin"], focus: "today", focusOrder: 3, status: "Blocked" }),
      t("Plan next week's shoot", { parentId: "ms-batch", departmentIds: ["d-prod"], focus: "today", focusOrder: 4, priority: "P2" }),
      // Noise
      t("Reply to the accountant", { departmentIds: ["d-fin"], noise: true, priority: "P1" }),
      t("Renew the domain", { departmentIds: ["d-ops"], due: day(1), priority: "P2" }),
      // Backlog
      t("Shortlist editor candidates", { parentId: "ms-hire", departmentIds: ["d-prod"], priority: "P2" }),
      t("Moodboard for the new logo", { parentId: "p-brand", level: "mission", departmentIds: ["d-ops"], priority: "P2" }),
      t("Clean up the asset drive", { departmentIds: ["d-ops"], priority: null }),
    ],
  };
}

export function mockStore(): Store {
  g.__mockStore ??= seed();
  return g.__mockStore;
}

export function mockUpdate(id: string, patch: TaskPatch) {
  const s = mockStore();
  const task = s.tasks.find((t) => t.id === id);
  if (!task) throw new Error("Task not found");
  Object.assign(task, patch, { editedAt: new Date().toISOString() });
  if (task.status === "Done" || task.status === "Cancelled") {
    s.tasks = s.tasks.filter((t) => t.id !== id);
    s.archive.push({ ...task, doneAt: task.doneAt ?? new Date().toISOString() });
    if (task.status === "Done")
      s.done.unshift({ id: task.id, name: task.name, doneAs: task.doneAs, focus: task.focus, noise: task.noise });
  }
}

export function mockCreate(t: NewTask): string {
  const id = `new-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  mockStore().tasks.push({
    id, url: "https://www.notion.so", name: t.name, status: "To Start", priority: t.priority ?? null,
    level: t.level, due: t.due ?? null, estMin: null, departmentIds: t.departmentIds ?? [],
    parentId: t.parentId ?? null, sprintId: "s-cur", focus: t.focus ?? null, focusOrder: t.focusOrder ?? null,
    noise: t.noise ?? false, idleSince: null, idleReminder: null, idleMinutes: 0, idleLog: "",
    doneAt: null, doneAs: null, missedOn: null, createdAt: now, editedAt: now,
  });
  return id;
}

export function mockTree(): TreeTask[] {
  const s = mockStore();
  return [
    ...s.tasks.map((t) => ({
      id: t.id, name: t.name, status: t.status, level: t.level, parentId: t.parentId, departmentIds: t.departmentIds,
      due: t.due, createdAt: new Date(Date.now() - 10 * 86400000).toISOString(), doneAt: null, url: t.url,
    })),
    ...s.archive,
  ];
}

export function mockCreateDay(date: string, signedIn: string, plannedIds: string[]) {
  const d: Day = {
    id: `day-${date}`, date, signedIn, signedOut: null, planned: plannedIds.length, done: 0, signalDone: 0,
    noiseDone: 0, plannedDone: 0, carriedOver: 0, idleMinutes: 0, plannedIds, notes: "",
  };
  const s = mockStore();
  s.days = [d, ...s.days.filter((x) => x.date !== date)];
  return d.id;
}

export function mockUpdateDay(
  id: string,
  patch: Partial<DayStats> & { signedIn?: string | null; signedOut?: string | null; notes?: string; plannedIds?: string[] },
) {
  const d = mockStore().days.find((x) => x.id === id);
  if (!d) throw new Error("Day not found");
  const { doneIds, ...rest } = patch;
  void doneIds;
  Object.assign(d, rest);
  if (patch.plannedIds) d.planned = patch.plannedIds.length;
}
