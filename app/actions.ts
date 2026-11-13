"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { AUTH_COOKIE, adminCredentials, safeEqual, sessionToken } from "@/lib/auth";
import { getCurrentSprintId, getHistory, todayInZone } from "@/lib/board";
import { ALL_STATUSES, BOARD_TAG, FOCUS, LEVELS, PRIORITIES, USE_MOCK } from "@/lib/config";
import { DAY_LOOKBACK, PUSH_MIN, workingDay } from "@/lib/days";
import { saveDelegation } from "@/lib/delegation";
import { mockCreate, mockCreateDay, mockUpdate, mockUpdateDay } from "@/lib/mock";
import { setWorkingUntil } from "@/lib/overtime";
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
  if (p.missedOn !== undefined) {
    if (p.missedOn !== null && !DAY.test(p.missedOn)) throw new Error("Bad missed date");
    c.missedOn = p.missedOn;
  }
  if (p.delegatedAt !== undefined) {
    if (p.delegatedAt !== null && !isISO(p.delegatedAt)) throw new Error("Bad delegated time");
    c.delegatedAt = p.delegatedAt;
  }
  if (p.expectBy !== undefined) {
    if (p.expectBy !== null && !DAY.test(p.expectBy) && !isISO(p.expectBy)) throw new Error("Bad expected date");
    c.expectBy = p.expectBy;
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
  // A new item may sit under another one created in the same batch (a pop-up that became a
  // mission with tasks): parents come first, so swap their temp id for the real one.
  const realId = new Map<string, string>();
  for (const draft of cleanCreates) {
    const t = draft.parentId?.startsWith("tmp-") ? { ...draft, parentId: realId.get(draft.parentId) ?? null } : draft;
    const id = USE_MOCK ? mockCreate(t) : await createTaskInNotion(t, sprintId);
    realId.set(t.tempId, id);
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
        // Delegation lives in the database, everything else in Notion.
        const { delegatedAt, expectBy, ...rest } = c.patch;
        if (delegatedAt !== undefined || expectBy !== undefined) {
          try {
            await saveDelegation(c.id, { delegatedAt, expectBy });
          } catch (err) {
            console.error("saving a delegation failed", c.id, err);
            errors.push(`Couldn't save the delegated switch: ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }
        }
        if (Object.keys(rest).length) {
          const warning = await updateTaskInNotion(c.id, rest);
          if (warning) warnings.add(warning);
        }
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
  const history = await getHistory(DAY_LOOKBACK);
  const existing = history.find((d) => d.date === today);
  const now = new Date().toISOString();
  // An earlier day that was never ended is over once a new one starts.
  for (const d of history) {
    if (d.date >= today || !d.signedIn || d.signedOut) continue;
    if (USE_MOCK) mockUpdateDay(d.id, { signedOut: now });
    else await updateDay(d.id, { signedOut: now });
  }
  if (existing) {
    const patch = { signedOut: null, plannedIds, ...(existing.signedIn ? {} : { signedIn: now }) };
    if (USE_MOCK) mockUpdateDay(existing.id, patch);
    else await updateDay(existing.id, patch);
  } else if (USE_MOCK) mockCreateDay(today, now, plannedIds);
  else await createDay(today, now, plannedIds);

  updateTag(BOARD_TAG);
  return { ok: true };
}

/** Work landed in a lane without "Start your day" (dragged in, or added after the day was
 *  ended): open the day's row so the day has a start time and the midnight check knows its date. */
export async function openDay() {
  const today = todayInZone();
  const day = workingDay(await getHistory(DAY_LOOKBACK), today);
  const now = new Date().toISOString();
  if (!day) {
    if (USE_MOCK) mockCreateDay(today, now, []);
    else await createDay(today, now, []);
  } else if (day.signedOut || !day.signedIn) {
    const patch = { signedOut: null, ...(day.signedIn ? {} : { signedIn: now }) };
    if (USE_MOCK) mockUpdateDay(day.id, patch);
    else await updateDay(day.id, patch);
  } else return { ok: true };
  updateTag(BOARD_TAG);
  return { ok: true };
}

/** End the day: save the stats and notes, and flush today's lanes. Unfinished work goes back to
 *  the to-do list marked with the day it was missed. `dropIds` (noise that was being worked on)
 *  leave their lane too, but were never planned, so they aren't marked as missed.
 *  `idleLogs` closes the idle periods that were still open (minutes and log line only).
 *  `dayId` is null when the day has no row yet; `endedAt` is set when the midnight check ended
 *  the day (the moment the 15 minutes ran out, which can be well before this call). */
export async function signOut(
  dayId: string | null,
  stats: DayStats,
  notes: string,
  returnIds: string[],
  dropIds: string[] = [],
  endedAt?: string,
  idleLogs: Change[] = [],
) {
  if ((dayId !== null && !ID.test(dayId)) || [...returnIds, ...dropIds].some((id) => !ID.test(id))) throw new Error("Bad id");
  const nums = ["planned", "done", "signalDone", "noiseDone", "plannedDone", "carriedOver", "idleMinutes"] as const;
  for (const k of nums) if (!Number.isFinite(stats[k]) || stats[k] < 0) throw new Error(`Bad ${k}`);
  if (stats.doneIds.some((id) => !ID.test(id))) throw new Error("Bad done id");
  if (typeof notes !== "string" || notes.length > 2000) throw new Error("Bad notes");
  if (endedAt !== undefined && !isISO(endedAt)) throw new Error("Bad end time");
  // Only tasks being flushed, and only their idle minutes and log.
  const leaving = new Set([...returnIds, ...dropIds]);
  const logOf = new Map(
    idleLogs
      .filter((c) => leaving.has(c.id))
      .map((c) => [c.id, cleanPatch({ idleMinutes: c.patch.idleMinutes, idleLog: c.patch.idleLog })] as const),
  );

  const today = todayInZone();
  const history = await getHistory(DAY_LOOKBACK).catch(() => []);
  const row = dayId ? history.find((d) => d.id === dayId) : workingDay(history, today);

  if (returnIds.length || dropIds.length) {
    const missedOn = row?.date ?? today;
    const { errors } = await writeChanges(
      [
        ...returnIds.map((id) => ({ id, patch: { ...FLUSH, ...logOf.get(id), missedOn } })),
        ...dropIds.map((id) => ({ id, patch: { ...FLUSH, ...logOf.get(id) } })),
      ],
      [],
    );
    if (errors.length) throw new Error(errors[0]);
  }
  const now = new Date().toISOString();
  let id = dayId ?? row?.id ?? null;
  if (!id) id = USE_MOCK ? mockCreateDay(today, now, []) : await createDay(today, now, []);
  const signedOut = endedAt && Date.parse(endedAt) <= Date.now() ? new Date(endedAt).toISOString() : now;
  const patch = { ...stats, notes, signedOut };
  if (USE_MOCK) mockUpdateDay(id, patch);
  else await updateDay(id, patch);
  updateTag(BOARD_TAG);
  return { ok: true };
}

/** "I'm still working", past midnight: don't ask again (or end the day) before `until`. */
export async function stillWorking(dayId: string, until: string) {
  if (!ID.test(dayId) || !isISO(until)) throw new Error("Bad request");
  const at = Date.parse(until);
  if (at < Date.now() - 60_000 || at > Date.now() + (PUSH_MIN + 5) * 60_000) throw new Error("Bad time");
  const day = (await getHistory(DAY_LOOKBACK)).find((d) => d.id === dayId);
  if (!day) throw new Error("Day not found");
  const saved = await setWorkingUntil(day.date, new Date(at).toISOString());
  updateTag(BOARD_TAG);
  return { ok: saved };
}

const FLUSH = { focus: null, focusOrder: null, idleSince: null, idleReminder: null } as const;

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
