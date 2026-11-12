#!/usr/bin/env node
// Spreads the company master (Neon, edited in Mission Control → Company) into each project's
// local folder, so every project's Claude knows who we are, the goal, the roadmap and where
// the project ranks.
//
//   npm run company:sync            write the files
//   npm run company:sync -- --dry   show what would change, write nothing
//
// Per project folder (the `local_folder` column, looked up next to this repo):
//   company/README.md   who we are, what this project is, how it works, where it ranks
//   company/GOAL.md     the goal, how we'll know, open questions
//   company/ROADMAP.md  now / next / problems / done / dropped
//   company/TEAM.md     who works on it
//   company/PIVOTS.md   every change of direction
//   CLAUDE.md           a short block between the BEGIN:company / END:company markers
// Mission Control itself gets company/PORTFOLIO.md (every project; git-ignored, this repo is public)
// and a block in AGENTS.md that carries no company data.
//
// Private notes never leave the database: they are not read here at all.
// Files are only rewritten when their content changes, so an unchanged master makes no diff.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = process.env.COMPANY_PROJECTS_ROOT ?? path.resolve(repo, "..");
const dry = process.argv.includes("--dry");

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = path.join(repo, ".env.local");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
  return line ? line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "") : null;
}

const dbUrl = databaseUrl();
if (!dbUrl) {
  console.error("DATABASE_URL is missing. Add it to .env.local (vercel env pull) or pass it in the environment.");
  process.exit(1);
}
const sql = neon(dbUrl);

// Only the shared columns: private_notes is never selected.
const [entities, projects, roadmap, pivots, noteRows] = await Promise.all([
  sql`SELECT slug, name, kind, jurisdiction, parent_slug, relationship, status, summary FROM company_entities ORDER BY position, name`,
  sql`SELECT slug, name, entity_slug, rank, status, one_liner, goal, success_metric, target_date::text AS target_date, context,
        team, open_questions, departments, local_folder, repo, links FROM company_projects ORDER BY rank, name`,
  sql`SELECT project_slug, kind, title, detail, status FROM company_roadmap ORDER BY project_slug, position, id`,
  sql`SELECT created_at::date::text AS day, project_slug, summary, why FROM company_pivots ORDER BY created_at DESC, id DESC`,
  sql`SELECT key, value FROM company_notes`,
]);
const notes = Object.fromEntries(noteRows.map((n) => [n.key, n.value]));
const live = projects.filter((p) => p.status !== "folded");
const entity = new Map(entities.map((e) => [e.slug, e]));

const HEADER = "<!-- Generated from the company master in Mission Control (Company view). Don't edit here: change it there, then run `npm run company:sync` in the Mission Control folder. -->";
const STATUS = { active: "active", side: "side project", paused: "paused", folded: "folded in" };
const list = (items, empty = "None.") => (items.length ? items.map((i) => `- ${i}`).join("\n") : empty);
const steps = (slug, kind, status) => roadmap.filter((r) => r.project_slug === slug && r.kind === kind && status.includes(r.status));
const item = (r) => `**${r.title}**${r.detail ? `\n  ${r.detail}` : ""}`;
const company = entity.get("ip-house-corp");
const companyName = company ? `${company.name} (brand name: IP Ventures)` : "the company";

const priorityLines = () =>
  live.map((p) => `${p.rank}. **${p.name}**${p.status === "side" ? " (side project)" : p.status === "paused" ? " (paused)" : ""}: ${p.one_liner}`).join("\n");

function rankLine(p) {
  if (p.rank === 1) return `${p.name} is the **main project**: #1 of ${live.length}. When projects compete for time, this one wins.`;
  const main = live[0];
  return `${p.name} is **#${p.rank} of ${live.length}**${p.status === "side" ? ", a side project" : ""}. The main project is ${main.name}. If work here would take time the main project needs, say so before starting.`;
}

function readme(p) {
  const own = entity.get(p.entity_slug);
  return `${HEADER}

# ${p.name}: who we are and where we're going

${p.one_liner}

## The goal

${p.goal || "Not written yet."}

${p.success_metric ? `**How we'll know we got there:** ${p.success_metric}${p.target_date ? ` (by ${p.target_date})` : ""}` : "**How we'll know we got there:** not set yet. See the open questions in `GOAL.md`."}

## How it works

${p.context || "Not written yet."}

## Where this sits in the company

${company ? company.summary : ""}
${own && own.slug !== "ip-house-corp" ? `\n${own.name}: ${own.summary}\n` : ""}
${rankLine(p)}

Projects in priority order:

${priorityLines()}

## How we work

${notes.how_we_work ?? ""}

## How to use this

- Before starting a piece of work, check that it moves the goal, something on the roadmap now, or an open problem (see \`ROADMAP.md\`). If it doesn't, say so in one line and ask whether it's worth doing now. Don't refuse; the call belongs to the person you're working with.
- The roadmap is rough on purpose. We set a position, then pivot as we learn. Only the goal is meant to hold still.
- When direction changes in a session (a new goal, a dropped step, a new problem), say that it should be logged in Mission Control → Company. These files are regenerated from there, so edits made here are lost.

## The other files in this folder

- \`GOAL.md\`: the goal, how we'll measure it, and the questions still open
- \`ROADMAP.md\`: what we're doing now, what's next, and the problems to solve
- \`TEAM.md\`: who works on this
- \`PIVOTS.md\`: every change of direction so far
${p.links?.length ? `\n## Links\n\n${p.links.map((l) => `- [${l.label}](${l.url})`).join("\n")}\n` : ""}`;
}

function goalFile(p) {
  return `${HEADER}

# ${p.name}: the goal

${p.goal || "Not written yet."}

## How we'll know we got there

${p.success_metric || "Not set yet."}${p.target_date ? `\n\nTarget date: ${p.target_date}` : ""}

## Questions still open

${list(p.open_questions ?? [], "None right now.")}
`;
}

function roadmapFile(p) {
  const now = steps(p.slug, "step", ["active"]);
  const next = steps(p.slug, "step", ["planned"]);
  const problems = steps(p.slug, "problem", ["active", "planned"]);
  const done = roadmap.filter((r) => r.project_slug === p.slug && r.status === "done");
  const dropped = roadmap.filter((r) => r.project_slug === p.slug && r.status === "dropped");
  return `${HEADER}

# ${p.name}: rough roadmap

This is how we currently believe we get to the goal. It is rough on purpose and it changes: we fix, change and pivot as we go.

**The goal:** ${p.goal || "Not written yet."}

## Problems to solve

${list(problems.map(item), "None open.")}

## Doing now

${list(now.map(item), "Nothing marked as now.")}

## Next

${list(next.map(item), "Nothing planned yet.")}
${done.length ? `\n## Done\n\n${list(done.map(item))}\n` : ""}${dropped.length ? `\n## Dropped\n\n${list(dropped.map(item))}\n` : ""}`;
}

function teamFile(p) {
  return `${HEADER}

# ${p.name}: team

${list((p.team ?? []).map((m) => `**${m.name}**${m.role ? `: ${m.role}` : ""}`), "Not written yet.")}
${p.departments?.length ? `\nTasks for this project live in Notion under: ${p.departments.join(", ")}.\n` : ""}`;
}

function pivotsFile(p) {
  const mine = pivots.filter((v) => v.project_slug === p.slug || v.project_slug === null);
  return `${HEADER}

# ${p.name}: pivots

Every change of direction, newest first. "Whole company" entries affect every project.

${list(mine.map((v) => `${v.day} · ${v.project_slug ? p.name : "Whole company"}: ${v.summary}${v.why ? `\n  Why: ${v.why}` : ""}`), "None yet.")}
`;
}

function claudeBlock(p) {
  const now = steps(p.slug, "step", ["active"]).map((r) => r.title);
  const problems = steps(p.slug, "problem", ["active", "planned"]).map((r) => r.title);
  return `## Company context

Generated by Mission Control. Edit it there (Company view), not here.

**${p.name}** is project #${p.rank} of ${live.length} at ${companyName}${p.rank === 1 ? ": the main project" : p.status === "side" ? ": a side project" : ""}. ${p.one_liner}

- **Goal:** ${p.goal || "not written yet"}
- **How we'll know:** ${p.success_metric || "not set yet"}${p.target_date ? ` (by ${p.target_date})` : ""}
- **Doing now:** ${now.join("; ") || "nothing marked"}
- **Problems to solve:** ${problems.join("; ") || "none open"}

Before starting work, check that it moves the goal, something we're doing now, or an open problem. If it doesn't, say so in one line and ask whether it's worth doing now.${p.rank > 1 ? ` The main project is ${live[0].name}: flag work here that would take time it needs.` : ""} The roadmap is rough on purpose; we pivot as we learn, and a change of direction gets logged in Mission Control.

More: \`company/README.md\` (who we are, how it works), \`company/GOAL.md\`, \`company/ROADMAP.md\`, \`company/TEAM.md\`, \`company/PIVOTS.md\`.`;
}

function portfolio() {
  const tree = (parent, depth) =>
    entities
      .filter((e) => (e.parent_slug ?? null) === parent)
      .map((e) => `${"  ".repeat(depth)}- **${e.name}** (${[e.kind, e.jurisdiction, e.relationship].filter(Boolean).join(", ")}): ${e.summary}\n${tree(e.slug, depth + 1)}`)
      .join("");
  const one = (p) => {
    const now = steps(p.slug, "step", ["active"]);
    const next = steps(p.slug, "step", ["planned"]);
    const problems = steps(p.slug, "problem", ["active", "planned"]);
    return `## ${p.rank}. ${p.name} (${STATUS[p.status] ?? p.status})

${p.one_liner}

- **Goal:** ${p.goal || "not written yet"}
- **How we'll know:** ${p.success_metric || "not set yet"}${p.target_date ? ` (by ${p.target_date})` : ""}
- **Folder:** ${p.local_folder ?? "none"}${p.repo ? ` · **Repo:** ${p.repo}` : ""}${p.departments?.length ? ` · **Notion departments:** ${p.departments.join(", ")}` : ""}

**Problems to solve**

${list(problems.map(item), "None open.")}

**Doing now**

${list(now.map(item), "Nothing marked as now.")}

**Next**

${list(next.map(item), "Nothing planned yet.")}

**Questions still open**

${list(p.open_questions ?? [], "None right now.")}

**Team**

${list((p.team ?? []).map((m) => `${m.name}${m.role ? `: ${m.role}` : ""}`), "Not written yet.")}
`;
  };
  return `${HEADER}

# The company: goals, roadmaps and priority

The readable copy of the company master (Neon tables \`company_entities\`, \`company_projects\`, \`company_roadmap\`, \`company_pivots\`, \`company_notes\`). Private notes (ownership splits, money) stay in the database and show only in Mission Control.

## Where the company is going

${notes.company_goal ?? "Not written yet."}

## How we work

${notes.how_we_work ?? ""}

## Structure

${tree(null, 0)}
## Projects, in priority order

When two projects compete for time, the higher one wins.

${projects.map(one).join("\n")}
## Pivots

${list(pivots.map((v) => `${v.day} · ${v.project_slug ? (projects.find((p) => p.slug === v.project_slug)?.name ?? v.project_slug) : "Whole company"}: ${v.summary}${v.why ? `\n  Why: ${v.why}` : ""}`), "None yet.")}
`;
}

function missionControlBlock() {
  // This repo is public, so the block names no project, goal or number. The data stays in
  // Neon and in company/PORTFOLIO.md, which is git-ignored.
  return `## Company context

Mission Control holds the company master: legal entities, each project's goal and rough roadmap, the priority order between projects, and the pivot log. It lives in Neon (tables \`company_*\`, code in \`lib/company.ts\`), is edited in the site's Company view, and feeds the AI planner so it can tell signal from noise across projects.

Read \`company/PORTFOLIO.md\` for the current goals, roadmaps and priority order before planning or recommending work. It is generated and git-ignored (this repo is public): if it's missing or stale, run \`npm run company:sync\`, which also refreshes every project folder's \`company/\` files and CLAUDE.md block. Never write company data (goals, numbers, names, ownership) into a tracked file here.`;
}

// ---- Writing ------------------------------------------------------------------------------
const changed = [];
function write(file, content) {
  const text = content.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  if (existsSync(file) && readFileSync(file, "utf8") === text) return;
  changed.push(path.relative(root, file));
  if (dry) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const BEGIN = "<!-- BEGIN:company -->";
const END = "<!-- END:company -->";
function upsertBlock(file, block, title) {
  const wrapped = `${BEGIN}\n${block.trim()}\n${END}`;
  let text = existsSync(file) ? readFileSync(file, "utf8") : `# ${title}\n`;
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  text = a >= 0 && b > a ? text.slice(0, a) + wrapped + text.slice(b + END.length) : `${text.trimEnd()}\n\n${wrapped}\n`;
  if (existsSync(file) && readFileSync(file, "utf8") === text) return;
  changed.push(path.relative(root, file));
  if (!dry) writeFileSync(file, text);
}

const skipped = [];
for (const p of projects) {
  if (!p.local_folder) continue;
  const dir = path.join(root, p.local_folder);
  if (!existsSync(dir)) {
    skipped.push(`${p.name}: no folder "${p.local_folder}" in ${root}`);
    continue;
  }
  write(path.join(dir, "company", "README.md"), readme(p));
  write(path.join(dir, "company", "GOAL.md"), goalFile(p));
  write(path.join(dir, "company", "ROADMAP.md"), roadmapFile(p));
  write(path.join(dir, "company", "TEAM.md"), teamFile(p));
  write(path.join(dir, "company", "PIVOTS.md"), pivotsFile(p));
  upsertBlock(path.join(dir, "CLAUDE.md"), claudeBlock(p), p.name);
}
write(path.join(repo, "company", "PORTFOLIO.md"), portfolio());
upsertBlock(path.join(repo, "AGENTS.md"), missionControlBlock(), "Mission Control");

console.log(changed.length ? `${dry ? "Would update" : "Updated"} ${changed.length} file(s):\n${changed.map((c) => `  ${c}`).join("\n")}` : "Everything is already up to date.");
for (const s of skipped) console.log(`Skipped ${s}`);
