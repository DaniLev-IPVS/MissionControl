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
