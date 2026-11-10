"use client";

import { useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { CHILD_LEVEL, LEVEL_LABELS } from "@/lib/config";
import { split } from "@/lib/flow";
import { useDictation } from "@/lib/hooks";
import type { Task } from "@/lib/types";
import { Modal, useMC } from "./ui";

export function SplitDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { tasks, today, apply } = useMC();
  const leaf = !task.level || task.level === "task";
  const [text, setText] = useState(leaf ? `${task.name}\n` : "");
  const voice = useDictation((t) => setText(t.replace(/\s*(?:next|then|new line)\s*[,.]?\s*/gi, "\n")));
  const parts = text.split("\n").map((s) => s.trim()).filter(Boolean);
  const childLabel = leaf ? "tasks" : `${LEVEL_LABELS[CHILD_LEVEL[task.level!]].toLowerCase()}s`;

  return (
    <Modal title={`Split ${leaf ? "task" : (task.level ?? "task")}`} onClose={onClose}>
      <p className="mb-3 text-sm text-ink-2">
        {leaf
          ? "One part per line. This task becomes the first line; the rest go next in line after it."
          : `One ${childLabel.slice(0, -1)} per line. They're created under "${task.name}", and the first one takes its place.`}
      </p>
      <div className="relative">
        <textarea
          data-autofocus
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"First part\nSecond part\nThird part"}
          className="w-full resize-none rounded-2xl bg-white/5 p-3.5 pr-12 text-sm leading-relaxed text-ink placeholder:text-ink-3 ring-1 ring-white/10 focus:ring-primary-hi"
        />
        {voice.supported && (
          <button
            onClick={() => (voice.listening ? voice.stop() : voice.start(text))}
            aria-label={voice.listening ? "Stop dictation" : "Dictate parts"}
            aria-pressed={voice.listening}
            className={`absolute right-2.5 top-2.5 rounded-full p-2 ${voice.listening ? "bg-danger text-white" : "text-ink-3 glass-chip hover:text-ink"}`}
          >
            {voice.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>
        )}
      </div>
      {voice.listening && <p className="mt-1.5 text-xs text-ink-3">Listening. Say &quot;next&quot; between parts.</p>}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-ink-3">
          {parts.length} {parts.length === 1 ? "part" : "parts"}
        </span>
        <div className="flex gap-2">
          <button onClick={onClose} className="h-10 rounded-full px-4 text-sm font-semibold text-ink-2 hover:bg-white/10">
            Cancel
          </button>
          <button
            disabled={leaf ? parts.length < 2 : parts.length < 1}
            onClick={() => {
              apply(split(tasks, task, parts, today));
              onClose();
            }}
            className="h-10 rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hi disabled:opacity-40"
          >
            Split into {parts.length || "…"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
