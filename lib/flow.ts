// Signal / Noise flow engine. Pure functions: given the current tasks and an
// action, return the Notion edits (Change[]) and new tasks (NewTask[]) to make.
//
//   Main (1)  <-  Dashboard (3)  <-  Today (2-6)  <-  To-do list
//   Noise: unplanned tasks (pop-ups, or due within NOISE_DUE_DAYS)
//   Detour ("Working on noise"): a pop-up you chose to work on anyway. It sits beside
//   Main, never in it, and counts as noise when it gets done.
//   A pop-up sent to signal keeps its Noise flag: that's what marks it as unplanned.
//
// After every action, autofill() promotes the next eligible Dashboard task to
// Main and refills the Dashboard from Today, in Focus Order.

import {
  CHILD_LEVEL,
  DASHBOARD_SLOTS,
  NOISE_DUE_DAYS,
  isBlockedStatus,
  isDoneStatus,
  isTodoStatus,
  type Focus,
  type SignalFocus,
} from "./config";
import type { Change, NewTask, Task, TaskPatch } from "./types";

export type Lane = "main" | "dashboard" | "today" | "detour" | "noise" | "backlog";
export type Sections = {
  main: Task | null;
  dashboard: Task[];
  today: Task[];
  detour: Task[]; // noise being worked on right now
  noise: Task[]; // noise that came up, not picked up
  backlog: Task[];
};
export type Plan = { changes: Change[]; creates: NewTask[] };

// ---- Basics -----------------------------------------------------------------
export const isBlocked = (t: Task) => isBlockedStatus(t.status);
export const isIdle = (t: Task) => !!t.idleSince;
const canLead = (t: Task) => !isBlocked(t) && !isIdle(t);
/** Delegated: on you, but someone else is doing it. Idle then means "waiting on them", not on AI. */
export const isDelegated = (t: Pick<Task, "delegatedAt">) => !!t.delegatedAt;
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** When the follow-up for a delegated task is due (ms). A day without a time means 9:00 that morning. */
export function expectAt(expectBy: string | null | undefined): number | null {
  if (!expectBy) return null;
  const ms = Date.parse(DAY_ONLY.test(expectBy) ? `${expectBy}T09:00:00` : expectBy);
  return Number.isNaN(ms) ? null : ms;
}
// ---- Carried over: planned or started on an earlier day, and not finished ----------------
/** Appended to a task's idle log line when the day ended while it was still handed off. */
export const DAY_ENDED_MARK = "· day ended";
/** Still handed off (idle) when its last day ended: the first thing to pick up next. */
export function leftIdle(t: Pick<Task, "idleLog" | "idleSince">) {
  if (t.idleSince) return false;
  const lines = t.idleLog ? t.idleLog.split("\n").filter(Boolean) : [];
  return !!lines.length && lines[lines.length - 1].trimEnd().endsWith(DAY_ENDED_MARK);
}
/** Planned on an earlier day and not finished, or started and left unfinished. */
export const isCarried = (t: Task) =>
  !t.focus && !t.delegatedAt && (!!t.missedOn || t.status === "Working on it" || leftIdle(t));
/** Carried-over work in the order to pick it up: left idle first, then the most recently missed. */
export const byCarried = (a: Task, b: Task) =>
  Number(leftIdle(b)) - Number(leftIdle(a)) || (b.missedOn ?? "").localeCompare(a.missedOn ?? "");

/** "Nov 15" for a day, "Nov 15, 3:00 PM" for an exact time. */
export function fmtExpect(expectBy: string) {
  const at = expectAt(expectBy);
  if (at === null) return expectBy;
  return new Date(at).toLocaleString(
    undefined,
    DAY_ONLY.test(expectBy) ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}

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
    detour: tasks.filter((t) => t.focus === "detour").sort(byOrder),
    noise: tasks.filter((t) => isNoise(t, today)),
    backlog: tasks.filter((t) => !t.focus && !isNoise(t, today)),
  };
}

export function laneOf(t: Task, today: string): Lane {
  if (t.focus) return t.focus;
  return isNoise(t, today) ? "noise" : "backlog";
}

export const isSignal = (t: Pick<Task, "focus">) => !!t.focus && t.focus !== "detour";
/** Signal that started as a pop-up: unplanned, but you decided it belongs in the plan. */
export const isPopupSignal = (t: Pick<Task, "focus" | "noise">) => isSignal(t) && t.noise;

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
/** Every open item under a task (missions and their tasks under a project, tasks under a mission). */
export function descendants(tasks: Task[], id: string): Task[] {
  const kids = new Map<string, Task[]>();
  for (const t of tasks) if (t.parentId) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t]);
  const out: Task[] = [];
  const seen = new Set<string>([id]);
  const walk = (pid: string) => {
    for (const k of kids.get(pid) ?? []) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push(k);
      walk(k.id);
    }
  };
  walk(id);
  return out;
}

/**
 * Close an open idle period: add its minutes to the task's idle total and log it.
 * Empty when the task isn't idle.
 */
export function closeIdle(task: Task, now = new Date()): TaskPatch {
  if (!task.idleSince) return {};
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(task.idleSince)) / 60000));
  const line = `${new Date(task.idleSince).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · idle ${mins} min`;
  return {
    idleMinutes: (task.idleMinutes ?? 0) + mins,
    idleLog: task.idleLog ? `${task.idleLog}\n${line}` : line,
    idleSince: null,
    idleReminder: null,
  };
}

const doneDetails = (task: Task, doneAs: "Signal" | "Noise", now: Date): TaskPatch => ({
  ...closeIdle(task, now),
  status: "Done",
  doneAs,
  doneAt: now.toISOString(),
  focus: null,
  focusOrder: null,
  idleSince: null,
  idleReminder: null,
  ...(task.delegatedAt ? { delegatedAt: null, expectBy: null } : {}),
});

/** How many open items marking this done would also close. */
export const openUnder = (tasks: Task[], task: Task) =>
  descendants(tasks, task.id).filter((t) => !isDoneStatus(t.status)).length;

/** Done. A project or mission takes everything still open under it along. */
export function done(tasks: Task[], task: Task, today: string, now = new Date()): Plan {
  // Work in a signal lane is signal, pop-ups you sent there included. Anything else is noise.
  const doneAs = isSignal(task) ? "Signal" : "Noise";
  const under = descendants(tasks, task.id).filter((t) => !isDoneStatus(t.status));
  return finish(tasks, today, [
    { id: task.id, patch: doneDetails(task, doneAs, now) },
    // Sub-items count the same way their own lane would have.
    ...under.map((t) => ({ id: t.id, patch: doneDetails(t, isSignal(t) ? "Signal" : "Noise", now) })),
  ]);
}

export function blocked(tasks: Task[], task: Task, today: string): Plan {
  const s = sections(tasks, today);
  return finish(tasks, today, [
    { id: task.id, patch: { ...closeIdle(task), status: "Blocked", focus: "today", focusOrder: maxOrder(s.today) + 1 } },
  ]);
}

/** Blocked from any card: planned work drops to the end of Today; unplanned work keeps its place. */
export function markBlocked(tasks: Task[], task: Task, today: string): Plan {
  if (isSignal(task)) return blocked(tasks, task, today);
  // Blocked noise you were working on drops back to the noise that came up.
  if (task.focus === "detour")
    return finish(tasks, today, [{ id: task.id, patch: { ...closeIdle(task), status: "Blocked", focus: null, focusOrder: null } }]);
  return finish(tasks, today, [{ id: task.id, patch: { ...closeIdle(task), status: "Blocked" } }]);
}

/**
 * Idle = handed off to AI (or another system) until it needs you again, with an optional
 * reminder to go back and check the session. Not a pause.
 *  - Main steps aside to the Dashboard, so the next task can lead.
 *  - Working on noise stays where it is: it's still being worked on, just not by you right now.
 */
export function idle(tasks: Task[], task: Task, today: string, remindInMin: number | null, now = new Date()): Plan {
  const reminder = remindInMin ? new Date(now.getTime() + remindInMin * 60000).toISOString() : null;
  if (task.focus === "detour") {
    return finish(tasks, today, [
      // Already idle: keep the period running, just reset the reminder.
      { id: task.id, patch: { idleSince: task.idleSince ?? now.toISOString(), idleReminder: reminder } },
    ]);
  }
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

/**
 * Delegated = handed to a person. It stays yours, so it stays on the board, but it steps out of
 * your hands the way idle does: Main moves aside, and a task in a lane waits on the Idle board.
 * Unlike idle, the delegation outlives the day: it is kept until you switch it off or finish the
 * task, and reminds you when the answer is expected. `expectBy` undefined keeps the date as is.
 */
export function delegate(tasks: Task[], task: Task, today: string, expectBy?: string | null, now = new Date()): Plan {
  const patch: TaskPatch = { delegatedAt: task.delegatedAt ?? now.toISOString() };
  if (expectBy !== undefined) patch.expectBy = expectBy;
  if (task.focus) {
    // Waiting on a person, not on an AI session: the "check the session" reminder goes.
    patch.idleSince = task.idleSince ?? now.toISOString();
    patch.idleReminder = null;
    if (task.focus === "main") {
      patch.focus = "dashboard";
      patch.focusOrder = maxOrder(sections(tasks, today).dashboard) + 1;
    }
  }
  return finish(tasks, today, [{ id: task.id, patch }]);
}

/** Switch delegated off. An idle task stays idle: it's waiting on AI again, not on a person. */
export function undelegate(task: Task): Plan {
  return { changes: [{ id: task.id, patch: { delegatedAt: null, expectBy: null } }], creates: [] };
}

/** Take a delegated task back to do it yourself: it becomes Main and is no longer delegated. */
export function takeBack(tasks: Task[], task: Task, today: string, now = new Date()): Plan {
  const plan = resumeIdle(tasks, task, today, now);
  const mine = { delegatedAt: null, expectBy: null };
  const touched = plan.changes.some((c) => c.id === task.id);
  return {
    ...plan,
    changes: touched
      ? plan.changes.map((c) => (c.id === task.id ? { ...c, patch: { ...c.patch, ...mine } } : c))
      : [...plan.changes, { id: task.id, patch: mine }],
  };
}

/** Set, move or clear when the answer is expected. */
export function expectBy(task: Task, when: string | null): Plan {
  return { changes: [{ id: task.id, patch: { expectBy: when } }], creates: [] };
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
  const patch: TaskPatch = { ...promote(task).patch, ...closeIdle(task, now) };
  if (isBlocked(task)) patch.status = "Working on it";
  // Pulled straight from noise: flag it, so it shows as a pop-up inside signal.
  if (!isSignal(task) && isUnplanned(task, today) && !task.noise) patch.noise = true;
  changes.push({ id: task.id, patch });
  return finish(tasks, today, changes);
}

/** Back from idle: noise you were working on stays put; anything else becomes Main. */
export function resumeIdle(tasks: Task[], task: Task, today: string, now = new Date()): Plan {
  if (task.focus === "detour") return finish(tasks, today, [{ id: task.id, patch: closeIdle(task, now) }]);
  return makeMain(tasks, task, today, now);
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
  if (lane === "detour") return workOnNoise(tasks, task, today);
  if (lane === "noise" || lane === "backlog") {
    return finish(tasks, today, [
      { id: task.id, patch: { ...closeIdle(task), focus: null, focusOrder: null, noise: lane === "noise" } },
    ]);
  }
  const s = sections(tasks, today);
  const list = (lane === "dashboard" ? s.dashboard : s.today).filter((t) => t.id !== task.id);
  list.splice(Math.max(0, Math.min(index, list.length)), 0, task);
  const changes: Change[] = [];
  list.forEach((t, i) => {
    const order = i + 1;
    if (t.id === task.id) {
      // Sent from noise to signal: keep (or set) the flag that marks it as a pop-up.
      const popup = !isSignal(task) && isUnplanned(task, today) && !task.noise;
      changes.push({ id: t.id, patch: { focus: lane as Focus, focusOrder: order, ...(popup ? { noise: true } : {}) } });
    } else if (t.focusOrder !== order || t.focus !== lane) changes.push({ id: t.id, patch: { focus: lane as Focus, focusOrder: order } });
  });
  return finish(tasks, today, changes);
}

// ---- Noise decisions ----------------------------------------------------------
/** In the noise lane or being worked on as noise. */
const isUnplanned = (t: Task, today: string) => t.focus === "detour" || isNoise(t, today);

/**
 * "I have to work on this": the pop-up becomes Working on noise. Main is left alone,
 * so it keeps showing what you should be working on.
 */
export function workOnNoise(tasks: Task[], task: Task, today: string): Plan {
  const s = sections(tasks, today);
  return finish(tasks, today, [
    {
      id: task.id,
      patch: clean({
        focus: "detour",
        focusOrder: maxOrder(s.detour.filter((t) => t.id !== task.id)) + 1,
        noise: true,
        status: isTodoStatus(task.status) || isBlocked(task) ? "Working on it" : undefined,
        idleSince: null,
        idleReminder: null,
      }),
    },
  ]);
}

/** "This belongs in the plan": the pop-up joins the end of Today, still marked as a pop-up. */
export function sendToSignal(tasks: Task[], task: Task, today: string): Plan {
  return moveTo(tasks, task, "today", Number.MAX_SAFE_INTEGER, today);
}

/** Out of signal (or off your hands) and back to the noise that came up. */
export function backToNoise(tasks: Task[], task: Task, today: string): Plan {
  return moveTo(tasks, task, "noise", 0, today);
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
    idleSince: null, idleReminder: null, idleMinutes: 0, idleLog: "", doneAt: null, doneAs: null, missedOn: null,
    createdAt: now, editedAt: now,
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
    noise: task.noise,
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

// ---- Day planning ------------------------------------------------------------------
/** Where the n-th planned item lands: 1st = Main, next 3 = Task switch, rest = Today. */
export function slotFor(index: number): SignalFocus {
  return index === 0 ? "main" : index <= DASHBOARD_SLOTS ? "dashboard" : "today";
}

/**
 * Commit an ordered day plan. Planned ids get their lane and order; anything that
 * was planned before but isn't any more goes back to the to-do list.
 * `creates` (new tasks from the planner) are placed at their position in `order`.
 */
export function commitPlan(tasks: Task[], order: string[], creates: NewTask[] = []): Plan {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const createById = new Map(creates.map((c) => [c.tempId, c]));
  const changes: Change[] = [];
  const keep = new Set(order);
  const counters: Record<Focus, number> = { main: 0, dashboard: 0, today: 0, detour: 0 };

  order.forEach((id, i) => {
    const focus = slotFor(i);
    const focusOrder = ++counters[focus];
    const draft = createById.get(id);
    if (draft) {
      draft.focus = focus;
      draft.focusOrder = focusOrder;
      return;
    }
    const t = byId.get(id);
    if (!t) return;
    const patch: TaskPatch = {};
    if (t.focus !== focus) patch.focus = focus;
    if (t.focusOrder !== focusOrder) patch.focusOrder = focusOrder;
    if (focus === "main" && isTodoStatus(t.status)) patch.status = "Working on it";
    if (Object.keys(patch).length) changes.push({ id, patch });
  });
  for (const t of tasks) {
    // Noise you're working on isn't part of the plan: re-planning leaves it where it is.
    if (isSignal(t) && !keep.has(t.id)) changes.push({ id: t.id, patch: { focus: null, focusOrder: null } });
  }
  return { changes, creates: creates.filter((c) => keep.has(c.tempId)) };
}

/** Current plan order: Main, then Task switch, then Today. */
export function currentOrder(tasks: Task[], today: string): string[] {
  const s = sections(tasks, today);
  return [...(s.main ? [s.main] : []), ...s.dashboard, ...s.today].map((t) => t.id);
}
