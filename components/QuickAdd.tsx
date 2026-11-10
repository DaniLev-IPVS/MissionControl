"use client";

import { useEffect, useMemo, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { LEVELS, LEVEL_LABELS, PRIORITIES, type Level } from "@/lib/config";
import { addTask, draftTask, type Lane } from "@/lib/flow";
import { useDictation } from "@/lib/hooks";
import { LANE_LABELS } from "./TaskCard";
import { Modal, Segmented, cx, useMC } from "./ui";

const PREFS_KEY = "mc.quickAdd";
type Prefs = { lane: Lane; level: Level; dept: string };

function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function QuickAdd({ onClose, startListening = false }: { onClose: () => void; startListening?: boolean }) {
  const { board, tasks, today, apply } = useMC();
  const [prefs] = useState(loadPrefs);
  const [text, setText] = useState("");
  const [lane, setLane] = useState<Lane>(prefs.lane ?? "noise");
  const [level, setLevel] = useState<Level>(prefs.level ?? "task");
  const [dept, setDept] = useState(prefs.dept ?? "");
  const [parentId, setParentId] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState("");
  const voice = useDictation(setText);

  useEffect(() => {
    if (startListening && voice.supported) voice.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startListening, voice.supported]);

  // Departments with open work first, then the rest.
  const departments = useMemo(() => {
    const used = new Set(tasks.flatMap((t) => t.departmentIds));
    return [...board.departments].sort(
      (a, b) => Number(used.has(b.id)) - Number(used.has(a.id)) || a.name.localeCompare(b.name),
    );
  }, [board.departments, tasks]);

  const parentLevel: Level | null = level === "task" ? "mission" : level === "mission" ? "project" : null;
  const parents = useMemo(
    () =>
      parentLevel
        ? tasks.filter((t) => t.level === parentLevel && !t.id.startsWith("tmp-") && (!dept || t.departmentIds.includes(dept)))
        : [],
    [tasks, parentLevel, dept],
  );

  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);

  function submit() {
    if (!lines.length) return;
    voice.stop();
    let current = tasks;
    const plan = { changes: [] as ReturnType<typeof addTask>["changes"], creates: [] as ReturnType<typeof addTask>["creates"] };
    for (const name of lines) {
      const p = addTask(current, today, {
        name,
        lane,
        level,
        departmentIds: dept ? [dept] : parentId ? (tasks.find((t) => t.id === parentId)?.departmentIds ?? []) : [],
        parentId: parentId || null,
        priority: priority || null,
        due: due || null,
      });
      plan.creates.push(...p.creates);
      plan.changes.push(...p.changes);
      // Next line goes after this one.
      current = [...current, ...p.creates.map(draftTask)];
    }
    apply(plan);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ lane, level, dept }));
    } catch {}
    onClose();
  }

  const lanes: Lane[] = ["noise", "today", "dashboard", "backlog"];

  return (
    <Modal title="Add tasks" onClose={onClose} wide>
      <div className="relative">
        <textarea
          data-autofocus
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder={voice.listening ? "Listening…" : "What needs doing? One task per line."}
          className="w-full resize-none rounded-2xl bg-white/5 p-4 pr-14 text-base leading-relaxed text-ink placeholder:text-ink-3 ring-1 ring-white/10 focus:ring-primary-hi"
        />
        {voice.supported && (
          <button
            onClick={() => (voice.listening ? voice.stop() : voice.start(text))}
            aria-label={voice.listening ? "Stop dictation" : "Dictate"}
            aria-pressed={voice.listening}
            className={cx(
              "absolute right-3 top-3 rounded-full p-2.5 transition-colors",
              voice.listening ? "animate-pulse bg-danger text-white" : "text-ink-2 glass-chip hover:text-ink",
            )}
          >
            {voice.listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
        )}
      </div>
      {voice.error && <p className="mt-1.5 text-xs text-danger-hi">{voice.error}</p>}

      <div className="mt-4 space-y-3">
        <Row label="Where">
          <Segmented
            label="Where"
            value={lane}
            onChange={setLane}
            options={lanes.map((l) => ({
              value: l,
              label: l === "noise" ? "Noise (pop-up)" : LANE_LABELS[l],
              dot: l === "noise" ? "#e89558" : l === "backlog" ? "#8a92a6" : "#5b87ff",
            }))}
          />
        </Row>
        <Row label="Level">
          <Segmented
            label="Level"
            value={level}
            onChange={(v) => {
              setLevel(v);
              setParentId("");
            }}
            options={[...LEVELS].reverse().map((l) => ({ value: l, label: LEVEL_LABELS[l] }))}
          />
        </Row>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Department">
            <select value={dept} onChange={(e) => { setDept(e.target.value); setParentId(""); }} className={inputCls}>
              <option value="">None</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          {parentLevel && (
            <Field label={`Parent ${LEVEL_LABELS[parentLevel].toLowerCase()}`}>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputCls}>
                <option value="">None</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
              <option value="">None</option>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Due">
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="hidden text-xs text-ink-3 sm:inline">⌘ Enter to add</span>
        <div className="ml-auto flex gap-2">
          <button onClick={onClose} className="h-11 rounded-full px-4 text-sm font-semibold text-ink-2 hover:bg-white/10">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!lines.length}
            className="h-11 rounded-full bg-primary px-6 text-sm font-semibold text-white shadow-[0_8px_30px_-8px_rgb(24_86_255/0.8)] hover:bg-primary-hi disabled:opacity-40"
          >
            Add {lines.length > 1 ? `${lines.length} tasks` : "task"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const inputCls = "h-10 w-full rounded-xl bg-white/5 px-3 text-sm text-ink ring-1 ring-white/10";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-16 text-xs font-semibold text-ink-3">{label}</span>
      <div className="min-w-0 overflow-x-auto">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-ink-3">{label}</span>
      {children}
    </label>
  );
}
