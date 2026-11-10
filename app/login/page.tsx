"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, Lock, Mail, Zap } from "lucide-react";
import { login } from "@/app/actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, null);
  const [show, setShow] = useState(false);

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary shadow-[0_10px_40px_-6px_rgb(24_86_255/0.9)]">
            <Zap className="size-7 text-white" />
          </span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-ink">Mission Control</h1>
          <p className="mt-1.5 text-sm text-ink-3">Signal over noise. Log in to continue.</p>
        </div>

        <form action={action} className="space-y-4 rounded-[28px] p-6 glass-strong">
          <label className="block">
            <span className="text-xs font-semibold text-ink-2">Email</span>
            <span className="relative mt-1.5 block">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                defaultValue={state?.email ?? ""}
                placeholder="you@company.com"
                className="h-12 w-full rounded-2xl bg-white/5 pl-10 pr-3 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/12 focus:ring-primary-hi"
              />
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-ink-2">Password</span>
            <span className="relative mt-1.5 block">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input
                name="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="••••••••"
                className="h-12 w-full rounded-2xl bg-white/5 pl-10 pr-11 text-sm text-ink placeholder:text-ink-3 ring-1 ring-white/12 focus:ring-primary-hi"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:text-ink"
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </span>
          </label>

          {state?.error && (
            <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-hi">
              {state.error}
            </p>
          )}

          <button
            disabled={pending}
            className="h-12 w-full rounded-2xl bg-primary text-sm font-semibold text-white shadow-[0_10px_34px_-8px_rgb(24_86_255/0.9)] hover:bg-primary-hi disabled:opacity-50"
          >
            {pending ? "Logging in…" : "Log in"}
          </button>
        </form>
      </div>
    </main>
  );
}
