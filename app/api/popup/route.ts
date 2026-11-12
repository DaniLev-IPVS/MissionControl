import { connection } from "next/server";
import { z } from "zod";
import { getBoard } from "@/lib/board";
import { aiMode, generateJSON } from "@/lib/ai";
import { companyForPrompt } from "@/lib/company";
import { LEVEL_LABELS } from "@/lib/config";
import type { PopupFiling, Task } from "@/lib/types";

// Files a pop-up typed into the top bar: which mission or project it belongs under, and
// which department. The server reads the board itself, so the model only ever picks from
// real items, by alias. Nothing is written here: the browser creates the task as noise.

const Filing = z.object({
  parent: z.string().nullable().describe("Alias of the mission or project this belongs under, or null"),
  department: z.string().nullable().describe("Exact department name from the list, or null"),
  due: z.string().nullable().describe("YYYY-MM-DD, only when the text itself states a deadline; otherwise null"),
});

const UNFILED: PopupFiling = { parentId: null, departmentIds: [], due: null, where: "" };

export async function POST(request: Request) {
  await connection();
  let name: unknown;
  try {
    ({ name } = await request.json());
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) return Response.json({ error: "Type a task first." }, { status: 400 });
  const text = name.trim().slice(0, 500);

  try {
    const board = await getBoard();
    // Homes a task can live under: open missions and projects.
    const homes = board.tasks.filter((t) => (t.level === "mission" || t.level === "project") && !t.id.startsWith("tmp-"));
    const byId = new Map(board.tasks.map((t) => [t.id, t]));
    const deptName = new Map(board.departments.map((d) => [d.id, d.name]));
    const deptByName = new Map(board.departments.map((d) => [d.name.trim().toLowerCase(), d.id]));

    const answer = (parentId: string | null, deptId: string | null, due: string | null): PopupFiling => {
      const parent = parentId ? byId.get(parentId) : undefined;
      const departmentIds = deptId ? [deptId] : (parent?.departmentIds.slice(0, 1) ?? []);
      const where = [departmentIds[0] ? deptName.get(departmentIds[0]) : null, parent?.name].filter(Boolean).join(" › ");
      return { parentId: parent?.id ?? null, departmentIds, due: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null, where };
    };

    if (!aiMode()) return Response.json(keywordFiling(text, homes, board.departments, answer));

    const alias = new Map(homes.map((t, i) => [`h${i + 1}`, t.id]));
    const aliasOf = new Map(homes.map((t, i) => [t.id, `h${i + 1}`]));
    const line = (t: Task) =>
      [
        aliasOf.get(t.id),
        t.level ? LEVEL_LABELS[t.level] : "",
        t.name,
        t.departmentIds.map((d) => deptName.get(d)).filter(Boolean).join(", ") || "no department",
        t.parentId && aliasOf.has(t.parentId) ? `in ${aliasOf.get(t.parentId)}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

    const output = await generateJSON({
      effort: "low",
      schema: Filing,
      system: `You file a pop-up: a task that just came up in the middle of the user's workday in Mission Control, a signal-over-noise focus board. It is saved as noise; your only job is to say where it belongs.
Today is ${new Date().toDateString()}.

- parent: the one mission (preferred) or project the task is clearly part of. If nothing clearly fits, use null: an unfiled pop-up is better than one filed in the wrong place.
- department: the department it belongs to. Use the parent's department when you picked a parent. Null if unclear.
- due: only when the text states a deadline ("by Friday", "tomorrow"). Never guess one.

Departments: ${board.departments.map((d) => d.name).join(", ") || "none"}.

Open missions and projects (alias | level | name | department | parent):
${homes.map(line).join("\n") || "(none)"}${await companyForPrompt()}`,
      messages: [{ role: "user", content: `Pop-up task: ${text}` }],
    });

    const parentId = output.parent ? (alias.get(output.parent.trim()) ?? null) : null;
    const deptId = output.department ? (deptByName.get(output.department.trim().toLowerCase()) ?? null) : null;
    return Response.json(answer(parentId, deptId, output.due));
  } catch (err) {
    // The task still gets added: it just lands in Noise without a home.
    console.error("filing a pop-up failed", err);
    return Response.json(UNFILED);
  }
}

/** No AI configured (local development): file by shared words with mission and department names. */
function keywordFiling(
  text: string,
  homes: Task[],
  departments: { id: string; name: string }[],
  answer: (parentId: string | null, deptId: string | null, due: string | null) => PopupFiling,
): PopupFiling {
  const words = new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const score = (name: string) => (name.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => words.has(w)).length;
  const best = homes
    .map((t) => ({ t, n: score(t.name) }))
    .filter((x) => x.n > 0)
    // More shared words first; a mission beats its project on a tie.
    .sort((a, b) => b.n - a.n || Number(b.t.level === "mission") - Number(a.t.level === "mission"))[0]?.t;
  const dept = best ? null : departments.find((d) => score(d.name) > 0);
  return answer(best?.id ?? null, dept?.id ?? null, null);
}
