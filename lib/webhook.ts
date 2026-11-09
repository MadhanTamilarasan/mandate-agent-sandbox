import { round2 } from "./mandate";
import { recordRefund, refundedTotal } from "./refunds";
import { logEvent } from "./store";
import type { Store } from "./types";

/**
 * Applies a PayPal webhook event to the store so the ledger follows what PayPal says, including changes made
 * outside the app (a refund from the PayPal dashboard, a hold that was voided or expired). Pure with respect to the
 * network: the route verifies the signature first, and this only edits the store it is given.
 */

export type WebhookEvent = {
  id: string;
  event_type: string;
  create_time?: string;
  resource?: any;
};

/** The event types the app subscribes to (see scripts/register-webhook.ts). */
export const WEBHOOK_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.REFUNDED",
] as const;

export type WebhookResult = { handled: boolean; note: string };

const seen = (s: Store, id: string) => s.events.some((e) => (e.details as { webhookId?: string } | undefined)?.webhookId === id);

/** A refund resource links back to its capture: `.../v2/payments/captures/{id}` with rel "up". */
export function captureIdFromRefund(resource: any): string | undefined {
  const up = (resource?.links ?? []).find((l: { rel?: string }) => l.rel === "up")?.href as string | undefined;
  return up?.split("/").filter(Boolean).pop();
}

function note(s: Store, mandateId: string, event: WebhookEvent, summary: string, extra: Record<string, unknown> = {}) {
  logEvent(s, {
    mandateId,
    actor: "paypal",
    kind: "webhook",
    summary: `PayPal webhook ${event.event_type}: ${summary}`,
    details: { webhookId: event.id, ...extra },
  });
}

export function applyWebhookEvent(s: Store, event: WebhookEvent): WebhookResult {
  if (!event?.id || !event.event_type) return { handled: false, note: "Not a PayPal event" };
  if (seen(s, event.id)) return { handled: false, note: "Already processed" };
  const r = event.resource ?? {};

  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      const p = s.purchases.find((x) => x.captureId === r.id);
      if (!p) return { handled: false, note: "Capture is not one of ours" };
      note(s, p.mandateId, event, `capture ${r.id} for "${p.product.title}" is complete. PayPal confirms the money moved.`);
      return { handled: true, note: "Capture confirmed" };
    }

    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED": {
      const p = s.purchases.find((x) => x.captureId === r.id);
      if (!p) return { handled: false, note: "Capture is not one of ours" };
      if (p.status === "captured" && !p.refunds?.length) {
        p.status = "failed";
        p.error = `PayPal later ${event.event_type.endsWith("DENIED") ? "denied" : "declined"} this capture`;
        const m = s.mandates.find((x) => x.id === p.mandateId);
        if (m) m.spent = round2(Math.max(0, m.spent - p.amount)); // the money never moved
      }
      note(s, p.mandateId, event, `capture ${r.id} for "${p.product.title}" did not go through. It is marked failed and no money was taken.`);
      return { handled: true, note: "Capture marked failed" };
    }

    case "PAYMENT.CAPTURE.REFUNDED": {
      const captureId = captureIdFromRefund(r);
      const p = s.purchases.find((x) => x.captureId === captureId);
      if (!p || !r.id) return { handled: false, note: "Refund is not for one of our captures" };
      const stated = Number(r.amount?.value);
      const amount = round2(stated > 0 ? stated : Math.max(0, p.amount - refundedTotal(p)));
      const added = recordRefund(s, p, { id: String(r.id), amount, status: String(r.status ?? "COMPLETED"), at: event.create_time ?? new Date().toISOString(), source: "paypal" }, event.id);
      // A refund the app started already logged itself: the webhook is PayPal's confirmation of it.
      if (!added) note(s, p.mandateId, event, `PayPal confirms refund ${r.id} (already recorded).`);
      return { handled: added, note: added ? "Refund recorded" : "Refund already recorded" };
    }

    case "PAYMENT.AUTHORIZATION.VOIDED": {
      const m = s.mandates.find((x) => x.paypal.authorizationId === r.id);
      if (!m) return { handled: false, note: "Authorization is not one of ours" };
      if (m.status === "active") {
        // The hold is gone (voided or expired in PayPal), so nothing more can be captured against it.
        for (const lo of s.limitOrders) {
          if (lo.mandateId === m.id && lo.status === "watching") {
            lo.status = "cancelled";
            lo.statusNote = "The PayPal hold was voided";
          }
        }
        m.reserved = 0;
        m.status = "closed";
        note(s, m.id, event, `the hold ${r.id} was voided in PayPal. The mandate is closed and nothing more can be bought.`, { externalVoid: true });
        return { handled: true, note: "Mandate closed: hold voided in PayPal" };
      }
      note(s, m.id, event, `PayPal confirms the hold ${r.id} is voided. The unspent money is released.`);
      return { handled: true, note: "Void confirmed" };
    }

    case "CHECKOUT.ORDER.APPROVED": {
      const m = s.mandates.find((x) => x.paypal.orderId === r.id);
      if (!m) return { handled: false, note: "Order is not one of ours" };
      note(s, m.id, event, `the buyer approved the budget (order ${r.id}).`);
      return { handled: true, note: "Order approval noted" };
    }

    default:
      return { handled: false, note: `Ignored ${event.event_type}` };
  }
}
