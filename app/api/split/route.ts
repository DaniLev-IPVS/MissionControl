import { connection } from "next/server";
import { z } from "zod";
import { getBoard } from "@/lib/board";
import { aiMode, generateJSON } from "@/lib/ai";
import { CHILD_LEVEL, LEVEL_LABELS, LEVELS, type Level } from "@/lib/config";
import type { Task } from "@/lib/types";

// "Describe the split": the user says in their own words how a task, mission or project should
// be broken up, and Sonnet writes the parts. Nothing is written here: the Split dialog shows the
// parts for a last look, and the browser creates them the same way a hand-written split does.

const MAX_HOW = 2000;
const MAX_PARTS = 12;
const MAX_CONTEXT = 30;

const Parts = z.object({
  parts: z.array(z.string().describe("Short, clean name of one part")).describe("The parts, in the order they should be done"),
});

export async function POST(request: Request) {
  await connection();
  let body: { id?: unknown; name?: unknown; level?: unknown; how?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const how = typeof body.how === "string" ? body.how.trim().slice(0, MAX_HOW) : "";

  // The board is the truth for what is being split; what the browser sent covers a task
  // that hasn't reached Notion yet.
  const board = await getBoard().catch(() => null);
  const onBoard = typeof body.id === "string" ? board?.tasks.find((t) => t.id === body.id) : undefined;
  const name = (onBoard?.name ?? (typeof body.name === "string" ? body.name : "")).replace(/\s+/g, " ").trim().slice(0, 300);
  if (!name) return Response.json({ error: "Nothing to split." }, { status: 400 });
  const sent = LEVELS.find((l) => l === body.level) ?? null;
  const level: Level = onBoard?.level ?? sent ?? "task";
  const leaf = level === "task";
  const min = leaf ? 2 : 1; // a task has to become at least two; a mission can start with one child

  const fromText = clean(listed(how));
  if (!aiMode()) {
    return fromText.length >= min
      ? Response.json({ parts: fromText })
      : Response.json({ error: "AI isn't set up here. List the parts yourself in Manual." }, { status: 503 });
  }

  try {
    const output = await generateJSON({
      fast: true,
      effort: "low",
      schema: Parts,
      system: `You split work for Mission Control, a signal-over-noise focus board (project > mission > task). The user is looking at one item that is too big and tells you how they want it split. Return the parts.

How to split
- Follow the user's description. If they name the parts, use exactly those, cleaned up. If they give a count or a principle ("three steps", "one per client", "by channel"), work the parts out from it.
- If the description is empty, split it the most natural way into 2 to 5 parts.
- Together the parts cover the original item and don't overlap. Don't add work the item or the description doesn't call for.
- Put them in the order they should be done.
- At most ${MAX_PARTS} parts.${leaf ? "\n- This is a task: return at least 2 parts. The first part is what to do first; the task is renamed to it and the others follow as tasks next in line." : `\n- This is a ${level}: the parts become its ${LEVEL_LABELS[CHILD_LEVEL[level]].toLowerCase()}s. Don't repeat one it already has.`}

Names
- Short and clean, 3 to 10 words. ${CHILD_LEVEL[level] === "task" ? 'A task starts with a verb ("Draft the pricing page copy").' : 'A mission names an outcome ("Launch the creator program").'}
- Keep the specifics from the original: people, companies, amounts, dates.
- Write in the language of the item and the description. No numbering, no trailing punctuation.`,
      messages: [{ role: "user", content: `${context(board?.tasks ?? [], board?.titles ?? {}, onBoard, name, level)}\n\nHow I want it split:\n${how || "(nothing said: split it the most natural way)"}` }],
    });
    const parts = clean(output.parts);
    if (parts.length < min) throw new Error("too few parts");
    return Response.json({ parts });
  } catch (err) {
    console.error("describing a split failed", err);
    if (fromText.length >= min) return Response.json({ parts: fromText });
    return Response.json({ error: "Couldn't work out the split. Try again, or list the parts yourself in Manual." }, { status: 502 });
  }
}

/** What the model sees: the item, where it sits, and what is already next to it. */
function context(tasks: Task[], titles: Record<string, string>, task: Task | undefined, name: string, level: Level): string {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const chain: string[] = [];
  for (let id = task?.parentId, hops = 0; id && hops < 4; hops++) {
    const p = byId.get(id);
    const title = p?.name ?? titles[id];
    if (title) chain.push(p?.level ? `${LEVEL_LABELS[p.level]} "${title}"` : `"${title}"`);
    id = p?.parentId ?? null;
  }
  const lines = [`${LEVEL_LABELS[level]} to split: ${name}`];
  if (chain.length) lines.push(`It sits in: ${chain.join(", in ")}`);
  if (task) {
    const near =
      level === "task"
        ? tasks.filter((t) => t.id !== task.id && !!task.parentId && t.parentId === task.parentId)
        : tasks.filter((t) => t.parentId === task.id);
    if (near.length) {
      lines.push(
        `${level === "task" ? "Other open items next to it (already covered, don't repeat)" : "It already has (don't repeat)"}:\n${near
          .slice(0, MAX_CONTEXT)
          .map((t) => `- ${t.name}`)
          .join("\n")}`,
      );
    }
  }
  return lines.join("\n");
}

/** Parts the user already listed out: one per line, numbered, or joined with ";" or "then". */
function listed(how: string): string[] {
  return how.split(/\n+|;|\s+(?:and\s+)?then\s+|(?:^|\s)\d+[.)]\s+/i);
}

function clean(parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const part = raw
      .replace(/\s+/g, " ")
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
      .trim()
      .slice(0, 200);
    const key = part.toLowerCase();
    if (!part || seen.has(key)) continue;
    seen.add(key);
    out.push(part);
    if (out.length === MAX_PARTS) break;
  }
  return out;
}
