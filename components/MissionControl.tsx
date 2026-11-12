"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCheck,
  Layers,
  LogOut,
  ListTodo,
  Flame,
  Mic,
  Plus,
  Radio,
  Search,
  SlidersHorizontal,
  Sunrise,
  Sunset,
  Waves,
  Zap,
} from "lucide-react";
import { LEVELS, LEVEL_LABELS, TODAY_TARGET, isDoneStatus, type Level } from "@/lib/config";
import { isIdle, localDay, lowestLevel, makeMain, moveTo, sections, type Lane } from "@/lib/flow";
import { useNow, useReminders } from "@/lib/hooks";
import type { Task } from "@/lib/types";
import { useBoard } from "@/lib/useBoard";
import { logout } from "@/app/actions";
import { CompanyView } from "./CompanyView";
import { DaysView } from "./DaysView";
import { DetailsDrawer } from "./DetailsDrawer";
import { IdleBoard } from "./IdleBoard";
import { NotificationRail, ReminderToasts } from "./Notifications";
import { PlanView } from "./PlanView";
import { PopupBar } from "./PopupBar";
import { SignOutDialog } from "./SignOutDialog";
import { TimelineView } from "./TimelineView";
import { TokensView } from "./TokensView";
import { MainCard } from "./MainCard";
import { QuickAdd } from "./QuickAdd";
import { TaskCard } from "./TaskCard";
import { DeptChip, MCContext, Segmented, cx, deptHue, useMC, type MC } from "./ui";

type TypeFilter = "all" | "signal" | "noise";
type SortKey = "flow" | "priority" | "due" | "level";
type View = "focus" | "plan" | "timeline" | "days" | "tokens" | "company";

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
const LEVEL_RANK: Record<string, number> = { project: 0, mission: 1, task: 2 };

export default function MissionControl() {
  const { board, tasks, error, saveError, clearSaveError, lastSync, saving, apply } = useBoard();
  const nowMs = useNow();
  const today = nowMs ? localDay(new Date(nowMs)) : "";

  // UI state
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | "type" | "voice">(null);
  const [depts, setDepts] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<"all" | Level>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [lowest, setLowest] = useState(false);
  const [hideDone, setHideDone] = useState(true); // on by default; can be switched off
  const [sort, setSort] = useState<SortKey>("flow");
  const [query, setQuery] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<View>("focus");
  const [planning, setPlanning] = useState(false); // signing in: Plan view in "start my day" mode
  const [signingOut, setSigningOut] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  // Keyboard: N = add, V = add by voice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "n") {
        e.preventDefault();
        setAdding("type");
      } else if (e.key === "v") {
        e.preventDefault();
        setAdding("voice");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const reminders = useReminders(tasks);

  const ctx: MC | null = useMemo(() => {
    if (!board) return null;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const deptNames = new Map(board.departments.map((d) => [d.id, d.name]));
    return {
      board,
      tasks,
      today,
      apply,
      openDetails: setDetailsId,
      deptName: (id) => deptNames.get(id) ?? "Department",
      taskById: (id) => byId.get(id),
      titleOf: (id) => byId.get(id)?.name ?? board.titles[id] ?? "…",
    };
  }, [board, tasks, today, apply]);

  const s = useMemo(() => sections(tasks, today), [tasks, today]);
  const lowestIds = useMemo(() => new Set(lowestLevel(tasks).map((t) => t.id)), [tasks]);

  const usedDepts = useMemo(() => {
    if (!board) return [];
    const count = new Map<string, number>();
    tasks.forEach((t) => t.departmentIds.forEach((d) => count.set(d, (count.get(d) ?? 0) + 1)));
    return board.departments
      .filter((d) => count.has(d.id))
      .map((d) => ({ ...d, count: count.get(d.id)! }))
      .sort((a, b) => b.count - a.count);
  }, [board, tasks]);

  const visible = useCallback(
    (t: Task) => {
      if (hideDone && isDoneStatus(t.status)) return false;
      if (depts.size && !t.departmentIds.some((d) => depts.has(d))) return false;
      if (level !== "all" && t.level !== level) return false;
      if (lowest && !lowestIds.has(t.id)) return false;
      if (query && !t.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    },
    [hideDone, depts, level, lowest, lowestIds, query],
  );
  const inDept = useCallback((ids: string[]) => !depts.size || ids.some((d) => depts.has(d)), [depts]);
  // Plan and Timeline share department, level and done filters (not lane-only ones).
  const treeVisible = useCallback(
    (t: { status: string | null; departmentIds: string[]; level: Level | null }) =>
      !(hideDone && isDoneStatus(t.status)) &&
      !(depts.size && !t.departmentIds.some((d) => depts.has(d))) &&
      !(level !== "all" && t.level !== level),
    [hideDone, depts, level],
  );

  const sorted = useCallback(
    (list: Task[], fallback: (a: Task, b: Task) => number = () => 0) => {
      const out = list.filter(visible);
      const cmp: Record<SortKey, (a: Task, b: Task) => number> = {
        flow: fallback,
        priority: (a, b) => (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9),
        due: (a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"),
        level: (a, b) => (LEVEL_RANK[a.level ?? ""] ?? 9) - (LEVEL_RANK[b.level ?? ""] ?? 9),
      };
      return sort === "flow" && fallback.length === 0 ? out : out.sort(cmp[sort]);
    },
    [visible, sort],
  );

  const backlogFallback = (a: Task, b: Task) =>
    (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9) ||
    (a.due ?? "9999").localeCompare(b.due ?? "9999");
  // What just came up sits on top (newest first); close due dates follow, soonest first.
  const noiseFallback = (a: Task, b: Task) =>
    Number(b.noise) - Number(a.noise) ||
    (a.noise && b.noise ? b.createdAt.localeCompare(a.createdAt) : 0) ||
    (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
    backlogFallback(a, b);

  // Drag and drop between lanes.
  const drop = useCallback(
    (lane: Lane, beforeId: string | null, draggedId: string | null) => {
      const id = draggedId || dragId;
      if (!id) return;
      const task = tasks.find((t) => t.id === id);
      setDragId(null);
      if (!task) return;
      const list = lane === "dashboard" ? s.dashboard : lane === "today" ? s.today : [];
      const idx = beforeId ? list.findIndex((t) => t.id === beforeId) : list.length;
      apply(moveTo(tasks, task, lane, idx < 0 ? list.length : idx, today));
    },
    [dragId, tasks, s, apply, today],
  );

  if (!ctx || !today) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="rounded-3xl px-6 py-5 text-sm text-ink-2 glass">
          {error ? `Couldn't load from Notion: ${error}` : "Loading Mission Control…"}
        </div>
      </main>
    );
  }

  const isFocus = view === "focus";
  const activeFilters =
    Number(type !== "all") + Number(level !== "all") + Number(lowest) + Number(sort !== "flow") + Number(!!query) + depts.size +
    Number(!hideDone);
  const signalCount = (s.main ? 1 : 0) + s.dashboard.length + s.today.length;
  const noiseCount = s.noise.length + s.detour.length;
  const showSignal = type !== "noise";
  const showNoise = type !== "signal";
  const showBacklog = type === "all";
  const age = lastSync && nowMs ? Math.round((nowMs - lastSync) / 1000) : null;
  const detailsTask = detailsId ? tasks.find((t) => t.id === detailsId) : undefined;

  // Idle work (handed to AI) lives on the Idle board, not in its lane.
  const active = (t: Task) => !isIdle(t);
  const byIdleStart = (a: Task, b: Task) => (a.idleSince ?? "").localeCompare(b.idleSince ?? "");
  const idleSignal = s.dashboard.concat(s.today).filter(isIdle).filter(visible).sort(byIdleStart);
  const idleNoise = s.detour.filter(isIdle).filter(visible).sort(byIdleStart);
  const dashboard = sorted(s.dashboard.filter(active));
  const todayList = sorted(s.today.filter(active));
  const noise = sorted(s.noise, noiseFallback);
  const detour = sorted(s.detour.filter(active));
  const backlog = sorted(s.backlog, backlogFallback);

  return (
    <MCContext.Provider value={ctx}>
      {/* Left rail (notification bell) and its panel are part of the layout: the board makes room. */}
      <div className="flex min-h-dvh">
      <NotificationRail {...reminders} open={notesOpen} setOpen={setNotesOpen} />
      <main className={cx("mx-auto w-full min-w-0 max-w-[1440px] flex-1 space-y-5 px-4 pb-24 pt-5 sm:px-6 lg:pt-8", notesOpen && "max-md:hidden")}>
        {/* ---- Header ---- */}
        <header className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
              <span className="grid size-8 place-items-center rounded-xl bg-primary shadow-[0_6px_24px_-4px_rgb(24_86_255/0.8)]">
                <Zap className="size-4 text-white" />
              </span>
              Mission Control
            </h1>
            <p className="mt-1 text-sm text-ink-3">
              {new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              {board!.doneToday.length > 0 && (
                <span className="ml-2 text-success">· {board!.doneToday.length} done today</span>
              )}
            </p>
          </div>

          <SignalMeter signal={signalCount} noise={noiseCount} />

          <div
            className="flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-ink-3 glass-chip"
            aria-live="polite"
            title={error ?? undefined}
          >
            <span
              className={cx(
                "size-2 rounded-full",
                error ? "bg-danger" : saving ? "animate-pulse bg-warning" : age !== null && age < 10 ? "bg-success" : "bg-warning",
              )}
            />
            {error ? "Sync error" : saving ? "Saving…" : age !== null && age < 10 ? "Live" : "Reconnecting"}
          </div>

          <DayButton
            state={!board!.day?.signedIn ? "out" : board!.day.signedOut ? "done" : "in"}
            onSignIn={() => {
              setPlanning(true);
              setView("plan");
            }}
            onSignOut={() => setSigningOut(true)}
          />

          <div className="flex gap-2">
            <button
              onClick={() => setAdding("voice")}
              aria-label="Add a task by voice (V)"
              title="Add by voice (V)"
              className="grid size-11 place-items-center rounded-full text-ink-2 glass-chip hover:text-ink"
            >
              <Mic className="size-5" />
            </button>
            <button
              onClick={() => setAdding("type")}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white shadow-[0_8px_30px_-8px_rgb(24_86_255/0.9)] hover:bg-primary-hi"
              title="Add task (N)"
            >
              <Plus className="size-4" /> Add task
            </button>
            <form action={logout}>
              <button
                aria-label="Log out of Mission Control"
                title="Log out"
                className="grid size-11 place-items-center rounded-full text-ink-3 glass-chip hover:text-ink"
              >
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </header>

        {/* ---- Pop-ups: one line, filed for you, lands in Noise ---- */}
        <PopupBar />

        {board?.warnings?.length ? (
          <div role="status" className="rounded-2xl px-4 py-3 text-sm text-ink-2 glass ring-1 ring-warning/40">
            {board.warnings.map((w) => (
              <p key={w}>
                <span className="font-semibold text-warning">Partly loaded:</span> {w}
              </p>
            ))}
          </div>
        ) : null}

        {/* ---- Views ---- */}
        <nav aria-label="Views" className="flex flex-wrap items-center gap-2 [&>[role=radiogroup]]:max-w-full [&>[role=radiogroup]]:overflow-x-auto [&>[role=radiogroup]]:[scrollbar-width:none] [&>[role=radiogroup]>*]:shrink-0">
          <Segmented
            label="View"
            value={view}
            onChange={(v) => {
              setView(v);
              if (v !== "plan") setPlanning(false);
            }}
            options={[
              { value: "focus", label: "Focus" },
              { value: "plan", label: "Plan" },
              { value: "timeline", label: "Timeline" },
              { value: "days", label: "Days" },
              { value: "tokens", label: "Tokens" },
              { value: "company", label: "Company" },
            ]}
          />
          {planning && view === "plan" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-3 py-1.5 text-xs font-semibold text-primary-hi">
              <Sunrise className="size-3.5" /> Starting your day: pick from the recommendations, then Start my day
            </span>
          )}
        </nav>

        {view !== "days" && view !== "tokens" && view !== "company" && (
        <>
        {/* ---- Filters (folded behind a button on phones) ---- */}
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold text-ink-2 glass-chip md:hidden"
        >
          <SlidersHorizontal className="size-4" /> Filters
          {activeFilters > 0 && (
            <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] text-white">{activeFilters}</span>
          )}
        </button>
        <div className={cx("flex-wrap items-center gap-2.5 rounded-3xl p-2.5 glass", filtersOpen ? "flex" : "hidden md:flex")}>
          {isFocus && (
          <Segmented
            label="Signal or noise"
            value={type}
            onChange={setType}
            options={[
              { value: "all", label: "All" },
              { value: "signal", label: "Signal", dot: "#5b87ff" },
              { value: "noise", label: "Noise", dot: "#e89558" },
            ]}
          />
          )}
          <Segmented
            label="Task level"
            value={level}
            onChange={setLevel}
            options={[{ value: "all" as const, label: "All levels" }, ...LEVELS.map((l) => ({ value: l, label: `${LEVEL_LABELS[l]}s` }))]}
          />
          {(
            <button
              onClick={() => setHideDone((v) => !v)}
              aria-pressed={hideDone}
              className={cx(
                "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors",
                hideDone ? "bg-primary/25 text-primary-hi ring-1 ring-primary/50" : "text-ink-3 glass-chip hover:text-ink",
              )}
              title={hideDone ? "Done tasks are hidden. Click to show them." : "Showing done tasks. Click to hide them."}
            >
              <CheckCheck className="size-3.5" /> Hide done
            </button>
          )}
          {isFocus && (
          <>
          <button
            onClick={() => setLowest((v) => !v)}
            aria-pressed={lowest}
            className={cx(
              "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors",
              lowest ? "bg-primary/25 text-primary-hi ring-1 ring-primary/50" : "text-ink-3 glass-chip hover:text-ink",
            )}
            title="Only show tasks with no open sub-items"
          >
            <Layers className="size-3.5" /> Lowest level
          </button>
          <label className="inline-flex h-9 items-center gap-2 rounded-full pl-3.5 pr-1 text-xs font-semibold text-ink-3 glass-chip">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-7 rounded-full bg-transparent pr-2 text-ink"
            >
              <option value="flow">Flow order</option>
              <option value="priority">Priority</option>
              <option value="due">Due date</option>
              <option value="level">Level</option>
            </select>
          </label>
          </>
          )}
          {view !== "plan" && (
          <div className="relative ml-auto min-w-[180px] flex-1 sm:max-w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search tasks"
              className="h-9 w-full rounded-full bg-white/5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/10"
            />
          </div>
          )}
          {usedDepts.length > 0 && (
            <div className="flex w-full flex-wrap gap-1.5 border-t border-white/8 pt-2.5" role="group" aria-label="Departments">
              <DeptToggle active={!depts.size} onClick={() => setDepts(new Set())} label="All departments" />
              {usedDepts.map((d) => (
                <DeptToggle
                  key={d.id}
                  active={depts.has(d.id)}
                  hue={deptHue(d.id)}
                  label={d.name}
                  count={d.count}
                  onClick={() =>
                    setDepts((prev) => {
                      const next = new Set(prev);
                      if (next.has(d.id)) next.delete(d.id);
                      else next.add(d.id);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>

        </>
        )}

        {view === "plan" && (
          <PlanView
            key={planning ? "signin" : "plan"}
            planning={planning}
            visible={treeVisible}
            showDone={!hideDone}
            onDone={() => {
              setPlanning(false);
              setView("focus");
            }}
          />
        )}
        {view === "timeline" && <TimelineView inDept={inDept} hideDone={hideDone} level={level} query={query} />}
        {view === "days" && <DaysView />}
        {view === "tokens" && <TokensView />}
        {view === "company" && <CompanyView />}

        {view === "focus" && (
        <>
        {/* ---- Board ---- */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-12">
          <div className="min-w-0 space-y-5 xl:col-span-8">
            <MainCard task={s.main} onDropTask={(id) => {
              const t = tasks.find((x) => x.id === id);
              setDragId(null);
              if (t) apply(makeMain(tasks, t, today));
            }} />

            <IdleBoard signal={idleSignal} noise={idleNoise} showSignal={showSignal} showNoise={showNoise} />

            {showSignal && (
              <LaneSection
                lane="dashboard"
                itemCount={dashboard.length}
                icon={<Radio className="size-4" />}
                title="Next in line"
                subtitle="The task switch · work on these while Main is handed off"
                count={`${dashboard.length}`}
                tone="signal"
                onDrop={drop}
                dragging={!!dragId}
                empty="Drag tasks here, or plan more into Today."
              >
                <div className="grid gap-3 md:grid-cols-3">
                  {dashboard.map((t, i) => (
                    <TaskCard key={t.id} task={t} index={i} onDragStart={setDragId} />
                  ))}
                </div>
              </LaneSection>
            )}

            {showSignal && (
              <LaneSection
                lane="today"
                itemCount={todayList.length}
                icon={<ListTodo className="size-4" />}
                title="Today"
                subtitle="Planned for today · feeds the task switch"
                count={`${s.today.length}`}
                warn={
                  s.today.length > TODAY_TARGET.max
                    ? `Over ${TODAY_TARGET.max}: move some back`
                    : s.today.length < TODAY_TARGET.min
                      ? `Plan at least ${TODAY_TARGET.min}`
                      : undefined
                }
                tone="signal"
                onDrop={drop}
                dragging={!!dragId}
                empty="Nothing planned. Drag tasks from the to-do list."
              >
                <div className="grid gap-2.5 md:grid-cols-2">
                  {todayList.map((t, i) => (
                    <TaskCard key={t.id} task={t} index={i} onDragStart={setDragId} dense />
                  ))}
                </div>
              </LaneSection>
            )}

            {showBacklog && (
              <LaneSection
                lane="backlog"
                itemCount={backlog.length}
                icon={<ListTodo className="size-4" />}
                title="To-do list"
                subtitle="Everything else, waiting to be planned"
                count={`${s.backlog.length}`}
                tone="neutral"
                onDrop={drop}
                dragging={!!dragId}
                empty="All clear."
              >
                <Backlog tasks={backlog} grouped={sort === "flow" && !depts.size} onDragStart={setDragId} />
              </LaneSection>
            )}
          </div>

          <div className="min-w-0 space-y-5 xl:col-span-4">
            {showNoise && detour.length > 0 && (
              <LaneSection
                lane="detour"
                itemCount={detour.length}
                icon={<Flame className="size-4" />}
                title="Working on noise"
                subtitle="Not signal. You chose this over what you should be working on."
                count={`${detour.length}`}
                tone="noise"
                strong
                onDrop={drop}
                dragging={!!dragId}
                empty="Nothing here."
              >
                <div className="space-y-2.5">
                  {detour.map((t, i) => (
                    <TaskCard key={t.id} task={t} index={i} onDragStart={setDragId} dense />
                  ))}
                </div>
              </LaneSection>
            )}

            {showNoise && (
              <LaneSection
                lane="noise"
                itemCount={noise.length}
                icon={<Waves className="size-4" />}
                title="Noise that came up"
                subtitle="Unplanned: pop-ups and close due dates. Work on it as noise, or send it to signal."
                count={`${s.noise.length}`}
                tone="noise"
                onDrop={drop}
                dragging={!!dragId}
                empty="No noise. Nice."
              >
                <div className="space-y-2.5">
                  {noise.map((t, i) => (
                    <TaskCard key={t.id} task={t} index={i} onDragStart={setDragId} dense />
                  ))}
                </div>
              </LaneSection>
            )}

            {!hideDone && (
              <section aria-label="Done today" className="rounded-[26px] p-4 glass sm:p-5">
                <header className="mb-3 flex items-center gap-2">
                  <CheckCheck className="size-4 text-success" />
                  <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-ink-2">Done today</h2>
                  <span className="ml-auto font-mono text-xs text-ink-3">{board!.doneToday.length}</span>
                </header>
                {board!.doneToday.length === 0 ? (
                  <p className="text-sm text-ink-3">Nothing finished yet today.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {board!.doneToday
                      .filter((d) => !query || d.name.toLowerCase().includes(query.toLowerCase()))
                      .map((d) => {
                        const signal = d.doneAs ? d.doneAs === "Signal" : !!d.focus && !d.noise;
                        return (
                          <li key={d.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm glass-chip">
                            <span className={cx("size-2 shrink-0 rounded-full", signal ? "bg-chart-signal" : "bg-chart-noise")} />
                            <span className="min-w-0 flex-1 truncate text-ink-2 line-through decoration-ink-3/60">{d.name}</span>
                            <span className="text-[11px] font-semibold text-ink-3">{signal ? "Signal" : "Noise"}</span>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </section>
            )}


          </div>
        </div>
        </>
        )}
      </main>
      </div>

      {/* ---- Overlays ---- */}
      <div className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md flex-col gap-2" aria-live="assertive">
        <ReminderToasts {...reminders} />
        {saveError && (
          <div role="alert" className="animate-pop flex items-center gap-3 rounded-2xl p-3.5 glass-float ring-1 ring-danger/40">
            <p className="flex-1 text-sm text-ink">{saveError}</p>
            <button onClick={clearSaveError} className="text-xs font-semibold text-ink-2 hover:text-ink">
              Dismiss
            </button>
          </div>
        )}
      </div>

      {detailsTask && <DetailsDrawer task={detailsTask} onClose={() => setDetailsId(null)} />}
      {signingOut && board!.day && <SignOutDialog onClose={() => setSigningOut(false)} />}
      {adding && <QuickAdd onClose={() => setAdding(null)} startListening={adding === "voice"} />}
    </MCContext.Provider>
  );
}

// ---- Pieces ------------------------------------------------------------------------------
function SignalMeter({ signal, noise }: { signal: number; noise: number }) {
  const total = signal + noise || 1;
  const pct = Math.round((signal / total) * 100);
  return (
    <div className="flex items-center gap-3 rounded-full px-4 py-2 glass-chip" title="Planned work vs unplanned noise">
      <div className="text-right leading-tight">
        <div className="text-xs font-semibold text-signal">Signal {signal}</div>
        <div className="text-xs font-semibold text-noise">Noise {noise}</div>
      </div>
      <div className="h-8 w-1.5 overflow-hidden rounded-full bg-noise/60" aria-hidden>
        <div className="w-full rounded-full bg-signal" style={{ height: `${pct}%` }} />
      </div>
      <span className="font-mono text-lg font-bold tabular-nums text-ink">{pct}%</span>
    </div>
  );
}

function DeptToggle({
  active,
  onClick,
  label,
  hue,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hue?: number;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors",
        active ? "bg-white/15 text-ink ring-1 ring-white/25" : "text-ink-3 hover:bg-white/8 hover:text-ink",
      )}
    >
      {hue !== undefined && <span className="size-2 rounded-full" style={{ background: `hsl(${hue} 85% 65%)` }} />}
      <span className="max-w-[12rem] truncate">{label}</span>
      {count !== undefined && <span className="font-mono text-[10px] text-ink-3">{count}</span>}
    </button>
  );
}

function LaneSection({
  lane,
  icon,
  title,
  subtitle,
  count,
  warn,
  tone,
  children,
  onDrop,
  dragging,
  empty,
  itemCount,
  strong = false,
}: {
  itemCount: number;
  strong?: boolean; // louder tint and outline (Working on noise)
  lane: Lane;
  icon: ReactNode;
  title: string;
  subtitle: string;
  count: string;
  warn?: string;
  tone: "signal" | "noise" | "neutral";
  children: ReactNode;
  onDrop: (lane: Lane, beforeId: string | null, draggedId: string | null) => void;
  dragging: boolean;
  empty: string;
}) {
  const [over, setOver] = useState(false);
  const hasItems = itemCount > 0;
  const toneCls = {
    signal: "text-signal",
    noise: "text-noise",
    neutral: "text-ink-3",
  }[tone];
  return (
    <section
      aria-label={title}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const card = (e.target as HTMLElement).closest<HTMLElement>("[data-task-id]");
        const dragged = e.dataTransfer.getData("text/plain") || null;
        const before = card?.dataset.taskId ?? null;
        onDrop(lane, before === dragged ? null : before, dragged);
      }}
      className={cx(
        "relative rounded-[26px] p-4 sm:p-5 glass transition-shadow focus-within:z-20",
        tone === "noise" && (strong ? "border-noise/45! bg-noise/[0.07]!" : "bg-noise/[0.035]"),
        over && dragging && "ring-2 ring-primary-hi/70",
      )}
    >
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div>
          <h2 className={cx("flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em]", toneCls)}>
            {icon}
            {title}
            <span className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[11px] tracking-normal text-ink-2">{count}</span>
          </h2>
          <p className="mt-1 text-xs text-ink-3">{subtitle}</p>
        </div>
        {warn && <span className="rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning">{warn}</span>}
      </div>
      {hasItems ? children : null}
      {!hasItems && (
        <div className={cx("rounded-2xl border border-dashed px-4 py-6 text-center text-sm", over ? "border-primary-hi text-ink-2" : "border-white/12 text-ink-3")}>
          {empty}
        </div>
      )}
    </section>
  );
}

function Backlog({ tasks, grouped, onDragStart }: { tasks: Task[]; grouped: boolean; onDragStart: (id: string) => void }) {
  const { deptName } = useMC();
  if (!grouped) {
    return (
      <div className="scroll-thin grid max-h-[70vh] gap-2.5 overflow-y-auto pr-1 md:grid-cols-2">
        {tasks.map((t, i) => (
          <TaskCard key={t.id} task={t} index={i} onDragStart={onDragStart} dense />
        ))}
      </div>
    );
  }
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.departmentIds[0] ?? "";
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return (
    <div className="scroll-thin max-h-[70vh] space-y-4 overflow-y-auto pr-1">
      {[...groups].map(([dept, list]) => (
        <div key={dept || "none"} className="space-y-2">
          <div className="flex items-center gap-2">
            {dept ? <DeptChip id={dept} name={deptName(dept)} /> : <span className="text-xs text-ink-3">No department</span>}
            <span className="font-mono text-[11px] text-ink-3">{list.length}</span>
          </div>
          <div className="grid gap-2.5 md:grid-cols-2">
            {list.map((t, i) => (
              <TaskCard key={t.id} task={t} index={i} onDragStart={onDragStart} dense />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


function DayButton({
  state,
  onSignIn,
  onSignOut,
}: {
  state: "out" | "in" | "done";
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  if (state === "in")
    return (
      <button
        onClick={onSignOut}
        className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-ink glass-chip hover:bg-white/12"
        title="Sign out: log the day and clear today's lanes"
      >
        <Sunset className="size-4 text-noise" /> End your day
      </button>
    );
  return (
    <button
      onClick={onSignIn}
      className={cx(
        "inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold",
        state === "out"
          ? "bg-success/90 text-[#04210f] shadow-[0_8px_30px_-8px_rgb(7_202_107/0.8)] hover:bg-success"
          : "text-ink-2 glass-chip hover:text-ink",
      )}
      title={state === "out" ? "Sign in: get recommendations and pick today's tasks" : "You ended today already. Start again?"}
    >
      <Sunrise className="size-4" /> {state === "out" ? "Start your day" : "Restart your day"}
    </button>
  );
}
