// Signal / Noise flow engine. Pure functions: given the current tasks and an
// action, return the Notion edits (Change[]) and new tasks (NewTask[]) to make.
//
//   Main (1)  <-  Dashboard (3)  <-  Today (2-6)  <-  To-do list
//   Noise: unplanned tasks (pop-ups, or due within NOISE_DUE_DAYS)
//
// After every action, autofill() promotes the next eligible Dashboard task to
// Main and refills the Dashboard from Today, in Focus Order.

import {
  CHILD_LEVEL,
  DASHBOARD_SLOTS,
  NOISE_DUE_DAYS,
  isBlockedStatus,
  isTodoStatus,
  type Focus,
} from "./config";
import type { Change, NewTask, Task, TaskPatch } from "./types";

export type Lane = "main" | "dashboard" | "today" | "noise" | "backlog";
export type Sections = { main: Task | null; dashboard: Task[]; today: Task[]; noise: Task[]; backlog: Task[] };
export type Plan = { changes: Change[]; creates: NewTask[] };

// ---- Basics -----------------------------------------------------------------
export const isBlocked = (t: Task) => isBlockedStatus(t.status);
export const isIdle = (t: Task) => !!t.idleSince;
const canLead = (t: Task) => !isBlocked(t) && !isIdle(t);

export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

export const byOrder = (a: Task, b: Task) =>
  (a.focusOrder ?? 1e9) - (b.focusOrder ?? 1e9) || a.createdAt.localeCompare(b.createdAt);

export function isNoise(t: Task, today: string) {
  return !t.focus && (t.noise || (!!t.due && t.due <= addDays(today, NOISE_DUE_DAYS)));
}

export function sections(tasks: Task[], today: string): Sections {
  const mains = tasks.filter((t) => t.focus === "main").sort(byOrder);
  return {
    main: mains[0] ?? null,
    // A second "Main" (e.g. set in Notion) is treated as next in line.
    dashboard: [...mains.slice(1), ...tasks.filter((t) => t.focus === "dashboard").sort(byOrder)],
    today: tasks.filter((t) => t.focus === "today").sort(byOrder),
    noise: tasks.filter((t) => isNoise(t, today)),
    backlog: tasks.filter((t) => !t.focus && !isNoise(t, today)),
  };
}

export function laneOf(t: Task, today: string): Lane {
  if (t.focus) return t.focus;
  return isNoise(t, today) ? "noise" : "backlog";
}

export const isSignal = (t: Task) => !!t.focus;

/** Tasks with no open children: the actionable bottom of the tree. */
export function lowestLevel(tasks: Task[]) {
  const parents = new Set(tasks.map((t) => t.parentId).filter(Boolean) as string[]);
  return tasks.filter((t) => !parents.has(t.id));
}

// ---- Change helpers ---------------------------------------------------------
function clean(patch: TaskPatch): TaskPatch {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as TaskPatch;
}

function merge(changes: Change[]): Change[] {
  const map = new Map<string, TaskPatch>();
  for (const c of changes) map.set(c.id, { ...map.get(c.id), ...clean(c.patch) });
  return [...map].map(([id, patch]) => ({ id, patch })).filter((c) => Object.keys(c.patch).length);
}

export function applyLocal(tasks: Task[], changes: Change[]): Task[] {
  const byId = new Map(changes.map((c) => [c.id, c.patch]));
  return tasks
    .map((t) => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t))
    .filter((t) => t.status !== "Done" && t.status !== "Cancelled");
}

const maxOrder = (list: Task[]) => list.reduce((m, t) => Math.max(m, t.focusOrder ?? 0), 0);
const minOrder = (list: Task[]) => list.reduce((m, t) => Math.min(m, t.focusOrder ?? 0), 1);

function promote(t: Task): Change {
  return {
    id: t.id,
    patch: clean({
      focus: "main",
      focusOrder: 0,
      status: isTodoStatus(t.status) ? "Working on it" : undefined,
    }),
  };
}

/** Fill Main from Dashboard/Today and keep the Dashboard at DASHBOARD_SLOTS. */
export function autofill(tasks: Task[], today: string): Change[] {
  const s = sections(tasks, today);
  const changes: Change[] = [];
  const dash = [...s.dashboard];
  const tod = [...s.today];

  if (!s.main) {
    const next = dash.find(canLead) ?? tod.find(canLead);
    if (next) {
      changes.push(promote(next));
      dash.splice(dash.indexOf(next), 1);
      if (tod.includes(next)) tod.splice(tod.indexOf(next), 1);
    }
  }

  // Too many on the Dashboard: send the last non-idle ones back to the top of Today.
  let front = minOrder(tod);
  while (dash.length > DASHBOARD_SLOTS) {
    const victim = [...dash].reverse().find((t) => !isIdle(t)) ?? dash[dash.length - 1];
    dash.splice(dash.indexOf(victim), 1);
    changes.push({ id: victim.id, patch: { focus: "today", focusOrder: --front } });
  }

  // Room on the Dashboard: pull the next unblocked tasks from Today.
  let order = maxOrder(dash);
  for (const t of tod.filter((x) => !isBlocked(x)).slice(0, DASHBOARD_SLOTS - dash.length)) {
    changes.push({ id: t.id, patch: { focus: "dashboard", focusOrder: ++order } });
  }
  return changes;
}

function finish(tasks: Task[], today: string, primary: Change[], creates: NewTask[] = []): Plan {
  const after = applyLocal(tasks, primary);
  const withNew = [...after, ...creates.map((c) => draftTask(c))];
  return { changes: merge([...primary, ...autofill(withNew, today).filter((c) => !c.id.startsWith("tmp-"))]), creates };
}

// ---- Main card actions --------------------------------------------------------
export function done(tasks: Task[], task: Task, today: string): Plan {
  return finish(tasks, today, [
    { id: task.id, patch: { status: "Done", focus: null, focusOrder: null, idleSince: null, idleReminder: null } },
  ]);
}

export function blocked(tasks: Task[], task: Task, today: string): Plan {
  const s = sections(tasks, today);
  return finish(tasks, today, [
    { id: task.id, patch: { status: "Blocked", focus: "today", focusOrder: maxOrder(s.today) + 1 } },
  ]);
}

export function idle(tasks: Task[], task: Task, today: string, remindInMin: number | null, now = new Date()): Plan {
  const s = sections(tasks, today);
  return finish(tasks, today, [
    {
      id: task.id,
      patch: {
        focus: "dashboard",
        focusOrder: maxOrder(s.dashboard) + 1,
        idleSince: now.toISOString(),
        idleReminder: remindInMin ? new Date(now.getTime() + remindInMin * 60000).toISOString() : null,
      },
    },
  ]);
}

/** Bring any task to Main. The current Main takes its place (or the front of the Dashboard). */
export function makeMain(tasks: Task[], task: Task, today: string, now = new Date()): Plan {
  const s = sections(tasks, today);
  const changes: Change[] = [];
  if (s.main && s.main.id !== task.id) {
    const swapIntoSlot = task.focus === "dashboard" || task.focus === "today";
    changes.push({
      id: s.main.id,
      patch: {
        focus: swapIntoSlot ? task.focus : "dashboard",
        focusOrder: swapIntoSlot ? task.focusOrder : minOrder(s.dashboard) - 1,
      },
    });
  }
  const patch: TaskPatch = { ...promote(task).patch };
  if (task.idleSince) {
    const mins = Math.max(0, Math.round((now.getTime() - Date.parse(task.idleSince)) / 60000));
    const line = `${new Date(task.idleSince).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · idle ${mins} min`;
    Object.assign(patch, {
      idleMinutes: (task.idleMinutes ?? 0) + mins,
      idleLog: task.idleLog ? `${task.idleLog}\n${line}` : line,
      idleSince: null,
      idleReminder: null,
    });
  }
  if (isBlocked(task)) patch.status = "Working on it";
  changes.push({ id: task.id, patch });
  return finish(tasks, today, changes);
}

export function unblock(tasks: Task[], task: Task, today: string): Plan {
  return finish(tasks, today, [{ id: task.id, patch: { status: "Unblocked" } }]);
}

export function snooze(task: Task, minutes: number, now = new Date()): Plan {
  return {
    changes: [{ id: task.id, patch: { idleReminder: new Date(now.getTime() + minutes * 60000).toISOString() } }],
    creates: [],
  };
}

// ---- Moving and ordering -----------------------------------------------------
/** Move a task into a lane at a position (index within that lane's visible order). */
export function moveTo(tasks: Task[], task: Task, lane: Lane, index: number, today: string): Plan {
  if (lane === "main") return makeMain(tasks, task, today);
  if (lane === "noise" || lane === "backlog") {
    return finish(tasks, today, [
      { id: task.id, patch: { focus: null, focusOrder: null, noise: lane === "noise", idleSince: null, idleReminder: null } },
    ]);
  }
  const s = sections(tasks, today);
  const list = (lane === "dashboard" ? s.dashboard : s.today).filter((t) => t.id !== task.id);
  list.splice(Math.max(0, Math.min(index, list.length)), 0, task);
  const changes: Change[] = [];
  list.forEach((t, i) => {
    const order = i + 1;
    if (t.id === task.id) changes.push({ id: t.id, patch: { focus: lane as Focus, focusOrder: order } });
    else if (t.focusOrder !== order || t.focus !== lane) changes.push({ id: t.id, patch: { focus: lane as Focus, focusOrder: order } });
  });
  return finish(tasks, today, changes);
}

// ---- Creating and splitting ---------------------------------------------------
let tmp = 0;
export const tempId = () => `tmp-${Date.now().toString(36)}-${++tmp}`;

export function draftTask(n: NewTask): Task {
  const now = new Date().toISOString();
  return {
    id: n.tempId, url: "", name: n.name, status: "To Start", priority: n.priority ?? null, level: n.level,
    due: n.due ?? null, estMin: null, departmentIds: n.departmentIds ?? [], parentId: n.parentId ?? null,
    sprintId: null, focus: n.focus ?? null, focusOrder: n.focusOrder ?? null, noise: n.noise ?? false,
    idleSince: null, idleReminder: null, idleMinutes: 0, idleLog: "", createdAt: now, editedAt: now,
  };
}

export function addTask(
  tasks: Task[],
  today: string,
  input: Omit<NewTask, "tempId" | "focusOrder"> & { lane: Lane },
): Plan {
  const s = sections(tasks, today);
  const { lane, ...rest } = input;
  const focus: Focus | null = lane === "dashboard" || lane === "today" ? lane : null;
  const listFor = lane === "dashboard" ? s.dashboard : s.today;
  const create: NewTask = {
    ...rest,
    tempId: tempId(),
    focus,
    focusOrder: focus ? maxOrder(listFor) + 1 : null,
    noise: lane === "noise" ? true : (rest.noise ?? false),
  };
  return finish(tasks, today, [], [create]);
}

/**
 * Split a task that is too big.
 *  - Task: it is renamed to the first part; the other parts become sibling tasks right after it.
 *  - Project / Mission: the parts become its children; the first child takes its place in the flow.
 */
export function split(tasks: Task[], task: Task, parts: string[], today: string): Plan {
  const names = parts.map((p) => p.trim()).filter(Boolean);
  if (!names.length) return { changes: [], creates: [] };
  const s = sections(tasks, today);
  const isLeafLevel = !task.level || task.level === "task";
  const base = {
    departmentIds: task.departmentIds,
    priority: task.priority,
    level: isLeafLevel ? ("task" as const) : CHILD_LEVEL[task.level!],
    parentId: isLeafLevel ? task.parentId : task.id,
  };
  const changes: Change[] = [];
  const creates: NewTask[] = [];

  // Where do the extra parts go? From Main they are next in line (front of the Dashboard);
  // otherwise right behind the original in the same lane.
  const fromMain = task.focus === "main";
  const lane: Focus | null = fromMain ? "dashboard" : task.focus;
  const laneList = lane === "dashboard" ? s.dashboard : lane === "today" ? s.today : [];

  let firstIsNew = false;
  if (isLeafLevel) {
    changes.push({ id: task.id, patch: { name: names[0] } });
  } else {
    firstIsNew = true;
    // The parent leaves the flow; its first child takes the slot.
    changes.push({ id: task.id, patch: { focus: null, focusOrder: null } });
    creates.push({ ...base, tempId: tempId(), name: names[0], focus: task.focus, focusOrder: task.focusOrder });
  }

  const extras = names.slice(1).map((name) => ({ ...base, tempId: tempId(), name }) as NewTask);
  if (lane) {
    const insertAt = fromMain ? 0 : laneList.findIndex((t) => t.id === task.id) + 1;
    const order: (Task | NewTask)[] = laneList.filter((t) => fromMain || t.id !== task.id || !firstIsNew);
    order.splice(insertAt, 0, ...extras);
    order.forEach((item, i) => {
      if ("tempId" in item) item.focusOrder = i + 1;
      else if (item.focusOrder !== i + 1) changes.push({ id: item.id, patch: { focusOrder: i + 1 } });
    });
    extras.forEach((e) => (e.focus = lane));
  }
  creates.push(...extras);
  return finish(tasks, today, changes, creates);
}
