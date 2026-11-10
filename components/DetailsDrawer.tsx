"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { ALL_STATUSES, LEVEL_LABELS, PRIORITIES } from "@/lib/config";
import { laneOf } from "@/lib/flow";
import type { Task, TaskPatch } from "@/lib/types";
import { LANE_LABELS } from "./TaskCard";
import { DeptChip, IdleTimer, LevelBadge, useMC } from "./ui";

export function DetailsDrawer({ task, onClose }: { task: Task; onClose: () => void }) {
  const { apply, taskById, titleOf, deptName, today } = useMC();
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(task.name);
  const [editedFor, setEditedFor] = useState(task.id);
  if (editedFor !== task.id) {
    setEditedFor(task.id);
    setName(task.name);
  }

  useEffect(() => {
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const save = (patch: TaskPatch) => apply({ changes: [{ id: task.id, patch }], creates: [] });

  // Breadcrumb: Project > Mission > Task
  const chain: { id: string; name: string; level: string }[] = [];
  let cur = task.parentId;
  for (let i = 0; cur && i < 4; i++) {
    const p = taskById(cur);
    chain.unshift({ id: cur, name: p?.name ?? titleOf(cur), level: p?.level ? LEVEL_LABELS[p.level] : "" });
    cur = p?.parentId ?? null;
  }

  const lane = laneOf(task, today);
  const idleLines = task.idleLog ? task.idleLog.split("\n").filter(Boolean).reverse() : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-md" onMouseDown={onClose}>
      <aside
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-label="Task details"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-pop scroll-thin flex h-full w-full max-w-md flex-col gap-5 overflow-y-auto rounded-l-[28px] p-6 glass-sheet outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <LevelBadge level={task.level} />
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-ink-2 glass-chip">{LANE_LABELS[lane]}</span>
          </div>
          <button onClick={onClose} aria-label="Close details" className="rounded-full p-1.5 text-ink-3 hover:bg-white/10 hover:text-ink">
            <X className="size-4" />
          </button>
        </div>

        <textarea
          aria-label="Task name"
          value={name}
          rows={2}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== task.name && save({ name: name.trim() })}
          className="-mx-2 resize-none rounded-xl bg-transparent px-2 py-1 text-xl font-semibold leading-snug text-ink hover:bg-white/5 focus:bg-white/5"
        />

        {chain.length > 0 && (
          <nav aria-label="Parents" className="flex flex-wrap items-center gap-1 text-xs text-ink-3">
            {chain.map((c, i) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                {i > 0 && <span>›</span>}
                <span className="text-ink-3">{c.level}</span>
                <span className="text-ink-2">{c.name}</span>
              </span>
            ))}
          </nav>
        )}

        <dl className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-3 text-sm">
          <dt className="text-ink-3">Status</dt>
          <dd>
            <Select value={task.status ?? ""} onChange={(v) => save({ status: v })} options={ALL_STATUSES} label="Status" />
          </dd>
          <dt className="text-ink-3">Priority</dt>
          <dd>
            <Select
              value={task.priority ?? ""}
              onChange={(v) => save({ priority: v || null })}
              options={["", ...PRIORITIES]}
              label="Priority"
            />
          </dd>
          <dt className="text-ink-3">Due</dt>
          <dd>
            <input
              type="date"
              value={task.due ?? ""}
              onChange={(e) => save({ due: e.target.value || null })}
              aria-label="Due date"
              className="h-9 rounded-xl bg-white/5 px-3 text-sm ring-1 ring-white/10"
            />
          </dd>
          <dt className="text-ink-3">Department</dt>
          <dd className="flex flex-wrap gap-1.5">
            {task.departmentIds.length ? (
              task.departmentIds.map((id) => <DeptChip key={id} id={id} name={deptName(id)} />)
            ) : (
              <span className="text-ink-3">None</span>
            )}
          </dd>
          <dt className="text-ink-3">Pop-up (noise)</dt>
          <dd>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={task.noise} onChange={(e) => save({ noise: e.target.checked })} className="size-4 accent-[#e89558]" />
              <span className="text-ink-2">{task.noise ? "Unplanned / pop-up" : "Planned"}</span>
            </label>
          </dd>
          <dt className="text-ink-3">Sprint</dt>
          <dd className="text-ink-2">{task.sprintId ? titleOf(task.sprintId) : "None"}</dd>
          <dt className="text-ink-3">Estimate</dt>
          <dd className="text-ink-2">{task.estMin ? `${task.estMin} min` : "None"}</dd>
          <dt className="text-ink-3">Order</dt>
          <dd className="font-mono text-ink-2">{task.focusOrder ?? "None"}</dd>
        </dl>

        <section className="rounded-2xl p-4 glass-chip">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3">Idle time</h3>
            <span className="font-mono text-sm font-semibold text-ink">{fmtMinutes(task.idleMinutes)}</span>
          </div>
          {task.idleSince && (
            <div className="mt-2">
              <IdleTimer task={task} />
            </div>
          )}
          {idleLines.length > 0 ? (
            <ul className="scroll-thin mt-3 max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-ink-2">
              {idleLines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink-3">No idle periods yet.</p>
          )}
        </section>

        {task.url && (
          <a
            href={task.url}
            target="_blank"
            rel="noreferrer"
            className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-full text-sm font-semibold text-ink-2 glass-chip hover:text-ink"
          >
            Open in Notion <ExternalLink className="size-3.5" />
          </a>
        )}
      </aside>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-xl bg-white/5 px-3 text-sm ring-1 ring-white/10"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o || "None"}
        </option>
      ))}
    </select>
  );
}

export function fmtMinutes(m: number) {
  if (!m) return "0 min";
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m} min`;
}
