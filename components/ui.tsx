"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { LEVEL_LABELS, type Level } from "@/lib/config";
import { addDays, type Plan } from "@/lib/flow";
import { formatElapsed, useNow } from "@/lib/hooks";
import type { Board, Task } from "@/lib/types";
import type { Runner } from "@/lib/useBoard";

// ---- Shared context -------------------------------------------------------------------
export type MC = {
  board: Board;
  tasks: Task[];
  today: string;
  apply: (plan: Plan, run?: Runner) => Promise<boolean>;
  openDetails: (id: string) => void;
  deptName: (id: string) => string;
  taskById: (id: string) => Task | undefined;
  titleOf: (id: string) => string;
};
export const MCContext = createContext<MC | null>(null);
export function useMC() {
  const v = useContext(MCContext);
  if (!v) throw new Error("useMC outside provider");
  return v;
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---- Level -------------------------------------------------------------------------------
const LEVEL_STYLE: Record<Level, string> = {
  project: "text-level-project bg-level-project/12 ring-level-project/30",
  mission: "text-level-mission bg-level-mission/12 ring-level-mission/30",
  task: "text-level-task bg-level-task/12 ring-level-task/30",
};
export function LevelBadge({ level }: { level: Level | null }) {
  if (!level) return null;
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", LEVEL_STYLE[level])}>
      <span className="size-1.5 rounded-full bg-current" />
      {LEVEL_LABELS[level]}
    </span>
  );
}

// ---- Department -------------------------------------------------------------------------
const DEPT_HUES = [210, 265, 150, 25, 330, 185, 45, 290, 100, 0];
export function deptHue(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DEPT_HUES[h % DEPT_HUES.length];
}
export function DeptChip({ id, name }: { id: string; name: string }) {
  const hue = deptHue(id);
  return (
    <span
      className="inline-flex max-w-[14rem] items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-[11px] font-medium text-ink-2 glass-chip"
      title={name}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: `hsl(${hue} 85% 65%)` }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

// ---- Priority / Due -------------------------------------------------------------------------
export function PriorityPill({ p }: { p: string | null }) {
  if (!p) return null;
  const style =
    p === "P0" ? "bg-danger/18 text-danger-hi ring-danger/40" : p === "P1" ? "bg-warning/15 text-warning ring-warning/35" : "bg-white/6 text-ink-2 ring-white/12";
  return <span className={cx("rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold ring-1", style)}>{p}</span>;
}

/** Which Notion board a task lives on. */
export function BoardBadge({ board }: { board?: string }) {
  const influity = board === "influity";
  return (
    <span
      title={influity ? "From the Influity Task Board" : "From your Personal Ticket Board"}
      className={cx(
        "rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ring-1",
        influity ? "bg-noise/12 text-noise ring-noise/35" : "bg-white/5 text-ink-3 ring-white/10",
      )}
    >
      {influity ? "Influity" : "Personal"}
    </span>
  );
}

export function DueBadge({ due, today }: { due: string | null; today: string }) {
  if (!due) return null;
  const overdue = due < today;
  const isToday = due === today;
  const soon = !overdue && !isToday && due <= addDays(today, 2);
  const label = overdue
    ? `Overdue · ${fmtDay(due)}`
    : isToday
      ? "Due today"
      : due === addDays(today, 1)
        ? "Due tomorrow"
        : `Due ${fmtDay(due)}`;
  return (
    <span
      className={cx(
        "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        overdue ? "bg-danger/18 text-danger-hi" : isToday ? "bg-warning/18 text-warning" : soon ? "bg-warning/10 text-warning/90" : "text-ink-3",
      )}
    >
      {label}
    </span>
  );
}

export function fmtDay(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---- Idle timer -------------------------------------------------------------------------------
export function IdleTimer({ task, large = false }: { task: Task; large?: boolean }) {
  const now = useNow();
  if (!task.idleSince || !now) return null;
  const elapsed = now - Date.parse(task.idleSince);
  const remind = task.idleReminder ? Date.parse(task.idleReminder) - now : null;
  const late = remind !== null && remind <= 0;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full font-mono font-semibold tabular-nums",
        large ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]",
        late ? "bg-warning/20 text-warning ring-1 ring-warning/40" : "bg-primary/18 text-primary-hi ring-1 ring-primary/35",
      )}
      title={task.idleReminder ? `Reminder at ${new Date(task.idleReminder).toLocaleTimeString()}` : "Idle"}
    >
      <span className={cx("size-1.5 rounded-full bg-current", !late && "animate-pulse")} />
      idle {formatElapsed(elapsed)}
      {remind !== null && !late && <span className="font-normal opacity-70">· ⏰ {formatElapsed(remind)}</span>}
      {late && <span className="font-normal">· time&apos;s up</span>}
    </span>
  );
}

// ---- Modal ---------------------------------------------------------------------------------------
/** A ref that always holds the latest value, for effects that should run once. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useLatest(onClose);
  // Focus once when it opens. (Re-running on every render would steal focus from
  // whatever you're typing in each time the board refreshes.)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first =
      ref.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      ref.current?.querySelector<HTMLElement>("input, textarea, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [close]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 backdrop-blur-md sm:items-center" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx("animate-pop w-full rounded-3xl p-5 glass-sheet", wide ? "max-w-2xl" : "max-w-lg")}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-ink-3 hover:bg-white/10 hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; dot?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full p-1 glass-chip">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
            value === o.value ? "bg-white/14 text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.dot && <span className="size-1.5 rounded-full" style={{ background: o.dot }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
