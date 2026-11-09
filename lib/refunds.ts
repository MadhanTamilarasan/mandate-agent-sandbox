import { round2 } from "./mandate";
import { logEvent } from "./store";
import type { Purchase, Refund, Store } from "./types";

/**
 * Refund bookkeeping, shared by the "Undo purchase" button and the PayPal webhook.
 *
 * A refund returns money to the buyer. It deliberately does NOT lower `mandate.spent`: a PayPal capture uses up
 * that part of the authorization for good, so the mandate cannot spend it a second time. Keeping `spent` as is
 * means the guardrail can only ever be more cautious than reality, never less.
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
  logEvent(s, {
    mandateId: p.mandateId,
    actor: "paypal",
    kind: "refunded",
    summary:
      `${where}: $${refund.amount.toFixed(2)} for "${p.product.title}" (refund ${refund.id}${refund.status === "COMPLETED" ? "" : `, ${refund.status.toLowerCase()}`}). ` +
      `The money went back to the buyer.` +
      (m ? ` The mandate still counts $${p.amount.toFixed(2)} as spent, because that part of the PayPal authorization is already used.` : ""),
    details: { refundId: refund.id, captureId: p.captureId, partial: !full, ...(webhookId && { webhookId }) },
  });
  return true;
}
