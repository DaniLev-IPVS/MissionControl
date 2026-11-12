// The workday: when it is running, what ending it does, its statistics, and the midnight check.
// Shared by the browser and the server actions.
import { addDays, isSignal } from "./flow";
import type { Board, Change, Day, DayStats, Task } from "./types";

// ---- Is a day running? ----------------------------------------------------------------
/** How far back an un-ended day is still picked up (days). */
export const DAY_LOOKBACK = 3;

/** The day being worked: today's row, or an earlier one that was never ended (work ran past midnight). */
export function workingDay(days: Day[], today: string): Day | null {
  return (
    days.find((d) => d.date === today) ??
    days.filter((d) => d.date < today && d.signedIn && !d.signedOut).sort((a, b) => b.date.localeCompare(a.date))[0] ??
    null
  );
}

/** A day is running while anything sits in Main, Task switch, Today or Working on noise.
 *  Idle work stays in those lanes, so it counts. The to-do list and Noise don't. */
export const dayIsOn = (tasks: Task[]) => tasks.some((t) => !!t.focus);

/** What ending the day does: every lane is emptied. Planned work goes back to the to-do list
 *  marked as missed; noise that was being worked on just goes back to Noise. */
export function endOfDay(board: Board, tasks: Task[]) {
  const day = board.day;
  const planned = new Set(day?.plannedIds ?? []);
  const real = tasks.filter((t) => !t.id.startsWith("tmp-"));
  const carried = real.filter((t) => isSignal(t) || planned.has(t.id));
  const dropped = real.filter((t) => t.focus === "detour" && !planned.has(t.id));
  const returnIds = carried.map((t) => t.id);
  const dropIds = dropped.map((t) => t.id);
  const flush = { focus: null, focusOrder: null, idleSince: null, idleReminder: null };
  const changes: Change[] = [
    ...returnIds.map((id) => ({ id, patch: day ? { ...flush, missedOn: day.date } : flush })),
    ...dropIds.map((id) => ({ id, patch: flush })),
  ];
  // Idle time is read by date: use the day's own, so a day that ran past midnight keeps its numbers.
  const when = day ? new Date(`${day.date}T12:00:00`) : new Date();
  const stats: DayStats = { ...computeDayStats(board, tasks, when), carriedOver: carried.length };
  return { carried, dropped, returnIds, dropIds, changes, stats };
}

// ---- Midnight: a day that wasn't ended ----------------------------------------------------
// At midnight a silent pop-up asks whether you're still working. Confirm and the next check is
// an hour later; say nothing for 15 minutes and the day is ended for you.
export const CONFIRM_WINDOW_MIN = 15;
export const PUSH_MIN = 60;

/** When the "still working?" check is due for an open day, and when it runs out (ms). */
export function midnightCheck(day: Pick<Day, "date" | "workingUntil">, localUntil = 0) {
  const midnight = new Date(`${addDays(day.date, 1)}T00:00:00`).getTime();
  const confirmed = Math.max(day.workingUntil ? Date.parse(day.workingUntil) : 0, localUntil);
  const checkAt = Math.max(midnight, confirmed);
  return { checkAt, deadline: checkAt + CONFIRM_WINDOW_MIN * 60_000, next: checkAt + PUSH_MIN * 60_000 };
}

// ---- Statistics -------------------------------------------------------------------------

const todayLabel = (d: Date) => d.toLocaleString(undefined, { month: "short", day: "numeric" });

/** Idle minutes logged today, read from each task's Idle Log lines ("Nov 10, 3:07 PM · idle 12 min"). */
export function idleMinutesToday(tasks: Task[], now = new Date()) {
  const prefix = `${todayLabel(now)},`;
  let total = 0;
  for (const t of tasks) {
    for (const line of t.idleLog.split("\n")) {
      if (!line.startsWith(prefix)) continue;
      const m = line.match(/idle (\d+) min/);
      if (m) total += Number(m[1]);
    }
  }
  return total;
}

export function computeDayStats(board: Board, tasks: Task[], now = new Date()): DayStats {
  const done = board.doneToday;
  const isSignal = (d: Board["doneToday"][number]) => (d.doneAs ? d.doneAs === "Signal" : !!d.focus && !d.noise);
  const planned = new Set(board.day?.plannedIds ?? []);
  const doneIds = done.map((d) => d.id);
  const openIds = new Set(tasks.map((t) => t.id));
  return {
    planned: planned.size,
    done: done.length,
    signalDone: done.filter(isSignal).length,
    noiseDone: done.filter((d) => !isSignal(d)).length,
    plannedDone: doneIds.filter((id) => planned.has(id)).length,
    carriedOver: [...planned].filter((id) => openIds.has(id)).length,
    idleMinutes: idleMinutesToday(tasks, now),
    doneIds,
  };
}

// ---- Day check: is this plan too much, too little, or about right? ------------------
// Unestimated items count by level. A focused day is about 6 hours of real work.
const DEFAULT_MIN = { project: 180, mission: 120, task: 45 } as const;
export const FOCUS_DAY_MIN = 360;

export type DayCheck = {
  tone: "danger" | "warning" | "success" | "signal";
  title: string;
  detail: string;
  minutes: number;
  unestimated: number;
};

export function checkPlan(items: Task[]): DayCheck | null {
  if (!items.length) return null;
  let minutes = 0;
  let unestimated = 0;
  for (const t of items) {
    if (t.estMin) minutes += t.estMin;
    else {
      unestimated++;
      minutes += DEFAULT_MIN[t.level ?? "task"];
    }
  }
  const hours = `about ${Math.round((minutes / 60) * 2) / 2}h of work`;
  const est = unestimated ? ` (${unestimated} without an estimate, guessed by level)` : "";
  if (minutes > 480 || items.length > 10)
    return { tone: "danger", title: "That's too much", detail: `${hours}${est}. Drop a few so the day stays winnable.`, minutes, unestimated };
  if (minutes > 390)
    return { tone: "warning", title: "That's a lot", detail: `${hours}${est}. Doable on a strong day: treat the last items as stretch.`, minutes, unestimated };
  if (minutes >= 270)
    return { tone: "success", title: "Looks like a solid day", detail: `${hours}${est}. Room to breathe, enough to matter.`, minutes, unestimated };
  if (minutes >= 150)
    return { tone: "signal", title: "I think you could do a bit more", detail: `${hours}${est}. There's room for one or two more.`, minutes, unestimated };
  return { tone: "warning", title: "That's too little", detail: `${hours}${est}. Add a couple more to make the day count.`, minutes, unestimated };
}
