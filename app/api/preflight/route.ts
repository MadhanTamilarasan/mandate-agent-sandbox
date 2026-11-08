import { NextResponse } from "next/server";
import { rejectCrossOrigin } from "@/lib/http";
import { friendlyLlmError } from "@/lib/llm";
import { preflight, preflightSchema } from "@/lib/preflight";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Would this purchase pass my rules?" Runs the real rules engine and the real auditor against one of the user's mandates.
 * Read-only: no PayPal call, nothing saved, no money. It spends LLM quota (the auditor), so it is same-origin only.
 */
export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;

  const parsed = preflightSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request: a mandate and a product (title, store, price) are required." }, { status: 400 });

  try {
    return NextResponse.json(await preflight(parsed.data));
  } catch (e) {
    const msg = (e as Error).message ?? "";
    const own = /no longer exists/.test(msg);
    return NextResponse.json({ error: own ? msg : friendlyLlmError(e) }, { status: own ? 400 : 502 });
  }
}
