"use client";

// Plumbing check only — deliberately unstyled. Replace with the real UI
// (from the wireframe) using the useBoard() hook.
import { useEffect, useState } from "react";
import { ALL_STATUSES } from "@/lib/config";
import { useBoard } from "@/lib/useBoard";

export default function DebugPage() {
  const { board, tasks, error, saveError, lastSync, saving, setSprint, edit } = useBoard();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: "monospace", fontSize: 13 }}>
      <p>
        sync: {error ? `ERROR ${error}` : lastSync && now ? `ok, ${Math.max(0, Math.round((now - lastSync) / 1000))}s ago` : "connecting"}
        {" | "}saving: {saving.size}
        {saveError && ` | ${saveError}`}
      </p>
      {board && (
        <p>
          sprint:{" "}
          <select value={board.sprint?.id ?? ""} onChange={(e) => setSprint(e.target.value)}>
            {board.sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.status ? `(${s.status})` : ""}
              </option>
            ))}
          </select>{" "}
          tasks: {tasks.length}
        </p>
      )}
      <table>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} data-task={t.id}>
              <td>
                <select value={t.status ?? ""} onChange={(e) => edit(t, { status: e.target.value })}>
                  {ALL_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </td>
              <td>{t.priority ?? "-"}</td>
              <td>{t.due ?? "-"}</td>
              <td>{t.name}</td>
              <td>{t.parentId ? board?.titles[t.parentId] : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
