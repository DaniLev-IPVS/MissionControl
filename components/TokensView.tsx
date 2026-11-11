"use client";

import { useEffect, useMemo, useState } from "react";
import { Coins, Flame, Lock, Trophy } from "lucide-react";
import { TIME_ZONE } from "@/lib/config";
import { addDays } from "@/lib/flow";
import type { TreeTask } from "@/lib/types";
import { cx, useMC } from "./ui";

// One token per finished task (Done, not Cancelled), counted from the day Mission Control started.
export const TOKENS_SINCE = "2026-11-10";

const MILESTONES = [
  { at: 1, name: "Spark", note: "First task finished" },
  { at: 10, name: "Ember", note: "Ten down" },
  { at: 25, name: "Flame", note: "A real week of work" },
  { at: 50, name: "Torch", note: "Fifty finished" },
  { at: 100, name: "Beacon", note: "Triple digits" },
  { at: 250, name: "Lighthouse", note: "Seen from far away" },
  { at: 500, name: "Star", note: "Half a thousand" },
  { at: 1000, name: "Supernova", note: "A thousand tasks done" },
];

const dayOf = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export function TokensView() {
  const { today } = useMC();
  const [all, setAll] = useState<TreeTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/tree", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => alive && (d.error ? setError(d.error) : setAll(d.tasks)))
        .catch((e) => alive && setError(String(e)));
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const stats = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const t of all ?? []) {
      if (t.status !== "Done" || !t.doneAt) continue;
      const d = dayOf(t.doneAt);
      if (d < TOKENS_SINCE) continue;
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const total = [...perDay.values()].reduce((a, b) => a + b, 0);
    const todayCount = perDay.get(today) ?? 0;
    // Streak: consecutive days with a token, ending today (or yesterday if today has none yet).
    let streak = 0;
    let d = todayCount ? today : addDays(today, -1);
    while ((perDay.get(d) ?? 0) > 0) {
      streak++;
      d = addDays(d, -1);
    }
    const best = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    const next = MILESTONES.find((m) => m.at > total) ?? null;
    const days = Array.from({ length: 14 }, (_, i) => {
      const day = addDays(today, i - 13);
      return { day, n: perDay.get(day) ?? 0 };
    });
    return { total, todayCount, streak, best, next, days };
  }, [all, today]);

  if (error) return <div className="rounded-3xl p-5 text-sm text-danger-hi glass">Couldn&apos;t load tokens: {error}</div>;
  if (!all) return <div className="rounded-3xl p-5 text-sm text-ink-3 glass">Counting tokens…</div>;

  const { total, todayCount, streak, best, next, days } = stats;
  const pct = next ? Math.round((total / next.at) * 100) : 100;
  const maxDay = Math.max(1, ...days.map((d) => d.n));

  return (
    <div className="space-y-5">
      <section aria-label="Token totals" className="grid gap-3 sm:grid-cols-4">
        <Tile icon={<Coins className="size-4 text-warning" />} label="Tokens" value={total} />
        <Tile icon={<Coins className="size-4 text-success" />} label="Today" value={`+${todayCount}`} />
        <Tile icon={<Flame className="size-4 text-noise" />} label="Day streak" value={streak} />
        <Tile
          icon={<Trophy className="size-4 text-level-project" />}
          label="Best day"
          value={best ? best[1] : 0}
          sub={best ? new Date(`${best[0]}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : undefined}
        />
      </section>

      <section aria-label="Next milestone" className="rounded-[26px] p-5 glass">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-ink-2">
              {next ? `Next: ${next.name}` : "Every milestone reached"}
            </h2>
            <p className="mt-1 text-xs text-ink-3">
              {next ? `${next.at - total} more token${next.at - total === 1 ? "" : "s"} to ${next.at}. ${next.note}.` : "Supernova. Absolutely unreasonable."}
            </p>
          </div>
          <span className="font-mono text-sm text-ink-2">
            {total}
            {next ? ` / ${next.at}` : ""}
          </span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-warning" style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-5 flex h-20 items-end gap-[6px]" aria-label="Tokens per day, last 14 days">
          {days.map((d) => (
            <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.n}`}>
              {d.n > 0 ? (
                <div className="rounded-t-[4px] bg-warning/80" style={{ height: `${(d.n / maxDay) * 100}%` }} />
              ) : (
                <div className="h-px bg-white/15" />
              )}
              <span className={cx("mt-1 text-center text-[10px]", d.day === today ? "font-semibold text-ink" : "text-ink-3")}>
                {new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Milestone board" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MILESTONES.map((m) => {
          const got = total >= m.at;
          return (
            <div key={m.at} className={cx("rounded-3xl p-4 glass", got ? "ring-1 ring-warning/40" : "opacity-60")}>
              <div className="flex items-center justify-between">
                <span className={cx("grid size-10 place-items-center rounded-2xl", got ? "bg-warning/20 text-warning" : "bg-white/5 text-ink-3")}>
                  {got ? <Trophy className="size-5" /> : <Lock className="size-4" />}
                </span>
                <span className="font-mono text-xs text-ink-3">{m.at}</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-ink">{m.name}</p>
              <p className="text-xs text-ink-3">{got ? m.note : `${m.at - total} to go`}</p>
            </div>
          );
        })}
      </section>
      <p className="text-xs text-ink-3">
        One token per finished task since {new Date(`${TOKENS_SINCE}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" })}. Cancelled tasks don&apos;t count.
      </p>
    </div>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-3xl p-4 glass">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-3">
        {icon} {label}
      </p>
      <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-ink">{value}</p>
      {sub && <p className="text-xs text-ink-3">{sub}</p>}
    </div>
  );
}
