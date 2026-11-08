import { createHmac, timingSafeEqual } from "node:crypto";
import type { Decision, Mandate, MandateTerms, ProductSnapshot, RuleCheck } from "./types";

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Stable serialization so the signature does not depend on key order. */
export function canonicalTerms(t: MandateTerms): string {
  return JSON.stringify({
    name: t.name,
    goal: t.goal,
    currency: t.currency,
    budget: round2(t.budget),
    maxPerItem: round2(t.maxPerItem),
    autoApproveBelow: round2(t.autoApproveBelow),
    blockedTerms: [...t.blockedTerms].map((s) => s.toLowerCase()).sort(),
    allowedMerchants: [...t.allowedMerchants].map((s) => s.toLowerCase()).sort(),
    expiresAt: t.expiresAt,
  });
}

export function signMandate(id: string, terms: MandateTerms, secret: string): string {
  return createHmac("sha256", secret).update(`${id}.${canonicalTerms(terms)}`).digest("hex");
}

export function verifyMandate(m: Mandate, secret: string): boolean {
  const expected = Buffer.from(signMandate(m.id, m, secret), "hex");
  let actual: Buffer;
  try {
    actual = Buffer.from(m.signature, "hex");
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function remainingBudget(m: Pick<Mandate, "budget" | "spent" | "reserved">): number {
  return round2(m.budget - m.spent - m.reserved);
}

export type RuleResult = { decision: Decision; checks: RuleCheck[] };

export type RuleOptions = {
  secret: string;
  /** Price the agent was quoted when it proposed the purchase. */
  quotedPrice?: number;
  now?: Date;
  /** Budget already reserved for this very purchase (limit-order trigger). */
  reservedForThis?: number;
};

const PRICE_DRIFT_TOLERANCE = 0.02; // 2%

function haystack(p: ProductSnapshot) {
  return `${p.title} ${p.brand} ${p.description} ${p.merchant}`.toLowerCase();
}

/**
 * Deterministic policy engine. No LLM involved: this is the part that makes
 * the mandate a real guardrail. Any failed check blocks the purchase; a
 * purchase above `autoApproveBelow` is escalated to a human.
 */
export function checkRules(m: Mandate, product: ProductSnapshot, opts: RuleOptions): RuleResult {
  const now = opts.now ?? new Date();
  const checks: RuleCheck[] = [];
  const add = (rule: string, ok: boolean, message: string) => checks.push({ rule, ok, message });

  add(
    "signature",
    verifyMandate(m, opts.secret),
    verifyMandate(m, opts.secret)
      ? "Mandate terms match their signature"
      : "Mandate terms were modified after signing - refusing to spend",
  );

  add(
    "funded",
    m.status === "active" && !!m.paypal.authorizationId,
    m.status === "active" && !!m.paypal.authorizationId
      ? "Mandate is funded by a PayPal authorization"
      : `Mandate is not active (status: ${m.status})`,
  );

  const expired = now.getTime() > new Date(m.expiresAt).getTime();
  add("not_expired", !expired, expired ? `Mandate expired ${m.expiresAt}` : "Mandate has not expired");

  add(
    "currency",
    product.currency === m.currency,
    product.currency === m.currency
      ? `Currency is ${m.currency}`
      : `Product is priced in ${product.currency}, mandate is ${m.currency}`,
  );

  add("in_stock", product.inStock, product.inStock ? "Offer is in stock" : "Offer is out of stock");

  add(
    "per_item_cap",
    product.price <= m.maxPerItem,
    product.price <= m.maxPerItem
      ? `$${product.price} is within the $${m.maxPerItem} per-item cap`
      : `$${product.price} exceeds the $${m.maxPerItem} per-item cap`,
  );

  const available = round2(remainingBudget(m) + (opts.reservedForThis ?? 0));
  add(
    "budget",
    product.price <= available,
    product.price <= available
      ? `$${product.price} fits the $${available} remaining budget`
      : `$${product.price} exceeds the $${available} remaining budget`,
  );

  if (m.allowedMerchants.length > 0) {
    // Exact domain or a true subdomain ("www.bestbuy.com"), never a look-alike ("notbestbuy.com").
    const okMerchant = m.allowedMerchants.some((a) => {
      const allowed = a.toLowerCase();
      const domain = product.merchant.toLowerCase();
      return domain === allowed || domain.endsWith(`.${allowed}`);
    });
    add(
      "merchant",
      okMerchant,
      okMerchant
        ? `${product.merchant} is an allowed merchant`
        : `${product.merchant} is not in the allowed merchants (${m.allowedMerchants.join(", ")})`,
    );
  }

  const text = haystack(product);
  const hit = m.blockedTerms.find((t) => t && text.includes(t.toLowerCase()));
  add(
    "blocked_terms",
    !hit,
    hit ? `Product matches blocked term "${hit}"` : "No blocked terms found in the listing",
  );

  if (opts.quotedPrice !== undefined) {
    const drift = Math.abs(product.price - opts.quotedPrice) / Math.max(opts.quotedPrice, 0.01);
    add(
      "price_fresh",
      drift <= PRICE_DRIFT_TOLERANCE,
      drift <= PRICE_DRIFT_TOLERANCE
        ? "Live price matches the price the agent saw"
        : `Live price $${product.price} differs from the quoted $${opts.quotedPrice}`,
    );
  }

  const failed = checks.some((c) => !c.ok);
  let decision: Decision = "allow";
  if (failed) decision = "block";
  else if (product.price > m.autoApproveBelow) {
    decision = "escalate";
    add(
      "auto_approve",
      false,
      `$${product.price} is above the $${m.autoApproveBelow} auto-approve limit - needs a human`,
    );
  } else {
    add("auto_approve", true, `$${product.price} is within the $${m.autoApproveBelow} auto-approve limit`);
  }

  return { decision, checks };
}

const SEVERITY: Record<Decision, number> = { allow: 0, escalate: 1, block: 2 };

/** The final decision is the most restrictive of all reviewers. */
export function strictest(...ds: Decision[]): Decision {
  return ds.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), "allow" as Decision);
}
