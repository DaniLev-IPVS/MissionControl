"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Building2, CircleHelp, History, Lock, Plus, Target, TriangleAlert, Users, X } from "lucide-react";
import {
  addRoadmap, logPivot, moveRoadmap, reorderProjects, saveNote, saveProject, saveRoadmap, type CompanyResult,
} from "@/app/company-actions";
import {
  PROJECT_STATUSES, PROJECT_STATUS_LABEL, ROADMAP_STATUSES, ROADMAP_STATUS_LABEL,
  type Company, type Entity, type Project, type RoadmapItem, type RoadmapKind,
} from "@/lib/company-types";
import { cx } from "./ui";

// The company master: where we're going, each project's goal, and the rough roadmap to it.
// Everything here can be edited; a change of goal, measure, date, status or priority is logged as a pivot.

type Act = (fn: () => Promise<CompanyResult>) => Promise<boolean>;

export function CompanyView() {
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/company", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => (d.error ? setError(d.error) : (setError(null), setCompany(d.company))))
        .catch((e) => setError(String(e))),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const act: Act = useCallback(
    async (fn) => {
      setSaveError(null);
      const res = await fn().catch((e): CompanyResult => ({ ok: false, error: String(e) }));
      if (!res.ok) setSaveError(res.error);
      await load();
      return res.ok;
    },
    [load],
  );

  if (error && !company) return <div className="rounded-3xl p-5 text-sm text-danger-hi glass">Couldn&apos;t load the company: {error}</div>;
  if (!company) return <div className="rounded-3xl p-5 text-sm text-ink-3 glass">Loading the company…</div>;
  if (!company.configured)
    return (
      <div className="rounded-3xl p-5 text-sm text-ink-2 glass">
        The company database isn&apos;t connected here. Add <code className="font-mono text-ink">DATABASE_URL</code> to{" "}
        <code className="font-mono text-ink">.env.local</code> to see goals and roadmaps.
      </div>
    );

  const projects = company.projects;
  const move = (slug: string, dir: -1 | 1) => {
    const order = projects.map((p) => p.slug);
    const i = order.indexOf(slug);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const why = window.prompt("Why is the priority order changing? (saved in the pivot log, optional)");
    if (why === null) return;
    act(() => reorderProjects(order, why));
  };

  return (
    <div className="space-y-5">
      {saveError && (
        <div role="alert" className="rounded-2xl bg-danger/15 px-4 py-3 text-sm text-danger-hi ring-1 ring-danger/40">
          That didn&apos;t save: {saveError}
        </div>
      )}

      <section aria-label="Where we're going" className="rounded-[26px] p-5 glass">
        <div className="grid gap-5 lg:grid-cols-2">
          <Field icon={<Target className="size-4 text-primary-hi" />} label="Where the company is going">
            <Editable
              multiline
              value={company.notes.company_goal ?? ""}
              placeholder="Write the company's goal"
              onSave={(v) => act(() => saveNote("company_goal", v))}
              className="text-[15px] leading-relaxed text-ink"
            />
          </Field>
          <Field icon={<History className="size-4 text-noise" />} label="How we work">
            <Editable
              multiline
              value={company.notes.how_we_work ?? ""}
              placeholder="Write how we work"
              onSave={(v) => act(() => saveNote("how_we_work", v))}
              className="text-sm leading-relaxed text-ink-2"
            />
          </Field>
        </div>
        <details className="mt-5 border-t border-white/8 pt-4">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-ink-2">
            <Building2 className="size-4" /> Company structure ({company.entities.length})
          </summary>
          <Structure entities={company.entities} />
        </details>
      </section>

      <p className="px-1 text-xs text-ink-3">
        Projects in priority order. When two projects compete for your time, the higher one wins, and the planner treats the rest as noise unless
        it&apos;s due or blocking someone.
      </p>

      {projects.map((p, i) => (
        <ProjectCard key={p.slug} project={p} act={act} onMove={(dir) => move(p.slug, dir)} first={i === 0} last={i === projects.length - 1} />
      ))}

      <PivotLog company={company} act={act} />
    </div>
  );
}

// ---- Structure ----------------------------------------------------------------------------
function Structure({ entities }: { entities: Entity[] }) {
  const children = (parent: string | null) => entities.filter((e) => e.parentSlug === parent);
  const row = (e: Entity, depth: number): ReactNode => (
    <Fragment key={e.slug}>
      <li className="py-2" style={{ paddingLeft: depth * 20 }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">{e.name}</span>
          <span className="rounded-md bg-white/6 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-3 ring-1 ring-white/10">
            {e.kind}
          </span>
          {e.jurisdiction && <span className="text-[11px] text-ink-3">{e.jurisdiction}</span>}
          {e.relationship && <span className="text-[11px] text-ink-3">· {e.relationship}</span>}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{e.summary}</p>
        {e.privateNotes && (
          <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-ink-3">
            <Lock className="mt-0.5 size-3 shrink-0" /> {e.privateNotes}
          </p>
        )}
      </li>
      {children(e.slug).map((c) => row(c, depth + 1))}
    </Fragment>
  );
  return <ul className="mt-3 divide-y divide-white/6">{children(null).map((e) => row(e, 0))}</ul>;
}

// ---- One project -------------------------------------------------------------------------
function ProjectCard({ project: p, act, onMove, first, last }: { project: Project; act: Act; onMove: (dir: -1 | 1) => void; first: boolean; last: boolean }) {
  const dim = p.status === "folded" || p.status === "paused";
  const savePivotal = (patch: Parameters<typeof saveProject>[1], what: string) => {
    const why = window.prompt(`Why is the ${what} changing? (saved in the pivot log, optional)`);
    if (why === null) return Promise.resolve(false);
    return act(() => saveProject(p.slug, patch, why));
  };
  const steps = p.roadmap;

  return (
    <article aria-label={p.name} className={cx("rounded-[26px] p-5 glass", p.rank === 1 && "ring-1 ring-primary/45", dim && "opacity-70")}>
      <header className="flex flex-wrap items-start gap-3">
        <span
          className={cx(
            "grid size-10 shrink-0 place-items-center rounded-2xl font-mono text-sm font-bold",
            p.rank === 1 ? "bg-primary/25 text-primary-hi" : "bg-white/6 text-ink-2",
          )}
          title={`Priority ${p.rank}`}
        >
          #{p.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">{p.name}</h2>
            {p.rank === 1 && (
              <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary-hi">Main project</span>
            )}
            <select
              aria-label={`${p.name} status`}
              value={p.status}
              onChange={(e) => savePivotal({ status: e.target.value as Project["status"] }, "status")}
              className="h-7 rounded-full bg-white/6 px-2 text-[11px] font-semibold text-ink-2 ring-1 ring-white/10"
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <Editable
            value={p.oneLiner}
            placeholder="One line: what this project is"
            onSave={(v) => act(() => saveProject(p.slug, { oneLiner: v }))}
            className="mt-1 text-sm leading-relaxed text-ink-2"
            multiline
          />
        </div>
        <div className="flex gap-1">
          <IconButton label={`Move ${p.name} up in priority`} disabled={first} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></IconButton>
          <IconButton label={`Move ${p.name} down in priority`} disabled={last} onClick={() => onMove(1)}><ArrowDown className="size-4" /></IconButton>
        </div>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Field icon={<Target className="size-4 text-primary-hi" />} label="Goal">
          <Editable
            multiline
            value={p.goal}
            placeholder="Write the goal"
            onSave={(v) => (v === p.goal ? Promise.resolve(true) : savePivotal({ goal: v }, "goal"))}
            className="text-[15px] leading-relaxed text-ink"
          />
        </Field>
        <Field icon={<Target className="size-4 text-success" />} label="How we'll know we got there">
          <Editable
            multiline
            value={p.successMetric}
            placeholder="Not set yet: a number and a date"
            onSave={(v) => (v === p.successMetric ? Promise.resolve(true) : savePivotal({ successMetric: v }, "measure of success"))}
            className="text-sm leading-relaxed text-ink"
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-ink-3">
            By
            <input
              type="date"
              value={p.targetDate ?? ""}
              onChange={(e) => savePivotal({ targetDate: e.target.value || null }, "target date")}
              className="h-8 rounded-lg bg-white/5 px-2 text-xs text-ink ring-1 ring-white/10"
            />
          </label>
        </Field>
      </div>

      <section aria-label={`${p.name} roadmap`} className="mt-5 border-t border-white/8 pt-4">
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-ink-2">Rough roadmap</h3>
        <ol className="mt-2 space-y-1.5">
          {steps.map((r, i) => (
            <RoadmapRow key={r.id} item={r} act={act} first={i === 0} last={i === steps.length - 1} />
          ))}
          {!steps.length && <li className="text-sm text-ink-3">Nothing on the roadmap yet.</li>}
        </ol>
        <AddRoadmap slug={p.slug} act={act} />
      </section>

      <div className="mt-5 grid gap-5 border-t border-white/8 pt-4 lg:grid-cols-2">
        <Field icon={<CircleHelp className="size-4 text-warning" />} label={`Open questions (${p.openQuestions.length})`}>
          <ListEditor
            items={p.openQuestions}
            placeholder="Add a question that still needs an answer"
            empty="No open questions."
            onChange={(next) => act(() => saveProject(p.slug, { openQuestions: next }))}
          />
        </Field>
        <Field icon={<Users className="size-4 text-level-mission" />} label={`Team (${p.team.length})`}>
          <Editable
            multiline
            value={p.team.map((m) => (m.role ? `${m.name}: ${m.role}` : m.name)).join("\n")}
            placeholder="One person per line, like  Name: what they do"
            onSave={(v) =>
              act(() =>
                saveProject(p.slug, {
                  team: v.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
                    const i = l.indexOf(":");
                    return i < 0 ? { name: l, role: "" } : { name: l.slice(0, i).trim(), role: l.slice(i + 1).trim() };
                  }),
                }),
              )
            }
            className="text-sm leading-relaxed text-ink-2"
          />
        </Field>
      </div>

      <details className="mt-4 border-t border-white/8 pt-3">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.12em] text-ink-2">How it works</summary>
        <Editable
          multiline
          rich
          value={p.context}
          placeholder="Explain the project in plain words. This goes into the project's folder."
          onSave={(v) => act(() => saveProject(p.slug, { context: v }))}
          className="mt-2 text-sm leading-relaxed text-ink-2"
        />
      </details>
      <details className="mt-3 border-t border-white/8 pt-3">
        <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-ink-2">
          <Lock className="size-3.5" /> Private notes (stay in Mission Control)
        </summary>
        <Editable
          multiline
          value={p.privateNotes}
          placeholder="Ownership, money, anything that shouldn't go into the project's folder"
          onSave={(v) => act(() => saveProject(p.slug, { privateNotes: v }))}
          className="mt-2 text-sm leading-relaxed text-ink-2"
        />
      </details>

      <footer className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
        {p.localFolder && <span>Folder: {p.localFolder}</span>}
        {p.repo && <span>Repo: {p.repo}</span>}
        {p.departments.length > 0 && <span>Notion departments: {p.departments.join(", ")}</span>}
        {p.links.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-primary-hi underline-offset-2 hover:underline">
            {l.label}
          </a>
        ))}
      </footer>
    </article>
  );
}

function RoadmapRow({ item: r, act, first, last }: { item: RoadmapItem; act: Act; first: boolean; last: boolean }) {
  const off = r.status === "done" || r.status === "dropped";
  return (
    <li className={cx("flex items-start gap-2 rounded-2xl px-3 py-2", r.status === "active" ? "bg-primary/10 ring-1 ring-primary/25" : "bg-white/[0.03]")}>
      <select
        aria-label={`Status of ${r.title}`}
        value={r.status}
        onChange={(e) => act(() => saveRoadmap(r.id, { status: e.target.value as RoadmapItem["status"] }))}
        className={cx(
          "mt-0.5 h-7 shrink-0 rounded-full px-2 text-[11px] font-semibold ring-1",
          r.status === "active" ? "bg-primary/25 text-primary-hi ring-primary/40"
            : r.status === "done" ? "bg-success/15 text-success ring-success/35"
              : "bg-white/6 text-ink-2 ring-white/10",
        )}
      >
        {ROADMAP_STATUSES.map((s) => (
          <option key={s} value={s}>{ROADMAP_STATUS_LABEL[s]}</option>
        ))}
      </select>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {r.kind === "problem" && (
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-warning ring-1 ring-warning/35">
              <TriangleAlert className="size-3" /> Problem
            </span>
          )}
          <Editable
            value={r.title}
            placeholder="Title"
            onSave={(v) => act(() => saveRoadmap(r.id, { title: v }))}
            className={cx("text-sm font-medium", off ? "text-ink-3 line-through" : "text-ink")}
          />
        </div>
        <Editable
          multiline
          value={r.detail}
          placeholder="Add a note"
          onSave={(v) => act(() => saveRoadmap(r.id, { detail: v }))}
          className="mt-0.5 text-xs leading-relaxed text-ink-3"
        />
      </div>
      <div className="flex shrink-0 gap-0.5">
        <IconButton small label={`Move "${r.title}" up`} disabled={first} onClick={() => act(() => moveRoadmap(r.id, -1))}><ArrowUp className="size-3.5" /></IconButton>
        <IconButton small label={`Move "${r.title}" down`} disabled={last} onClick={() => act(() => moveRoadmap(r.id, 1))}><ArrowDown className="size-3.5" /></IconButton>
      </div>
    </li>
  );
}

function AddRoadmap({ slug, act }: { slug: string; act: Act }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<RoadmapKind>("step");
  const add = async () => {
    if (!title.trim()) return;
    if (await act(() => addRoadmap(slug, { title, kind }))) setTitle("");
  };
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder="Add a step or a problem to solve"
        aria-label="New roadmap item"
        className="h-9 min-w-[200px] flex-1 rounded-full bg-white/5 px-4 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/10"
      />
      <select
        aria-label="Kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as RoadmapKind)}
        className="h-9 rounded-full bg-white/5 px-3 text-xs font-semibold text-ink-2 ring-1 ring-white/10"
      >
        <option value="step">Step</option>
        <option value="problem">Problem</option>
      </select>
      <button onClick={add} disabled={!title.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-white disabled:opacity-40">
        <Plus className="size-3.5" /> Add
      </button>
    </div>
  );
}

// ---- Pivot log ------------------------------------------------------------------------------
function PivotLog({ company, act }: { company: Company; act: Act }) {
  const [summary, setSummary] = useState("");
  const [why, setWhy] = useState("");
  const [slug, setSlug] = useState("");
  const name = new Map(company.projects.map((p) => [p.slug, p.name]));
  const add = async () => {
    if (!summary.trim()) return;
    if (await act(() => logPivot(slug || null, summary, why))) {
      setSummary("");
      setWhy("");
    }
  };
  return (
    <section aria-label="Pivot log" className="rounded-[26px] p-5 glass">
      <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-ink-2">
        <History className="size-4" /> Pivot log
      </h2>
      <p className="mt-1 text-xs text-ink-3">Every change of direction, newest first. Changes to goals, measures, dates, priority and the roadmap are logged here on their own.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[160px_1fr_1fr_auto]">
        <select
          aria-label="Project"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="h-9 rounded-full bg-white/5 px-3 text-xs font-semibold text-ink-2 ring-1 ring-white/10"
        >
          <option value="">Whole company</option>
          {company.projects.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What changed"
          aria-label="What changed"
          className="h-9 rounded-full bg-white/5 px-4 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/10"
        />
        <input
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Why"
          aria-label="Why"
          className="h-9 rounded-full bg-white/5 px-4 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/10"
        />
        <button onClick={add} disabled={!summary.trim()} className="h-9 rounded-full bg-primary px-4 text-xs font-semibold text-white disabled:opacity-40">
          Log pivot
        </button>
      </div>
      <ul className="mt-4 divide-y divide-white/6">
        {company.pivots.map((v) => (
          <li key={v.id} className="py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-ink-3">
              <time dateTime={v.createdAt}>
                {new Date(v.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </time>
              <span className="font-semibold text-ink-2">{v.projectSlug ? (name.get(v.projectSlug) ?? v.projectSlug) : "Whole company"}</span>
            </div>
            <p className="mt-0.5 text-sm text-ink">{v.summary}</p>
            {v.why && <p className="mt-0.5 text-xs text-ink-3">Why: {v.why}</p>}
          </li>
        ))}
        {!company.pivots.length && <li className="py-2 text-sm text-ink-3">No pivots logged yet.</li>}
      </ul>
    </section>
  );
}

// ---- Small pieces ---------------------------------------------------------------------------
function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-ink-2">
        {icon} {label}
      </h3>
      {children}
    </div>
  );
}

function IconButton({ label, onClick, disabled, small, children }: { label: string; onClick: () => void; disabled?: boolean; small?: boolean; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "grid place-items-center rounded-full text-ink-3 ring-1 ring-white/10 hover:bg-white/10 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent",
        small ? "size-7" : "size-9",
      )}
    >
      {children}
    </button>
  );
}

/** Text that turns into an input when clicked. Saves on blur (or Enter for one-line fields); Escape cancels. */
function Editable({
  value, onSave, placeholder, multiline = false, rich = false, className,
}: {
  value: string;
  onSave: (v: string) => Promise<boolean>;
  placeholder: string;
  multiline?: boolean;
  rich?: boolean; // show **bold** and paragraphs when not editing
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  const start = () => {
    setDraft(value);
    cancelled.current = false;
    setEditing(true);
  };
  const finish = async () => {
    setEditing(false);
    if (cancelled.current || draft.trim() === value.trim()) return;
    await onSave(draft.trim());
  };
  if (editing) {
    const shared = {
      autoFocus: true,
      value: draft,
      "aria-label": placeholder,
      onBlur: finish,
      className: cx("w-full rounded-xl bg-black/30 px-3 py-2 text-sm text-ink ring-1 ring-primary/50", multiline && "min-h-[5.5rem] resize-y"),
    };
    return multiline ? (
      <textarea
        {...shared}
        rows={Math.min(16, Math.max(3, draft.split("\n").length + 1))}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
        }}
      />
    ) : (
      <input
        {...shared}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancelled.current = true;
          if (e.key === "Escape" || e.key === "Enter") e.currentTarget.blur();
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={start}
      title="Click to edit"
      className={cx("block w-full cursor-text whitespace-pre-wrap rounded-lg text-left hover:bg-white/[0.04]", className, !value && "italic text-ink-3")}
    >
      {value ? (rich ? <Rich text={value} /> : value) : placeholder}
    </button>
  );
}

/** Just enough formatting for the notes: **bold** and backticks. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
        part.startsWith("**") ? (
          <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>
        ) : part.startsWith("`") ? (
          <code key={i} className="font-mono text-[0.92em] text-ink">{part.slice(1, -1)}</code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function ListEditor({ items, onChange, placeholder, empty }: { items: string[]; onChange: (next: string[]) => Promise<boolean>; placeholder: string; empty: string }) {
  const [draft, setDraft] = useState("");
  const add = async () => {
    if (!draft.trim()) return;
    if (await onChange([...items, draft.trim()])) setDraft("");
  };
  return (
    <div>
      <ul className="space-y-1">
        {items.map((q, i) => (
          <li key={`${i}-${q}`} className="flex items-start gap-2 text-sm leading-relaxed text-ink-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
            <span className="flex-1">{q}</span>
            <button
              aria-label={`Remove question: ${q}`}
              title="Answered or no longer needed"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="rounded-full p-1 text-ink-3 hover:bg-white/10 hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
        {!items.length && <li className="text-sm text-ink-3">{empty}</li>}
      </ul>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        onBlur={add}
        placeholder={placeholder}
        aria-label={placeholder}
        className="mt-2 h-9 w-full rounded-full bg-white/5 px-4 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/10"
      />
    </div>
  );
}
