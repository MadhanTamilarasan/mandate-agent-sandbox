import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectCrossOrigin } from "@/lib/http";
import { friendlyLlmError } from "@/lib/llm";
import { planAttacks, termsSchema } from "@/lib/redteam";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const bodySchema = z.object({
  mandateId: z.string().max(80).optional(),
  text: z.string().max(1000).optional(),
  terms: termsSchema.optional(),
});

/**
 * Builds a fresh set of attacks for one mandate: the numbers and domains are derived from its real rules, and an attacker AI writes
 * the listing text. Nothing is saved and PayPal is never called. It spends LLM quota, so it is same-origin only.
 */
export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { mandateId, text, terms } = parsed.data;

  const source = mandateId ? { mandateId } : terms ? { terms } : text?.trim() ? { text: text.trim() } : null;
  if (!source) return NextResponse.json({ error: "Choose one of your mandates, or describe one." }, { status: 400 });

  try {
    return NextResponse.json(await planAttacks(source));
  } catch (e) {
    const msg = (e as Error).message ?? "";
    // Our own plain-language errors (not enough budget, attacker skipped listings) are shown as written; model failures are translated.
    const own = /left to spend|attacker AI|no longer exists/.test(msg);
    return NextResponse.json({ error: own ? msg : friendlyLlmError(e) }, { status: own ? 400 : 502 });
  }
}
