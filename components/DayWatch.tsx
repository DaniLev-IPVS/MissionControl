"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Sunset } from "lucide-react";
import { openDay, signOut, stillWorking } from "@/app/actions";
import { dayIsOn, endOfDay, midnightCheck } from "@/lib/days";
import { formatElapsed, useNow } from "@/lib/hooks";
import { useLatest, useMC } from "./ui";

// Keeps the workday honest without asking for clicks.
//
//  - Work in a lane with no open day (dragged in without "Start your day"): the day's row is
//    opened quietly, so the day has a start time and a date.
//  - Midnight on a day that wasn't ended: a silent pop-up asks whether you're still working.
//    "I'm still working" pushes the next check an hour out. No answer within 15 minutes and the
//    day is ended for you, exactly as "End your day" would. If the page was closed at midnight,
//    that happens the next time it is opened.
//
// The confirmation is saved on the server, so another tab or device doesn't end a day you just
// confirmed; this browser also remembers it in case that save didn't go through.

const LOCAL_KEY = "mc.stillWorking";
const OPEN_AFTER_MS = 4000; // let a save and its refresh settle before opening a row
const RETRY_MS = 60_000;

type Confirmed = { dayId: string; until: number };
type Ended = { at: number; carried: number };

function readLocal(): Confirmed | null {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "null") as Confirmed | null;
    return v && typeof v.dayId === "string" && Number.isFinite(v.until) ? v : null;
  } catch {
    return null;
  }
}

export function DayWatch({
  paused,
  saving,
  fresh,
  onEndDay,
}: {
  paused: boolean; // the End your day dialog is open: don't end the day underneath it
  saving: boolean;
  fresh: boolean; // the board was synced in the last few seconds
  onEndDay: () => void;
}) {
  const mc = useMC();
  const latest = useLatest(mc);
  const { board, tasks } = mc;
  const now = useNow();
  const day = board.day;
  const on = dayIsOn(tasks);
  const open = !!day?.signedIn && !day.signedOut;

  // ---- Work in a lane, no open day: open one ----
  useEffect(() => {
    if (!on || open || saving || paused) return;
    const id = setTimeout(() => void openDay().catch(() => {}), OPEN_AFTER_MS);
    return () => clearTimeout(id);
  }, [on, open, saving, paused]);

  // ---- Midnight ----
  const [confirmed, setConfirmed] = useState<Confirmed | null>(readLocal);
  const [ended, setEnded] = useState<Ended | null>(null);
  const check = day && open && on ? midnightCheck(day, confirmed?.dayId === day.id ? confirmed.until : 0) : null;
  const asking = !!check && now >= check.checkAt && now < check.deadline && !paused;
  const deadline = check?.deadline ?? 0;
  const expired = !!check && now >= deadline;

  const busy = useRef(false);
  const retryAt = useRef(0);
  // Checked on every tick of the clock, so it also runs after a failed try or once the tab is back.
  useEffect(() => {
    if (!expired || paused || saving || !fresh || busy.current) return;
    if (document.visibilityState !== "visible" || now < retryAt.current) return;
    const { board, tasks, apply } = latest.current;
    const end = endOfDay(board, tasks);
    const at = deadline;
    const time = new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const notes = [board.day?.notes, `Ended automatically at ${time}: no "still working" after midnight.`].filter(Boolean).join("\n").slice(0, 2000);
    busy.current = true;
    apply({ changes: end.changes, creates: [] }, () =>
      signOut(board.day?.id ?? null, end.stats, notes, end.returnIds, end.dropIds, new Date(at).toISOString(), end.idleLogs),
    )
      .then((ok) => {
        if (ok) setEnded({ at, carried: end.carried.length });
        else retryAt.current = Date.now() + RETRY_MS;
      })
      .finally(() => (busy.current = false));
  }, [expired, deadline, paused, saving, fresh, now, latest]);

  function confirm() {
    if (!day || !check) return;
    const next = { dayId: day.id, until: check.next };
    setConfirmed(next);
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
    } catch {}
    void stillWorking(day.id, new Date(check.next).toISOString()).catch(() => {});
  }

  const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const left = check ? check.deadline - now : 0;
  const mins = Math.max(1, Math.ceil(left / 60_000));

  return (
    <>
      {asking && check && (
        <div role="alertdialog" aria-label="Still working?" className="animate-pop rounded-3xl p-4 glass-float ring-1 ring-noise/45">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-noise/20 text-noise">
              <Moon className="size-4.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline justify-between gap-3 text-sm font-semibold text-ink">
                Still working?
                <span className="font-mono text-xs tabular-nums text-noise" aria-label={`${mins} minutes left`}>
                  {formatElapsed(left)}
                </span>
              </p>
              <p className="mt-1 text-sm leading-snug text-ink-2">
                If you don&apos;t confirm that you&apos;re still working in the next {mins} {mins === 1 ? "minute" : "minutes"}, I will end your day
                automatically.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button onClick={onEndDay} className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-ink-2 glass-chip hover:text-ink">
              <Sunset className="size-4 text-noise" aria-hidden /> End the day
            </button>
            <button
              onClick={confirm}
              title={`I'll ask again at ${clock(check.next)}`}
              className="h-10 rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hi"
            >
              I&apos;m still working
            </button>
          </div>
        </div>
      )}
      {ended && (
        <div role="status" className="animate-pop flex items-center gap-3 rounded-2xl p-3.5 glass-float ring-1 ring-noise/35">
          <Sunset className="size-5 shrink-0 text-noise" aria-hidden />
          <p className="flex-1 text-sm text-ink">
            Your day was ended automatically at {clock(ended.at)}.
            <span className="text-ink-3">
              {" "}
              {ended.carried > 0
                ? `${ended.carried} unfinished ${ended.carried === 1 ? "task is" : "tasks are"} back on the to-do list.`
                : "Nothing was left unfinished."}
            </span>
          </p>
          <button onClick={() => setEnded(null)} className="text-xs font-semibold text-ink-2 hover:text-ink">
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
