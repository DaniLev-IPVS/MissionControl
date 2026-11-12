"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownLeft, Loader2, Mic, MicOff, Waves } from "lucide-react";
import { LEVEL_LABELS } from "@/lib/config";
import { addTask, draftTask, type Lane, type Plan } from "@/lib/flow";
import { useDictation } from "@/lib/hooks";
import type { PopupItem } from "@/lib/types";
import { cx, useLatest, useMC } from "./ui";

// The bar at the top of the page: type or dictate what just came up, press Enter. Sonnet pulls
// out each thing in it, gives it a clean name, and files it under the mission and department it
// belongs to (or a new mission when several things share a goal). The tasks land in Noise, so
// the plan stays untouched until you decide what to do with them.

type Shown = { name: string; level: PopupItem["level"]; where: string; container: boolean };
type Entry = { key: number; raw: string; state: "sorting" | "added" | "failed"; items: Shown[] };

const SORTING_TIMEOUT_MS = 25_000;
const SHOW_MS = 9000;

async function sortIt(text: string): Promise<PopupItem[]> {
  const asTyped: PopupItem[] = [
    { key: "n1", name: text.slice(0, 200), level: "task", parentId: null, parentKey: null, departmentIds: [], due: null, where: "" },
  ];
  try {
    const res = await fetch("/api/popup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: text }),
      signal: AbortSignal.timeout(SORTING_TIMEOUT_MS),
    });
    if (!res.ok) return asTyped;
    const { items } = (await res.json()) as { items?: PopupItem[] };
    return items?.length ? items : asTyped;
  } catch {
    return asTyped; // slow or offline: add it anyway, as typed and without a home
  }
}

export function PopupBar() {
  const mc = useMC();
  const latest = useLatest(mc);
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const voice = useDictation(setText);

  // "/" jumps to the bar from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = useCallback((key: number, patch: Partial<Entry>) => {
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }, []);

  async function submit() {
    const raw = text.replace(/\s+/g, " ").trim();
    if (!raw) return;
    voice.stop();
    setText("");
    const key = ++seq.current;
    setEntries((list) => [{ key, raw, state: "sorting" as const, items: [] }, ...list].slice(0, 4));

    const items = await sortIt(raw);
    // The board may have moved on while this was being sorted: read it fresh.
    const { tasks, today, apply, taskById } = latest.current;
    const hasKids = new Set(items.map((i) => i.parentKey).filter(Boolean));
    const tempOf = new Map<string, string>(); // item key -> temp id of the new task
    const plan: Plan = { changes: [], creates: [] };
    const shown: Shown[] = [];
    let current = tasks;
    for (const item of items) {
      const parentId = item.parentKey ? (tempOf.get(item.parentKey) ?? null) : item.parentId && taskById(item.parentId) ? item.parentId : null;
      // A new mission or project that holds tasks from this pop-up is structure, not noise:
      // its tasks carry the noise and show it as their parent.
      const container = item.level !== "task" && hasKids.has(item.key);
      const lane: Lane = container ? "backlog" : "noise";
      const p = addTask(current, today, { name: item.name, lane, level: item.level, parentId, departmentIds: item.departmentIds, due: item.due });
      plan.creates.push(...p.creates);
      plan.changes.push(...p.changes);
      if (p.creates[0]) tempOf.set(item.key, p.creates[0].tempId);
      current = [...current, ...p.creates.map(draftTask)];
      shown.push({ name: item.name, level: item.level, where: parentId ? item.where : item.where.split(" › ")[0] ?? "", container });
    }
    const ok = await apply(plan);
    update(key, { state: ok ? "added" : "failed", items: shown });
    setTimeout(() => setEntries((list) => list.filter((e) => e.key !== key)), SHOW_MS);
  }

  return (
    <section aria-label="Add a pop-up" className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex h-12 items-center gap-2 rounded-full pl-4 pr-1.5 glass ring-1 ring-noise/25 focus-within:ring-noise/60"
      >
        <Waves className="size-4 shrink-0 text-noise" aria-hidden />
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && input.current?.blur()}
          placeholder={voice.listening ? "Listening…" : "Something came up? Type it and press Enter"}
          title="Sorted into clean tasks (and missions, when several things share a goal), filed where they belong and added to Noise. Your plan stays as it is."
          aria-label="A task that just came up"
          enterKeyHint="done"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
        />
        {!text && (
          <kbd className="hidden rounded-md px-1.5 py-0.5 font-mono text-[11px] text-ink-3 ring-1 ring-white/12 sm:inline" aria-hidden>
            /
          </kbd>
        )}
        {voice.supported && (
          <button
            type="button"
            onClick={() => (voice.listening ? voice.stop() : voice.start(text))}
            aria-label={voice.listening ? "Stop dictation" : "Dictate the pop-up"}
            aria-pressed={voice.listening}
            className={cx(
              "grid size-9 shrink-0 place-items-center rounded-full transition-colors",
              voice.listening ? "animate-pulse bg-danger text-white" : "text-ink-3 hover:bg-white/10 hover:text-ink",
            )}
          >
            {voice.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>
        )}
        <button
          type="submit"
          disabled={!text.trim()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-noise/20 px-3.5 text-xs font-semibold text-noise transition-colors hover:bg-noise/30 disabled:opacity-40"
        >
          <span className="hidden sm:inline">Add to noise</span>
          <span className="sr-only sm:hidden">Add to noise</span>
          <CornerDownLeft className="size-3.5" aria-hidden />
        </button>
      </form>
      {voice.error && <p className="px-4 text-xs text-danger-hi">{voice.error}</p>}

      {entries.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-1" aria-live="polite">
          {entries.flatMap((e) =>
            e.state === "sorting" ? (
              <Chip key={e.key} dot="spin" name={e.raw} note="sorting it out…" />
            ) : (
              e.items.map((it, i) => (
                <Chip
                  key={`${e.key}-${i}`}
                  dot={e.state === "failed" ? "fail" : "ok"}
                  name={it.name}
                  badge={it.level !== "task" ? `New ${LEVEL_LABELS[it.level].toLowerCase()}` : undefined}
                  note={
                    e.state === "failed"
                      ? "couldn't be saved"
                      : `${it.container ? "on the board" : "in Noise"}${it.where ? ` · ${it.where}` : it.level === "task" ? " · no home found" : ""}`
                  }
                />
              ))
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function Chip({ dot, name, note, badge }: { dot: "spin" | "ok" | "fail"; name: string; note: string; badge?: string }) {
  return (
    <li
      className={cx(
        "animate-pop inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs glass-chip",
        dot === "fail" ? "text-danger-hi" : "text-ink-2",
      )}
    >
      {dot === "spin" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-noise" aria-hidden />
      ) : (
        <span className={cx("size-2 shrink-0 rounded-full", dot === "fail" ? "bg-danger" : "bg-noise")} aria-hidden />
      )}
      {badge && <span className="shrink-0 rounded-full bg-noise/20 px-1.5 py-px text-[10px] font-semibold text-noise">{badge}</span>}
      <span className="truncate font-medium text-ink">{name}</span>
      <span className="shrink-0 text-ink-3">{note}</span>
    </li>
  );
}
