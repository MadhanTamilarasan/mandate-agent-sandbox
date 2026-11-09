import { round2 } from "./mandate";
import { logEvent } from "./store";
import type { Purchase, Refund, Store } from "./types";

/**
 * Refund bookkeeping, shared by the "Undo purchase" button and the PayPal webhook.
 *
 * A refund returns money to the buyer and frees that budget in the mandate again (`mandate.refunded`, see
 * `netSpent`). `mandate.spent` itself stays the gross amount captured: it is what PayPal's hold was drawn down by.
 *
 * Safety does not depend on this: the PayPal authorization is the hard cap, and the app cannot capture more than
 * it holds. If PayPal turns out to refuse capturing refunded money a second time, the capture fails, nothing is
 * spent, and `refundCreditBlocked` is set so the budget shown goes back to what PayPal really has left.
 */

export const refundedTotal = (p: Pick<Purchase, "refunds">): number =>
  round2((p.refunds ?? []).reduce((sum, r) => sum + r.amount, 0));

/** Money from this purchase that has not been refunded yet. */
export const refundable = (p: Pick<Purchase, "amount" | "refunds" | "status" | "captureId">): number =>
  p.status === "captured" && p.captureId ? Math.max(0, round2(p.amount - refundedTotal(p))) : 0;

/**
 * Records a refund on a purchase. Returns false when this refund id was already recorded (a webhook for a refund
 * the app started itself, or a PayPal retry), so nothing is counted twice.
 */
export function recordRefund(s: Store, p: Purchase, refund: Refund, webhookId?: string): boolean {
  p.refunds ??= [];
  const known = p.refunds.find((r) => r.id === refund.id);
  if (known) {
    known.status = refund.status; // e.g. PENDING -> COMPLETED
    return false;
  }
  p.refunds.push(refund);
  const full = refundedTotal(p) + 0.005 >= p.amount;
  if (full) p.status = "refunded";

  const where = refund.source === "paypal" ? "PayPal reported a refund made outside the app" : "Refunded through PayPal";
  const m = s.mandates.find((x) => x.id === p.mandateId);
  if (m) m.refunded = round2((m.refunded ?? 0) + refund.amount);
  const freed = m?.status === "active" && !m.refundCreditBlocked;
  logEvent(s, {
    mandateId: p.mandateId,
    actor: "paypal",
    kind: "refunded",
    summary:
      `${where}: $${refund.amount.toFixed(2)} for "${p.product.title}" (refund ${refund.id}${refund.status === "COMPLETED" ? "" : `, ${refund.status.toLowerCase()}`}). ` +
      `The money went back to the buyer.` +
      (freed ? ` That $${refund.amount.toFixed(2)} is available in the mandate's budget again.` : ""),
    details: { refundId: refund.id, captureId: p.captureId, partial: !full, ...(webhookId && { webhookId }) },
  });
  return true;
}
