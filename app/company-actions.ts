"use server";

import {
  addPivot, addRoadmapItem, moveRoadmapItem, setNote, setProjectOrder, updateProject, updateRoadmapItem,
} from "@/lib/company";
import {
  PROJECT_STATUSES, ROADMAP_KINDS, ROADMAP_STATUSES,
  type ProjectPatch, type RoadmapKind, type RoadmapPatch,
} from "@/lib/company-types";

// Edits to the company master. Server actions are reachable by POST, so validate everything.
// Errors come back as values: production hides thrown messages from the browser.

export type CompanyResult = { ok: true } | { ok: false; error: string };

const SLUG = /^[a-z0-9-]{1,60}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_KEYS = ["company_goal", "how_we_work"];
const oneOf = (list: readonly string[], v: unknown) => typeof v === "string" && list.includes(v);

function text(v: unknown, max: number, name: string) {
  if (typeof v !== "string" || v.length > max) throw new Error(`Bad ${name}`);
  return v.trim();
}

async function run(fn: () => Promise<void>): Promise<CompanyResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    console.error("company save failed", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function cleanProject(p: ProjectPatch): ProjectPatch {
  const c: ProjectPatch = {};
  if (p.name !== undefined) {
    c.name = text(p.name, 120, "name");
    if (!c.name) throw new Error("A project needs a name");
  }
  if (p.status !== undefined) {
    if (!oneOf(PROJECT_STATUSES, p.status)) throw new Error("Bad status");
    c.status = p.status;
  }
  if (p.oneLiner !== undefined) c.oneLiner = text(p.oneLiner, 400, "summary");
  if (p.goal !== undefined) c.goal = text(p.goal, 1500, "goal");
  if (p.successMetric !== undefined) c.successMetric = text(p.successMetric, 600, "measure");
  if (p.targetDate !== undefined) {
    if (p.targetDate !== null && !DAY.test(p.targetDate)) throw new Error("Bad date");
    c.targetDate = p.targetDate;
  }
  if (p.context !== undefined) c.context = text(p.context, 12000, "notes");
  if (p.privateNotes !== undefined) c.privateNotes = text(p.privateNotes, 6000, "private notes");
  if (p.team !== undefined) {
    if (!Array.isArray(p.team) || p.team.length > 40) throw new Error("Bad team");
    c.team = p.team
      .map((m) => ({ name: text(m?.name, 120, "team name"), role: text(m?.role ?? "", 300, "team role") }))
      .filter((m) => m.name);
  }
  for (const k of ["openQuestions", "departments"] as const) {
    const list = p[k];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > 40) throw new Error(`Bad ${k}`);
    c[k] = list.map((q) => text(q, 500, k)).filter(Boolean);
  }
  return c;
}

export async function saveProject(slug: string, patch: ProjectPatch, why = "") {
  return run(async () => {
    if (!SLUG.test(slug)) throw new Error("Bad project");
    await updateProject(slug, cleanProject(patch), text(why, 1000, "reason"));
  });
}

export async function reorderProjects(slugs: string[], why = "") {
  return run(async () => {
    if (!Array.isArray(slugs) || slugs.length > 50 || slugs.some((s) => !SLUG.test(s))) throw new Error("Bad order");
    await setProjectOrder(slugs, text(why, 1000, "reason"));
  });
}

export async function addRoadmap(slug: string, item: { title: string; detail?: string; kind?: RoadmapKind }) {
  return run(async () => {
    if (!SLUG.test(slug)) throw new Error("Bad project");
    const title = text(item.title, 300, "title");
    if (!title) throw new Error("Give it a title");
    const kind = item.kind ?? "step";
    if (!oneOf(ROADMAP_KINDS, kind)) throw new Error("Bad kind");
    await addRoadmapItem(slug, { title, detail: text(item.detail ?? "", 2000, "detail"), kind });
  });
}

export async function saveRoadmap(id: number, patch: RoadmapPatch, why = "") {
  return run(async () => {
    if (!Number.isInteger(id) || id < 1) throw new Error("Bad item");
    const c: RoadmapPatch = {};
    if (patch.title !== undefined) {
      c.title = text(patch.title, 300, "title");
      if (!c.title) throw new Error("Give it a title");
    }
    if (patch.detail !== undefined) c.detail = text(patch.detail, 2000, "detail");
    if (patch.status !== undefined) {
      if (!oneOf(ROADMAP_STATUSES, patch.status)) throw new Error("Bad status");
      c.status = patch.status;
    }
    if (patch.kind !== undefined) {
      if (!oneOf(ROADMAP_KINDS, patch.kind)) throw new Error("Bad kind");
      c.kind = patch.kind;
    }
    await updateRoadmapItem(id, c, text(why, 1000, "reason"));
  });
}

export async function moveRoadmap(id: number, direction: -1 | 1) {
  return run(async () => {
    if (!Number.isInteger(id) || id < 1 || (direction !== -1 && direction !== 1)) throw new Error("Bad move");
    await moveRoadmapItem(id, direction);
  });
}

export async function saveNote(key: string, value: string) {
  return run(async () => {
    if (!NOTE_KEYS.includes(key)) throw new Error("Bad note");
    await setNote(key, text(value, 4000, "note"));
  });
}

export async function logPivot(slug: string | null, summary: string, why = "") {
  return run(async () => {
    if (slug !== null && !SLUG.test(slug)) throw new Error("Bad project");
    const s = text(summary, 600, "summary");
    if (!s) throw new Error("Say what changed");
    await addPivot(slug, s, text(why, 1000, "reason"));
  });
}
