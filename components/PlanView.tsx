"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Mic,
  MicOff,
  Search,
  Send,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { signIn } from "@/app/actions";
import { DASHBOARD_SLOTS, LEVEL_LABELS, TODAY_TARGET } from "@/lib/config";
import { commitPlan, currentOrder, draftTask, isBlocked, slotFor } from "@/lib/flow";
import { useDictation } from "@/lib/hooks";
import type { NewTask, Task } from "@/lib/types";
import { DueBadge, PriorityPill, cx, deptHue, useMC } from "./ui";

const MAX_PLAN = 1 + DASHBOARD_SLOTS + TODAY_TARGET.max;
const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
const LEVEL_RANK: Record<string, number> = { project: 0, mission: 1, task: 2 };
const SLOT_LABEL = { main: "Main", dashboard: "Task switch", today: "Today" } as const;
const SLOT_STYLE = {
  main: "bg-primary text-white",
  dashboard: "bg-primary/25 text-primary-hi",
  today: "bg-white/10 text-ink-2",
} as const;

type ChatMsg = { role: "user" | "assistant"; content: string };

type Visible = (t: Pick<Task, "status" | "departmentIds" | "level">) => boolean;

export function PlanView({
  planning,
  onDone,
  visible = () => true,
}: {
  planning: boolean;
  onDone: () => void;
  visible?: Visible;
}) {
  const { tasks, today, board, apply, deptName, openDetails } = useMC();
  const [draft, setDraft] = useState<string[]>(() => currentOrder(tasks, today));
  const [drafts, setDrafts] = useState<NewTask[]>([]); // new tasks proposed by the AI
  const [undo, setUndo] = useState<string[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => {
    const m = new Map<string, Task>(tasks.map((t) => [t.id, t]));
    drafts.forEach((d) => m.set(d.tempId, draftTask(d)));
    return m;
  }, [tasks, drafts]);
  const inPlan = useMemo(() => new Map(draft.map((id, i) => [id, i])), [draft]);

  // ---- Tree: Department > Project > Mission > Task --------------------------------------
  const tree = useMemo(() => {
    const children = new Map<string, Task[]>();
    const ids = new Set(tasks.map((t) => t.id));
    for (const t of tasks) if (t.parentId && ids.has(t.parentId)) children.set(t.parentId, [...(children.get(t.parentId) ?? []), t]);
    const sort = (list: Task[]) =>
      [...list].sort(
        (a, b) =>
          (LEVEL_RANK[a.level ?? "task"] ?? 3) - (LEVEL_RANK[b.level ?? "task"] ?? 3) ||
          (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9) ||
          a.name.localeCompare(b.name),
      );
    const groups = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.parentId && ids.has(t.parentId)) continue;
      const key = t.departmentIds[0] ?? "";
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    const depts = [...groups.entries()]
      .map(([id, roots]) => ({ id, name: id ? deptName(id) : "No department", roots: sort(roots) }))
      .sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || a.name.localeCompare(b.name));
    return { depts, children: (id: string) => sort(children.get(id) ?? []) };
  }, [tasks, deptName]);

  // Shown if it passes the shared filters and the search, or if something under it does.
  const matches = (t: Task): boolean =>
    (visible(t) && (!query || t.name.toLowerCase().includes(query.toLowerCase()))) || tree.children(t.id).some(matches);

  // ---- Draft editing ------------------------------------------------------------------
  const toggle = (id: string) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : d.length >= MAX_PLAN ? d : [...d, id]));
  const move = (id: string, delta: number) =>
    setDraft((d) => {
      const i = d.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const insertAt = (id: string, beforeId: string | null) =>
    setDraft((d) => {
      const rest = d.filter((x) => x !== id);
      if (!d.includes(id) && rest.length >= MAX_PLAN) return d;
      const at = beforeId ? rest.indexOf(beforeId) : -1;
      rest.splice(at < 0 ? rest.length : at, 0, id);
      return rest;
    });

  async function commit() {
    setSaving(true);
    const plan = commitPlan(tasks, draft, drafts.map((d) => ({ ...d })));
    const ok = planning
      ? await apply(plan, (changes, creates) => signIn(changes, creates, draft))
      : await apply(plan);
    setSaving(false);
    if (ok) onDone();
  }

  const nDash = Math.min(DASHBOARD_SLOTS, Math.max(0, draft.length - 1));
  const nToday = Math.max(0, draft.length - 1 - DASHBOARD_SLOTS);

  return (
    <div className="grid gap-5 xl:grid-cols-12">
      {/* ---- Tree ---- */}
      <section className="rounded-[26px] p-4 glass sm:p-5 xl:col-span-7" aria-label="All tasks">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-bold uppercase tracking-[0.12em] text-ink-2">All open work</h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search tasks"
              className="h-9 w-48 rounded-full bg-white/5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/10"
            />
          </div>
          <button
            onClick={() => setCollapsed(new Set())}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-ink-3 glass-chip hover:text-ink"
          >
            <ChevronsUpDown className="size-3.5" /> Expand
          </button>
          <button
            onClick={() => setCollapsed(new Set(tasks.filter((t) => tree.children(t.id).length).map((t) => t.id)))}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-ink-3 glass-chip hover:text-ink"
          >
            <ChevronsDownUp className="size-3.5" /> Collapse
          </button>
        </div>
        <p className="mb-3 text-xs text-ink-3">Tick tasks or drag them into today&apos;s plan. Projects › Missions › Tasks, by department.</p>

        <div className="scroll-thin max-h-[72vh] space-y-5 overflow-y-auto pr-1" role="tree">
          {tree.depts.map((d) => {
            const roots = d.roots.filter(matches);
            if (!roots.length) return null;
            return (
              <div key={d.id || "none"} role="group" aria-label={d.name}>
                <div className="sticky top-0 z-10 mb-1 flex items-center gap-2 rounded-xl bg-[#0d1020]/80 px-2 py-1.5 backdrop-blur">
                  <span className="size-2 rounded-full" style={{ background: d.id ? `hsl(${deptHue(d.id)} 85% 65%)` : "#8a92a6" }} />
                  <span className="text-sm font-semibold text-ink">{d.name}</span>
                  <span className="font-mono text-[11px] text-ink-3">{countAll(roots, tree.children)}</span>
                </div>
                {roots.map((t) => (
                  <TreeRow
                    key={t.id}
                    task={t}
                    depth={0}
                    childrenOf={tree.children}
                    collapsed={collapsed}
                    setCollapsed={setCollapsed}
                    inPlan={inPlan}
                    toggle={toggle}
                    matches={matches}
                    openDetails={openDetails}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Plan + AI ---- */}
      <div className="order-first space-y-5 xl:order-none xl:col-span-5">
        <section
          aria-label="Today's plan"
          className="rounded-[26px] p-4 glass-strong sm:p-5"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/plain");
            const before = (e.target as HTMLElement).closest<HTMLElement>("[data-plan-id]")?.dataset.planId ?? null;
            if (id && byId.has(id)) insertAt(id, before === id ? null : before);
          }}
        >
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-primary-hi">
              {planning ? "Plan your day" : "Today's plan"}
            </h2>
            <span className="font-mono text-xs text-ink-3">
              {draft.length}/{MAX_PLAN}
            </span>
          </div>
          <p className="mb-4 text-xs text-ink-3">
            #1 is Main, the next {DASHBOARD_SLOTS} are the Task switch, the rest is Today ({TODAY_TARGET.min}–{TODAY_TARGET.max}).
          </p>

          {draft.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 px-4 py-10 text-center text-sm text-ink-3">
              Drag tasks here, tick them in the tree, or tell the planner what today is about.
            </div>
          ) : (
            <ol className="space-y-1.5">
              {draft.map((id, i) => {
                const t = byId.get(id);
                if (!t) return null;
                const slot = slotFor(i);
                const firstOfSlot = i === 0 || slotFor(i - 1) !== slot;
                return (
                  <li key={id} data-plan-id={id}>
                    {firstOfSlot && i > 0 && <div className="mb-1.5 mt-3 h-px bg-white/10" aria-hidden />}
                    <div
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", id)}
                      className="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 glass-chip hover:bg-white/10"
                    >
                      <span className={cx("shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-bold", SLOT_STYLE[slot])}>
                        {slot === "main" ? "MAIN" : i}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">
                          {t.name}
                          {id.startsWith("tmp-") && <span className="ml-1.5 text-[11px] font-semibold text-success">new</span>}
                        </p>
                        <p className="truncate text-[11px] text-ink-3">
                          {firstOfSlot ? `${SLOT_LABEL[slot]} · ` : ""}
                          {t.level ? LEVEL_LABELS[t.level] : "Task"}
                          {t.departmentIds[0] ? ` · ${deptName(t.departmentIds[0])}` : ""}
                          {isBlocked(t) ? " · blocked" : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 opacity-60 group-hover:opacity-100">
                        <IconBtn label="Move up" onClick={() => move(id, -1)} disabled={i === 0}>
                          <ArrowUp className="size-3.5" />
                        </IconBtn>
                        <IconBtn label="Move down" onClick={() => move(id, 1)} disabled={i === draft.length - 1}>
                          <ArrowDown className="size-3.5" />
                        </IconBtn>
                        <IconBtn label="Remove from plan" onClick={() => setDraft((d) => d.filter((x) => x !== id))}>
                          <X className="size-3.5" />
                        </IconBtn>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
            <span>Main {draft.length ? 1 : 0}</span>·<span>Task switch {nDash}/{DASHBOARD_SLOTS}</span>·
            <span className={cx(draft.length > 0 && (nToday < TODAY_TARGET.min || nToday > TODAY_TARGET.max) && "text-warning")}>
              Today {nToday}
            </span>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setDraft(currentOrder(tasks, today))}
              className="h-11 rounded-full px-4 text-sm font-semibold text-ink-2 glass-chip hover:text-ink"
            >
              Reset
            </button>
            <button
              onClick={commit}
              disabled={saving || (planning && draft.length === 0)}
              className="h-11 flex-1 rounded-full bg-primary text-sm font-semibold text-white shadow-[0_8px_30px_-8px_rgb(24_86_255/0.9)] hover:bg-primary-hi disabled:opacity-40"
            >
              {saving ? "Saving…" : planning ? "Start my day" : "Save plan"}
            </button>
          </div>
        </section>

        <PlannerChat
          draft={draft}
          onPlan={(order, creates) => {
            setUndo(draft);
            setDrafts((prev) => [...prev.filter((p) => order.includes(p.tempId)), ...creates]);
            setDraft(order.slice(0, MAX_PLAN));
          }}
          undo={
            undo
              ? () => {
                  setDraft(undo);
                  setUndo(null);
                }
              : null
          }
          signedInLabel={board.day?.signedIn ? null : "Signing in starts today's log."}
        />
      </div>
    </div>
  );
}

function countAll(list: Task[], childrenOf: (id: string) => Task[]): number {
  return list.reduce((n, t) => n + 1 + countAll(childrenOf(t.id), childrenOf), 0);
}

function TreeRow({
  task,
  depth,
  childrenOf,
  collapsed,
  setCollapsed,
  inPlan,
  toggle,
  matches,
  openDetails,
}: {
  task: Task;
  depth: number;
  childrenOf: (id: string) => Task[];
  collapsed: Set<string>;
  setCollapsed: (fn: (s: Set<string>) => Set<string>) => void;
  inPlan: Map<string, number>;
  toggle: (id: string) => void;
  matches: (t: Task) => boolean;
  openDetails: (id: string) => void;
}) {
  const { today } = useMC();
  const kids = childrenOf(task.id).filter(matches);
  const isCollapsed = collapsed.has(task.id);
  const idx = inPlan.get(task.id);
  const planned = idx !== undefined;
  const levelColor = { project: "bg-level-project", mission: "bg-level-mission", task: "bg-level-task" }[task.level ?? "task"];
  return (
    <div role="treeitem" aria-expanded={kids.length ? !isCollapsed : undefined} aria-selected={planned}>
      <div
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
        className={cx(
          "group flex min-h-9 items-center gap-1.5 rounded-lg pr-2 transition-colors hover:bg-white/6",
          planned && "bg-primary/12 hover:bg-primary/18",
        )}
        style={{ paddingLeft: depth * 22 + 4 }}
      >
        <button
          onClick={() =>
            setCollapsed((s) => {
              const n = new Set(s);
              if (n.has(task.id)) n.delete(task.id);
              else n.add(task.id);
              return n;
            })
          }
          aria-label={isCollapsed ? "Expand" : "Collapse"}
          className={cx("grid size-6 shrink-0 place-items-center rounded text-ink-3 hover:bg-white/10", !kids.length && "invisible")}
        >
          <ChevronRight className={cx("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
        </button>
        <input
          type="checkbox"
          checked={planned}
          onChange={() => toggle(task.id)}
          aria-label={`Plan "${task.name}" for today`}
          className="size-4 shrink-0 accent-[#1856ff]"
        />
        <span className={cx("ml-1 size-2 shrink-0 rounded-full", levelColor)} title={task.level ? LEVEL_LABELS[task.level] : "Task"} />
        <button
          onClick={() => openDetails(task.id)}
          className={cx(
            "min-w-0 flex-1 truncate text-left",
            task.level === "project" ? "text-[14px] font-semibold text-ink" : task.level === "mission" ? "text-[13.5px] font-medium text-ink" : "text-[13px] text-ink-2",
          )}
        >
          {task.name}
        </button>
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {isBlocked(task) && <span className="text-[11px] font-semibold text-danger-hi">Blocked</span>}
          {task.focus && <span className="text-[11px] text-primary-hi">in focus</span>}
          <PriorityPill p={task.priority} />
          <DueBadge due={task.due} today={today} />
          {planned && (
            <span className={cx("rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold", SLOT_STYLE[slotFor(idx!)])}>
              {idx === 0 ? "MAIN" : `#${idx}`}
            </span>
          )}
        </div>
      </div>
      {!isCollapsed &&
        kids.map((k) => (
          <TreeRow
            key={k.id}
            task={k}
            depth={depth + 1}
            childrenOf={childrenOf}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            inPlan={inPlan}
            toggle={toggle}
            matches={matches}
            openDetails={openDetails}
          />
        ))}
    </div>
  );
}

function IconBtn({ children, label, onClick, disabled }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-white/10 hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

// ---- AI planner chat ---------------------------------------------------------------------
function PlannerChat({
  draft,
  onPlan,
  undo,
  signedInLabel,
}: {
  draft: string[];
  onPlan: (order: string[], creates: NewTask[]) => void;
  undo: (() => void) | null;
  signedInLabel: string | null;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voice = useDictation(setInput);
  const endRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    voice.stop();
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, draft: draft.filter((id) => !id.startsWith("tmp-")) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMessages([...next, { role: "assistant", content: data.reply }]);
      onPlan(data.order, data.creates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The planner didn't answer.");
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ block: "nearest" }), 50);
    }
  }

  return (
    <section aria-label="AI planner" className="rounded-[26px] p-4 glass sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-level-project">
          <Bot className="size-4" /> Planner
        </h2>
        {undo && (
          <button onClick={undo} className="inline-flex items-center gap-1 text-xs font-semibold text-ink-3 hover:text-ink">
            <Undo2 className="size-3.5" /> Undo last change
          </button>
        )}
      </div>
      {messages.length === 0 && (
        <p className="mb-3 text-sm text-ink-2">
          Say or type what today is about, e.g. <span className="text-ink">&ldquo;Close the bank account and finish the pilot proposal, captions after lunch.&rdquo;</span>
          {signedInLabel && <span className="mt-1 block text-xs text-ink-3">{signedInLabel}</span>}
        </p>
      )}
      <div className="scroll-thin max-h-64 space-y-2 overflow-y-auto" aria-live="polite">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cx(
              "max-w-[90%] rounded-2xl px-3.5 py-2 text-sm",
              m.role === "user" ? "ml-auto bg-primary/25 text-ink" : "bg-white/6 text-ink-2",
            )}
          >
            {m.role === "assistant" && <Sparkles className="mr-1 inline size-3.5 text-level-project" />}
            {m.content}
          </div>
        ))}
        {busy && <div className="w-fit rounded-2xl bg-white/6 px-3.5 py-2 text-sm text-ink-3">Planning…</div>}
        <div ref={endRef} />
      </div>
      {error && <p className="mt-2 text-xs text-danger-hi">{error}</p>}
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={voice.listening ? "Listening…" : "What's today about?"}
          aria-label="Message the planner"
          className="min-h-11 flex-1 resize-none rounded-2xl bg-white/5 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/10"
        />
        {voice.supported && (
          <button
            type="button"
            onClick={() => (voice.listening ? voice.stop() : voice.start(input))}
            aria-label={voice.listening ? "Stop dictation" : "Speak to the planner"}
            aria-pressed={voice.listening}
            className={cx("grid size-11 shrink-0 place-items-center rounded-full", voice.listening ? "animate-pulse bg-danger text-white" : "text-ink-2 glass-chip hover:text-ink")}
          >
            {voice.listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
        )}
        <button
          disabled={!input.trim() || busy}
          aria-label="Send"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-white disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </form>
    </section>
  );
}
