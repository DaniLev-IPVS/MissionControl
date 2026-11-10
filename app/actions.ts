"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { AUTH_COOKIE, adminCredentials, safeEqual, sessionToken } from "@/lib/auth";
import { getCurrentSprintId, getHistory, todayInZone } from "@/lib/board";
import { ALL_STATUSES, BOARD_TAG, FOCUS, LEVELS, PRIORITIES, USE_MOCK } from "@/lib/config";
import { mockCreate, mockCreateDay, mockUpdate, mockUpdateDay } from "@/lib/mock";
import { createDay, createTaskInNotion, updateDay, updateTaskInNotion } from "@/lib/notion";
import type { Change, DayStats, NewTask, TaskPatch } from "@/lib/types";

// Server actions are reachable by POST, so validate everything.
const ID = /^[\w-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isISO = (s: unknown) => typeof s === "string" && !Number.isNaN(Date.parse(s)) && s.length <= 40;
const oneOf = (list: readonly string[], v: unknown) => typeof v === "string" && list.includes(v);

function cleanPatch(p: TaskPatch): TaskPatch {
  const c: TaskPatch = {};
  if (p.name !== undefined) {
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 500) throw new Error("Bad name");
    c.name = p.name.trim();
  }
  if (p.status !== undefined) {
    if (!oneOf(ALL_STATUSES, p.status)) throw new Error("Bad status");
    c.status = p.status;
  }
  if (p.priority !== undefined) {
    if (p.priority !== null && !oneOf(PRIORITIES, p.priority)) throw new Error("Bad priority");
    c.priority = p.priority;
  }
  if (p.due !== undefined) {
    if (p.due !== null && !DAY.test(p.due)) throw new Error("Bad date");
    c.due = p.due;
  }
  if (p.focus !== undefined) {
    if (p.focus !== null && !oneOf(FOCUS, p.focus)) throw new Error("Bad focus");
    c.focus = p.focus;
  }
  if (p.focusOrder !== undefined) {
    if (p.focusOrder !== null && !Number.isFinite(p.focusOrder)) throw new Error("Bad order");
    c.focusOrder = p.focusOrder;
  }
  if (p.noise !== undefined) c.noise = Boolean(p.noise);
  for (const k of ["idleSince", "idleReminder"] as const) {
    if (p[k] !== undefined) {
      if (p[k] !== null && !isISO(p[k])) throw new Error(`Bad ${k}`);
      c[k] = p[k];
    }
  }
  if (p.idleMinutes !== undefined) {
    if (!Number.isFinite(p.idleMinutes) || p.idleMinutes < 0) throw new Error("Bad idle minutes");
    c.idleMinutes = Math.round(p.idleMinutes);
  }
  if (p.idleLog !== undefined) {
    if (typeof p.idleLog !== "string") throw new Error("Bad idle log");
    c.idleLog = p.idleLog.slice(-2000);
  }
  if (p.doneAt !== undefined) {
    if (p.doneAt !== null && !isISO(p.doneAt)) throw new Error("Bad done time");
    c.doneAt = p.doneAt;
  }
  if (p.doneAs !== undefined) {
    if (p.doneAs !== null && !oneOf(["Signal", "Noise"], p.doneAs)) throw new Error("Bad done as");
    c.doneAs = p.doneAs;
  }
  return c;
}

function cleanNew(t: NewTask): NewTask {
  if (!ID.test(t.tempId)) throw new Error("Bad temp id");
  if (!oneOf(LEVELS, t.level)) throw new Error("Bad level");
  if (t.parentId && !ID.test(t.parentId)) throw new Error("Bad parent");
  if ((t.departmentIds ?? []).some((d) => !ID.test(d))) throw new Error("Bad department");
  const p = cleanPatch({
    name: t.name,
    focus: t.focus ?? null,
    focusOrder: t.focusOrder ?? null,
    noise: t.noise ?? false,
    due: t.due ?? null,
    priority: t.priority ?? null,
  });
  return { ...t, ...p, name: p.name! } as NewTask;
}

// Applies a batch of edits and new tasks, in order. Returns real ids for new tasks.
// Errors come back as values: production hides thrown messages from the browser.
export async function applyChanges(changes: Change[], creates: NewTask[] = []): Promise<SaveResult> {
  try {
    const res = await writeChanges(changes, creates);
    return res.errors.length
      ? { ok: false, error: res.errors[0], created: res.created, warnings: res.warnings }
      : { ok: true, created: res.created, warnings: res.warnings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), created: [], warnings: [] };
  } finally {
    updateTag(BOARD_TAG); // refresh the board whatever happened
  }
}

export type SaveResult = {
  ok: boolean;
  error?: string;
  created: { tempId: string; id: string }[];
  warnings: string[];
};

const MAX_CHANGES = 150; // marking a project done touches everything under it

async function writeChanges(changes: Change[], creates: NewTask[]) {
  if (changes.length + creates.length > MAX_CHANGES) throw new Error("Too many changes at once");
  const cleanChanges = changes.map((c) => {
    if (!ID.test(c.id)) throw new Error("Bad id");
    return { id: c.id, patch: cleanPatch(c.patch) };
  });
  const cleanCreates = creates.map(cleanNew);

  const created: { tempId: string; id: string }[] = [];
  const sprintId = cleanCreates.length ? await getCurrentSprintId() : null;
  for (const t of cleanCreates) {
    const id = USE_MOCK ? mockCreate(t) : await createTaskInNotion(t, sprintId);
    created.push({ tempId: t.tempId, id });
  }
  // Sequential to stay under Notion's ~3 requests/second. One failure doesn't stop the rest.
  const errors: string[] = [];
  const warnings = new Set<string>();
  for (const c of cleanChanges) {
    if (!Object.keys(c.patch).length) continue;
    try {
      if (USE_MOCK) mockUpdate(c.id, c.patch);
      else {
        const warning = await updateTaskInNotion(c.id, c.patch);
        if (warning) warnings.add(warning);
      }
    } catch (err) {
      console.error("save failed", c.id, err);
      errors.push(saveErrorMessage(err));
    }
  }
  return { created, errors, warnings: [...warnings] };
}

function saveErrorMessage(err: unknown) {
  const code = (err as { code?: string }).code;
  if (code === "object_not_found" || code === "restricted_resource")
    return "Notion wouldn't let the site edit that task. Check the board is shared with your integration.";
  if (code === "rate_limited") return "Notion is busy (rate limit). Try again in a few seconds.";
  if (code === "validation_error") return `Notion rejected the change: ${err instanceof Error ? err.message : ""}`;
  return `Couldn't save to Notion: ${err instanceof Error ? err.message : String(err)}`;
}

// ---- Sign in / sign out (the workday, not the website login) -----------------------------

/** Start the day: apply the plan, then open (or reopen) today's row in Mission Control Days. */
export async function signIn(changes: Change[], creates: NewTask[], order: string[]) {
  if (order.length > 60 || order.some((id) => !ID.test(id))) throw new Error("Bad plan");
  const { created, errors } = await writeChanges(changes, creates);
  if (errors.length) throw new Error(errors[0]);
  const realId = new Map(created.map((c) => [c.tempId, c.id]));
  const plannedIds = order.map((id) => realId.get(id) ?? id).filter((id) => !id.startsWith("tmp-"));

  const today = todayInZone();
  const existing = (await getHistory(1)).find((d) => d.date === today);
  const now = new Date().toISOString();
  if (existing) {
    const patch = { signedOut: null, plannedIds, ...(existing.signedIn ? {} : { signedIn: now }) };
    if (USE_MOCK) mockUpdateDay(existing.id, patch);
    else await updateDay(existing.id, patch);
  } else if (USE_MOCK) mockCreateDay(today, now, plannedIds);
  else await createDay(today, now, plannedIds);

  updateTag(BOARD_TAG);
  return { ok: true };
}

/** End the day: save the stats and notes; optionally send unfinished planned work back to the to-do list. */
export async function signOut(dayId: string, stats: DayStats, notes: string, returnIds: string[]) {
  if (!ID.test(dayId) || returnIds.some((id) => !ID.test(id))) throw new Error("Bad id");
  const nums = ["planned", "done", "signalDone", "noiseDone", "plannedDone", "carriedOver", "idleMinutes"] as const;
  for (const k of nums) if (!Number.isFinite(stats[k]) || stats[k] < 0) throw new Error(`Bad ${k}`);
  if (stats.doneIds.some((id) => !ID.test(id))) throw new Error("Bad done id");
  if (typeof notes !== "string" || notes.length > 2000) throw new Error("Bad notes");

  if (returnIds.length) {
    const { errors } = await writeChanges(returnIds.map((id) => ({ id, patch: { focus: null, focusOrder: null } })), []);
    if (errors.length) throw new Error(errors[0]);
  }
  const patch = { ...stats, notes, signedOut: new Date().toISOString() };
  if (USE_MOCK) mockUpdateDay(dayId, patch);
  else await updateDay(dayId, patch);
  updateTag(BOARD_TAG);
  return { ok: true };
}

export async function login(_: unknown, form: FormData) {
  const creds = adminCredentials();
  if (!creds) return { error: "Login isn't set up yet: add ADMIN_EMAIL and ADMIN_PASSWORD in Vercel." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ok = (await safeEqual(email, creds.email)) && (await safeEqual(password, creds.password));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 900)); // slow down guessing
    return { error: "That email and password don't match.", email };
  }
  (await cookies()).set(AUTH_COOKIE, await sessionToken(creds.email, creds.password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/login");
}
