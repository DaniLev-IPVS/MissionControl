// Day statistics, shared by the sign-out summary and the server action.
import type { Board, DayStats, Task } from "./types";

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
