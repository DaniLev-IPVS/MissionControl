import { connection } from "next/server";
import { z } from "zod";
import { getBoard } from "@/lib/board";
import { aiMode, generateJSON } from "@/lib/ai";
import { companyForPrompt } from "@/lib/company";
import { LEVELS, LEVEL_LABELS, type Level } from "@/lib/config";
import type { PopupItem, Task } from "@/lib/types";

// Turns whatever was typed or dictated into the top bar into clean board items. Sonnet pulls
// out each distinct thing that came up, names it as a short action, and files it under the
// mission or project it belongs to (or a new one, when several things share a goal with no
// home yet). The server reads the board itself, so the model only picks from real items, by
// alias. Nothing is written here: the browser creates the items as noise.

const MAX_TEXT = 4000;
const MAX_ITEMS = 12;
const RANK: Record<Level, number> = { project: 3, mission: 2, task: 1 };

const Extracted = z.object({
  items: z.array(
    z.object({
      key: z.string().describe("n1, n2, n3… in the order listed"),
      name: z.string().describe("Short, clean name: an action for a task, an outcome for a mission or project"),
      level: z.enum(LEVELS),
      parent: z
        .string()
        .nullable()
        .describe("Alias of an existing mission or project (h…), or the key of a new item listed earlier (n…), or null"),
      department: z.string().nullable().describe("Exact department name from the list, or null"),
      due: z.string().nullable().describe("YYYY-MM-DD, only when the text itself states a deadline; otherwise null"),
    }),
  ),
});

export async function POST(request: Request) {
  await connection();
  let name: unknown;
  try {
    ({ name } = await request.json());
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) return Response.json({ error: "Type something first." }, { status: 400 });
  const text = name.trim().slice(0, MAX_TEXT);

  const board = await getBoard().catch(() => null);
  if (!board) return Response.json({ items: [verbatim(text)] });

  // Homes an item can live under: open missions and projects.
  const homes = board.tasks.filter((t) => (t.level === "mission" || t.level === "project") && !t.id.startsWith("tmp-"));
  const deptName = new Map(board.departments.map((d) => [d.id, d.name]));
  const deptByName = new Map(board.departments.map((d) => [d.name.trim().toLowerCase(), d.id]));

  if (!aiMode()) return Response.json({ items: [keywordFiling(text, homes, board.departments, deptName)] });

  try {
    const alias = new Map(homes.map((t, i) => [`h${i + 1}`, t]));
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
      fast: true,
      effort: "low",
      schema: Extracted,
      system: `You sort a pop-up for Mission Control, a signal-over-noise focus board. The user typed or dictated whatever just came up in the middle of the workday. Turn it into clean board items. They are saved as noise (unplanned); you only decide what the items are and where they belong.
Today is ${new Date().toDateString()}.

Extract
- One item per distinct thing that needs doing. Most pop-ups hold one; a voice dump can hold several. Don't break one action into steps, and don't invent work that wasn't mentioned.
- Drop chatter that isn't an action ("the call went well"), unless it implies one.
- If nothing is clearly actionable, still return one task that captures it.

Name
- Never copy the text verbatim. Write a short, clean name of 3 to 10 words: a task starts with a verb ("Send Dana the signed NDA"); a mission or project names the outcome ("Launch the Influity creator program").
- Remove filler ("I need to", "also", "remind me", "um"), fix obvious dictation mistakes, keep the specifics: people, companies, amounts, dates.
- Write in the language the user wrote in.

Level (project > mission > task)
- task: a concrete action, one sitting.
- mission: a goal that takes several tasks.
- project: a large effort made of several missions. Only when the user clearly describes a new big initiative.

File
- Put each item under the existing mission (preferred) or project it clearly belongs to, by alias. A task can sit under a mission or a project; a mission only under a project; a project has no parent.
- Create a new mission only when two or more tasks in this pop-up share a goal that has no home on the board, or the user explicitly names a new goal. List it before its tasks and point the tasks at its key. Never wrap a single task in a new mission.
- If nothing clearly fits, parent is null: an unfiled item is better than one filed in the wrong place.
- department: the parent's department when there is a parent; otherwise the department it clearly belongs to, or null.
- due: only when the text states a deadline ("by Friday", "tomorrow"). Never guess one.

Departments: ${board.departments.map((d) => d.name).join(", ") || "none"}.

Open missions and projects (alias | level | name | department | parent):
${homes.map(line).join("\n") || "(none)"}${await companyForPrompt()}`,
      messages: [{ role: "user", content: `Pop-up:\n${text}` }],
    });

    // Check every answer against the board: real parents only, levels in order, parents first.
    const made = new Map<string, PopupItem>(); // model key -> accepted item
    const items: PopupItem[] = [];
    for (const raw of output.items.slice(0, MAX_ITEMS)) {
      const clean = raw.name.replace(/\s+/g, " ").trim().slice(0, 200);
      if (!clean || !LEVELS.includes(raw.level)) continue;
      const p = raw.parent?.trim() ?? "";
      const home = alias.get(p);
      const fresh = made.get(p);
      const homeOk = home?.level && RANK[home.level] > RANK[raw.level];
      const freshOk = fresh && RANK[fresh.level] > RANK[raw.level];
      const parentName = homeOk ? home!.name : freshOk ? fresh!.name : null;
      const parentDepts = homeOk ? home!.departmentIds : freshOk ? fresh!.departmentIds : [];
      const deptId = raw.department ? deptByName.get(raw.department.trim().toLowerCase()) : undefined;
      const departmentIds = deptId ? [deptId] : parentDepts.slice(0, 1);
      const item: PopupItem = {
        key: `n${items.length + 1}`,
        name: clean,
        level: raw.level,
        parentId: homeOk ? home!.id : null,
        parentKey: freshOk ? fresh!.key : null,
        departmentIds,
        due: raw.due && /^\d{4}-\d{2}-\d{2}$/.test(raw.due) ? raw.due : null,
        where: [departmentIds[0] ? deptName.get(departmentIds[0]) : null, parentName].filter(Boolean).join(" › "),
      };
      if (raw.key) made.set(raw.key.trim(), item);
      items.push(item);
    }
    if (!items.length) return Response.json({ items: [keywordFiling(text, homes, board.departments, deptName)] });
    return Response.json({ items });
  } catch (err) {
    // Still added: as typed, filed by shared words.
    console.error("sorting a pop-up failed", err);
    return Response.json({ items: [keywordFiling(text, homes, board.departments, deptName)] });
  }
}

function verbatim(text: string): PopupItem {
  return {
    key: "n1",
    name: text.replace(/\s+/g, " ").slice(0, 200),
    level: "task",
    parentId: null,
    parentKey: null,
    departmentIds: [],
    due: null,
    where: "",
  };
}

/** No AI (local development, or the call failed): one task as typed, filed by shared words. */
function keywordFiling(
  text: string,
  homes: Task[],
  departments: { id: string; name: string }[],
  deptName: Map<string, string>,
): PopupItem {
  const words = new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const score = (name: string) => (name.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => words.has(w)).length;
  const best = homes
    .map((t) => ({ t, n: score(t.name) }))
    .filter((x) => x.n > 0)
    // More shared words first; a mission beats its project on a tie.
    .sort((a, b) => b.n - a.n || Number(b.t.level === "mission") - Number(a.t.level === "mission"))[0]?.t;
  const dept = best ? null : departments.find((d) => score(d.name) > 0);
  const departmentIds = best ? best.departmentIds.slice(0, 1) : dept ? [dept.id] : [];
  return {
    ...verbatim(text),
    parentId: best?.id ?? null,
    departmentIds,
    where: [departmentIds[0] ? deptName.get(departmentIds[0]) : null, best?.name].filter(Boolean).join(" › "),
  };
}
