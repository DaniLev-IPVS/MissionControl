import { connection } from "next/server";
import { z } from "zod";
import { getBoard } from "@/lib/board";
import { aiMode, currentModel, generateJSON } from "@/lib/ai";
import { companyForPrompt } from "@/lib/company";
import { historyForPrompt, saveRecommendation, savePlan, type RecItem } from "@/lib/history";
import { DASHBOARD_SLOTS, LEVEL_LABELS, TODAY_TARGET } from "@/lib/config";
import type { NewTask, Task } from "@/lib/types";

// AI day planner. The client sends the conversation and its current draft order;
// the server reads the open tasks itself, so the model only ever sees real tasks,
// referenced by short aliases (t1, t2, …) it cannot get wrong.

type Msg = { role: "user" | "assistant"; content: string };

const Plan = z.object({
  reply: z.string().describe("One or two short, friendly sentences about what you planned and why."),
  order: z
    .array(z.string())
    .describe("Aliases in the order to work on them today. First = Main, next 3 = Task switch, rest = Today."),
  newTasks: z
    .array(
      z.object({
        alias: z.string().describe("n1, n2, …; also put it in `order` where it belongs"),
        name: z.string(),
        department: z.string().nullable().describe("Exact department name from the list, or null"),
        parent: z.string().nullable().describe("Alias of the parent mission/project, or null"),
      }),
    )
    .describe("Only tasks the user asked for that don't exist yet."),
});

const MAX_PLAN = 1 + DASHBOARD_SLOTS + TODAY_TARGET.max;

const Recommendation = z.object({
  reply: z.string().describe("One short sentence summing up the suggested day."),
  picks: z
    .array(
      z.object({
        alias: z.string().describe("Alias of an open task, mission or project"),
        why: z.string().describe("Why today, in 12 words or fewer"),
      }),
    )
    .describe("Best first. Mostly tasks; a mission or project only when the whole thing should move today."),
});

export async function POST(request: Request) {
  await connection();
  let body: {
    messages?: Msg[];
    draft?: string[];
    recommend?: boolean;
    source?: "planner" | "voice";
    plan?: string[]; // what was actually planned (Start my day / Save plan)
    haiku?: { kind: "plan" | "day"; items: string[]; note?: string };
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (body.recommend) return recommend();
  if (Array.isArray(body.plan)) return logPlan(body.plan);
  if (body.haiku) return haiku(body.haiku);

  const messages = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "Send a message first." }, { status: 400 });
  }

  const board = await getBoard();
  const tasks = board.tasks;
  const alias = new Map<string, string>(); // alias -> id
  const aliasOf = new Map<string, string>(); // id -> alias
  tasks.forEach((t, i) => {
    alias.set(`t${i + 1}`, t.id);
    aliasOf.set(t.id, `t${i + 1}`);
  });
  const deptName = new Map(board.departments.map((d) => [d.id, d.name]));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const draft = (body.draft ?? []).filter((id) => byId.has(id));

  const line = (t: Task) => {
    const parent = t.parentId ? byId.get(t.parentId) : undefined;
    return [
      aliasOf.get(t.id),
      t.level ? LEVEL_LABELS[t.level] : "Task",
      t.name,
      t.departmentIds.map((d) => deptName.get(d)).filter(Boolean).join(", ") || "no department",
      parent ? `in ${parent.level ? LEVEL_LABELS[parent.level] : ""} ${aliasOf.get(parent.id)} "${parent.name}"` : "",
      t.priority ?? "",
      t.due ? `due ${t.due}` : "",
      t.status ?? "",
      t.noise ? "pop-up" : "",
    ]
      .filter(Boolean)
      .join(" | ");
  };

  const [history, company] = aiMode()
    ? await Promise.all([historyForPrompt(new Set(tasks.map((t) => t.id))), companyForPrompt()])
    : ["", ""];
  const source = body.source === "voice" ? "voice" : "planner";
  const lastUser = messages[messages.length - 1].content;
  const asItems = (ids: string[], names: Map<string, string> = new Map()): RecItem[] =>
    ids.map((id) => {
      const t = byId.get(id);
      return { id, name: t?.name ?? names.get(id) ?? id, level: t?.level ?? null, board: t?.board ?? "personal" };
    });
  const system = `You plan the user's workday in Mission Control, a signal-over-noise focus board.
Today is ${new Date().toDateString()}.

How a day works:
- The plan is an ordered list. #1 is Main (worked on right now), #2-#${1 + DASHBOARD_SLOTS} are the Task switch (next in line, worked on while Main waits), the rest is Today.
- Aim for ${1 + DASHBOARD_SLOTS + TODAY_TARGET.min}-${MAX_PLAN} items in total. Never more than ${MAX_PLAN}.
- Prefer the lowest level that is actionable (a Task over its Mission, a Mission over its Project) unless the user names the bigger item.
- Put what the user says matters most first; then P0, then due soonest. Skip Blocked tasks unless asked.
- Keep the current draft unless the user asks to change it. Edit it the way they describe (add, remove, reorder).
- Only create a new task when the user clearly asks for something that is not in the list.

Departments: ${board.departments.map((d) => d.name).join(", ") || "none"}.

Open tasks (alias | level | name | department | parent | priority | due | status):
${tasks.map(line).join("\n")}

Current draft order: ${draft.map((id) => aliasOf.get(id)).join(", ") || "(empty)"}${company}${historyBlock(history)}`;

  if (!aiMode()) {
    const res = keywordFallback(lastUser, tasks, draft);
    await saveRecommendation({ source, prompt: lastUser, reply: res.reply, items: asItems(res.order), usedAI: false });
    return Response.json(res);
  }

  try {
    const output = await generateJSON({ system, messages, schema: Plan });

    const deptByName = new Map(board.departments.map((d) => [d.name.toLowerCase(), d.id]));
    const creates: NewTask[] = output.newTasks.slice(0, 10).map((n) => {
      const parentId = n.parent ? (alias.get(n.parent) ?? null) : null;
      const parent = parentId ? byId.get(parentId) : undefined;
      return {
        tempId: `tmp-ai-${n.alias.replace(/\W/g, "")}-${Date.now().toString(36)}`,
        name: n.name.slice(0, 300),
        level: "task",
        parentId,
        departmentIds: n.department
          ? [deptByName.get(n.department.toLowerCase())].filter(Boolean) as string[]
          : (parent?.departmentIds ?? []),
      };
    });
    const newAlias = new Map(output.newTasks.slice(0, 10).map((n, i) => [n.alias, creates[i].tempId]));
    const seen = new Set<string>();
    const order = output.order
      .map((a) => alias.get(a) ?? newAlias.get(a))
      .filter((id): id is string => !!id && !seen.has(id) && !!seen.add(id))
      .slice(0, MAX_PLAN);

    const newNames = new Map(creates.map((c) => [c.tempId, c.name]));
    await saveRecommendation({
      source,
      prompt: lastUser,
      reply: output.reply,
      items: asItems(order, newNames),
      model: currentModel(),
      usedAI: true,
    });
    return Response.json({ reply: output.reply, order, creates: creates.filter((c) => order.includes(c.tempId)) });
  } catch (err) {
    console.error("planner failed", err);
    return Response.json({ error: "The planner couldn't answer. Try again, or plan by dragging." }, { status: 502 });
  }
}

// ---- A haiku about the plan (morning) or the finished day (sign out) ----------------------
const Haiku = z.object({
  lines: z.array(z.string()).describe("Exactly three lines, 5-7-5 syllables"),
  insight: z.string().describe("One short, honest sentence of analysis behind the haiku"),
});

async function haiku(input: { kind: "plan" | "day"; items: string[]; note?: string }) {
  const kind = input.kind === "day" ? "day" : "plan";
  const items = (input.items ?? []).filter((x) => typeof x === "string").slice(0, 20).map((x) => x.slice(0, 160));
  const note = typeof input.note === "string" ? input.note.slice(0, 400) : "";
  const fallback = () =>
    Response.json(
      kind === "plan"
        ? {
            lines: [`${items.length} stones on the path`, "the first one sets the rhythm", "noise waits by the door"],
            insight: note || "Start with Main and let the rest wait their turn.",
          }
        : {
            lines: ["the lanes are empty", `${items.length} small fires put out today`, "tomorrow, fresh coals"],
            insight: note || "Logged and cleared. Unfinished work is back on the list.",
          },
    );
  if (!aiMode()) return fallback();
  try {
    const output = await generateJSON({
      effort: "low",
      system:
        "You write one haiku (5-7-5) about someone's workday, warm and a little wry, then one honest sentence of analysis. No emojis.",
      schema: Haiku,
      messages: [{ role: "user", content:
        kind === "plan"
          ? `Today's plan, in order:\n${items.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n${note ? `Load check: ${note}` : ""}`
          : `What got done today:\n${items.map((x) => `- ${x}`).join("\n") || "(nothing)"}\n${note ? `Stats: ${note}` : ""}` }],
    });
    return Response.json({ lines: output.lines.slice(0, 3), insight: output.insight });
  } catch (err) {
    console.error("haiku failed", err);
    return fallback();
  }
}

// ---- "Recommend me today's tasks" -------------------------------------------------------
type Pick = { id: string; why: string };
const PRIORITY: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

async function recommend() {
  const board = await getBoard();
  const tasks = board.tasks.filter((t) => !t.id.startsWith("tmp-"));
  const aliasOf = new Map(tasks.map((t, i) => [t.id, `t${i + 1}`]));
  const alias = new Map(tasks.map((t, i) => [`t${i + 1}`, t.id]));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const deptName = new Map(board.departments.map((d) => [d.id, d.name]));
  const hasKids = new Set(tasks.map((t) => t.parentId).filter(Boolean) as string[]);
  const line = (t: Task) =>
    [
      aliasOf.get(t.id),
      t.level ? LEVEL_LABELS[t.level] : "Task",
      t.name,
      t.departmentIds.map((d) => deptName.get(d)).filter(Boolean).join(", ") || "no department",
      t.parentId && byId.has(t.parentId) ? `in ${aliasOf.get(t.parentId)}` : "",
      t.priority ?? "",
      t.due ? `due ${t.due}` : "",
      t.status ?? "",
      t.focus ? `already planned (${t.focus})` : "",
      hasKids.has(t.id) ? "has open sub-items" : "",
    ]
      .filter(Boolean)
      .join(" | ");

  const toItems = (picks: Pick[]): RecItem[] =>
    picks.map((p) => {
      const t = byId.get(p.id);
      return { id: p.id, name: t?.name ?? p.id, level: t?.level ?? null, board: t?.board ?? "personal", why: p.why };
    });
  const fallback = async (note: string) => {
    const picks = heuristicPicks(tasks, hasKids);
    await saveRecommendation({ source: "recommend", reply: note, items: toItems(picks), usedAI: false });
    return Response.json({ reply: note, picks });
  };
  if (!aiMode()) return fallback("AI isn't set up here, so these are ranked by priority, due date and what's in progress.");
  const [history, company] = await Promise.all([historyForPrompt(new Set(tasks.map((t) => t.id))), companyForPrompt()]);

  try {
    const output = await generateJSON({
      schema: Recommendation,
      system: `You recommend what the user should work on today in Mission Control, a signal-over-noise focus board.
Today is ${new Date().toDateString()}.
Pick ${1 + DASHBOARD_SLOTS + TODAY_TARGET.min}-${MAX_PLAN} items, best first. Favour: P0, due soon or overdue, already in progress, unblocking others, momentum on one or two projects rather than scattering.
Prefer actionable tasks (lowest level). Recommend a whole mission or project only when it should clearly move as one piece today.
Skip Blocked items. Give each pick a short reason.

Open items (alias | level | name | department | parent | priority | due | status | notes):
${tasks.map(line).join("\n")}${company}${historyBlock(history)}`,
      messages: [{ role: "user", content: "Recommend today's tasks." }],
    });
    const seen = new Set<string>();
    const picks: Pick[] = output.picks
      .map((p) => ({ id: alias.get(p.alias) ?? "", why: p.why.slice(0, 140) }))
      .filter((p) => p.id && !seen.has(p.id) && !!seen.add(p.id))
      .slice(0, MAX_PLAN);
    await saveRecommendation({ source: "recommend", reply: output.reply, items: toItems(picks), model: currentModel(), usedAI: true });
    return Response.json({ reply: output.reply, picks });
  } catch (err) {
    console.error("recommend failed", err);
    return fallback("The AI didn't answer, so these are ranked by priority, due date and what's in progress.");
  }
}

// The last 7 days of recommendations, so the AI can see what it already suggested and what got skipped.
function historyBlock(history: string) {
  if (!history) return "";
  return `

Your recommendations from the last 7 days (taken = made it into that day's plan; still open / finished = status now):
${history}
Use this: don't keep pushing items that were skipped again and again unless they're urgent now (say why if you do), follow through on taken items that are still open, and don't re-suggest finished work.`;
}

async function logPlan(ids: string[]) {
  const clean = ids.filter((id) => typeof id === "string" && /^[\w-]{1,64}$/.test(id) && !id.startsWith("tmp-")).slice(0, 20);
  const board = await getBoard();
  const byId = new Map(board.tasks.map((t) => [t.id, t]));
  await savePlan(clean.map((id) => ({ id, name: byId.get(id)?.name ?? id, level: byId.get(id)?.level ?? null, board: byId.get(id)?.board })));
  return Response.json({ ok: true });
}

function heuristicPicks(tasks: Task[], hasKids: Set<string>): Pick[] {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const score = (t: Task) =>
    (PRIORITY[t.priority ?? ""] ?? 3) * 10 +
    (t.due && t.due < today ? -15 : t.due && t.due <= soon ? -8 : 0) +
    (t.status === "Working on it" ? -6 : 0) +
    (t.focus ? -4 : 0);
  const why = (t: Task) =>
    t.due && t.due < today
      ? `Overdue since ${t.due}`
      : t.due === today
        ? "Due today"
        : t.due && t.due <= soon
          ? `Due ${t.due}`
          : t.status === "Working on it"
            ? "Already in progress"
            : t.priority === "P0"
              ? "Top priority (P0)"
              : t.focus
                ? "Already on today's board"
                : `${t.priority ?? "Open"} and ready to start`;
  return tasks
    .filter((t) => !hasKids.has(t.id) && t.status !== "Blocked" && t.status !== "BLOCKING")
    .sort((a, b) => score(a) - score(b))
    .slice(0, 1 + DASHBOARD_SLOTS + TODAY_TARGET.max - 2)
    .map((t) => ({ id: t.id, why: why(t) }));
}

/** Local development without AI credentials: add tasks whose names share words with the message. */
function keywordFallback(text: string, tasks: Task[], draft: string[]) {
  const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const hits = tasks
    .filter((t) => !draft.includes(t.id) && words.some((w) => t.name.toLowerCase().includes(w)))
    .slice(0, MAX_PLAN - draft.length);
  return {
    reply: hits.length
      ? `AI isn't set up here, so I matched by keywords and added ${hits.length} task${hits.length > 1 ? "s" : ""}.`
      : "AI isn't set up here and no task names matched. Drag tasks in, or deploy with AI Gateway enabled.",
    order: [...draft, ...hits.map((t) => t.id)],
    creates: [],
  };
}
