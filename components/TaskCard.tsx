"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, Check, ChevronDown, CornerDownRight, GripVertical, Info, Play, Undo2 } from "lucide-react";
import { LEVEL_LABELS } from "@/lib/config";
import { isBlocked, laneOf, makeMain, markBlocked, moveTo, unblock, type Lane } from "@/lib/flow";
import type { Task } from "@/lib/types";
import { BoardBadge, DeptChip, DueBadge, IdleTimer, LevelBadge, PriorityPill, cx, markDone, useMC } from "./ui";

export const LANE_LABELS: Record<Lane, string> = {
  main: "Main",
  dashboard: "Dashboard",
  today: "Today",
  noise: "Noise",
  backlog: "To-do list",
};

export function ParentLine({ task }: { task: Task }) {
  const { taskById, titleOf } = useMC();
  if (!task.parentId) return null;
  const parent = taskById(task.parentId);
  const name = parent?.name ?? titleOf(task.parentId);
  const level = parent?.level ? LEVEL_LABELS[parent.level] : task.level === "mission" ? "Project" : "Mission";
  return (
    <div className="flex min-w-0 items-center gap-1 text-xs text-ink-3">
      <CornerDownRight className="size-3 shrink-0" />
      <span className="shrink-0">{level}</span>
      <span className="truncate text-ink-2">{name}</span>
    </div>
  );
}

export function TaskMeta({ task }: { task: Task }) {
  const { deptName, today } = useMC();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <LevelBadge level={task.level} />
      {task.departmentIds.slice(0, 2).map((id) => (
        <DeptChip key={id} id={id} name={deptName(id)} />
      ))}
      <BoardBadge board={task.board} />
      <PriorityPill p={task.priority} />
      <DueBadge due={task.due} today={today} />
      {isBlocked(task) && (
        <span className="rounded-md bg-danger/18 px-1.5 py-0.5 text-[11px] font-semibold text-danger-hi">Blocked</span>
      )}
      {task.noise && <span className="rounded-md bg-noise/15 px-1.5 py-0.5 text-[11px] font-semibold text-noise">Pop-up</span>}
      {task.estMin ? <span className="text-[11px] text-ink-3">~{task.estMin} min</span> : null}
    </div>
  );
}

export function TaskCard({
  task,
  index,
  onDragStart,
  dense = false,
}: {
  task: Task;
  index: number;
  onDragStart: (id: string) => void;
  dense?: boolean;
}) {
  const { tasks, today, apply, openDetails } = useMC();
  const lane = laneOf(task, today);
  const pendingSave = task.id.startsWith("tmp-");

  return (
    <article
      draggable={!pendingSave}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(task.id);
      }}
      data-task-id={task.id}
      data-index={index}
      className={cx(
        "group relative rounded-2xl glass transition-[transform,background] duration-150 focus-within:z-20 hover:z-10 hover:-translate-y-px hover:bg-white/[0.07]",
        dense ? "p-3" : "p-3.5",
        pendingSave && "opacity-60",
        isBlocked(task) && "ring-1 ring-danger/30",
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 size-4 shrink-0 cursor-grab text-ink-3/50 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className={cx("font-medium leading-snug text-ink", dense ? "text-[13.5px]" : "text-sm")}>{task.name}</p>
          <ParentLine task={task} />
          <TaskMeta task={task} />
          {task.idleSince && <IdleTimer task={task} />}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1">
        {isBlocked(task) ? (
          <CardButton onClick={() => apply(unblock(tasks, task, today))} label="Unblock">
            <Undo2 className="size-3.5" /> Unblock
          </CardButton>
        ) : (
          <>
            <CardButton onClick={() => apply(makeMain(tasks, task, today))} label={`Start "${task.name}" now`} primary>
              <Play className="size-3.5" /> {task.idleSince ? "Resume" : "Start"}
            </CardButton>
            <CardButton onClick={() => apply(markBlocked(tasks, task, today))} label={`Mark "${task.name}" blocked`} tone="danger">
              <Ban className="size-3.5" /> Blocked
            </CardButton>
          </>
        )}
        <CardButton onClick={() => markDone({ tasks, today, apply }, task)} label={`Mark "${task.name}" done`} tone="success">
          <Check className="size-3.5" /> Done
        </CardButton>
        <MoveMenu task={task} current={lane} />
        <CardButton onClick={() => openDetails(task.id)} label="Open details">
          <Info className="size-3.5" />
        </CardButton>
      </div>
    </article>
  );
}

function CardButton({
  children,
  onClick,
  label,
  primary = false,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  primary?: boolean;
  tone?: "success" | "danger";
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors",
        primary
          ? "bg-primary/20 text-primary-hi hover:bg-primary/35"
          : tone === "success"
            ? "text-success hover:bg-success/15"
            : tone === "danger"
              ? "text-danger-hi hover:bg-danger/15"
              : "text-ink-3 hover:bg-white/10 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function MoveMenu({ task, current }: { task: Task; current: Lane }) {
  const { tasks, today, apply } = useMC();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const lanes: Lane[] = ["dashboard", "today", "noise", "backlog"];
  return (
    <div ref={ref} className="relative">
      <CardButton onClick={() => setOpen((o) => !o)} label="Move to…">
        Move <ChevronDown className="size-3.5" />
      </CardButton>
      {open && (
        <div role="menu" className="animate-pop absolute right-0 top-9 z-30 w-44 rounded-2xl p-1.5 glass-menu">
          {lanes
            .filter((l) => l !== current)
            .map((l) => (
              <button
                key={l}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  apply(moveTo(tasks, task, l, 999, today));
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-ink-2 hover:bg-white/10 hover:text-ink"
              >
                {LANE_LABELS[l]}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
