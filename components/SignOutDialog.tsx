"use client";

import { useMemo, useState } from "react";
import { Coins, Mic, MicOff } from "lucide-react";
import { signOut } from "@/app/actions";
import { computeDayStats } from "@/lib/days";
import { isSignal } from "@/lib/flow";
import { useDictation, useNow } from "@/lib/hooks";
import { fmtMinutes } from "./DetailsDrawer";
import { Haiku } from "./Haiku";
import { Modal, cx, useMC } from "./ui";

export function SignOutDialog({ onClose }: { onClose: () => void }) {
  const { board, tasks, apply } = useMC();
  const day = board.day!;
  const stats = useMemo(() => computeDayStats(board, tasks), [board, tasks]);
  const [notes, setNotes] = useState(day.notes ?? "");
  const [saving, setSaving] = useState(false);
  const voice = useDictation(setNotes);

  // Everything still in a lane, plus planned work that slipped out of one, goes back to the to-do list.
  const planned = new Set(day.plannedIds);
  const carried = tasks.filter((t) => !t.id.startsWith("tmp-") && (isSignal(t) || planned.has(t.id)));
  // Noise you were still working on wasn't planned: it just goes back to Noise.
  const dropped = tasks.filter((t) => !t.id.startsWith("tmp-") && t.focus === "detour" && !planned.has(t.id));
  const signedIn = day.signedIn ? new Date(day.signedIn) : null;
  const now = useNow();
  const minutes = signedIn && now ? Math.round((now - signedIn.getTime()) / 60000) : 0;
  const signalPct = stats.done ? Math.round((stats.signalDone / stats.done) * 100) : 0;

  async function confirm() {
    setSaving(true);
    voice.stop();
    const returnIds = carried.map((t) => t.id);
    const dropIds = dropped.map((t) => t.id);
    const missedOn = day.date;
    const flush = { focus: null, focusOrder: null, idleSince: null, idleReminder: null };
    const ok = await apply(
      {
        changes: [
          ...returnIds.map((id) => ({ id, patch: { ...flush, missedOn } })),
          ...dropIds.map((id) => ({ id, patch: flush })),
        ],
        creates: [],
      },
      () => signOut(day.id, { ...stats, carriedOver: carried.length }, notes, returnIds, dropIds),
    );
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal title="End your day" onClose={onClose} wide>
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-warning/10 px-4 py-3 ring-1 ring-warning/30">
        <Coins className="size-6 shrink-0 text-warning" />
        <div>
          <p className="text-sm font-semibold text-ink">
            +{stats.done} token{stats.done === 1 ? "" : "s"} today
          </p>
          <p className="text-xs text-ink-3">One for every task you finished. See them grow in Tokens.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Done" value={stats.done} />
        <Stat label="Signal" value={stats.signalDone} tone="signal" />
        <Stat label="Noise" value={stats.noiseDone} tone="noise" />
        <Stat label="Planned done" value={`${stats.plannedDone}/${stats.planned}`} />
      </div>

      {stats.done > 0 && (
        <figure className="mt-4" aria-label={`Signal ${stats.signalDone}, noise ${stats.noiseDone}`}>
          <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
            {stats.signalDone > 0 && <div className="rounded-l-full bg-chart-signal" style={{ width: `${signalPct}%` }} />}
            {stats.noiseDone > 0 && <div className="flex-1 rounded-r-full bg-chart-noise" />}
          </div>
          <figcaption className="mt-1.5 flex justify-between text-xs text-ink-3">
            <span>
              <span className="mr-1 inline-block size-2 rounded-full bg-chart-signal" /> Signal {signalPct}%
            </span>
            <span>
              Noise {100 - signalPct}% <span className="ml-1 inline-block size-2 rounded-full bg-chart-noise" />
            </span>
          </figcaption>
        </figure>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ink-3">Signed in</dt>
        <dd className="text-ink-2">
          {signedIn ? signedIn.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—"}
          {minutes > 0 && <span className="text-ink-3"> · {fmtMinutes(minutes)} ago</span>}
        </dd>
        <dt className="text-ink-3">Idle time today</dt>
        <dd className="text-ink-2">{fmtMinutes(stats.idleMinutes)}</dd>
      </dl>

      {carried.length > 0 ? (
        <div className="mt-5 rounded-2xl p-4 glass-chip">
          <p className="text-sm font-semibold text-ink">
            {carried.length} unfinished {carried.length === 1 ? "task goes" : "tasks go"} back to the to-do list
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            Today&apos;s lanes are cleared. Each one is marked &quot;missed {fmtDay(day.date)}&quot; so you can see what slipped.
          </p>
          <ul className="mt-2.5 space-y-1 text-sm text-ink-2">
            {carried.slice(0, 8).map((t) => (
              <li key={t.id} className="truncate">· {t.name}</li>
            ))}
            {carried.length > 8 && <li className="text-ink-3">+ {carried.length - 8} more</li>}
          </ul>
        </div>
      ) : (
        <p className="mt-5 rounded-2xl p-4 text-sm text-success glass-chip">Everything you planned is done. Clean slate for tomorrow.</p>
      )}

      <Haiku
        kind="day"
        auto
        items={board.doneToday.map((d) => d.name)}
        note={`${stats.done} done (${stats.signalDone} signal, ${stats.noiseDone} noise), ${stats.plannedDone}/${stats.planned} of the plan, ${carried.length} unfinished, ${fmtMinutes(stats.idleMinutes)} idle`}
        className="mt-4"
      />

      <label className="mt-5 block">
        <span className="text-xs font-semibold text-ink-3">Notes on the day</span>
        <div className="relative mt-1.5">
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What went well, what got in the way?"
            className="w-full resize-none rounded-2xl bg-white/5 p-3.5 pr-12 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/10"
          />
          {voice.supported && (
            <button
              type="button"
              onClick={() => (voice.listening ? voice.stop() : voice.start(notes))}
              aria-label={voice.listening ? "Stop dictation" : "Dictate notes"}
              className={cx("absolute right-2.5 top-2.5 rounded-full p-2", voice.listening ? "bg-danger text-white" : "text-ink-3 glass-chip hover:text-ink")}
            >
              {voice.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </button>
          )}
        </div>
      </label>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="h-11 rounded-full px-4 text-sm font-semibold text-ink-2 hover:bg-white/10">
          Not yet
        </button>
        <button
          onClick={confirm}
          disabled={saving}
          className="h-11 rounded-full bg-primary px-6 text-sm font-semibold text-white hover:bg-primary-hi disabled:opacity-40"
        >
          {saving ? "Saving…" : "End my day"}
        </button>
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "signal" | "noise" }) {
  return (
    <div className="rounded-2xl p-3.5 glass-chip">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-3">
        {tone && <span className={cx("size-2 rounded-full", tone === "signal" ? "bg-chart-signal" : "bg-chart-noise")} />}
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
