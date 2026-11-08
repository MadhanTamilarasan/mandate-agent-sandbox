import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { completeFunding } from "@/lib/service";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** PayPal sends the buyer back here after they approve the mandate's budget. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mandateId = url.searchParams.get("mandate") ?? "";
  const orderId = url.searchParams.get("token") ?? "";
  const home = (q: string) => NextResponse.redirect(`${env.appUrl}/?mandate=${mandateId}&${q}`);
  try {
    const m = readStore().mandates.find((x) => x.id === mandateId);
    if (!m) return home("error=Mandate%20not%20found");
    if (m.status === "active") return home("funded=1");
    if (m.paypal.orderId !== orderId) return home("error=Order%20does%20not%20match%20this%20mandate");
    await completeFunding(mandateId, orderId);
    return home("funded=1");
  } catch (e) {
    return home(`error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
