"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { applyChanges } from "@/app/actions";
import { applyLocal, draftTask, type Plan } from "./flow";
import type { Board, Task, TaskPatch } from "./types";

// Live sync between the browser and Notion. UI-agnostic.
//
//   Notion -> browser: polls /api/board every 2s (304 when nothing changed).
//                      The server cache is expired by the Notion webhook.
//   browser -> Notion: apply(plan) shows the result instantly (optimistic),
//                      saves it via a server action, and reverts on failure.

const POLL_MS = 2000;

type Pending = { patch: TaskPatch; doneSeq?: number };
type Temp = { task: Task; doneSeq?: number };

export function useBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [pending, setPending] = useState<Map<string, Pending>>(new Map());
  const [temps, setTemps] = useState<Map<string, Temp>>(new Map());
  const [inFlight, setInFlight] = useState(0);

  const router = useRouter();
  const etag = useRef<string | null>(null);
  const seq = useRef(0);

  const poll = useCallback(async () => {
    const mySeq = ++seq.current;
    try {
      const res = await fetch("/api/board", {
        cache: "no-store",
        headers: etag.current ? { "If-None-Match": etag.current } : {},
      });
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
      // Drop optimistic state once a poll that started after the save returns.
      const settled = <T extends { doneSeq?: number }>(prev: Map<string, T>) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, p] of next) {
          if (p.doneSeq !== undefined && mySeq > p.doneSeq) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      };
      setPending(settled);
      setTemps(settled);
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

  const apply = useCallback(
    async ({ changes, creates }: Plan) => {
      if (!changes.length && !creates.length) return;
      const ids = changes.map((c) => c.id);
      const tempIds = creates.map((c) => c.tempId);
      setPending((prev) => {
        const next = new Map(prev);
        for (const c of changes) next.set(c.id, { patch: { ...prev.get(c.id)?.patch, ...c.patch } });
        return next;
      });
      setTemps((prev) => {
        const next = new Map(prev);
        for (const c of creates) next.set(c.tempId, { task: draftTask(c) });
        return next;
      });
      setInFlight((n) => n + 1);
      const markDone = <T extends { doneSeq?: number }>(keys: string[]) => (prev: Map<string, T>) => {
        const next = new Map(prev);
        for (const k of keys) {
          const p = next.get(k);
          if (p) next.set(k, { ...p, doneSeq: seq.current });
        }
        return next;
      };
      try {
        await applyChanges(changes, creates);
        setPending(markDone(ids));
        setTemps(markDone(tempIds));
        setSaveError(null);
        poll();
      } catch {
        const drop = <T,>(keys: string[]) => (prev: Map<string, T>) => {
          const next = new Map(prev);
          keys.forEach((k) => next.delete(k));
          return next;
        };
        setPending(drop(ids));
        setTemps(drop(tempIds));
        setSaveError("Couldn't save to Notion. Your last change was undone.");
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [poll],
  );

  const tasks = useMemo(() => {
    if (!board) return [];
    const merged = applyLocal(
      board.tasks,
      [...pending].map(([id, p]) => ({ id, patch: p.patch })),
    );
    const known = new Set(merged.map((t) => t.id));
    for (const [, t] of temps) if (!known.has(t.task.id)) merged.push(t.task);
    return merged;
  }, [board, pending, temps]);

  return {
    board,
    tasks,
    error,
    saveError,
    clearSaveError: () => setSaveError(null),
    lastSync,
    saving: inFlight > 0,
    apply,
    refresh: poll,
  };
}
