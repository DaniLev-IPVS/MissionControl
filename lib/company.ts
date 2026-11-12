import "server-only";
import { neon } from "@neondatabase/serverless";
import type {
  Company, Entity, Pivot, Project, ProjectPatch, RoadmapItem, RoadmapKind, RoadmapPatch, RoadmapStatus,
} from "./company-types";

// The company master database (Neon): legal entities and brands, each project's goal and rough
// roadmap, and the log of pivots. Mission Control is the only place this is edited; each project's
// folder gets a generated copy (scripts/company-sync.mjs), and the AI planner reads it so it can
// tell signal from noise across projects.
// Without DATABASE_URL (local dev) reads come back empty with configured = false.

const url = () => process.env.DATABASE_URL;
let ready: Promise<void> | null = null;

function db() {
  const u = url();
  return u ? neon(u) : null;
}

/** Table definitions, created on first use. */
export const COMPANY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS company_entities (
    slug text PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL DEFAULT 'company',
    jurisdiction text,
    parent_slug text,
    relationship text,
    status text NOT NULL DEFAULT 'active',
    summary text NOT NULL DEFAULT '',
    private_notes text NOT NULL DEFAULT '',
    position int NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS company_projects (
    slug text PRIMARY KEY,
    name text NOT NULL,
    entity_slug text,
    rank int NOT NULL DEFAULT 99,
    status text NOT NULL DEFAULT 'active',
    one_liner text NOT NULL DEFAULT '',
    goal text NOT NULL DEFAULT '',
    success_metric text NOT NULL DEFAULT '',
    target_date date,
    context text NOT NULL DEFAULT '',
    team jsonb NOT NULL DEFAULT '[]'::jsonb,
    open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
    departments jsonb NOT NULL DEFAULT '[]'::jsonb,
    local_folder text,
    repo text,
    links jsonb NOT NULL DEFAULT '[]'::jsonb,
    private_notes text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS company_roadmap (
    id bigserial PRIMARY KEY,
    project_slug text NOT NULL,
    position int NOT NULL DEFAULT 0,
    kind text NOT NULL DEFAULT 'step',
    title text NOT NULL,
    detail text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'planned',
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS company_roadmap_project ON company_roadmap (project_slug, position)`,
  `CREATE TABLE IF NOT EXISTS company_pivots (
    id bigserial PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    project_slug text,
    summary text NOT NULL,
    why text NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS company_notes (
    key text PRIMARY KEY,
    value text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
];

async function ensure() {
  const sql = db();
  if (!sql) return null;
  ready ??= (async () => {
    for (const stmt of COMPANY_SCHEMA) await sql.query(stmt);
  })().catch((err) => {
    ready = null;
    throw err;
  });
  await ready;
  return sql;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : str(v));
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : str(v).slice(0, 10) || null);

const toEntity = (r: Row): Entity => ({
  slug: str(r.slug),
  name: str(r.name),
  kind: str(r.kind),
  jurisdiction: strOrNull(r.jurisdiction),
  parentSlug: strOrNull(r.parent_slug),
  relationship: strOrNull(r.relationship),
  status: str(r.status),
  summary: str(r.summary),
  privateNotes: str(r.private_notes),
  position: Number(r.position) || 0,
});

const toRoadmap = (r: Row): RoadmapItem => ({
  id: Number(r.id),
  projectSlug: str(r.project_slug),
  position: Number(r.position) || 0,
  kind: (str(r.kind) || "step") as RoadmapKind,
  title: str(r.title),
  detail: str(r.detail),
  status: (str(r.status) || "planned") as RoadmapStatus,
});

const toPivot = (r: Row): Pivot => ({
  id: Number(r.id),
  createdAt: iso(r.created_at),
  projectSlug: strOrNull(r.project_slug),
  summary: str(r.summary),
  why: str(r.why),
});

const toProject = (r: Row, roadmap: RoadmapItem[]): Project => ({
  slug: str(r.slug),
  name: str(r.name),
  entitySlug: strOrNull(r.entity_slug),
  rank: Number(r.rank) || 99,
  status: (str(r.status) || "active") as Project["status"],
  oneLiner: str(r.one_liner),
  goal: str(r.goal),
  successMetric: str(r.success_metric),
  targetDate: day(r.target_date),
  context: str(r.context),
  team: arr(r.team),
  openQuestions: arr(r.open_questions),
  departments: arr(r.departments),
  localFolder: strOrNull(r.local_folder),
  repo: strOrNull(r.repo),
  links: arr(r.links),
  privateNotes: str(r.private_notes),
  updatedAt: iso(r.updated_at),
  roadmap,
});

const EMPTY: Company = { configured: false, notes: {}, entities: [], projects: [], pivots: [] };

export async function getCompany(): Promise<Company> {
  const sql = await ensure();
  if (!sql) return EMPTY;
  const [entities, projects, roadmap, pivots, notes] = (await Promise.all([
    sql`SELECT * FROM company_entities ORDER BY position, name`,
    sql`SELECT * FROM company_projects ORDER BY rank, name`,
    sql`SELECT * FROM company_roadmap ORDER BY project_slug, position, id`,
    sql`SELECT * FROM company_pivots ORDER BY created_at DESC LIMIT 60`,
    sql`SELECT key, value FROM company_notes`,
  ])) as Row[][];
  const items = roadmap.map(toRoadmap);
  return {
    configured: true,
    notes: Object.fromEntries(notes.map((n) => [str(n.key), str(n.value)])),
    entities: entities.map(toEntity),
    projects: projects.map((p) => toProject(p, items.filter((i) => i.projectSlug === p.slug))),
    pivots: pivots.map(toPivot),
  };
}

async function need() {
  const sql = await ensure();
  if (!sql) throw new Error("The company database isn't connected here (DATABASE_URL is missing).");
  return sql;
}

export async function addPivot(projectSlug: string | null, summary: string, why = "") {
  const sql = await need();
  await sql`INSERT INTO company_pivots (project_slug, summary, why) VALUES (${projectSlug}, ${summary.slice(0, 600)}, ${why.slice(0, 1000)})`;
}

const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Save edits to a project. A change of goal, measure, target date or status is logged as a pivot. */
export async function updateProject(slug: string, patch: ProjectPatch, why = "") {
  const sql = await need();
  const rows = (await sql`SELECT * FROM company_projects WHERE slug = ${slug}`) as Row[];
  if (!rows.length) throw new Error("No such project");
  const before = toProject(rows[0], []);
  const next = { ...before, ...patch };
  await sql`UPDATE company_projects SET
      name = ${next.name}, status = ${next.status}, one_liner = ${next.oneLiner}, goal = ${next.goal},
      success_metric = ${next.successMetric}, target_date = ${next.targetDate}, context = ${next.context},
      team = ${JSON.stringify(next.team)}::jsonb, open_questions = ${JSON.stringify(next.openQuestions)}::jsonb,
      departments = ${JSON.stringify(next.departments)}::jsonb, private_notes = ${next.privateNotes}, updated_at = now()
    WHERE slug = ${slug}`;
  const changes: string[] = [];
  if (before.goal !== next.goal) changes.push(`Goal: "${short(before.goal) || "none"}" → "${short(next.goal)}"`);
  if (before.successMetric !== next.successMetric)
    changes.push(`Measure of success: "${short(before.successMetric) || "none"}" → "${short(next.successMetric)}"`);
  if (before.targetDate !== next.targetDate) changes.push(`Target date: ${before.targetDate ?? "none"} → ${next.targetDate ?? "none"}`);
  if (before.status !== next.status) changes.push(`Status: ${before.status} → ${next.status}`);
  if (changes.length) await addPivot(slug, changes.join(" · "), why);
}

/** New priority order: the first slug becomes #1. Logged as a company-wide pivot when it changes. */
export async function setProjectOrder(slugs: string[], why = "") {
  const sql = await need();
  const rows = (await sql`SELECT slug, name, rank FROM company_projects ORDER BY rank, name`) as Row[];
  const current = rows.map((r) => str(r.slug));
  const order = [...slugs.filter((s) => current.includes(s)), ...current.filter((s) => !slugs.includes(s))];
  if (order.join() === current.join()) return;
  for (let i = 0; i < order.length; i++) {
    await sql`UPDATE company_projects SET rank = ${i + 1}, updated_at = now() WHERE slug = ${order[i]}`;
  }
  const name = new Map(rows.map((r) => [str(r.slug), str(r.name)]));
  await addPivot(null, `Priority order: ${order.map((s, i) => `${i + 1}. ${name.get(s)}`).join(", ")}`, why);
}

export async function addRoadmapItem(projectSlug: string, item: { title: string; detail?: string; kind?: RoadmapKind }) {
  const sql = await need();
  const max = (await sql`SELECT COALESCE(MAX(position), 0) AS p FROM company_roadmap WHERE project_slug = ${projectSlug}`) as Row[];
  await sql`INSERT INTO company_roadmap (project_slug, position, kind, title, detail)
    VALUES (${projectSlug}, ${Number(max[0]?.p ?? 0) + 1}, ${item.kind ?? "step"}, ${item.title}, ${item.detail ?? ""})`;
  await addPivot(projectSlug, `Added to the roadmap: ${item.kind === "problem" ? "(problem) " : ""}${short(item.title)}`);
}

export async function updateRoadmapItem(id: number, patch: RoadmapPatch, why = "") {
  const sql = await need();
  const rows = (await sql`SELECT * FROM company_roadmap WHERE id = ${id}`) as Row[];
  if (!rows.length) throw new Error("No such roadmap item");
  const before = toRoadmap(rows[0]);
  const next = { ...before, ...patch };
  await sql`UPDATE company_roadmap SET title = ${next.title}, detail = ${next.detail}, status = ${next.status},
      kind = ${next.kind}, updated_at = now() WHERE id = ${id}`;
  const changes: string[] = [];
  if (before.title !== next.title) changes.push(`"${short(before.title)}" → "${short(next.title)}"`);
  if (before.status !== next.status) changes.push(`"${short(next.title)}": ${before.status} → ${next.status}`);
  if (changes.length) await addPivot(before.projectSlug, `Roadmap: ${changes.join(" · ")}`, why);
}

/** Move a roadmap item one place up or down among its project's items. */
export async function moveRoadmapItem(id: number, direction: -1 | 1) {
  const sql = await need();
  const rows = (await sql`SELECT r.* FROM company_roadmap r
    WHERE r.project_slug = (SELECT project_slug FROM company_roadmap WHERE id = ${id}) ORDER BY position, id`) as Row[];
  const list = rows.map(toRoadmap);
  const i = list.findIndex((r) => r.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) {
    if (list[k].position !== k + 1) await sql`UPDATE company_roadmap SET position = ${k + 1} WHERE id = ${list[k].id}`;
  }
}

export async function setNote(key: string, value: string) {
  const sql = await need();
  await sql`INSERT INTO company_notes (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

// ---- For the AI planner ---------------------------------------------------------------
/**
 * The company picture as prompt text: priority order, each project's goal, where it is on its
 * roadmap, and the open problems. Empty when there's no database or nothing is filled in.
 * A database error never breaks an AI feature.
 */
export async function companyForPrompt(): Promise<string> {
  try {
    const c = await getCompany();
    const projects = c.projects.filter((p) => p.status !== "folded" && p.status !== "paused");
    if (!projects.length) return "";
    const lines = projects.map((p) => {
      const now = p.roadmap.filter((r) => r.kind === "step" && r.status === "active").map((r) => r.title);
      const next = p.roadmap.filter((r) => r.kind === "step" && r.status === "planned").map((r) => r.title).slice(0, 2);
      const problems = p.roadmap.filter((r) => r.kind === "problem" && r.status !== "done" && r.status !== "dropped").map((r) => r.title);
      return [
        `${p.rank}. ${p.name}${p.status === "side" ? " (side project)" : ""}${p.departments.length ? ` [departments: ${p.departments.join(", ")}]` : ""}`,
        p.goal ? `   Goal: ${p.goal}` : "",
        p.successMetric ? `   Measured by: ${p.successMetric}${p.targetDate ? ` by ${p.targetDate}` : ""}` : "",
        now.length ? `   On the roadmap now: ${now.join("; ")}` : "",
        next.length ? `   Next: ${next.join("; ")}` : "",
        problems.length ? `   Open problems: ${problems.join("; ")}` : "",
      ].filter(Boolean).join("\n");
    });
    return `

Where the company is going (projects in priority order; #1 wins when projects compete for time):
${lines.join("\n")}
${c.notes.company_goal ? `Company goal: ${c.notes.company_goal.replace(/\s+/g, " ")}\n` : ""}${c.notes.how_we_work ? `How we work: ${c.notes.how_we_work}\n` : ""}Use this: the day should mostly move project #1 toward its goal, through what's on its roadmap now and its open problems. Work for a lower-ranked project is noise unless it's due, blocks a teammate, or the user asks for it; a side project gets time only after the main project is covered. When a pick's link to a goal isn't obvious, name it in the reason. If nothing in the plan moves project #1, say so plainly in your reply.`;
  } catch (err) {
    console.error("reading the company picture failed", err);
    return "";
  }
}
