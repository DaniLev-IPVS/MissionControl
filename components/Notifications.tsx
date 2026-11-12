"use client";

import { useEffect, useRef, useState } from "react";
import { AlarmClock, Bell, Bot, Play, X } from "lucide-react";
import { isIdle, resumeIdle, snooze } from "@/lib/flow";
import { formatElapsed, useNow } from "@/lib/hooks";
import type { Task } from "@/lib/types";
import { cx, useMC } from "./ui";

// Reminders to go back and check an AI session. A new one pops up as a toast; after a few
// minutes (or once newer ones arrive) it moves into the bell on the side of the screen, which
// keeps bouncing until you deal with it.

const TOAST_MS = 3.5 * 60_000;
const MAX_TOASTS = 3;

type Props = { due: Task[]; dismiss: (t: Task) => void; dueAt: (t: Task) => number };

/** The toasts still fresh enough to show in the middle of the screen. Newest first. */
export function useToasts({ due, dueAt }: Pick<Props, "due" | "dueAt">) {
  const now = useNow();
  return [...due]
    .filter((t) => now - dueAt(t) < TOAST_MS)
    .sort((a, b) => dueAt(b) - dueAt(a))
    .slice(0, MAX_TOASTS);
}

export function ReminderToasts({ due, dismiss, dueAt }: Props) {
  const toasts = useToasts({ due, dueAt });
  const { tasks, today, apply } = useMC();
  return toasts.map((t) => (
    <div key={t.id} className="animate-pop flex items-center gap-3 rounded-2xl p-3.5 glass-float ring-1 ring-warning/40">
      <AlarmClock className="size-5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-warning">Check the session</p>
        <p className="truncate text-sm text-ink">{t.name}</p>
      </div>
      <button
        onClick={() => {
          dismiss(t);
          apply(resumeIdle(tasks, t, today));
        }}
        className="h-9 rounded-full bg-primary px-3.5 text-xs font-semibold text-white"
      >
        Back to it
      </button>
      <button
        onClick={() => {
          dismiss(t);
          apply(snooze(t, 5));
        }}
        className="h-9 rounded-full px-3 text-xs font-semibold text-ink-2 glass-chip"
      >
        +5 min
      </button>
    </div>
  ));
}

export function NotificationBell({ due, dismiss, dueAt }: Props) {
  const { tasks, today, apply } = useMC();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const close = (e: MouseEvent) =>
      !panel.current?.contains(e.target as Node) && !bell.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const needsYou = [...due].sort((a, b) => dueAt(b) - dueAt(a));
  const dueIds = new Set(due.map((t) => t.id));
  // Everything still handed to AI, soonest check-in first.
  const handedOff = tasks
    .filter((t) => isIdle(t) && !dueIds.has(t.id))
    .sort((a, b) => (a.idleReminder ?? "~").localeCompare(b.idleReminder ?? "~"));
  const count = needsYou.length;

  return (
    <>
      <button
        ref={bell}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={count ? `Notifications: ${count} session${count === 1 ? "" : "s"} to check` : "Notifications"}
        title={count ? `${count} to check` : "Notifications"}
        className={cx(
          "fixed right-3 top-[38%] z-40 grid size-12 place-items-center rounded-full glass-float transition-colors",
          count ? "text-warning ring-1 ring-warning/50" : "text-ink-2 hover:text-ink",
          count > 0 && !open && "animate-bell",
        )}
      >
        <Bell className="size-5" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-warning px-1 font-mono text-[11px] font-bold text-black">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panel}
          tabIndex={-1}
          role="dialog"
          aria-label="Notifications"
          className="animate-pop fixed inset-y-3 right-3 z-50 flex w-[min(380px,calc(100vw-24px))] flex-col rounded-[26px] p-4 glass-float focus:outline-none"
        >
          <header className="mb-3 flex items-center gap-2">
            <Bell className="size-4 text-warning" />
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-ink-2">Notifications</h2>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close notifications"
              className="ml-auto grid size-8 place-items-center rounded-full text-ink-3 hover:bg-white/10 hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="scroll-thin -mr-1 flex-1 space-y-5 overflow-y-auto pr-1">
            <section aria-label="Needs you">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-warning">Needs you · {count}</h3>
              {count === 0 ? (
                <p className="text-sm text-ink-3">Nothing to check right now.</p>
              ) : (
                <ul className="space-y-2">
                  {needsYou.map((t) => (
                    <li key={t.id} className="rounded-2xl p-3 glass-chip ring-1 ring-warning/30">
                      <p className="text-sm font-medium leading-snug text-ink">{t.name}</p>
                      <p className="mt-0.5 text-xs text-ink-3">
                        Check the session · due {formatElapsed(now - dueAt(t))} ago · idle {formatElapsed(now - Date.parse(t.idleSince!))}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => {
                            dismiss(t);
                            apply(resumeIdle(tasks, t, today));
                          }}
                          className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-white"
                        >
                          <Play className="size-3.5" /> Back to it
                        </button>
                        <button
                          onClick={() => {
                            dismiss(t);
                            apply(snooze(t, 5));
                          }}
                          className="h-8 rounded-full px-3 text-xs font-semibold text-ink-2 glass-chip hover:text-ink"
                        >
                          +5 min
                        </button>
                        <button
                          onClick={() => dismiss(t)}
                          title="Hide this reminder. The task stays idle."
                          className="h-8 rounded-full px-3 text-xs font-semibold text-ink-3 hover:bg-white/10 hover:text-ink"
                        >
                          Clear
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Handed to AI">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-3">Handed to AI · {handedOff.length}</h3>
              {handedOff.length === 0 ? (
                <p className="text-sm text-ink-3">Nothing else is idle.</p>
              ) : (
                <ul className="space-y-1.5">
                  {handedOff.map((t) => {
                    const left = t.idleReminder ? Date.parse(t.idleReminder) - now : null;
                    return (
                      <li key={t.id} className="flex items-center gap-2 rounded-xl px-3 py-2 glass-chip">
                        <Bot className="size-3.5 shrink-0 text-primary-hi" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{t.name}</span>
                        <span className="shrink-0 font-mono text-[11px] text-ink-3">
                          {left !== null && left > 0 ? `check in ${formatElapsed(left)}` : `idle ${formatElapsed(now - Date.parse(t.idleSince!))}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
