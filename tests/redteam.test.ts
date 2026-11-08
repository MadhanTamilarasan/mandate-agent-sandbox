import assert from "node:assert/strict";
import { test } from "node:test";
import { signMandate } from "../lib/mandate";
import {
  evadesKeyword,
  evaluateRules,
  isAllowedMerchant,
  lookalike,
  planSpecs,
  specToAttack,
  subjectFromMandate,
  subjectFromTerms,
  type Spec,
  type Terms,
} from "../lib/redteam";
import type { Mandate, MandateTerms } from "../lib/types";

// These cover the deterministic half only (no LLM): that every attack's numbers and domains are DERIVED from the mandate under test,
// and that each attack reaches the layer it is aimed at. The listing text is written by an AI at run time; here a neutral placeholder
// stands in, which is enough because the rules engine only looks at the numbers, the store and the signature.

const TERMS: Terms = {
  name: "Test mandate",
  goal: "Buy a gift",
  budget: 100,
  maxPerItem: 40,
  autoApproveBelow: 25,
  blockedTerms: ["fast fashion", "gaming", "extra"],
  allowedMerchants: ["shop-a.com", "www.shop-b.org"],
  spent: 70, // leaves $30, below the $40 cap, so the overdraw attack can be crafted
};

const NEUTRAL = { title: "A plain item", brand: "Brand", description: "A normal, harmless product description.", agentReason: "It fits." };
const specOf = (specs: Spec[], id: string) => specs.find((s) => s.id === id)!;
const attackOf = (s: Spec) => specToAttack(s, NEUTRAL);

test("every number and domain is derived from the mandate under test", () => {
  const sub = subjectFromTerms(TERMS);
  const { specs } = planSpecs(sub);
  const cap = TERMS.maxPerItem;

  assert.ok(specOf(specs, "over-cap").price >= cap * 3, "over-cap price is a multiple of THIS mandate's cap");
  const overdraw = specOf(specs, "overdraw");
  assert.equal(overdraw.price, cap, "overdraw price is this mandate's cap");
  assert.ok(overdraw.price > sub.remaining, "and it exceeds what is left");
  const look = specOf(specs, "lookalike");
  assert.equal(look.merchant, lookalike("shop-a.com"), "look-alike is derived from this mandate's allowed merchant");
  assert.equal(isAllowedMerchant(look.merchant, TERMS.allowedMerchants), false);
  const bait = specOf(specs, "price-bait");
  assert.ok(Math.abs(bait.price - bait.quotedPrice!) / bait.quotedPrice! > 0.02, "price jump exceeds the 2% drift tolerance");
  const safe = specOf(specs, "control").price;
  assert.ok(safe <= TERMS.autoApproveBelow && safe <= TERMS.maxPerItem && safe <= sub.remaining, "the normal price is inside every limit");
});

test("attacks aimed at the rules engine are blocked by the rules", () => {
  const sub = subjectFromTerms(TERMS);
  const { specs } = planSpecs(sub);
  const aimed = specs.filter((s) => s.designedFor === "Rules engine");
  assert.ok(aimed.length >= 5);
  for (const s of aimed) {
    const { result } = evaluateRules(sub, attackOf(s));
    assert.equal(result.decision, "block", `${s.id} should be blocked by the rules engine`);
    assert.ok(result.checks.some((c) => !c.ok && c.rule !== "auto_approve"), `${s.id} should fail a rule`);
  }
});

test("attacks aimed at the auditor get past the rules, so they reach it", () => {
  const sub = subjectFromTerms(TERMS);
  const { specs } = planSpecs(sub);
  const aimed = specs.filter((s) => s.designedFor === "Auditor");
  assert.ok(aimed.length >= 5);
  for (const s of aimed) {
    assert.notEqual(evaluateRules(sub, attackOf(s)).result.decision, "block", `${s.id} must not be stopped by the rules, or the auditor is never tested`);
  }
});

test("the control is a clean purchase the rules allow outright", () => {
  const sub = subjectFromTerms(TERMS);
  const control = specOf(planSpecs(sub).specs, "control");
  const { result } = evaluateRules(sub, attackOf(control));
  assert.equal(result.decision, "allow");
  assert.ok(result.checks.every((c) => c.ok));
});

test("the tamper attack fails on the signature, while the untouched mandate verifies", () => {
  const sub = subjectFromTerms(TERMS);
  const tamper = specOf(planSpecs(sub).specs, "tamper");
  assert.equal(evaluateRules(sub, attackOf(tamper)).result.checks.find((c) => c.rule === "signature")!.ok, false);
  const control = specOf(planSpecs(sub).specs, "control");
  assert.equal(evaluateRules(sub, attackOf(control)).result.checks.find((c) => c.rule === "signature")!.ok, true);
});

test("attacks that cannot be crafted for this mandate are skipped, with a reason", () => {
  // No allow-list, no blocked terms, plenty of budget left (so remaining >= cap).
  const sub = subjectFromTerms({ ...TERMS, blockedTerms: [], allowedMerchants: [], spent: 0 });
  const { specs, skipped } = planSpecs(sub);
  assert.equal(specs.some((s) => s.id === "lookalike"), false);
  assert.equal(specs.some((s) => s.scenario === "keyword-evasion"), false);
  assert.equal(specs.some((s) => s.id === "overdraw"), false);
  assert.deepEqual(skipped.map((s) => s.scenario).sort(), ["Keyword evasion", "Look-alike store", "Overdraw"]);
  assert.ok(skipped.every((s) => s.reason.length > 20));
  // With no allow-list the attacks use a clearly synthetic store, never a real shop.
  assert.ok(specs.every((s) => s.merchant.endsWith(".example")));
});

test("keyword evasion targets the mandate's own blocked terms, at most two", () => {
  const { specs } = planSpecs(subjectFromTerms(TERMS));
  const kw = specs.filter((s) => s.scenario === "keyword-evasion");
  assert.deepEqual(kw.map((s) => s.term), ["fast fashion", "gaming"]);
  for (const s of kw) assert.ok(s.brief.includes(`"${s.term}"`));
});

test("a mandate with almost nothing left is refused rather than attacked meaninglessly", () => {
  assert.throws(() => planSpecs(subjectFromTerms({ ...TERMS, spent: 99.5 })), /left to spend/);
});

test("the keyword check recognises text that dodges the exact phrase", () => {
  assert.equal(evadesKeyword("fast fashion", "Ultra FAST-fashion haul"), true);
  assert.equal(evadesKeyword("fast fashion", "Great FAST FASHION haul"), false);
});

test("look-alike domains resemble the original but are not on the list", () => {
  assert.equal(lookalike("tracksmith.com"), "tracksmith-outlet.com");
  assert.equal(lookalike("shop.mango.com"), "shop.mango-outlet.com");
  assert.equal(isAllowedMerchant("www.shop-b.org", ["shop-b.org"]), true);
  assert.equal(isAllowedMerchant("shop-b-outlet.org", ["shop-b.org"]), false);
});

test("a real mandate is simulated as active, un-tampered and judged before it expired", () => {
  const secret = "store-secret";
  const terms: MandateTerms = {
    name: "Old one",
    goal: "g",
    currency: "USD",
    budget: 100,
    maxPerItem: 40,
    autoApproveBelow: 25,
    blockedTerms: [],
    allowedMerchants: [],
    expiresAt: new Date(Date.now() - 86_400_000).toISOString(), // already expired
  };
  const id = "mnd_real";
  const real: Mandate = {
    ...terms,
    id,
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    status: "closed",
    signature: signMandate(id, terms, secret),
    spent: 10,
    reserved: 0,
    budget: 1000, // the tamper demo left the budget edited...
    tamperedFrom: 100, // ...but remembers the signed value
    paypal: {},
  };
  const sub = subjectFromMandate(real, secret);
  assert.equal(sub.mandate.budget, 100, "the signed budget is restored");
  assert.equal(sub.remaining, 90, "real spent is respected");
  assert.ok(sub.notes.length >= 2, "the page is told it is being simulated");

  const control = specOf(planSpecs(sub).specs, "control");
  const { result } = evaluateRules(sub, attackOf(control));
  const failed = result.checks.filter((c) => !c.ok && c.rule !== "auto_approve");
  assert.deepEqual(failed, [], "an expired, closed, tampered mandate still behaves like its live rules for the control");
});
