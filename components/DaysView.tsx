"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { computeDayStats } from "@/lib/days";
import { addDays } from "@/lib/flow";
import type { Day } from "@/lib/types";
import { fmtMinutes } from "./DetailsDrawer";
import { cx, useMC } from "./ui";

export function DaysView() {
  const { board, tasks, today } = useMC();
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/days", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => alive && (d.error ? setError(d.error) : setDays(d.days)))
        .catch((e) => alive && setError(String(e)));
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Today, while still signed in, uses live numbers.
  const rows = useMemo(() => {
    if (!days) return [];
    const live = board.day && !board.day.signedOut ? { ...board.day, ...computeDayStats(board, tasks) } : null;
    const list = days.filter((d) => d.date !== live?.date);
    return live ? [live, ...list] : list;
  }, [days, board, tasks]);

  const chart = useMemo(() => {
    const byDate = new Map(rows.map((d) => [d.date, d]));
    return Array.from({ length: 14 }, (_, i) => {
      const date = addDays(today, i - 13);
      const d = byDate.get(date);
      return { date, signal: d?.signalDone ?? 0, noise: d?.noiseDone ?? 0, worked: !!d };
    });
  }, [rows, today]);
  const max = Math.max(4, ...chart.map((c) => c.signal + c.noise));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];

  const totals = rows.slice(0, 7).reduce(
    (a, d) => ({ s: a.s + d.signalDone, n: a.n + d.noiseDone, days: a.days + 1 }),
    { s: 0, n: 0, days: 0 },
  );

  if (error) return <div className="rounded-3xl p-5 text-sm text-danger-hi glass">Couldn&apos;t load the day log: {error}</div>;
  if (!days) return <div className="rounded-3xl p-5 text-sm text-ink-3 glass">Loading the day log…</div>;

  return (
    <div className="space-y-5">
      <section className="rounded-[26px] p-5 glass" aria-label="Last 14 days">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-ink-2">Done per day · last 14 days</h2>
            <p className="mt-1 text-xs text-ink-3">
              Last {totals.days} workdays: {totals.s + totals.n} done,{" "}
              {totals.s + totals.n ? Math.round((totals.s / (totals.s + totals.n)) * 100) : 0}% signal
            </p>
          </div>
          <div className="flex gap-4 text-xs text-ink-2" aria-label="Legend">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-signal" />Signal</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-noise" />Noise</span>
          </div>
        </div>

        <div className="relative h-56 pl-7">
          {/* recessive grid + y axis */}
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 flex items-center" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden>
              <span className="w-6 pr-1.5 text-right font-mono text-[10px] text-ink-3">{t}</span>
              <span className="h-px flex-1 bg-white/6" />
            </div>
          ))}
          <div className="relative flex h-full items-end gap-[6px] pl-1" role="list">
            {chart.map((c) => {
              const total = c.signal + c.noise;
              const isToday = c.date === today;
              const label = new Date(`${c.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
              return (
                <div key={c.date} role="listitem" className="group relative flex h-full flex-1 flex-col justify-end" tabIndex={0} aria-label={`${label}: ${c.signal} signal, ${c.noise} noise`}>
                  {/* stacked: signal at the base, 2px surface gap, noise on top; 4px rounded free end */}
                  {total > 0 ? (
                    <div className="flex flex-col-reverse gap-[2px]" style={{ height: `${(total / top) * 100}%` }}>
                      {c.signal > 0 && (
                        <div className={cx("bg-chart-signal", c.noise ? "" : "rounded-t-[4px]")} style={{ flexGrow: c.signal }} />
                      )}
                      {c.noise > 0 && <div className="rounded-t-[4px] bg-chart-noise" style={{ flexGrow: c.noise }} />}
                    </div>
                  ) : (
                    <div className="h-px bg-white/15" />
                  )}
                  <span className={cx("mt-1.5 text-center text-[10px]", isToday ? "font-semibold text-ink" : "text-ink-3")}>
                    {new Date(`${c.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}
                  </span>
                  {/* tooltip: hit target is the whole column */}
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-36 -translate-x-1/2 rounded-xl p-2.5 text-xs glass-menu group-hover:block group-focus:block">
                    <p className="font-semibold text-ink">{label}</p>
                    {c.worked || total ? (
                      <>
                        <p className="mt-1 flex justify-between text-ink-2"><span><span className="mr-1 inline-block size-2 rounded-sm bg-chart-signal" />Signal</span><span className="font-mono">{c.signal}</span></p>
                        <p className="flex justify-between text-ink-2"><span><span className="mr-1 inline-block size-2 rounded-sm bg-chart-noise" />Noise</span><span className="font-mono">{c.noise}</span></p>
                      </>
                    ) : (
                      <p className="mt-1 text-ink-3">No sign in</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section aria-label="Day log" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.length === 0 && (
          <div className="rounded-3xl p-5 text-sm text-ink-3 glass md:col-span-2 xl:col-span-3">
            No days logged yet. Sign in to start today&apos;s log.
          </div>
        )}
        {rows.map((d) => (
          <DayCard key={d.id} day={d} live={d.date === today && !d.signedOut} />
        ))}
      </section>
    </div>
  );
}

function DayCard({ day, live }: { day: Day; live: boolean }) {
  const total = day.signalDone + day.noiseDone;
  const sigPct = total ? Math.round((day.signalDone / total) * 100) : 0;
  const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—");
  const span = day.signedIn && day.signedOut ? Math.round((Date.parse(day.signedOut) - Date.parse(day.signedIn)) / 60000) : null;
  return (
    <article className={cx("rounded-3xl p-4 glass", live && "ring-1 ring-primary/40")}>
      <header className="flex items-start justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <CalendarDays className="size-4 text-ink-3" />
            {new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </h3>
          <p className="mt-0.5 text-xs text-ink-3">
            {t(day.signedIn)} – {live ? "now" : t(day.signedOut)}
            {span !== null && ` · ${fmtMinutes(span)}`}
          </p>
        </div>
        {live && <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary-hi">Live</span>}
      </header>
      <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Num label="Done" value={total} />
        <Num label="Signal" value={day.signalDone} />
        <Num label="Noise" value={day.noiseDone} />
        <Num label="Plan" value={`${day.plannedDone}/${day.planned}`} />
      </dl>
      {total > 0 && (
        <div className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full" aria-hidden>
          {day.signalDone > 0 && <div className="bg-chart-signal" style={{ width: `${sigPct}%` }} />}
          {day.noiseDone > 0 && <div className="flex-1 bg-chart-noise" />}
        </div>
      )}
      <p className="mt-2 text-xs text-ink-3">
        {day.carriedOver > 0 ? `${day.carriedOver} carried over` : "Nothing carried over"}
        {day.idleMinutes > 0 && ` · ${fmtMinutes(day.idleMinutes)} idle`}
      </p>
      {day.notes && <p className="mt-2 rounded-xl bg-white/5 p-2.5 text-xs leading-relaxed text-ink-2">{day.notes}</p>}
    </article>
  );
}

function Num({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dd className="font-mono text-lg font-bold tabular-nums text-ink">{value}</dd>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</dt>
    </div>
  );
}

function niceTicks(max: number) {
  const step = max <= 6 ? 2 : max <= 12 ? 4 : max <= 24 ? 6 : 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step - 1; v += step) out.push(v);
  return out;
}
