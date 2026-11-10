"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { AUTH_COOKIE, authToken } from "@/lib/auth";
import { ALL_STATUSES, BOARD_TAG, PRIORITIES, USE_MOCK } from "@/lib/config";
import { mockUpdate } from "@/lib/mock";
import { updateTaskInNotion } from "@/lib/notion";
import type { TaskPatch } from "@/lib/types";

export async function updateTask(id: string, patch: TaskPatch) {
  // Server actions are reachable by POST, so validate everything.
  const clean: TaskPatch = {};
  if (patch.status !== undefined) {
    if (!(ALL_STATUSES as readonly string[]).includes(patch.status)) throw new Error("Bad status");
    clean.status = patch.status;
  }
  if (patch.priority !== undefined) {
    if (patch.priority !== null && !(PRIORITIES as readonly string[]).includes(patch.priority))
      throw new Error("Bad priority");
    clean.priority = patch.priority;
  }
  if (patch.due !== undefined) {
    if (patch.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due)) throw new Error("Bad date");
    clean.due = patch.due;
  }
  if (!/^[\w-]{1,64}$/.test(id)) throw new Error("Bad id");

  if (USE_MOCK) mockUpdate(id, clean);
  else await updateTaskInNotion(id, clean);

  // Read-your-own-writes: the next poll from any viewer gets fresh data.
  updateTag(BOARD_TAG);
  return { ok: true };
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
