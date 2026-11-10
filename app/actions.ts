"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { AUTH_COOKIE, authToken } from "@/lib/auth";
import { getCurrentSprintId } from "@/lib/board";
import { ALL_STATUSES, BOARD_TAG, FOCUS, LEVELS, PRIORITIES, USE_MOCK } from "@/lib/config";
import { mockCreate, mockUpdate } from "@/lib/mock";
import { createTaskInNotion, updateTaskInNotion } from "@/lib/notion";
import type { Change, NewTask, TaskPatch } from "@/lib/types";

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
export async function applyChanges(changes: Change[], creates: NewTask[] = []) {
  if (changes.length + creates.length > 40) throw new Error("Too many changes at once");
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
  // Sequential to stay under Notion's ~3 requests/second.
  for (const c of cleanChanges) {
    if (!Object.keys(c.patch).length) continue;
    if (USE_MOCK) mockUpdate(c.id, c.patch);
    else await updateTaskInNotion(c.id, c.patch);
  }

  // Read-your-own-writes: the next poll from any viewer gets fresh data.
  updateTag(BOARD_TAG);
  return { ok: true, created };
}

export async function login(_: unknown, form: FormData) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return { error: "SITE_PASSWORD is not set on the server." };
  if (form.get("password") !== password) return { error: "Wrong password." };
  (await cookies()).set(AUTH_COOKIE, await authToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}
