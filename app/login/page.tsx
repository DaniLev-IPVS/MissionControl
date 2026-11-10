"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";

// Minimal password gate. Restyle with the rest of the UI.
export default function LoginPage() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <main style={{ padding: 16, fontFamily: "monospace" }}>
      <form action={action}>
        <input name="password" type="password" placeholder="Password" autoFocus required />{" "}
        <button disabled={pending}>Enter</button>
        {state?.error && <p>{state.error}</p>}
      </form>
    </main>
  );
}
