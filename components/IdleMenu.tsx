"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, localDay } from "@/lib/flow";
import { Switch, cx, joinExpect } from "./ui";

// Idle = out of your hands for now. Two kinds, picked with the switch at the top:
//  - Handed to AI (switch off): the menu asks when to go back and check the session.
//  - Delegated (switch on): someone else is doing it. The menu asks when you expect an answer,
//    which is optional, and you're reminded to follow up then.

const OPTIONS: { label: string; min: number | null }[] = [
  { label: "No reminder", min: null },
  { label: "5 min", min: 5 },
  { label: "10 min", min: 10 },
  { label: "15 min", min: 15 },
  { label: "30 min", min: 30 },
  { label: "1 hour", min: 60 },
];
const EXPECT: { label: string; days: number | null }[] = [
  { label: "No date", days: null },
  { label: "Tomorrow", days: 1 },
  { label: "In 2 days", days: 2 },
  { label: "In 3 days", days: 3 },
  { label: "In a week", days: 7 },
  { label: "In 2 weeks", days: 14 },
];

export function IdleMenu({
  onPick,
  onDelegate,
  onClose,
  className,
  style,
}: {
  onPick: (min: number | null) => void;
  /** Delegated to someone. `expectBy` is a day (YYYY-MM-DD), an exact time (ISO), or null. */
  onDelegate: (expectBy: string | null) => void;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [delegated, setDelegated] = useState(false);
  const [custom, setCustom] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
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
  const today = localDay();
  const item = "h-10 rounded-xl text-sm font-semibold text-ink-2 glass-chip hover:text-ink";
  const field = "h-10 min-w-0 rounded-xl bg-white/5 px-2.5 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/10 [color-scheme:dark]";
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={delegated ? "Delegated: expecting an answer by" : "Check the session in"}
      style={style}
      className={cx("animate-pop z-50 w-64 rounded-2xl p-2 glass-menu", className)}
    >
      <label className="mb-1.5 flex cursor-pointer items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5">
        <span className="text-xs font-semibold text-ink-2">Delegated to someone</span>
        <Switch checked={delegated} onChange={setDelegated} label="Delegated to someone" />
      </label>
      <p className={cx("px-2 pb-0.5 pt-1 text-[11px] font-bold uppercase tracking-wider", delegated ? "text-delegated" : "text-ink-3")}>
        {delegated ? "Delegated" : "Handed to AI"}
      </p>
      <p className="px-2 pb-2 text-xs text-ink-3">{delegated ? "Expecting an answer by… (optional)" : "Check the session again in…"}</p>
      {delegated ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {EXPECT.map((o) => (
              <button
                key={o.label}
                role="menuitem"
                onClick={() => onDelegate(o.days === null ? null : addDays(today, o.days))}
                className={cx(item, "hover:bg-delegated/20")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <form
            className="mt-1.5 grid grid-cols-[1fr_auto] gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (date) onDelegate(joinExpect(date, time));
            }}
          >
            <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} aria-label="Answer expected on" className={field} />
            <button disabled={!date} className="row-span-2 h-full rounded-xl bg-delegated px-3 text-sm font-semibold text-black disabled:opacity-40">
              Set
            </button>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="At (optional time)" title="Optional time" className={field} />
          </form>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {OPTIONS.map((o) => (
              <button key={o.label} role="menuitem" onClick={() => onPick(o.min)} className={cx(item, "hover:bg-primary/25")}>
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
              className={cx(field, "flex-1 px-3")}
            />
            <button disabled={!(customMin > 0)} className="h-10 rounded-xl bg-primary px-3 text-sm font-semibold text-white disabled:opacity-40">
              Set
            </button>
          </form>
        </>
      )}
    </div>
  );
}
