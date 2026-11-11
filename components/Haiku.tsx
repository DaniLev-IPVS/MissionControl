"use client";

import { useEffect, useRef, useState } from "react";
import { Feather } from "lucide-react";
import { cx } from "./ui";

type Result = { lines: string[]; insight: string };

/** A haiku about today's plan (morning) or the finished day (sign out). */
export function Haiku({
  kind,
  items,
  note,
  auto = false,
  className,
}: {
  kind: "plan" | "day";
  items: string[];
  note?: string;
  auto?: boolean;
  className?: string;
}) {
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  async function write() {
    setBusy(true);
    try {
      const r = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ haiku: { kind, items, note } }),
      });
      if (r.ok) setRes(await r.json());
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!auto || asked.current) return;
    asked.current = true;
    void write();
  });

  return (
    <div className={cx("rounded-2xl p-3.5 glass-chip", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-level-project">
          <Feather className="size-3.5" /> {kind === "plan" ? "Haiku of the plan" : "Haiku of the day"}
        </p>
        <button
          onClick={write}
          disabled={busy || (kind === "plan" && !items.length)}
          className="text-xs font-semibold text-ink-3 hover:text-ink disabled:opacity-40"
        >
          {busy ? "Writing…" : res ? "Another" : "Write one"}
        </button>
      </div>
      {res ? (
        <figure className="mt-2">
          <blockquote className="space-y-0.5 font-medium italic leading-relaxed text-ink">
            {res.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </blockquote>
          <figcaption className="mt-2 text-xs text-ink-3">{res.insight}</figcaption>
        </figure>
      ) : (
        <p className="mt-1.5 text-xs text-ink-3">
          {busy ? "Counting syllables…" : kind === "plan" ? "Three lines on what this plan says about your day." : "Three lines to close the day."}
        </p>
      )}
    </div>
  );
}
