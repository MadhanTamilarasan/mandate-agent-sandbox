import { body, fail, ok } from "@/lib/http";
import { proposePurchase } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A person picks a product from the search results. It goes through exactly the same pipeline as the
 * agent's own proposals (signature, budget, caps, merchant list, blocked terms, price drift, then the
 * independent auditor, then human approval above the auto-approve limit). Choosing a product does not
 * bypass any guardrail, and a blocked purchase stays blocked.
 */
export async function POST(req: Request) {
  try {
    const b = await body<{ mandateId?: string; productId?: string; merchant?: string; quotedPrice?: number }>(req);
    if (!b.mandateId || !b.productId) throw new Error("mandateId and productId are required");
    const outcome = await proposePurchase({
      mandateId: b.mandateId,
      productId: b.productId,
      merchant: typeof b.merchant === "string" ? b.merchant : undefined,
      // The price on the card the person clicked: if the live price has moved, the drift rule blocks it.
      quotedPrice: typeof b.quotedPrice === "number" && Number.isFinite(b.quotedPrice) ? b.quotedPrice : undefined,
      reason: "The user picked this exact product from the search results.",
    });
    return ok(outcome);
  } catch (e) {
    return fail(e);
  }
}
