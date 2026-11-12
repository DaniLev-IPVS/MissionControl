import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { generateText, Output } from "ai";
import { z } from "zod";

// One way in for every AI call on the site (planner, recommendations, haiku).
//
// 1. ANTHROPIC_API_KEY set  -> straight to Anthropic with the official SDK, billed
//    to your Anthropic account (spend limits live in the Anthropic Console).
// 2. Otherwise, on Vercel  -> Vercel AI Gateway (OIDC), billed to Vercel at the
//    same list prices.
// 3. Neither              -> null; callers fall back to their non-AI version.

export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
export const GATEWAY_MODEL = process.env.PLANNER_MODEL ?? "anthropic/claude-opus-5.5";
// Lighter, faster model for small structured jobs (sorting pop-ups into tasks).
export const ANTHROPIC_FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL ?? "claude-sonnet-5-5";
export const GATEWAY_FAST_MODEL = process.env.FAST_MODEL ?? "anthropic/claude-sonnet-5.5";

export type AIMode = "anthropic" | "gateway" | null;
export const currentModel = () => (aiMode() === "anthropic" ? ANTHROPIC_MODEL : aiMode() === "gateway" ? GATEWAY_MODEL : null);
export function aiMode(): AIMode {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) return "gateway";
  return null;
}

type Msg = { role: "user" | "assistant"; content: string };

let client: Anthropic | null = null;

/** Structured JSON from Claude, validated against `schema`. Throws on refusal or bad output. */
export async function generateJSON<T>({
  system,
  messages,
  schema,
  effort = "medium",
  fast = false,
}: {
  system: string;
  messages: Msg[];
  schema: z.ZodType<T>;
  effort?: "low" | "medium" | "high";
  /** Use the lighter model (Sonnet) instead of the planner model. */
  fast?: boolean;
}): Promise<T> {
  const mode = aiMode();
  if (!mode) throw new Error("AI is not configured");

  if (mode === "gateway") {
    const { output } = await generateText({
      model: fast ? GATEWAY_FAST_MODEL : GATEWAY_MODEL,
      system,
      messages,
      output: Output.object({ schema }),
    });
    return output as T;
  }

  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  // Server-side fallback re-runs a declined request on Anthropic's recommended model.
  // Haiku has no server-side fallback, so it's left off there.
  const model = fast ? ANTHROPIC_FAST_MODEL : ANTHROPIC_MODEL;
  const canFallback = !model.startsWith("claude-haiku");
  const res = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    system,
    messages,
    output_config: { effort, format: { type: "json_schema", schema: strictSchema(z.toJSONSchema(schema)) } },
    ...(canFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined this request");
  if (res.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off");
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return schema.parse(JSON.parse(text));
}

// Structured outputs want closed objects; zod's export doesn't always say so.
function strictSchema(node: unknown): { [key: string]: unknown } {
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (!n || typeof n !== "object") return n;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) if (k !== "$schema") out[k] = walk(v);
    if (out.type === "object") out.additionalProperties = false;
    return out;
  };
  return walk(node) as { [key: string]: unknown };
}
