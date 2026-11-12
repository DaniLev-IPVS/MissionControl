"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Ban, Bot, Check, ChevronDown, CornerDownRight, GripVertical, Info, Play, Undo2, Users, Waves } from "lucide-react";
import { LEVEL_LABELS } from "@/lib/config";
import {
  backToNoise,
  delegate,
  fmtExpect,
  isBlocked,
  isPopupSignal,
  laneOf,
  makeMain,
  markBlocked,
  moveTo,
  idle,
  resumeIdle,
  sendToSignal,
  unblock,
  workOnNoise,
  type Lane,
} from "@/lib/flow";
import { askNotificationPermission } from "@/lib/hooks";
import type { Task } from "@/lib/types";
import { IdleMenu } from "./IdleMenu";
import { BoardBadge, DeptChip, DueBadge, IdleTimer, LevelBadge, PriorityPill, cx, markDone, useMC } from "./ui";

export const LANE_LABELS: Record<Lane, string> = {
  main: "Main",
  dashboard: "Dashboard",
  today: "Today",
  detour: "Working on noise",
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
      {isPopupSignal(task) ? (
        <span
          title="Came up during the day and wasn't in the plan. You sent it to signal."
          className="rounded-md bg-popup/15 px-1.5 py-0.5 text-[11px] font-semibold text-popup ring-1 ring-popup/35"
        >
          Pop-up
        </span>
      ) : (
        task.noise && <span className="rounded-md bg-noise/15 px-1.5 py-0.5 text-[11px] font-semibold text-noise">Pop-up</span>
      )}
      {task.delegatedAt && (
        <span
          title={`Delegated ${new Date(task.delegatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}${task.expectBy ? `. Answer expected ${fmtExpect(task.expectBy)}` : ""}`}
          className="inline-flex items-center gap-1 rounded-md bg-delegated/15 px-1.5 py-0.5 text-[11px] font-semibold text-delegated"
        >
          <Users className="size-3" aria-hidden /> Delegated
        </span>
      )}
      {task.missedOn && (
        <span
          title={`Planned for ${task.missedOn} but not finished`}
          className="rounded-md bg-warning/12 px-1.5 py-0.5 text-[11px] font-semibold text-warning"
        >
          Missed {new Date(`${task.missedOn}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      )}
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
  const popup = isPopupSignal(task);

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
        "group relative min-w-0 rounded-2xl glass transition-[transform,background] duration-150 focus-within:z-20 hover:z-10 hover:-translate-y-px hover:bg-white/[0.07]",
        dense ? "p-3" : "p-3.5",
        pendingSave && "opacity-60",
        // A pop-up that was sent to signal: part of the plan now, but it wasn't in it this morning.
        // (`glass` sets its own background and border, hence the important modifier.)
        popup && "border-popup/50! bg-popup/[0.08]!",
        lane === "detour" && "border-noise/50! bg-noise/[0.09]!",
        isBlocked(task) && "ring-1 ring-danger/30",
      )}
    >
      {lane === "detour" && <DetourIdle task={task} />}
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 size-4 shrink-0 cursor-grab text-ink-3/50 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className={cx("font-medium leading-snug text-ink", dense ? "text-[13.5px]" : "text-sm", lane === "detour" && "pr-20")}>{task.name}</p>
          <ParentLine task={task} />
          <TaskMeta task={task} />
          {task.idleSince && <IdleTimer task={task} />}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1">
        {lane === "noise" || lane === "detour" ? (
          // Noise gets a decision, not a Start button: work on it as noise, or make it signal.
          <>
            {lane === "noise" ? (
              <CardButton
                onClick={() => apply(workOnNoise(tasks, task, today))}
                label={`Work on "${task.name}" now, as noise. Main stays what you should be working on.`}
                tone="noise"
              >
                <Play className="size-3.5" /> Work on it
              </CardButton>
            ) : (
              <CardButton
                onClick={() => apply(backToNoise(tasks, task, today))}
                label={`Stop working on "${task.name}" and leave it in Noise`}
              >
                <Undo2 className="size-3.5" /> Put down
              </CardButton>
            )}
            <CardButton
              onClick={() => apply(sendToSignal(tasks, task, today))}
              label={`Send "${task.name}" to signal: it joins Today, marked as a pop-up`}
              primary
            >
              <ArrowUpRight className="size-3.5" /> To signal
            </CardButton>
          </>
        ) : isBlocked(task) ? (
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
        {popup && (
          <CardButton onClick={() => apply(backToNoise(tasks, task, today))} label={`Move "${task.name}" out of signal, back to Noise`} tone="noise">
            <Waves className="size-3.5" /> To noise
          </CardButton>
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

/**
 * Top-right of a Working on noise card. Idle hands the task to AI with a reminder to check the
 * session; the card stays in Working on noise. While idle it offers "Back to it".
 */
function DetourIdle({ task }: { task: Task }) {
  const { tasks, today, apply } = useMC();
  // Where to draw the menu. It goes in a portal: lanes are their own stacking layers, so a
  // menu inside the card would slide under the lane below.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const busy = task.id.startsWith("tmp-");
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [at]);
  return (
    <div className="absolute right-2.5 top-2.5 z-10">
      {task.idleSince ? (
        <button
          onClick={() => apply(resumeIdle(tasks, task, today))}
          aria-label={`Back to "${task.name}": stop the idle timer`}
          title="Back to it: stop the idle timer"
          className="inline-flex h-8 items-center gap-1 rounded-full bg-primary/20 px-2.5 text-xs font-semibold text-primary-hi hover:bg-primary/35"
        >
          <Play className="size-3.5" /> Back to it
        </button>
      ) : (
        <button
          disabled={busy}
          onClick={(e) => {
            if (at) return setAt(null);
            const r = e.currentTarget.getBoundingClientRect();
            setAt({ top: r.bottom + 6, right: window.innerWidth - r.right });
          }}
          aria-expanded={!!at}
          aria-label={`Idle "${task.name}": handed to AI, remind me to check the session`}
          title="Idle: handed to AI. Set when to check the session again. It stays in Working on noise."
          className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-primary-hi glass-chip hover:bg-primary/25 disabled:opacity-40"
        >
          <Bot className="size-3.5" /> Idle
        </button>
      )}
      {at &&
        createPortal(
          <IdleMenu
            className="fixed"
            style={{ top: Math.min(at.top, window.innerHeight - 330), right: Math.max(8, at.right) }}
            onClose={() => setAt(null)}
            onPick={(min) => {
              setAt(null);
              if (min) askNotificationPermission();
              apply(idle(tasks, task, today, min));
            }}
            onDelegate={(when) => {
              setAt(null);
              askNotificationPermission();
              apply(delegate(tasks, task, today, when));
            }}
          />,
          document.body,
        )}
    </div>
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
  tone?: "success" | "danger" | "noise";
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
              : tone === "noise"
                ? "bg-noise/15 text-noise hover:bg-noise/30"
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
