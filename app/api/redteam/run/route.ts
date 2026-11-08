import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectCrossOrigin } from "@/lib/http";
import { friendlyLlmError } from "@/lib/llm";
import { attackSchema, resolveSubject, runAttack, sourceSchema, type Attack } from "@/lib/redteam";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const bodySchema = z.object({ source: sourceSchema, attack: attackSchema });

/**
 * Judges one attack with the real rules engine and the real auditor model. Simulation only: no PayPal call, no store write, no money.
 * The mandate is rebuilt here from its id or its terms; the attack's listing is just the input being judged.
 */
export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  try {
    const { subject } = await resolveSubject(parsed.data.source);
    return NextResponse.json(await runAttack(subject, parsed.data.attack as Attack));
  } catch (e) {
    const msg = (e as Error).message ?? "";
    const own = /no longer exists/.test(msg);
    return NextResponse.json({ error: own ? msg : friendlyLlmError(e) }, { status: own ? 400 : 502 });
  }
}
