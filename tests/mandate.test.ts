import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRules, remainingBudget, signMandate, strictest, verifyMandate } from "../lib/mandate";
import type { Mandate, ProductSnapshot } from "../lib/types";

const SECRET = "test-secret";

function makeMandate(over: Partial<Mandate> = {}): Mandate {
  const terms = {
    name: "Gift",
    goal: "A gift for my sister",
    currency: "USD" as const,
    budget: 100,
    maxPerItem: 60,
    autoApproveBelow: 40,
    blockedTerms: ["fast fashion"],
    allowedMerchants: [] as string[],
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const id = "mnd_test";
  const merged = { ...terms, ...over };
  return {
    ...terms,
    id,
    createdAt: new Date().toISOString(),
    status: "active",
    // Sign the final terms so overrides still verify (unless a test passes its own signature).
    signature: signMandate(id, merged, SECRET),
    spent: 0,
    reserved: 0,
    paypal: { authorizationId: "AUTH-1" },
    ...over,
  };
}

function makeProduct(over: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    id: "p1",
    title: "Wool scarf",
    brand: "Acme",
    description: "Warm scarf",
    imageUrl: null,
    merchant: "shop.example.com",
    buyUrl: "https://shop.example.com/p1",
    price: 30,
    currency: "USD",
    inStock: true,
    ...over,
  };
}

const failedRules = (r: ReturnType<typeof checkRules>) => r.checks.filter((c) => !c.ok).map((c) => c.rule);

test("allows a purchase inside every limit", () => {
  const r = checkRules(makeMandate(), makeProduct(), { secret: SECRET });
  assert.equal(r.decision, "allow");
  assert.deepEqual(failedRules(r), []);
});

test("escalates above the auto-approve limit but within the cap", () => {
  const r = checkRules(makeMandate(), makeProduct({ price: 55 }), { secret: SECRET });
  assert.equal(r.decision, "escalate");
  assert.deepEqual(failedRules(r), ["auto_approve"]);
});

test("blocks above the per-item cap", () => {
  const r = checkRules(makeMandate(), makeProduct({ price: 75 }), { secret: SECRET });
  assert.equal(r.decision, "block");
  assert.ok(failedRules(r).includes("per_item_cap"));
});

test("blocks when the remaining budget is too small, counting reservations", () => {
  const m = makeMandate({ spent: 50, reserved: 30 });
  assert.equal(remainingBudget(m), 20);
  const r = checkRules(m, makeProduct({ price: 30 }), { secret: SECRET });
  assert.equal(r.decision, "block");
  assert.ok(failedRules(r).includes("budget"));
});

test("a limit order may use its own reservation", () => {
  const m = makeMandate({ spent: 50, reserved: 30 });
  const r = checkRules(m, makeProduct({ price: 30 }), { secret: SECRET, reservedForThis: 30 });
  assert.equal(r.decision, "allow");
});

test("blocks blocked terms in title, brand or description (case-insensitive)", () => {
  const r = checkRules(makeMandate(), makeProduct({ description: "Great FAST FASHION piece" }), { secret: SECRET });
  assert.equal(r.decision, "block");
  assert.ok(failedRules(r).includes("blocked_terms"));
});

test("enforces the merchant allow-list by domain suffix", () => {
  const m = makeMandate({ allowedMerchants: ["bestbuy.com"] });
  assert.equal(checkRules(m, makeProduct({ merchant: "bestbuy.com" }), { secret: SECRET }).decision, "allow");
  assert.equal(checkRules(m, makeProduct({ merchant: "www.bestbuy.com" }), { secret: SECRET }).decision, "allow");
  assert.equal(checkRules(m, makeProduct({ merchant: "notbestbuy.com" }), { secret: SECRET }).decision, "block");
  assert.equal(checkRules(m, makeProduct({ merchant: "bestbuy.com.example.org" }), { secret: SECRET }).decision, "block");
});

test("blocks expired mandates, unfunded mandates and out-of-stock offers", () => {
  const expired = makeMandate({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.ok(failedRules(checkRules(expired, makeProduct(), { secret: SECRET })).includes("not_expired"));
  const unfunded = makeMandate({ status: "pending_funding", paypal: {} });
  assert.ok(failedRules(checkRules(unfunded, makeProduct(), { secret: SECRET })).includes("funded"));
  assert.ok(failedRules(checkRules(makeMandate(), makeProduct({ inStock: false }), { secret: SECRET })).includes("in_stock"));
});

test("blocks when the live price drifts from the quoted price", () => {
  const ok = checkRules(makeMandate(), makeProduct({ price: 30.2 }), { secret: SECRET, quotedPrice: 30 });
  assert.equal(ok.decision, "allow");
  const stale = checkRules(makeMandate(), makeProduct({ price: 39 }), { secret: SECRET, quotedPrice: 30 });
  assert.ok(failedRules(stale).includes("price_fresh"));
});

test("detects a tampered mandate", () => {
  const m = makeMandate();
  assert.equal(verifyMandate(m, SECRET), true);
  const tampered = { ...m, budget: 10_000 };
  assert.equal(verifyMandate(tampered, SECRET), false);
  const r = checkRules(tampered, makeProduct(), { secret: SECRET });
  assert.equal(r.decision, "block");
  assert.ok(failedRules(r).includes("signature"));
  assert.equal(verifyMandate(m, "other-secret"), false);
});

test("strictest picks the most restrictive decision", () => {
  assert.equal(strictest("allow", "allow"), "allow");
  assert.equal(strictest("allow", "escalate"), "escalate");
  assert.equal(strictest("escalate", "block", "allow"), "block");
});
