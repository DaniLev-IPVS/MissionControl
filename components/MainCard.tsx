"use client";

import { useState } from "react";
import { Bot, Check, Crosshair, Info, OctagonAlert, Scissors, Sparkles, Waves } from "lucide-react";
import { autofill, backToNoise, blocked, delegate, idle, isPopupSignal, sections } from "@/lib/flow";
import { askNotificationPermission } from "@/lib/hooks";
import type { Task } from "@/lib/types";
import { IdleMenu } from "./IdleMenu";
import { SplitDialog } from "./SplitDialog";
import { ParentLine, TaskMeta } from "./TaskCard";
import { cx, markDone, useMC } from "./ui";

export function MainCard({ task, onDropTask }: { task: Task | null; onDropTask: (id: string) => void }) {
  const { tasks, today, apply, openDetails } = useMC();
  const [splitting, setSplitting] = useState(false);
  const [idleOpen, setIdleOpen] = useState(false);
  const [over, setOver] = useState(false);

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const id = e.dataTransfer.getData("text/plain");
      if (id && id !== task?.id) onDropTask(id);
    },
  };

  const s = sections(tasks, today);
  // Noise being worked on right now. Main doesn't change: it still says what the plan is.
  const onNoise = s.detour.length > 0;
  const popup = !!task && isPopupSignal(task);

  if (!task) {
    const next = autofill(tasks, today);
    return (
      <section
        {...dropProps}
        aria-label="This is what you should be working on"
        className={cx("relative overflow-hidden rounded-[28px] p-7 glass-strong", over && "ring-2 ring-primary-hi")}
      >
        <Label />
        <p className="mt-4 text-2xl font-semibold text-ink-2">Nothing in focus.</p>
        <p className="mt-1 text-sm text-ink-3">
          {s.dashboard.length || s.today.length
            ? "Start the next task in line, or drag any task here."
            : "Plan a few tasks into Today, then start the first one."}
        </p>
        {next.length > 0 && (
          <button
            onClick={() => apply({ changes: next, creates: [] })}
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white shadow-[0_8px_30px_-6px_rgb(24_86_255/0.7)] hover:bg-primary-hi"
          >
            <Sparkles className="size-4" /> Start next in line
          </button>
        )}
      </section>
    );
  }

  return (
    <section
      {...dropProps}
      aria-label="This is what you should be working on"
      className={cx(
        "relative z-10 rounded-[28px] p-6 sm:p-7 glass-strong",
        popup && "border-popup/50!",
        over && "ring-2 ring-primary-hi",
      )}
    >
      {/* Signal glow (clipped on its own layer so menus can overflow the card) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]" aria-hidden>
        <div className={cx("absolute -right-24 -top-24 size-72 rounded-full blur-3xl", popup ? "bg-popup/20" : "bg-primary/30")} />
      </div>
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label />
          <div className="flex items-center gap-2">
            {popup && (
              <button
                onClick={() => apply(backToNoise(tasks, task, today))}
                title="Move it out of signal, back to Noise"
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-noise glass-chip hover:bg-noise/20"
              >
                <Waves className="size-3.5" /> Back to noise
              </button>
            )}
            <button
              onClick={() => openDetails(task.id)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-ink-3 glass-chip hover:text-ink"
            >
              <Info className="size-3.5" /> Details
            </button>
          </div>
        </div>

        {onNoise && (
          <p role="status" className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full bg-noise/15 px-3 py-1.5 text-xs font-semibold text-noise ring-1 ring-noise/35">
            <Waves className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              Right now you&apos;re on noise instead: {s.detour[0].name}
              {s.detour.length > 1 ? ` +${s.detour.length - 1}` : ""}
            </span>
          </p>
        )}
        {popup && (
          <p className="mt-3 text-xs font-medium text-popup">
            A pop-up: this wasn&apos;t in the plan this morning. You sent it to signal.
          </p>
        )}

        <h2 className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-[28px]">{task.name}</h2>
        <div className="mt-3 space-y-2">
          <ParentLine task={task} />
          <TaskMeta task={task} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <ActionButton icon={<Scissors className="size-5" />} label="Split" hint="Too big" onClick={() => setSplitting(true)} />
          <ActionButton
            icon={<Check className="size-5" />}
            label="Done"
            hint="Finished"
            tone="success"
            onClick={() => markDone({ tasks, today, apply }, task)}
          />
          <ActionButton
            icon={<OctagonAlert className="size-5" />}
            label="Blocked"
            hint="Waiting on someone"
            tone="danger"
            onClick={() => apply(blocked(tasks, task, today))}
          />
          <div className="relative">
            <ActionButton
              icon={<Bot className="size-5" />}
              label="Idle"
              hint="Handed to AI or delegated to someone: set when to check back"
              tone="primary"
              onClick={() => setIdleOpen((o) => !o)}
              expanded={idleOpen}
            />
            {idleOpen && (
              <IdleMenu
                className="absolute right-0 top-[80px]"
                onClose={() => setIdleOpen(false)}
                onPick={(min) => {
                  setIdleOpen(false);
                  if (min) askNotificationPermission();
                  apply(idle(tasks, task, today, min));
                }}
                onDelegate={(when) => {
                  setIdleOpen(false);
                  askNotificationPermission();
                  apply(delegate(tasks, task, today, when));
                }}
              />
            )}
          </div>
        </div>
      </div>
      {splitting && <SplitDialog task={task} onClose={() => setSplitting(false)} />}
    </section>
  );
}

function Label() {
  return (
    <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-primary-hi">
      <Crosshair className="size-3.5" /> This is what you should be working on
    </div>
  );
}

function ActionButton({
  icon,
  label,
  hint,
  onClick,
  tone = "neutral",
  expanded,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  tone?: "neutral" | "success" | "danger" | "primary";
  expanded?: boolean;
}) {
  const tones = {
    neutral: "hover:bg-white/12 text-ink",
    success: "hover:bg-success/25 text-success [&_svg]:text-success",
    danger: "hover:bg-danger/25 text-danger-hi",
    primary: "hover:bg-primary/30 text-primary-hi",
  };
  return (
    <button
      onClick={onClick}
      aria-expanded={expanded}
      className={cx(
        "flex h-[72px] w-full flex-col items-center justify-center gap-1 rounded-2xl glass-chip transition-colors active:scale-[0.98]",
        tones[tone],
      )}
    >
      {icon}
      <span className="text-sm font-semibold">{label}</span>
      <span className="sr-only">{hint}</span>
    </button>
  );
}
