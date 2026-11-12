import "server-only";
import { neon } from "@neondatabase/serverless";
import { USE_MOCK } from "./config";

// "Still working" past midnight. When a day runs past midnight the site asks whether you're
// still at it; a yes is good until the time kept here (Neon), so every tab and device agrees on
// when to ask next. Without DATABASE_URL the browser that confirmed remembers it on its own.

const url = () => (USE_MOCK ? undefined : process.env.DATABASE_URL);
const mock = globalThis as unknown as { __mockOvertime?: Map<string, string> };
let ready: Promise<void> | null = null;

async function ensure() {
  const u = url();
  if (!u) return null;
  const sql = neon(u);
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS day_overtime (
      day date PRIMARY KEY,
      working_until timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  })().catch((err) => {
    ready = null;
    throw err;
  });
  await ready;
  return sql;
}

/** Until when "still working" is confirmed for that day (YYYY-MM-DD), as ISO, or null. */
export async function getWorkingUntil(day: string): Promise<string | null> {
  if (USE_MOCK) return mock.__mockOvertime?.get(day) ?? null;
  try {
    const sql = await ensure();
    if (!sql) return null;
    const rows = await sql`SELECT working_until FROM day_overtime WHERE day = ${day}`;
    const at = rows[0]?.working_until;
    return at ? new Date(at as string).toISOString() : null;
  } catch (err) {
    console.error("reading the still-working time failed", err);
    return null;
  }
}

/** False when it couldn't be saved (the browser keeps its own copy). */
export async function setWorkingUntil(day: string, until: string): Promise<boolean> {
  if (USE_MOCK) {
    (mock.__mockOvertime ??= new Map()).set(day, until);
    return true;
  }
  try {
    const sql = await ensure();
    if (!sql) return false;
    await sql`INSERT INTO day_overtime (day, working_until) VALUES (${day}, ${until})
      ON CONFLICT (day) DO UPDATE SET working_until = EXCLUDED.working_until, updated_at = now()`;
    return true;
  } catch (err) {
    console.error("saving the still-working time failed", err);
    return false;
  }
}
