import "server-only";
import { neon } from "@neondatabase/serverless";
import { USE_MOCK } from "./config";

// Delegated tasks: still yours, but someone else is doing the work and you have to make sure it
// happens. Kept in Neon rather than as Notion columns, so it works the same for the personal
// board and the shared Influity board and needs nothing added to either. A row exists while a
// task is delegated: when it was handed over, and (optionally) when an answer is expected.
// On the mock board the fields simply live on the mock tasks.

export type Delegation = { delegatedAt: string; expectBy: string | null };
export type DelegationPatch = { delegatedAt?: string | null; expectBy?: string | null };

const url = () => (USE_MOCK ? undefined : process.env.DATABASE_URL);
let ready: Promise<void> | null = null;

async function ensure() {
  const u = url();
  if (!u) return null;
  const sql = neon(u);
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS task_delegations (
      task_id text PRIMARY KEY,
      delegated_at timestamptz NOT NULL,
      expect_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  })().catch((err) => {
    ready = null;
    throw err;
  });
  await ready;
  return sql;
}

/** Every delegated task, by task id. Empty when the database isn't connected or can't be read. */
export async function getDelegations(): Promise<Record<string, Delegation>> {
  try {
    const sql = await ensure();
    if (!sql) return {};
    const rows = await sql`SELECT task_id, delegated_at, expect_by FROM task_delegations`;
    return Object.fromEntries(
      rows.map((r) => [
        r.task_id as string,
        { delegatedAt: new Date(r.delegated_at as string).toISOString(), expectBy: (r.expect_by as string | null) ?? null },
      ]),
    );
  } catch (err) {
    console.error("reading delegations failed", err);
    return {};
  }
}

/** Apply the delegation part of a task edit. Throws when it can't be saved. */
export async function saveDelegation(taskId: string, patch: DelegationPatch) {
  const sql = await ensure();
  if (!sql) throw new Error("Delegated tasks need the database (DATABASE_URL is missing).");
  if (patch.delegatedAt === null) {
    await sql`DELETE FROM task_delegations WHERE task_id = ${taskId}`;
  } else if (patch.delegatedAt) {
    // Turning the switch on without a date keeps a date set earlier; an explicit date (or null) replaces it.
    const keep = patch.expectBy === undefined;
    await sql`INSERT INTO task_delegations (task_id, delegated_at, expect_by)
      VALUES (${taskId}, ${patch.delegatedAt}, ${patch.expectBy ?? null})
      ON CONFLICT (task_id) DO UPDATE SET
        delegated_at = EXCLUDED.delegated_at,
        expect_by = CASE WHEN ${keep} THEN task_delegations.expect_by ELSE EXCLUDED.expect_by END,
        updated_at = now()`;
  } else if (patch.expectBy !== undefined) {
    await sql`UPDATE task_delegations SET expect_by = ${patch.expectBy}, updated_at = now() WHERE task_id = ${taskId}`;
  }
}
