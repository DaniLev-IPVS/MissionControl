"use client";

import { useState } from "react";
import { Loader2, Mic, MicOff, Sparkles } from "lucide-react";
import { CHILD_LEVEL, LEVEL_LABELS } from "@/lib/config";
import { split } from "@/lib/flow";
import { useDictation } from "@/lib/hooks";
import type { Task } from "@/lib/types";
import { Modal, Segmented, cx, useMC } from "./ui";

// Two ways to split, picked at the top of the dialog:
//  - Describe: say how you want it split; Sonnet writes the parts, you check them, then split.
//  - Manual: list the parts yourself, one per line.
// Both end in the same list of parts and the same split. The last way used is remembered.

type Mode = "describe" | "manual";
const MODE_KEY = "mc.splitMode";
const SUGGEST_TIMEOUT_MS = 30_000;

function savedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "manual" ? "manual" : "describe";
  } catch {
    return "describe";
  }
}

export function SplitDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { tasks, today, apply } = useMC();
  const leaf = !task.level || task.level === "task";
  const child = leaf ? "task" : LEVEL_LABELS[CHILD_LEVEL[task.level!]].toLowerCase();

  const [mode, setMode] = useState<Mode>(savedMode);
  const [how, setHow] = useState("");
  const [text, setText] = useState(leaf ? `${task.name}\n` : "");
  const [suggested, setSuggested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const howVoice = useDictation(setHow);
  const partsVoice = useDictation((t) => setText(t.replace(/\s*(?:next|then|new line)\s*[,.]?\s*/gi, "\n")));
  const parts = text.split("\n").map((s) => s.trim()).filter(Boolean);
  const showParts = mode === "manual" || suggested;

  function pick(next: Mode) {
    howVoice.stop();
    partsVoice.stop();
    setError(null);
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {}
  }

  async function suggest() {
    if (busy) return;
    howVoice.stop();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, name: task.name, level: task.level, how: how.trim() }),
        signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
      });
      const data = (await res.json().catch(() => ({}))) as { parts?: string[]; error?: string };
      if (!res.ok || !data.parts?.length) {
        setError(data.error ?? "Couldn't work out the split. Try again, or list the parts yourself in Manual.");
        return;
      }
      setText(data.parts.join("\n"));
      setSuggested(true);
    } catch {
      setError("That took too long. Try again, or list the parts yourself in Manual.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Split ${leaf ? "task" : (task.level ?? "task")}`} onClose={onClose}>
      <div className="mb-3">
        <Segmented
          label="How to split"
          value={mode}
          onChange={pick}
          options={[
            { value: "describe", label: "Describe it" },
            { value: "manual", label: "Manual" },
          ]}
        />
      </div>

      {mode === "describe" && (
        <>
          <p className="mb-3 text-sm text-ink-2">
            Say how you want it split, or leave it empty and let AI decide. You see the parts before anything changes.
          </p>
          <div className="relative">
            <textarea
              data-autofocus
              autoFocus
              rows={suggested ? 2 : 6} // as tall as the Manual list, so the dialog doesn't jump between the two
              value={how}
              onChange={(e) => setHow(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                suggest();
              }}
              placeholder={
                howVoice.listening
                  ? "Listening…"
                  : leaf
                    ? "e.g. Three steps: outline, draft, then review"
                    : `e.g. One ${child} per channel`
              }
              aria-label="How you want it split"
              className="w-full resize-none rounded-2xl bg-white/5 p-3.5 pr-12 text-sm leading-relaxed text-ink placeholder:text-ink-3 ring-1 ring-white/10 focus:ring-primary-hi"
            />
            {howVoice.supported && (
              <MicButton listening={howVoice.listening} label="Dictate how to split it" onClick={() => (howVoice.listening ? howVoice.stop() : howVoice.start(how))} />
            )}
          </div>
          {suggested && (
            <button
              onClick={suggest}
              disabled={busy}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-ink-2 glass-chip hover:text-ink disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
              {busy ? "Working it out…" : "Suggest again"}
            </button>
          )}
        </>
      )}

      {mode === "manual" && (
        <p className="mb-3 text-sm text-ink-2">
          {leaf
            ? "One part per line. This task becomes the first line; the rest go next in line after it."
            : `One ${child} per line. They're created under "${task.name}", and the first one takes its place.`}
        </p>
      )}

      {showParts && (
        <>
          {mode === "describe" && (
            <p className="mb-1.5 mt-4 text-xs text-ink-3">
              {leaf
                ? "The split, one part per line. Edit anything. This task becomes the first line; the rest go next in line."
                : `The split, one ${child} per line. Edit anything. They're created under "${task.name}".`}
            </p>
          )}
          <div className="relative">
            <textarea
              data-autofocus={mode === "manual" ? true : undefined}
              autoFocus={mode === "manual"}
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"First part\nSecond part\nThird part"}
              aria-label="The parts, one per line"
              className={cx(
                "w-full resize-none rounded-2xl bg-white/5 p-3.5 text-sm leading-relaxed text-ink placeholder:text-ink-3 ring-1 ring-white/10 focus:ring-primary-hi",
                mode === "manual" && "pr-12",
                busy && "opacity-50",
              )}
            />
            {mode === "manual" && partsVoice.supported && (
              <MicButton listening={partsVoice.listening} label="Dictate parts" onClick={() => (partsVoice.listening ? partsVoice.stop() : partsVoice.start(text))} />
            )}
          </div>
          {partsVoice.listening && <p className="mt-1.5 text-xs text-ink-3">Listening. Say &quot;next&quot; between parts.</p>}
        </>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger-hi">
          {error}
        </p>
      )}
      {(howVoice.error || partsVoice.error) && <p className="mt-2 text-xs text-danger-hi">{howVoice.error || partsVoice.error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-ink-3">{showParts ? `${parts.length} ${parts.length === 1 ? "part" : "parts"}` : "Enter to suggest"}</span>
        <div className="flex gap-2">
          <button onClick={onClose} className="h-10 rounded-full px-4 text-sm font-semibold text-ink-2 hover:bg-white/10">
            Cancel
          </button>
          {showParts ? (
            <button
              disabled={busy || (leaf ? parts.length < 2 : parts.length < 1)}
              onClick={() => {
                apply(split(tasks, task, parts, today));
                onClose();
              }}
              className="h-10 rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hi disabled:opacity-40"
            >
              Split into {parts.length || "…"}
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={suggest}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hi disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {busy ? "Working it out…" : "Suggest the split"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function MicButton({ listening, label, onClick }: { listening: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={listening ? "Stop dictation" : label}
      aria-pressed={listening}
      className={cx("absolute right-2.5 top-2.5 rounded-full p-2", listening ? "bg-danger text-white" : "text-ink-3 glass-chip hover:text-ink")}
    >
      {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
    </button>
  );
}
