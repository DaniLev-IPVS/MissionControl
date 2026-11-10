"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateTask } from "@/app/actions";
import type { Board, Task, TaskPatch } from "./types";

// Live sync between the browser and Notion. UI-agnostic: any view can use it.
//
//   Notion -> browser: polls /api/board every 2s (304 when nothing changed).
//                      The server cache is expired by the Notion webhook, so
//                      edits in Notion show up as soon as Notion sends the event.
//   browser -> Notion: edit() applies the change instantly (optimistic), saves it
//                      to Notion via a server action, and reverts on failure.

const POLL_MS = 2000;

type Pending = { patch: TaskPatch; doneSeq?: number };

export type SyncState = {
  board: Board | null;
  tasks: Task[]; // board tasks with unsaved edits applied
  error: string | null; // last poll error
  saveError: string | null; // last failed save
  lastSync: number | null; // ms timestamp of last successful poll
  saving: Set<string>; // task ids with a save in flight
  sprintId: string | null;
  setSprint: (id: string) => void;
  edit: (task: Task, patch: TaskPatch) => Promise<void>;
  refresh: () => void;
};

export function useBoard(initialSprintId: string | null = null): SyncState {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [sprintId, setSprintId] = useState<string | null>(initialSprintId);
  const [pending, setPending] = useState<Map<string, Pending>>(new Map());

  const router = useRouter();
  const etag = useRef<string | null>(null);
  const seq = useRef(0);
  const sprintRef = useRef<string | null>(initialSprintId);

  const poll = useCallback(async () => {
    const mySeq = ++seq.current;
    const sprint = sprintRef.current;
    try {
      const res = await fetch(`/api/board${sprint ? `?sprint=${encodeURIComponent(sprint)}` : ""}`, {
        cache: "no-store",
        headers: etag.current ? { "If-None-Match": etag.current } : {},
      });
      if (sprint !== sprintRef.current) return; // sprint switched mid-flight
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (res.status !== 304) {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        etag.current = res.headers.get("ETag");
        setBoard(data as Board);
      }
      setError(null);
      setLastSync(Date.now());
      // Drop optimistic edits once a poll that started after the save returns.
      setPending((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, p] of next) {
          if (p.doneSeq !== undefined && mySeq > p.doneSeq) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    }
  }, [router]);

  useEffect(() => {
    poll();
    const id = setInterval(() => document.visibilityState === "visible" && poll(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [poll]);

  const setSprint = useCallback(
    (id: string) => {
      sprintRef.current = id;
      etag.current = null;
      setSprintId(id);
      setBoard(null);
      poll();
    },
    [poll],
  );

  const edit = useCallback(
    async (task: Task, patch: TaskPatch) => {
      setPending((prev) => {
        const next = new Map(prev);
        next.set(task.id, { patch: { ...prev.get(task.id)?.patch, ...patch } });
        return next;
      });
      try {
        await updateTask(task.id, patch);
        setPending((prev) => {
          const p = prev.get(task.id);
          if (!p) return prev;
          const next = new Map(prev);
          next.set(task.id, { ...p, doneSeq: seq.current });
          return next;
        });
        setSaveError(null);
        poll();
      } catch {
        setPending((prev) => {
          const next = new Map(prev);
          next.delete(task.id);
          return next;
        });
        setSaveError(`Couldn't save "${task.name}" to Notion. Reverted.`);
      }
    },
    [poll],
  );

  const tasks = useMemo(() => {
    if (!board) return [];
    return board.tasks.map((t) => {
      const p = pending.get(t.id);
      return p ? { ...t, ...p.patch } : t;
    });
  }, [board, pending]);

  const saving = useMemo(
    () => new Set([...pending].filter(([, p]) => p.doneSeq === undefined).map(([id]) => id)),
    [pending],
  );

  return { board, tasks, error, saveError, lastSync, saving, sprintId, setSprint, edit, refresh: poll };
}
