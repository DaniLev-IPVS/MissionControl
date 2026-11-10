import { generateText, Output } from "ai";
import { connection } from "next/server";
import { z } from "zod";
import { getBoard } from "@/lib/board";
import { DASHBOARD_SLOTS, LEVEL_LABELS, PLANNER_MODEL, TODAY_TARGET } from "@/lib/config";
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

export async function POST(request: Request) {
  await connection();
  let body: { messages?: Msg[]; draft?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
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

Current draft order: ${draft.map((id) => aliasOf.get(id)).join(", ") || "(empty)"}`;

  const hasAI = !!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
  if (!hasAI) return Response.json(keywordFallback(messages[messages.length - 1].content, tasks, draft));

  try {
    const { output } = await generateText({
      model: PLANNER_MODEL,
      system,
      messages,
      output: Output.object({ schema: Plan }),
    });

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

    return Response.json({ reply: output.reply, order, creates: creates.filter((c) => order.includes(c.tempId)) });
  } catch (err) {
    console.error("planner failed", err);
    return Response.json({ error: "The planner couldn't answer. Try again, or plan by dragging." }, { status: 502 });
  }
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
