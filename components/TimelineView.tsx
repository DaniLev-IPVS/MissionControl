"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { LEVEL_LABELS } from "@/lib/config";
import { addDays } from "@/lib/flow";
import type { Level } from "@/lib/config";
import type { TreeTask } from "@/lib/types";
import { BoardBadge, cx, deptHue, useMC } from "./ui";

// Gantt-style timeline of projects (and their missions) with progress.
// Progress = finished leaf tasks / all leaf tasks under the item (cancelled ones excluded).
// A bar runs from the earliest created item to the latest due date (or finish date).

type Node = {
  task: TreeTask;
  start: string;
  end: string;
  openEnded: boolean; // no due dates anywhere: bar fades out
  overdue: boolean;
  done: number;
  total: number;
  finished: boolean;
  children: Node[];
};

const isFinished = (t: TreeTask) => t.status === "Done" || t.status === "Cancelled";
const DAY_MS = 86400000;

export function TimelineView({
  inDept = () => true,
  hideDone = true,
  level = "all",
  query = "",
}: {
  inDept?: (departmentIds: string[]) => boolean;
  hideDone?: boolean;
  level?: "all" | Level;
  query?: string;
}) {
  const { deptName, today } = useMC();
  const [all, setAll] = useState<TreeTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hideFinished = hideDone;
  const [open, setOpen] = useState<Set<string>>(new Set());

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

  const groups = useMemo(() => {
    if (!all) return [];
    const kids = new Map<string, TreeTask[]>();
    const ids = new Set(all.map((t) => t.id));
    for (const t of all) if (t.parentId && ids.has(t.parentId)) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t]);

    const build = (t: TreeTask): Node => {
      const direct = kids.get(t.id) ?? [];
      // Rows under a project are its missions (and anything else that has children);
      // plain tasks are counted as leaves, not drawn.
      const branch = direct.filter((c) => kids.has(c.id) || c.level === "mission" || c.level === "project");
      const children = branch.map(build);
      let done = 0;
      let total = 0;
      const countLeaf = (x: TreeTask) => {
        if (x.status === "Cancelled") return;
        total++;
        if (x.status === "Done") done++;
      };
      direct.filter((c) => !branch.includes(c)).forEach(countLeaf);
      for (const c of children) {
        done += c.done;
        total += c.total;
      }
      if (!total) countLeaf(t); // nothing under it: it is its own leaf

      const subtree = [t, ...(kids.get(t.id) ?? [])];
      const starts = [t.createdAt.slice(0, 10), ...children.map((c) => c.start), ...subtree.map((x) => x.createdAt.slice(0, 10))];
      const dues = [
        ...subtree.filter((x) => !isFinished(x)).map((x) => x.due),
        ...children.filter((c) => c.overdue || (!c.openEnded && !c.finished)).map((c) => c.end),
      ].filter(Boolean) as string[];
      const ends = [
        ...dues,
        ...subtree.map((x) => x.due).filter(Boolean),
        ...subtree.map((x) => x.doneAt?.slice(0, 10)).filter(Boolean),
        ...children.map((c) => c.end),
      ] as string[];
      const finished = isFinished(t) || (total > 0 && done === total);
      const start = starts.sort()[0];
      let end = ends.sort().pop() ?? addDays(today, 14);
      // Only a real due date can be overdue; finish dates just extend the bar.
      const openEnded = !finished && !dues.length;
      const latestDue = dues.sort().pop();
      const overdue = !finished && ((!!latestDue && latestDue < today) || children.some((c) => c.overdue));
      if (!finished && end < today) end = openEnded ? addDays(today, 7) : today;
      return { task: t, start, end: end < start ? start : end, openEnded, overdue, done, total, finished, children };
    };

    // Top rows: projects, plus missions that don't belong to a project.
    // With the level filter on Missions, every mission gets its own row.
    const roots = all.filter((t) =>
      level === "mission"
        ? t.level === "mission"
        : t.level === "project" || (t.level === "mission" && !(t.parentId && ids.has(t.parentId))),
    );
    const q = query.trim().toLowerCase();
    const hit = (n: Node): boolean => n.task.name.toLowerCase().includes(q) || n.children.some(hit);
    const byDept = new Map<string, Node[]>();
    for (const r of roots) {
      const n = build(r);
      if (hideFinished && n.finished) continue;
      if (!inDept(r.departmentIds)) continue;
      if (q && !hit(n)) continue;
      const key = r.departmentIds[0] ?? "";
      byDept.set(key, [...(byDept.get(key) ?? []), n]);
    }
    return [...byDept.entries()]
      .map(([id, nodes]) => ({
        id,
        name: id ? deptName(id) : "No department",
        nodes: nodes.sort((a, b) => Number(a.finished) - Number(b.finished) || a.start.localeCompare(b.start)),
      }))
      .sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || a.name.localeCompare(b.name));
  }, [all, hideFinished, deptName, today, level, query, inDept]);

  // Time range: snap to weeks, cap at ~4 months back.
  const range = useMemo(() => {
    const nodes = groups.flatMap((g) => g.nodes);
    let start = nodes.map((n) => n.start).sort()[0] ?? addDays(today, -28);
    let end = nodes.map((n) => n.end).sort().pop() ?? addDays(today, 14);
    if (start < addDays(today, -120)) start = addDays(today, -120);
    if (end < addDays(today, 14)) end = addDays(today, 14);
    const s = new Date(`${start}T12:00:00`);
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); // Monday
    const startDay = s.toISOString().slice(0, 10);
    const endDay = addDays(end, 4);
    const days = Math.round((Date.parse(endDay) - Date.parse(startDay)) / DAY_MS);
    return { start: startDay, end: endDay, days };
  }, [groups, today]);

  const pos = (day: string) => {
    const d = Math.round((Date.parse(day < range.start ? range.start : day) - Date.parse(range.start)) / DAY_MS);
    return Math.max(0, Math.min(100, (d / range.days) * 100));
  };
  const weeks = Array.from({ length: Math.ceil(range.days / 7) }, (_, i) => addDays(range.start, i * 7));

  if (error) return <div className="rounded-3xl p-5 text-sm text-danger-hi glass">Couldn&apos;t load projects: {error}</div>;
  if (!all) return <div className="rounded-3xl p-5 text-sm text-ink-3 glass">Loading projects…</div>;

  return (
    <section className="rounded-[26px] p-4 glass sm:p-5" aria-label="Project timeline">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-ink-2">Projects timeline</h2>
          <p className="mt-1 text-xs text-ink-3">Bars run from first created to latest due date. Fill = share of tasks done. Open a project to see its missions.</p>
        </div>
      </div>

      <div className="scroll-thin overflow-x-auto">
        <div className="min-w-[860px]">
          {/* axis */}
          <div className="grid grid-cols-[260px_1fr] text-[10px] text-ink-3">
            <div />
            <div className="relative h-6 border-b border-white/10">
              {weeks.map((w) => (
                <span key={w} className="absolute bottom-1 -translate-x-1/2 whitespace-nowrap" style={{ left: `${pos(w)}%` }}>
                  {new Date(`${w}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            {/* week grid + today line, behind the rows */}
            <div className="pointer-events-none absolute inset-y-0 left-[260px] right-0" aria-hidden>
              {weeks.map((w) => (
                <span key={w} className="absolute inset-y-0 w-px bg-white/[0.05]" style={{ left: `${pos(w)}%` }} />
              ))}
              <span className="absolute inset-y-0 w-[2px] bg-primary-hi/70" style={{ left: `${pos(today)}%` }}>
                <span className="absolute -top-0.5 left-1 rounded bg-primary px-1 text-[9px] font-bold text-white">Today</span>
              </span>
            </div>

            {groups.length === 0 && <p className="py-8 text-center text-sm text-ink-3">No projects to show.</p>}
            {groups.map((g) => (
              <div key={g.id || "none"} className="mt-3">
                <div className="flex items-center gap-2 py-1.5 text-sm font-semibold text-ink">
                  <span className="size-2 rounded-full" style={{ background: g.id ? `hsl(${deptHue(g.id)} 85% 65%)` : "#8a92a6" }} />
                  {g.name}
                </div>
                {g.nodes.map((n) => (
                  <Row key={n.task.id} node={n} depth={0} pos={pos} open={open} setOpen={setOpen} today={today} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({
  node,
  depth,
  pos,
  open,
  setOpen,
  today,
}: {
  node: Node;
  depth: number;
  pos: (d: string) => number;
  open: Set<string>;
  setOpen: (fn: (s: Set<string>) => Set<string>) => void;
  today: string;
}) {
  const pct = node.total ? Math.round((node.done / node.total) * 100) : 0;
  const isOpen = open.has(node.task.id);
  const left = pos(node.start);
  const width = Math.max(1.2, pos(node.end) - left);
  const label = `${node.task.name}: ${pct}% done (${node.done} of ${node.total})${node.overdue ? ", past its due date" : ""}`;
  return (
    <>
      <div className="group grid grid-cols-[260px_1fr] items-center rounded-lg hover:bg-white/[0.04]">
        <div className="flex min-w-0 items-center gap-1 py-1.5 pr-3" style={{ paddingLeft: depth * 18 }}>
          <button
            onClick={() =>
              setOpen((s) => {
                const n = new Set(s);
                if (n.has(node.task.id)) n.delete(node.task.id);
                else n.add(node.task.id);
                return n;
              })
            }
            aria-label={isOpen ? "Hide missions" : "Show missions"}
            aria-expanded={isOpen}
            className={cx("grid size-6 shrink-0 place-items-center rounded text-ink-3 hover:bg-white/10", !node.children.length && "invisible")}
          >
            <ChevronRight className={cx("size-3.5 transition-transform", isOpen && "rotate-90")} />
          </button>
          <div className="min-w-0">
            <a href={node.task.url} target="_blank" rel="noreferrer" className={cx("block truncate hover:underline", depth ? "text-[13px] text-ink-2" : "text-sm font-medium text-ink")}>
              {node.task.name}
            </a>
            <p className="flex items-center gap-1.5 text-[10.5px] text-ink-3">
              <span>{node.task.level ? LEVEL_LABELS[node.task.level] : "Task"} · {node.done}/{node.total} done</span>
              <BoardBadge board={node.task.board} />
            </p>
          </div>
        </div>
        <div className="relative h-9" role="img" aria-label={label}>
          <div
            className={cx(
              "absolute top-1/2 h-5 -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.08] ring-1",
              node.overdue ? "ring-danger/60" : "ring-white/10",
              node.openEnded && "[mask-image:linear-gradient(90deg,#000_70%,transparent)]",
            )}
            style={{ left: `${left}%`, width: `${width}%` }}
            title={label}
          >
            <div className={cx("h-full rounded-full", node.finished ? "bg-success/80" : "bg-primary")} style={{ width: `${pct}%` }} />
          </div>
          <span
            className="absolute top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap font-mono text-[11px] font-semibold text-ink-2"
            style={{ left: `${Math.min(left + width, 92)}%` }}
          >
            {node.finished ? <Check className="inline size-3.5 text-success" aria-hidden /> : null} {pct}%
            {node.overdue && <span className="ml-1 font-sans text-danger-hi">overdue</span>}
            {node.task.due && !node.finished && node.task.due >= today && (
              <span className="ml-1 font-sans font-normal text-ink-3">due {new Date(`${node.task.due}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            )}
          </span>
        </div>
      </div>
      {isOpen && node.children.map((c) => <Row key={c.task.id} node={c} depth={depth + 1} pos={pos} open={open} setOpen={setOpen} today={today} />)}
    </>
  );
}
