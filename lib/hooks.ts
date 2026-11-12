"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { expectAt } from "./flow";
import type { Task } from "./types";

// ---- A shared 1-second clock ----------------------------------------------------
const listeners = new Set<() => void>();
let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
/** Current time in ms, ticking every second. 0 during server render. */
export function useNow() {
  return useSyncExternalStore(subscribe, () => now || Date.now(), () => 0);
}

export function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// ---- Voice dictation (Web Speech API) ------------------------------------------------
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Speak to type. onText receives the full transcript so far (final + live guess). */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = useSyncExternalStore(
    () => () => {},
    () => !!getRecognition(),
    () => false,
  );
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  }, [onText]);

  const stop = useCallback(() => rec.current?.stop(), []);
  const start = useCallback((prefix = "") => {
    const R = getRecognition();
    if (!R) return;
    setError(null);
    finalText.current = prefix ? `${prefix.trimEnd()} ` : "";
    const r = new R();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += res[0].transcript;
        else interim += res[0].transcript;
      }
      cb.current((finalText.current + interim).replace(/\s+/g, " ").trimStart());
    };
    r.onerror = (e) => setError(e.error === "not-allowed" ? "Microphone access was blocked." : e.error);
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  useEffect(() => () => rec.current?.stop(), []);
  return { supported, listening, error, start, stop };
}

// ---- Idle reminders ------------------------------------------------------------------------
const FIRED_KEY = "mc.firedReminders";
function fired(): Record<string, true> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function markFired(key: string) {
  try {
    const f = fired();
    f[key] = true;
    const keys = Object.keys(f);
    if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => delete f[k]);
    localStorage.setItem(FIRED_KEY, JSON.stringify(f));
  } catch {}
}

export function playChime() {
  try {
    const ctx = new AudioContext();
    [880, 1320, 1760].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.65);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {}
}

export function askNotificationPermission() {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

// Two kinds of reminder, one per task: an AI session to go back and check (idle, with a
// reminder time), or a follow-up on a delegated task once its answer is expected.
export const reminderKey = (t: Task) => (t.delegatedAt ? `${t.id}:d:${t.expectBy}` : `${t.id}:${t.idleReminder}`);
/** When the task's reminder is (or was) due, in ms. Null when it has none. */
export function reminderAt(t: Task): number | null {
  if (t.delegatedAt) return expectAt(t.expectBy);
  return t.idleSince && t.idleReminder ? Date.parse(t.idleReminder) : null;
}

/**
 * Tasks whose reminder time has passed (until dismissed). Rings once per
 * reminder: a chime, plus a system notification when permission was granted.
 */
export function useReminders(tasks: Task[]) {
  const nowMs = useNow();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const due = nowMs
    ? tasks.filter((t) => {
        const at = reminderAt(t);
        return at !== null && at <= nowMs && !dismissed.has(reminderKey(t));
      })
    : [];
  const dueKeys = due.map(reminderKey).join("|");

  useEffect(() => {
    if (!dueKeys) return;
    const f = fired();
    const fresh = due.filter((t) => !f[reminderKey(t)]);
    if (!fresh.length) return;
    for (const t of fresh) {
      markFired(reminderKey(t));
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(t.delegatedAt ? "Follow up: you delegated this" : "Check the session", { body: t.name, tag: t.id });
        } catch {}
      }
    }
    playChime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueKeys]);

  const dismiss = useCallback(
    (t: Task) => setDismissed((d) => new Set(d).add(reminderKey(t))),
    [],
  );
  // A reminder's due time is when it first rang: after a few minutes as a toast it moves to the bell.
  const dueAt = useCallback((t: Task) => reminderAt(t) ?? 0, []);
  return { due, dismiss, dueAt };
}
