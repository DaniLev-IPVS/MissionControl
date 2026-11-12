"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownLeft, Loader2, Mic, MicOff, Waves } from "lucide-react";
import { addTask } from "@/lib/flow";
import { useDictation } from "@/lib/hooks";
import type { PopupFiling } from "@/lib/types";
import { cx, useLatest, useMC } from "./ui";

// The bar at the top of the page: type what just came up, press Enter. It is filed under
// the mission and department it belongs to and lands in Noise, so the plan stays untouched
// until you decide what to do with it.

type Entry = { key: number; name: string; state: "filing" | "added" | "failed"; where: string };

const FILING_TIMEOUT_MS = 12_000;
const SHOW_MS = 7000;
const UNFILED: PopupFiling = { parentId: null, departmentIds: [], due: null, where: "" };

async function fileIt(name: string): Promise<PopupFiling> {
  try {
    const res = await fetch("/api/popup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(FILING_TIMEOUT_MS),
    });
    if (!res.ok) return UNFILED;
    return { ...UNFILED, ...((await res.json()) as Partial<PopupFiling>) };
  } catch {
    return UNFILED; // slow or offline: add it anyway, without a home
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
    const name = text.replace(/\s+/g, " ").trim();
    if (!name) return;
    voice.stop();
    setText("");
    const key = ++seq.current;
    setEntries((list) => [{ key, name, state: "filing" as const, where: "" }, ...list].slice(0, 4));

    const filing = await fileIt(name);
    // The board may have moved on while this was being filed: read it fresh.
    const { tasks, today, apply, taskById } = latest.current;
    const parentId = filing.parentId && taskById(filing.parentId) ? filing.parentId : null;
    const ok = await apply(
      addTask(tasks, today, {
        name,
        lane: "noise",
        level: "task",
        parentId,
        departmentIds: filing.departmentIds,
        due: filing.due,
      }),
    );
    update(key, { state: ok ? "added" : "failed", where: parentId || filing.departmentIds.length ? filing.where : "" });
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
          title="Filed under the mission and department it belongs to, and added to Noise. Your plan stays as it is."
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
          {entries.map((e) => (
            <li
              key={e.key}
              className={cx(
                "animate-pop inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs glass-chip",
                e.state === "failed" ? "text-danger-hi" : "text-ink-2",
              )}
            >
              {e.state === "filing" ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-noise" aria-hidden />
              ) : (
                <span className={cx("size-2 shrink-0 rounded-full", e.state === "failed" ? "bg-danger" : "bg-noise")} aria-hidden />
              )}
              <span className="truncate font-medium text-ink">{e.name}</span>
              <span className="shrink-0 text-ink-3">
                {e.state === "filing"
                  ? "finding where it belongs…"
                  : e.state === "failed"
                    ? "couldn't be saved"
                    : e.where
                      ? `in Noise · ${e.where}`
                      : "in Noise · no home found"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
