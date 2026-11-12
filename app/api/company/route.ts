import { connection } from "next/server";
import { getCompany } from "@/lib/company";

// The company master (entities, goals, roadmaps, pivots) for the Company view.
export async function GET() {
  await connection();
  try {
    return Response.json({ company: await getCompany() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("company fetch failed", err);
    return Response.json({ error: "The company database didn't answer. Try again in a moment." }, { status: 502 });
  }
}
