"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

// Idle = handed to AI until it needs you. The menu asks when to go back and check the session.

const OPTIONS: { label: string; min: number | null }[] = [
  { label: "No reminder", min: null },
  { label: "5 min", min: 5 },
  { label: "10 min", min: 10 },
  { label: "15 min", min: 15 },
  { label: "30 min", min: 30 },
  { label: "1 hour", min: 60 },
];

export function IdleMenu({
  onPick,
  onClose,
  className,
  style,
}: {
  onPick: (min: number | null) => void;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
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
      aria-label="Check the session in"
      style={style}
      className={cx("animate-pop z-50 w-64 rounded-2xl p-2 glass-menu", className)}
    >
      <p className="px-2 pb-0.5 pt-1 text-[11px] font-bold uppercase tracking-wider text-ink-3">Handed to AI</p>
      <p className="px-2 pb-2 text-xs text-ink-3">Check the session again in…</p>
      <div className="grid grid-cols-2 gap-1.5">
        {OPTIONS.map((o) => (
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
