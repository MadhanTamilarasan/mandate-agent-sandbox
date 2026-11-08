import { NextResponse } from "next/server";
import { friendlyLlmError } from "./llm";
import { PayPalError } from "./paypal";

export function ok(data: unknown, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function fail(e: unknown, fallbackStatus = 400) {
  if (e instanceof PayPalError) {
    return NextResponse.json({ error: e.message, debugId: e.debugId }, { status: 502 });
  }
  const msg = (e as Error)?.message ?? String(e);
  const llm = /ai call|generate|rate|quota|gemini|anthropic|api key/i.test(msg) ? friendlyLlmError(e) : msg;
  return NextResponse.json({ error: llm }, { status: fallbackStatus });
}

export async function body<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
