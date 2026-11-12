"use client";

import { Bot, Check, OctagonAlert, Play } from "lucide-react";
import { markBlocked, resumeIdle } from "@/lib/flow";
import { formatElapsed, useNow } from "@/lib/hooks";
import type { Task } from "@/lib/types";
import { cx, markDone, useMC } from "./ui";

// The idle screen, where the task switch used to be: everything handed to AI right now, signal
// on one side and noise on the other, each with its idle clock running up. Small cards, three
// moves: back to it, blocked, done.

export function IdleBoard({ signal, noise, showSignal, showNoise }: { signal: Task[]; noise: Task[]; showSignal: boolean; showNoise: boolean }) {
  const total = (showSignal ? signal.length : 0) + (showNoise ? noise.length : 0);
  return (
    <section aria-label="Idle" className="rounded-[26px] p-4 glass sm:p-5">
      <header className="mb-3.5">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-primary-hi">
          <Bot className="size-4" />
          Idle
          <span className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[11px] tracking-normal text-ink-2">{total}</span>
        </h2>
        <p className="mt-1 text-xs text-ink-3">Handed to AI. Go back when the clock says so, or when the bell rings.</p>
      </header>
      <div className={cx("grid gap-3", showSignal && showNoise && "md:grid-cols-2")}>
        {showSignal && <Half tone="signal" tasks={signal} />}
        {showNoise && <Half tone="noise" tasks={noise} />}
      </div>
    </section>
  );
}

function Half({ tone, tasks }: { tone: "signal" | "noise"; tasks: Task[] }) {
  const signal = tone === "signal";
  return (
    <div className={cx("rounded-2xl p-2.5 ring-1", signal ? "bg-signal/[0.04] ring-signal/20" : "bg-noise/[0.05] ring-noise/25")}>
      <h3 className={cx("mb-2 flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider", signal ? "text-signal" : "text-noise")}>
        <span className={cx("size-1.5 rounded-full", signal ? "bg-signal" : "bg-noise")} aria-hidden />
        {signal ? "Signal" : "Noise"}
        <span className="font-mono font-normal text-ink-3">{tasks.length}</span>
      </h3>
      {tasks.length === 0 ? (
        <p className="px-1 pb-1 text-xs text-ink-3">{signal ? "No planned work handed off." : "No noise handed off."}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {tasks.map((t) => (
            <IdleCard key={t.id} task={t} tone={tone} />
          ))}
        </ul>
      )}
    </div>
  );
}

function IdleCard({ task, tone }: { task: Task; tone: "signal" | "noise" }) {
  const { tasks, today, apply, openDetails } = useMC();
  const now = useNow();
  const elapsed = now - Date.parse(task.idleSince!);
  const left = task.idleReminder ? Date.parse(task.idleReminder) - now : null;
  const late = left !== null && left <= 0;
  return (
    <li
      className={cx(
        "flex flex-col gap-2 rounded-xl p-2.5 glass-chip",
        late && "ring-1 ring-warning/50",
        tone === "noise" && !late && "ring-1 ring-noise/20",
      )}
    >
      <button
        onClick={() => openDetails(task.id)}
        title={task.name}
        className="line-clamp-2 text-left text-[13px] font-medium leading-snug text-ink hover:underline"
      >
        {task.name}
      </button>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cx("font-mono text-xl font-bold tabular-nums leading-none", late ? "text-warning" : "text-primary-hi")}
          aria-label={`Idle for ${formatElapsed(elapsed)}`}
        >
          {formatElapsed(elapsed)}
        </span>
        <span className={cx("truncate text-[11px]", late ? "font-semibold text-warning" : "text-ink-3")}>
          {left === null ? "no reminder" : late ? "check the session" : `check in ${formatElapsed(left)}`}
        </span>
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => apply(resumeIdle(tasks, task, today))}
          aria-label={`Back to "${task.name}"`}
          title={tone === "signal" ? "Back to it: becomes Main" : "Back to it: stays in Working on noise"}
          className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-full bg-primary/25 text-[11px] font-semibold text-primary-hi hover:bg-primary/40"
        >
          <Play className="size-3" /> Resume
        </button>
        <button
          onClick={() => apply(markBlocked(tasks, task, today))}
          aria-label={`Mark "${task.name}" blocked`}
          title="Blocked: waiting on someone"
          className="grid h-7 w-8 place-items-center rounded-full text-danger-hi hover:bg-danger/15"
        >
          <OctagonAlert className="size-3.5" />
        </button>
        <button
          onClick={() => markDone({ tasks, today, apply }, task)}
          aria-label={`Mark "${task.name}" done`}
          title="Done"
          className="grid h-7 w-8 place-items-center rounded-full text-success hover:bg-success/15"
        >
          <Check className="size-3.5" />
        </button>
      </div>
    </li>
  );
}
