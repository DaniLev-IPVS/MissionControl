"use client";

import { useEffect, useState } from "react";
import { cx } from "./ui";

const RECOMMEND_WORDS = [
  "Reading your board",
  "Weighing deadlines",
  "Checking yesterday's picks",
  "Hunting for signal",
  "Muting the noise",
  "Lining up Main",
  "Sizing up your day",
];
const PLAN_WORDS = ["Listening", "Reshuffling the plan", "Finding the next step", "Checking the load", "Almost there"];

/** Bouncing orbs with a rotating caption, shown while the AI is thinking. */
export function Thinking({ kind = "recommend", className }: { kind?: "recommend" | "plan"; className?: string }) {
  const words = kind === "plan" ? PLAN_WORDS : RECOMMEND_WORDS;
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % words.length), 1400);
    return () => clearInterval(id);
  }, [words.length]);

  return (
    <div role="status" aria-live="polite" className={cx("flex items-center gap-4", className)}>
      <div className="relative flex h-10 items-end gap-1.5" aria-hidden>
        {["bg-primary", "bg-level-project", "bg-noise"].map((c, n) => (
          <span
            key={c}
            className={cx("mc-bounce size-3 rounded-full shadow-[0_0_14px_currentColor]", c)}
            style={{ animationDelay: `${n * 0.14}s` }}
          />
        ))}
        <span className="mc-shadow absolute -bottom-1 left-0 h-1 w-full rounded-full bg-white/10 blur-[2px]" />
      </div>
      <p key={i} className="mc-word text-sm font-semibold text-ink">
        {words[i]}
        <span className="mc-dots" />
      </p>
    </div>
  );
}
