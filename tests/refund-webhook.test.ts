import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetView, holdWasReleased, remainingBudget } from "../lib/mandate";
import { recordRefund, refundable, refundedTotal } from "../lib/refunds";
import type { LimitOrder, Mandate, Purchase, Store } from "../lib/types";
import { applyWebhookEvent, captureIdFromRefund, type WebhookEvent } from "../lib/webhook";

function makeStore(): Store {
  const mandate = {
    id: "mnd_1",
    name: "Gift",
    goal: "A gift",
    currency: "USD",
    budget: 100,
    maxPerItem: 60,
    autoApproveBelow: 40,
    blockedTerms: [],
    allowedMerchants: [],
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    createdAt: new Date().toISOString(),
    status: "active",
    signature: "x",
    spent: 30,
    reserved: 10,
    paypal: { orderId: "ORDER1", authorizationId: "AUTH1", fundedAmount: 100 },
  } as Mandate;
  const purchase = {
    id: "pur_1",
    mandateId: "mnd_1",
    product: { id: "p", title: "Armband", brand: "B", description: "", imageUrl: null, merchant: "shop.com", buyUrl: "", price: 30, currency: "USD", inStock: true },
    amount: 30,
    via: "agent",
    captureId: "CAP1",
    status: "captured",
    createdAt: new Date().toISOString(),
  } as Purchase;
  const watching = { id: "lmt_1", mandateId: "mnd_1", status: "watching" } as LimitOrder;
  return { signingSecret: "s", mandates: [mandate], purchases: [purchase], approvals: [], limitOrders: [watching], events: [] };
}

const refundEvent = (over: Partial<WebhookEvent> = {}, value = "30.00"): WebhookEvent => ({
  id: "WH-1",
  event_type: "PAYMENT.CAPTURE.REFUNDED",
  create_time: "2026-11-09T10:00:00Z",
  resource: {
    id: "REF1",
    status: "COMPLETED",
    amount: { value, currency_code: "USD" },
    links: [{ rel: "up", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAP1" }],
  },
  ...over,
});

test("a full refund marks the purchase refunded and returns the money to the buyer", () => {
  const s = makeStore();
  const p = s.purchases[0];
  assert.equal(refundable(p), 30);
  assert.equal(recordRefund(s, p, { id: "R1", amount: 30, status: "COMPLETED", at: "t", source: "app" }), true);
  assert.equal(p.status, "refunded");
  assert.equal(refundedTotal(p), 30);
  assert.equal(refundable(p), 0, "nothing left to refund, so no second Undo button");
  assert.equal(s.events.at(-1)?.kind, "refunded");
});

test("a refund does NOT hand budget back: the PayPal authorization is already used", () => {
  const s = makeStore();
  const m = s.mandates[0];
  const before = remainingBudget(m);
  recordRefund(s, s.purchases[0], { id: "R1", amount: 30, status: "COMPLETED", at: "t", source: "app" });
  assert.equal(m.spent, 30);
  assert.equal(remainingBudget(m), before, "the guardrail stays at least as strict as PayPal");
});

test("a partial refund keeps the purchase captured and leaves the rest refundable", () => {
  const s = makeStore();
  const p = s.purchases[0];
  recordRefund(s, p, { id: "R1", amount: 10, status: "COMPLETED", at: "t", source: "paypal" });
  assert.equal(p.status, "captured");
  assert.equal(refundable(p), 20);
  recordRefund(s, p, { id: "R2", amount: 20, status: "COMPLETED", at: "t", source: "paypal" });
  assert.equal(p.status, "refunded");
});

test("the same refund is never counted twice", () => {
  const s = makeStore();
  const p = s.purchases[0];
  assert.equal(recordRefund(s, p, { id: "R1", amount: 30, status: "PENDING", at: "t", source: "app" }), true);
  assert.equal(recordRefund(s, p, { id: "R1", amount: 30, status: "COMPLETED", at: "t", source: "paypal" }), false);
  assert.equal(refundedTotal(p), 30);
  assert.equal(p.refunds?.[0].status, "COMPLETED", "the pending refund is updated when it completes");
});

test("a refund webhook for a refund made in PayPal is recorded and shows as made outside the app", () => {
  const s = makeStore();
  const r = applyWebhookEvent(s, refundEvent());
  assert.equal(r.handled, true);
  assert.equal(s.purchases[0].status, "refunded");
  assert.equal(s.purchases[0].refunds?.[0].source, "paypal");
  assert.match(s.events.at(-1)!.summary, /outside the app/);
});

test("PayPal retrying the same event changes nothing", () => {
  const s = makeStore();
  applyWebhookEvent(s, refundEvent());
  const events = s.events.length;
  const again = applyWebhookEvent(s, refundEvent());
  assert.equal(again.handled, false);
  assert.equal(s.events.length, events);
  assert.equal(refundedTotal(s.purchases[0]), 30);
});

test("a webhook confirming a refund the app already made only adds a confirmation line", () => {
  const s = makeStore();
  recordRefund(s, s.purchases[0], { id: "REF1", amount: 30, status: "COMPLETED", at: "t", source: "app" });
  const r = applyWebhookEvent(s, refundEvent({ id: "WH-2" }));
  assert.equal(r.handled, false);
  assert.equal(refundedTotal(s.purchases[0]), 30, "not double counted");
  assert.match(s.events.at(-1)!.summary, /already recorded/);
});

test("a refund event with no amount refunds whatever is left", () => {
  const s = makeStore();
  const ev = refundEvent();
  delete ev.resource.amount;
  applyWebhookEvent(s, ev);
  assert.equal(refundedTotal(s.purchases[0]), 30);
});

test("the capture id is read from the refund's 'up' link", () => {
  assert.equal(captureIdFromRefund(refundEvent().resource), "CAP1");
  assert.equal(captureIdFromRefund({}), undefined);
});

test("events for captures, refunds or holds that are not ours are ignored", () => {
  const s = makeStore();
  const cases: WebhookEvent[] = [
    { id: "a", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "OTHER" } },
    { id: "b", event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "R", links: [{ rel: "up", href: "https://x/captures/OTHER" }] } },
    { id: "c", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "OTHERAUTH" } },
    { id: "d", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "OTHERORDER" } },
    { id: "e", event_type: "BILLING.SUBSCRIPTION.CREATED", resource: {} },
  ];
  for (const c of cases) assert.equal(applyWebhookEvent(s, c).handled, false, c.event_type);
  assert.equal(s.events.length, 0);
  assert.equal(s.mandates[0].status, "active");
});

test("a completed capture webhook is logged as PayPal's confirmation", () => {
  const s = makeStore();
  const r = applyWebhookEvent(s, { id: "w", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP1" } });
  assert.equal(r.handled, true);
  assert.match(s.events[0].summary, /PayPal confirms the money moved/);
});

test("a capture PayPal later denies is marked failed and its money is not counted as spent", () => {
  const s = makeStore();
  applyWebhookEvent(s, { id: "w", event_type: "PAYMENT.CAPTURE.DENIED", resource: { id: "CAP1" } });
  assert.equal(s.purchases[0].status, "failed");
  assert.equal(s.mandates[0].spent, 0);
});

test("a hold voided in PayPal closes the mandate and cancels its watching limit orders", () => {
  const s = makeStore();
  const r = applyWebhookEvent(s, { id: "w", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "AUTH1" } });
  assert.equal(r.handled, true);
  const m = s.mandates[0];
  assert.equal(m.status, "closed");
  assert.equal(m.reserved, 0);
  assert.equal(s.limitOrders[0].status, "cancelled");
  assert.equal(holdWasReleased(s.events, m.id), true, "the dashboard shows the unspent money as released");
  assert.equal(budgetView(m, true).released, 70);
});

test("the void confirmation for a mandate the app already closed changes nothing", () => {
  const s = makeStore();
  s.mandates[0].status = "closed";
  applyWebhookEvent(s, { id: "w", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "AUTH1" } });
  assert.equal(s.mandates[0].status, "closed");
  assert.equal(holdWasReleased(s.events, "mnd_1"), false, "only the app's own close log says the hold was released");
});
