"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CirclePause, Crosshair, Info, OctagonAlert, Scissors, Sparkles } from "lucide-react";
import { autofill, blocked, idle, sections } from "@/lib/flow";
import { askNotificationPermission } from "@/lib/hooks";
import type { Task } from "@/lib/types";
import { SplitDialog } from "./SplitDialog";
import { ParentLine, TaskMeta } from "./TaskCard";
import { cx, markDone, useMC } from "./ui";

const IDLE_OPTIONS: { label: string; min: number | null }[] = [
  { label: "None", min: null },
  { label: "5 min", min: 5 },
  { label: "15 min", min: 15 },
  { label: "30 min", min: 30 },
  { label: "1 hour", min: 60 },
];

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

  if (!task) {
    const next = autofill(tasks, today);
    const s = sections(tasks, today);
    return (
      <section
        {...dropProps}
        aria-label="Currently working on"
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
      aria-label="Currently working on"
      className={cx(
        "relative z-10 rounded-[28px] p-6 sm:p-7 glass-strong",
        over && "ring-2 ring-primary-hi",
      )}
    >
      {/* Signal glow (clipped on its own layer so menus can overflow the card) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]" aria-hidden>
        <div className="absolute -right-24 -top-24 size-72 rounded-full bg-primary/30 blur-3xl" />
      </div>
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <Label />
          <button
            onClick={() => openDetails(task.id)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-ink-3 glass-chip hover:text-ink"
          >
            <Info className="size-3.5" /> Details
          </button>
        </div>

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
              icon={<CirclePause className="size-5" />}
              label="Idle"
              hint="Waiting on Claude / a system"
              tone="primary"
              onClick={() => setIdleOpen((o) => !o)}
              expanded={idleOpen}
            />
            {idleOpen && (
              <IdleMenu
                onClose={() => setIdleOpen(false)}
                onPick={(min) => {
                  setIdleOpen(false);
                  if (min) askNotificationPermission();
                  apply(idle(tasks, task, today, min));
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
      <Crosshair className="size-3.5" /> Currently working on
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

function IdleMenu({ onPick, onClose }: { onPick: (min: number | null) => void; onClose: () => void }) {
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.focus({ preventScroll: true });
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const customMin = Number(custom);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Remind me in"
      className="animate-pop absolute right-0 top-[80px] z-40 w-60 rounded-2xl p-2 glass-menu"
    >
      <p className="px-2 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-wider text-ink-3">Remind me in</p>
      <div className="grid grid-cols-2 gap-1.5">
        {IDLE_OPTIONS.map((o) => (
          <button
            key={o.label}
            role="menuitem"
            onClick={() => onPick(o.min)}
            className="h-10 rounded-xl text-sm font-semibold text-ink-2 glass-chip hover:bg-primary/25 hover:text-ink"
          >
            {o.label}
          </button>
        ))}
      </div>
      <form
        className="mt-1.5 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (customMin > 0) onPick(Math.min(customMin, 24 * 60));
        }}
      >
        <input
          inputMode="numeric"
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))}
          placeholder="Custom (min)"
          aria-label="Custom minutes"
          className="h-10 min-w-0 flex-1 rounded-xl bg-white/5 px-3 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/10"
        />
        <button
          disabled={!(customMin > 0)}
          className="h-10 rounded-xl bg-primary px-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Set
        </button>
      </form>
    </div>
  );
}
