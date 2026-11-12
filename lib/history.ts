import "server-only";
import { neon } from "@neondatabase/serverless";
import { TIME_ZONE, USE_MOCK } from "./config";

// AI recommendation history in Neon (Postgres): what the AI suggested each day, and what Dani
// actually planned. The last 7 days go back into the planner prompts so it can see what it
// already suggested, what was taken, and what kept getting skipped.
// Without DATABASE_URL (local dev) every call is a quiet no-op, and a database error never
// breaks an AI feature.

export type RecItem = { id: string; name: string; level?: string | null; board?: string; why?: string };
export type RecSource = "recommend" | "planner" | "voice";

// On the mock board the task ids are fake, so nothing is saved or read back.
const url = () => (USE_MOCK ? undefined : process.env.DATABASE_URL);
let ready: Promise<void> | null = null;

function db() {
  const u = url();
  return u ? neon(u) : null;
}

async function ensure() {
  const sql = db();
  if (!sql) return null;
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS ai_recommendations (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      day date NOT NULL,
      source text NOT NULL,
      prompt text,
      reply text,
      items jsonb NOT NULL DEFAULT '[]'::jsonb,
      model text,
      used_ai boolean NOT NULL DEFAULT true
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ai_recommendations_day ON ai_recommendations (day)`;
    await sql`CREATE TABLE IF NOT EXISTS day_plans (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      day date NOT NULL,
      items jsonb NOT NULL DEFAULT '[]'::jsonb
    )`;
    await sql`CREATE INDEX IF NOT EXISTS day_plans_day ON day_plans (day)`;
  })().catch((err) => {
    ready = null;
    throw err;
  });
  await ready;
  return sql;
}

export const dayInZone = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Save one AI answer (a recommendation list or a planner reply). */
export async function saveRecommendation(rec: {
  source: RecSource;
  prompt?: string;
  reply?: string;
  items: RecItem[];
  model?: string | null;
  usedAI: boolean;
}) {
  try {
    const sql = await ensure();
    if (!sql) return;
    await sql`INSERT INTO ai_recommendations (day, source, prompt, reply, items, model, used_ai)
      VALUES (${dayInZone()}, ${rec.source}, ${rec.prompt?.slice(0, 4000) ?? null}, ${rec.reply?.slice(0, 2000) ?? null},
              ${JSON.stringify(rec.items.slice(0, 20))}::jsonb, ${rec.model ?? null}, ${rec.usedAI})`;
  } catch (err) {
    console.error("saving recommendation failed", err);
  }
}

/** Save what was actually planned (Start my day / Save plan). */
export async function savePlan(items: RecItem[]) {
  try {
    const sql = await ensure();
    if (!sql) return;
    await sql`INSERT INTO day_plans (day, items) VALUES (${dayInZone()}, ${JSON.stringify(items.slice(0, 20))}::jsonb)`;
  } catch (err) {
    console.error("saving plan failed", err);
  }
}

/**
 * The last `days` days as short prompt text: per day, what was recommended, whether it made it
 * into the plan, and whether it's finished now. `openIds` = tasks still open on the board.
 */
export async function historyForPrompt(openIds: Set<string>, days = 7): Promise<string> {
  try {
    const sql = await ensure();
    if (!sql) return "";
    const since = dayInZone(new Date(Date.now() - days * 86400000));
    const recs = (await sql`SELECT day::text AS day, items FROM ai_recommendations
      WHERE day >= ${since} AND day < ${dayInZone()} ORDER BY day, created_at`) as { day: string; items: RecItem[] }[];
    if (!recs.length) return "";
    const plans = (await sql`SELECT DISTINCT ON (day) day::text AS day, items FROM day_plans
      WHERE day >= ${since} ORDER BY day, created_at DESC`) as { day: string; items: RecItem[] }[];
    const plannedOn = new Map(plans.map((p) => [p.day, new Set(p.items.map((i) => i.id))]));

    const byDay = new Map<string, Map<string, RecItem>>();
    for (const r of recs) {
      const m = byDay.get(r.day) ?? new Map<string, RecItem>();
      for (const it of r.items ?? []) if (it?.id && !m.has(it.id)) m.set(it.id, it);
      byDay.set(r.day, m);
    }
    const lines: string[] = [];
    for (const [day, items] of byDay) {
      const planned = plannedOn.get(day);
      const parts = [...items.values()].map((it) => {
        const took = planned ? (planned.has(it.id) ? "taken" : "not taken") : "no plan saved";
        const now = openIds.has(it.id) ? "still open" : "finished";
        return `"${it.name}" (${took}, ${now})`;
      });
      lines.push(`${day}: ${parts.join("; ")}`);
    }
    return lines.join("\n");
  } catch (err) {
    console.error("reading recommendation history failed", err);
    return "";
  }
}
