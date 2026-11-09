import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { PayPalError, verifyWebhook } from "@/lib/paypal";
import { handleWebhook } from "@/lib/service";

export const dynamic = "force-dynamic";

/**
 * PayPal posts events here (captures, refunds, voids, buyer approval). Nothing is trusted until PayPal itself
 * confirms the signature, so a stranger POSTing to this public URL changes nothing.
 */
export async function POST(req: Request) {
  const webhookId = env.paypalWebhookId;
  if (!webhookId) {
    return NextResponse.json({ error: "Webhooks are not configured (set PAYPAL_WEBHOOK_ID)." }, { status: 503 });
  }

  const raw = await req.text(); // verify against the body exactly as PayPal sent it
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    let verified = false;
    try {
      verified = await verifyWebhook(req.headers, event, webhookId);
    } catch (e) {
      // PayPal answers 400 when the signature headers are missing or malformed: that is a forged or broken
      // request, not a server fault, so refuse it instead of returning a 5xx that PayPal would retry.
      if (!(e instanceof PayPalError && e.status === 400)) throw e;
    }
    if (!verified) {
      return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
    }
    const result = await handleWebhook(event);
    return NextResponse.json({ received: true, ...result });
  } catch (e) {
    // A 5xx makes PayPal retry later, which is what we want for a transient failure.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
