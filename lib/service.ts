import { audit } from "./auditor";
import { env } from "./env";
import { getProduct } from "./channel3";
import { checkRules, holdWasReleased, remainingBudget, round2, signMandate, strictest, verifyMandate } from "./mandate";
import * as paypal from "./paypal";
import { checkPricesViaWorkflow } from "./workflow";
import { recordRefund, refundable, refundedTotal } from "./refunds";
import { applyWebhookEvent, type WebhookEvent, type WebhookResult } from "./webhook";
import { logEvent, mutate, newId, readStore } from "./store";
import type {
  Approval,
  AuditorVerdict,
  Decision,
  LimitOrder,
  Mandate,
  MandateTerms,
  ProductSnapshot,
  Purchase,
  PurchaseVia,
  RuleCheck,
} from "./types";

const DAY = 86_400_000;
const MAX_MANDATE_DAYS = 28; // PayPal authorizations are valid for 29 days

/* ------------------------------------------------------------------ */
/* Mandates                                                            */
/* ------------------------------------------------------------------ */

export type MandateInput = Omit<MandateTerms, "expiresAt" | "currency"> & { days?: number };

export function validateTerms(input: MandateInput): string | null {
  if (!input.name?.trim()) return "Give the mandate a name.";
  if (!input.goal?.trim()) return "Describe what the agent should buy.";
  if (!(input.budget >= 5 && input.budget <= 2000)) return "Budget must be between $5 and $2,000 (sandbox).";
  if (!(input.maxPerItem > 0 && input.maxPerItem <= input.budget)) return "Per-item cap must be above $0 and no more than the budget.";
  if (!(input.autoApproveBelow >= 0 && input.autoApproveBelow <= input.maxPerItem))
    return "Auto-approve limit cannot exceed the per-item cap.";
  return null;
}

export async function createMandate(input: MandateInput) {
  const err = validateTerms(input);
  if (err) throw new Error(err);
  const days = Math.min(Math.max(input.days ?? 7, 1), MAX_MANDATE_DAYS);
  const id = newId("mnd");
  const terms: MandateTerms = {
    name: input.name.trim(),
    goal: input.goal.trim(),
    currency: "USD",
    budget: round2(input.budget),
    maxPerItem: round2(input.maxPerItem),
    autoApproveBelow: round2(input.autoApproveBelow),
    blockedTerms: input.blockedTerms.map((s) => s.trim().toLowerCase()).filter(Boolean),
    allowedMerchants: input.allowedMerchants.map((s) => s.trim().toLowerCase()).filter(Boolean),
    expiresAt: new Date(Date.now() + days * DAY).toISOString(),
  };

  const funding = await paypal.createFundingOrder({
    mandateId: id,
    amount: terms.budget,
    // Deliberately neutral: PayPal screens order text for compliance, and a user-typed name (a band, a place, a
    // brand) can trip that screen and get the buyer's approval declined. The name stays in our own records.
    description: `Spending mandate ${id}`,
    returnUrl: `${env.appUrl}/api/paypal/return?mandate=${id}`,
    cancelUrl: `${env.appUrl}/api/paypal/cancel?mandate=${id}`,
  });

  return mutate((s) => {
    const mandate: Mandate = {
      ...terms,
      id,
      createdAt: new Date().toISOString(),
      status: "pending_funding",
      signature: signMandate(id, terms, s.signingSecret),
      spent: 0,
      reserved: 0,
      paypal: { orderId: funding.orderId, approveUrl: funding.approveUrl },
    };
    s.mandates.push(mandate);
    logEvent(s, {
      mandateId: id,
      actor: "user",
      kind: "mandate_created",
      summary: `Created mandate "${terms.name}": $${terms.budget} budget, $${terms.maxPerItem} per item, signed.`,
    });
    return mandate;
  });
}

/** Called after the buyer approves the budget in PayPal. */
export async function completeFunding(mandateId: string, orderId: string) {
  const auth = await paypal.authorizeOrder(orderId);
  return mutate((s) => {
    const m = s.mandates.find((x) => x.id === mandateId);
    if (!m) throw new Error("Mandate not found");
    m.status = "active";
    m.paypal.authorizationId = auth.authorizationId;
    m.paypal.fundedAmount = auth.amount;
    m.paypal.payerEmail = auth.payerEmail;
    logEvent(s, {
      mandateId,
      actor: "paypal",
      kind: "funded",
      summary: `Buyer approved $${auth.amount.toFixed(2)} in PayPal. Authorization ${auth.authorizationId} is now the mandate's spending pool.`,
    });
    return m;
  });
}

export async function closeMandate(mandateId: string) {
  return mutate(async (s) => {
    const m = s.mandates.find((x) => x.id === mandateId);
    if (!m) throw new Error("Mandate not found");
    let voided = false;
    if (m.paypal.authorizationId && m.status === "active") {
      try {
        await paypal.voidAuthorization(m.paypal.authorizationId);
        voided = true;
      } catch (e) {
        logEvent(s, { mandateId, actor: "paypal", kind: "void_failed", summary: `Void failed: ${(e as Error).message}` });
      }
    }
    for (const lo of s.limitOrders) {
      if (lo.mandateId === mandateId && lo.status === "watching") {
        lo.status = "cancelled";
        lo.statusNote = "Mandate closed";
      }
    }
    m.reserved = 0;
    m.status = "closed";
    logEvent(s, {
      mandateId,
      actor: "user",
      kind: "closed",
      summary: `Closed mandate. Spent $${m.spent.toFixed(2)} of $${m.budget.toFixed(2)}.${voided ? " The unspent PayPal hold was released." : ""}`,
    });
    return m;
  });
}

/** Demo control: modify terms WITHOUT re-signing, to show tamper protection. */
export async function toggleTamper(mandateId: string) {
  return mutate((s) => {
    const m = s.mandates.find((x) => x.id === mandateId);
    if (!m) throw new Error("Mandate not found");
    if (m.tamperedFrom === undefined) {
      m.tamperedFrom = m.budget;
      m.budget = round2(m.budget * 10);
      logEvent(s, { mandateId, actor: "system", kind: "tamper", summary: `DEMO: budget edited from $${m.tamperedFrom} to $${m.budget} without re-signing.` });
    } else {
      m.budget = m.tamperedFrom;
      m.tamperedFrom = undefined;
      logEvent(s, { mandateId, actor: "system", kind: "tamper_restored", summary: "DEMO: budget restored to its signed value." });
    }
    return m;
  });
}

/* ------------------------------------------------------------------ */
/* Purchases                                                           */
/* ------------------------------------------------------------------ */

export type Outcome = {
  outcome: "purchased" | "needs_approval" | "blocked" | "failed";
  decision: Decision;
  message: string;
  checks: RuleCheck[];
  auditor?: AuditorVerdict;
  product?: ProductSnapshot;
  purchaseId?: string;
  approvalId?: string;
};

function mandateOrThrow(id: string): Mandate {
  const m = readStore().mandates.find((x) => x.id === id);
  if (!m) throw new Error("Mandate not found");
  return m;
}

function alreadyBought(mandateId: string, productId: string) {
  return readStore().purchases.some(
    (p) => p.mandateId === mandateId && p.product.id === productId && p.status === "captured",
  );
}

/** Capture against the mandate's authorization, re-validating rules under the write lock. */
async function settle(
  mandateId: string,
  product: ProductSnapshot,
  via: PurchaseVia,
  opts: { quotedPrice?: number; reservedForThis?: number; limitOrderId?: string; humanApproved?: boolean },
): Promise<Outcome> {
  return mutate(async (s): Promise<Outcome> => {
    const m = s.mandates.find((x) => x.id === mandateId);
    if (!m) throw new Error("Mandate not found");
    const rules = checkRules(m, product, {
      secret: s.signingSecret,
      quotedPrice: opts.quotedPrice,
      reservedForThis: opts.reservedForThis,
    });
    // A human click can lift only the "above auto-approve limit" gate, nothing else.
    const hardFails = rules.checks.filter((c) => !c.ok && !(opts.humanApproved && c.rule === "auto_approve"));
    if (hardFails.length > 0 || (!opts.humanApproved && rules.decision !== "allow")) {
      const reason = (hardFails[0] ?? rules.checks.find((c) => !c.ok))?.message ?? "Rules changed before payment";
      logEvent(s, { mandateId, actor: "rules", kind: "blocked_at_settlement", decision: "block", summary: `Blocked at payment: ${reason}` });
      return { outcome: "blocked", decision: "block", message: reason, checks: rules.checks, product };
    }

    const purchase: Purchase = {
      id: newId("pur"),
      mandateId,
      product,
      amount: product.price,
      via,
      status: "captured",
      createdAt: new Date().toISOString(),
    };
    try {
      const cap = await paypal.captureAuthorization({
        authorizationId: m.paypal.authorizationId!,
        amount: product.price,
        invoiceId: purchase.id,
        note: `Mandate purchase: ${product.title}`,
        requestId: purchase.id,
      });
      purchase.captureId = cap.captureId;
      if (cap.status !== "COMPLETED" && cap.status !== "PENDING") purchase.status = "failed";
    } catch (e) {
      purchase.status = "failed";
      purchase.error = (e as Error).message;
    }

    if (purchase.status === "failed") {
      s.purchases.push(purchase);
      logEvent(s, { mandateId, actor: "paypal", kind: "capture_failed", summary: `PayPal capture failed: ${purchase.error ?? "unexpected status"}` });
      if (opts.limitOrderId) {
        const lo = s.limitOrders.find((x) => x.id === opts.limitOrderId);
        if (lo) {
          lo.status = "blocked";
          lo.statusNote = "PayPal capture failed";
          m.reserved = round2(Math.max(0, m.reserved - (opts.reservedForThis ?? 0)));
        }
      }
      return { outcome: "failed", decision: "block", message: `PayPal capture failed: ${purchase.error ?? "unexpected status"}`, checks: rules.checks, product };
    }

    m.spent = round2(m.spent + purchase.amount);
    if (opts.reservedForThis) m.reserved = round2(Math.max(0, m.reserved - opts.reservedForThis));
    s.purchases.push(purchase);
    if (opts.limitOrderId) {
      const lo = s.limitOrders.find((x) => x.id === opts.limitOrderId);
      if (lo) {
        lo.status = "purchased";
        lo.statusNote = `Bought at $${purchase.amount.toFixed(2)}`;
        lo.currentPrice = purchase.amount;
      }
    }
    logEvent(s, {
      mandateId,
      actor: "paypal",
      kind: "captured",
      summary: `Captured $${purchase.amount.toFixed(2)} for "${product.title}" (${product.merchant}) - PayPal capture ${purchase.captureId}. $${remainingBudget(m).toFixed(2)} left.`,
      details: { captureId: purchase.captureId, via },
    });
    return {
      outcome: "purchased",
      decision: "allow",
      message: `Purchased "${product.title}" for $${purchase.amount.toFixed(2)} from ${product.merchant}.`,
      checks: rules.checks,
      product,
      purchaseId: purchase.id,
    };
  });
}

/**
 * "Undo purchase": a human-only action (the agent has no refund tool). Refunds whatever is left of the capture back
 * to the buyer through PayPal. It does not hand budget back to the mandate (see lib/refunds.ts).
 */
export async function refundPurchase(purchaseId: string): Promise<{ ok: boolean; message: string }> {
  return mutate(async (s) => {
    const p = s.purchases.find((x) => x.id === purchaseId);
    if (!p) return { ok: false, message: "Purchase not found." };
    if (p.status === "refunded") return { ok: false, message: "This purchase was already refunded." };
    if (p.status !== "captured" || !p.captureId) return { ok: false, message: "Only a captured purchase can be refunded." };
    const left = refundable(p);
    if (left <= 0) return { ok: false, message: "Nothing is left to refund on this purchase." };
    try {
      const r = await paypal.refundCapture(p.captureId, refundedTotal(p) > 0 ? left : undefined);
      if (r.status === "FAILED" || r.status === "CANCELLED") throw new Error(`PayPal refund ${r.status.toLowerCase()}`);
      const amount = r.amount || left;
      recordRefund(s, p, { id: r.refundId, amount, status: r.status, at: new Date().toISOString(), source: "app" });
      return { ok: true, message: `Refunded $${amount.toFixed(2)} for "${p.product.title}" back to the buyer.` };
    } catch (e) {
      logEvent(s, { mandateId: p.mandateId, actor: "paypal", kind: "refund_failed", summary: `Refund of "${p.product.title}" failed: ${(e as Error).message}` });
      return { ok: false, message: `PayPal could not refund this purchase: ${(e as Error).message}` };
    }
  });
}

/** Applies a (signature-verified) PayPal webhook event. Also lets a webhook finish funding if the buyer never came back. */
export async function handleWebhook(event: WebhookEvent): Promise<WebhookResult> {
  const id = event?.resource?.id as string | undefined;
  if (event?.event_type === "CHECKOUT.ORDER.APPROVED" && id) {
    const m = readStore().mandates.find((x) => x.paypal.orderId === id);
    if (m && m.status === "pending_funding") {
      try {
        await completeFunding(m.id, id); // same call the return URL makes; PayPal's request id makes it safe to repeat
      } catch (e) {
        await mutate((s) => logEvent(s, { mandateId: m.id, actor: "paypal", kind: "funding_failed", summary: `Could not place the hold after PayPal reported approval: ${(e as Error).message}` }));
      }
    }
  }
  return mutate((s) => applyWebhookEvent(s, event));
}

function recordReview(mandateId: string, product: ProductSnapshot, rules: { decision: Decision; checks: RuleCheck[] }, auditor: AuditorVerdict | undefined, final: Decision) {
  return mutate((s) => {
    const failed = rules.checks.filter((c) => !c.ok && c.rule !== "auto_approve");
    logEvent(s, {
      mandateId,
      actor: "rules",
      kind: "rules_review",
      decision: rules.decision,
      summary: failed.length
        ? `Rules blocked "${product.title}": ${failed.map((f) => f.message).join("; ")}`
        : `Rules passed for "${product.title}" at $${product.price.toFixed(2)}.`,
      details: rules.checks,
      review: {
        title: product.title,
        merchant: product.merchant,
        amount: product.price,
        final,
        auditorVerdict: auditor?.verdict,
        fitScore: auditor?.fitScore,
        injectionSuspected: auditor?.injectionSuspected,
      },
    });
    if (auditor) {
      logEvent(s, {
        mandateId,
        actor: "auditor",
        kind: "auditor_review",
        decision: auditor.verdict,
        summary: `Auditor ${auditor.verdict.toUpperCase()} (fit ${auditor.fitScore}/100${auditor.injectionSuspected ? ", prompt-injection suspected" : ""}): ${auditor.reasons.join(" ")}`,
        details: auditor,
      });
    }
  });
}

/** The full pipeline the agent goes through for every purchase it proposes. */
export async function proposePurchase(args: {
  mandateId: string;
  productId: string;
  merchant?: string;
  reason: string;
  quotedPrice?: number;
}): Promise<Outcome> {
  const m = mandateOrThrow(args.mandateId);
  let product: ProductSnapshot | null;
  try {
    product = await getProduct(args.productId, args.merchant);
  } catch (e) {
    return { outcome: "failed", decision: "block", message: `Could not refresh the product: ${(e as Error).message}`, checks: [] };
  }
  if (!product) return { outcome: "blocked", decision: "block", message: "Product has no purchasable offer.", checks: [] };

  if (alreadyBought(m.id, product.id)) {
    return { outcome: "blocked", decision: "block", message: "This product was already purchased under this mandate.", checks: [], product };
  }

  const rules = checkRules(m, product, { secret: readStore().signingSecret, quotedPrice: args.quotedPrice });
  if (rules.decision === "block") {
    await recordReview(m.id, product, rules, undefined, "block");
    const why = rules.checks.filter((c) => !c.ok).map((c) => c.message).join("; ");
    return { outcome: "blocked", decision: "block", message: `Blocked by mandate rules: ${why}`, checks: rules.checks, product };
  }

  const auditor = await audit(m, product, args.reason);
  const final = strictest(rules.decision, auditor.verdict);
  await recordReview(m.id, product, rules, auditor, final);

  if (final === "block") {
    return { outcome: "blocked", decision: "block", message: `Auditor blocked this purchase: ${auditor.reasons.join(" ")}`, checks: rules.checks, auditor, product };
  }
  if (final === "escalate") {
    const approval = await createApproval(m.id, product, "agent", rules.checks, auditor, [
      ...rules.checks.filter((c) => !c.ok).map((c) => c.message),
      ...(auditor.verdict === "escalate" ? auditor.reasons : []),
    ]);
    return {
      outcome: "needs_approval",
      decision: "escalate",
      message: `Needs human approval before payment (${approval.reasons.join("; ")}).`,
      checks: rules.checks,
      auditor,
      product,
      approvalId: approval.id,
    };
  }

  const result = await settle(m.id, product, "agent", { quotedPrice: args.quotedPrice });
  return { ...result, auditor };
}

function createApproval(
  mandateId: string,
  product: ProductSnapshot,
  via: PurchaseVia,
  checks: RuleCheck[],
  auditor: AuditorVerdict | undefined,
  reasons: string[],
  limitOrderId?: string,
): Promise<Approval> {
  return mutate((s) => {
    const approval: Approval = {
      id: newId("apr"),
      mandateId,
      product,
      reasons: reasons.length ? reasons : ["Needs your approval"],
      checks,
      auditor,
      via,
      limitOrderId,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    s.approvals.push(approval);
    logEvent(s, {
      mandateId,
      actor: "system",
      kind: "approval_requested",
      decision: "escalate",
      summary: `Waiting for your approval: "${product.title}" at $${product.price.toFixed(2)}.`,
    });
    return approval;
  });
}

export async function resolveApproval(approvalId: string, action: "approve" | "reject"): Promise<Outcome | { outcome: "rejected"; message: string }> {
  const approval = readStore().approvals.find((a) => a.id === approvalId);
  if (!approval) throw new Error("Approval not found");
  if (approval.status !== "pending") throw new Error("This approval was already resolved.");

  if (action === "reject") {
    await mutate((s) => {
      const a = s.approvals.find((x) => x.id === approvalId)!;
      a.status = "rejected";
      a.resolvedAt = new Date().toISOString();
      if (a.limitOrderId) {
        const lo = s.limitOrders.find((x) => x.id === a.limitOrderId);
        const m = s.mandates.find((x) => x.id === a.mandateId);
        if (lo && m) {
          m.reserved = round2(Math.max(0, m.reserved - lo.targetPrice));
          lo.status = "cancelled";
          lo.statusNote = "You rejected the purchase";
        }
      }
      logEvent(s, { mandateId: a.mandateId, actor: "user", kind: "approval_rejected", decision: "block", summary: `You rejected "${a.product.title}".` });
    });
    return { outcome: "rejected", message: "Rejected." };
  }

  const lo = approval.limitOrderId ? readStore().limitOrders.find((x) => x.id === approval.limitOrderId) : undefined;
  const result = await settle(approval.mandateId, approval.product, "human_approval", {
    humanApproved: true,
    reservedForThis: lo?.targetPrice,
    limitOrderId: lo?.id,
  });
  await mutate((s) => {
    const a = s.approvals.find((x) => x.id === approvalId)!;
    a.status = result.outcome === "purchased" ? "approved" : "rejected";
    a.resolvedAt = new Date().toISOString();
    logEvent(s, { mandateId: a.mandateId, actor: "user", kind: "approval_resolved", decision: result.outcome === "purchased" ? "allow" : "block", summary: `You approved "${a.product.title}" - ${result.message}` });
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* Limit orders: authorize now, capture only when the price drops      */
/* ------------------------------------------------------------------ */

export async function createLimitOrder(args: {
  mandateId: string;
  productId: string;
  merchant?: string;
  targetPrice: number;
  reason: string;
}): Promise<{ ok: boolean; message: string; limitOrder?: LimitOrder; checks?: RuleCheck[] }> {
  const m = mandateOrThrow(args.mandateId);
  const live = await getProduct(args.productId, args.merchant);
  if (!live) return { ok: false, message: "Product has no purchasable offer." };
  const target = round2(args.targetPrice);
  if (!(target > 0)) return { ok: false, message: "Target price must be above $0." };
  if (target >= live.price) {
    return { ok: false, message: `It is already $${live.price.toFixed(2)}, at or below your $${target.toFixed(2)} target. Propose a purchase instead.` };
  }
  if (alreadyBought(m.id, live.id)) return { ok: false, message: "This product was already purchased under this mandate." };
  const dup = readStore().limitOrders.find((l) => l.mandateId === m.id && l.product.id === live.id && l.status === "watching");
  if (dup) return { ok: false, message: "A limit order for this product is already watching." };

  // Validate the *target* price against the rules: that is the most it can ever cost.
  const probe: ProductSnapshot = { ...live, price: target, inStock: true };
  const rules = checkRules(m, probe, { secret: readStore().signingSecret });
  const hard = rules.checks.filter((c) => !c.ok && c.rule !== "auto_approve");
  if (hard.length) return { ok: false, message: `Limit order refused: ${hard.map((h) => h.message).join("; ")}`, checks: rules.checks };

  const lo = await mutate((s) => {
    const mm = s.mandates.find((x) => x.id === m.id)!;
    mm.reserved = round2(mm.reserved + target);
    const order: LimitOrder = {
      id: newId("lmt"),
      mandateId: m.id,
      product: live,
      targetPrice: target,
      currentPrice: live.price,
      status: "watching",
      createdAt: new Date().toISOString(),
      expiresAt: m.expiresAt,
    };
    s.limitOrders.push(order);
    logEvent(s, {
      mandateId: m.id,
      actor: "agent",
      kind: "limit_order_set",
      summary: `Limit order: buy "${live.title}" if it drops to $${target.toFixed(2)} (now $${live.price.toFixed(2)}). $${target.toFixed(2)} reserved from the mandate.`,
    });
    return order;
  });
  return {
    ok: true,
    limitOrder: lo,
    checks: rules.checks,
    message: `Watching "${live.title}": will buy at $${target.toFixed(2)} or less. $${target.toFixed(2)} of the budget is reserved.${rules.decision === "escalate" ? " Because it is above the auto-approve limit, you will be asked to approve when it triggers." : ""}`,
  };
}

function releaseReserve(m: Mandate, lo: LimitOrder) {
  m.reserved = round2(Math.max(0, m.reserved - lo.targetPrice));
}

export async function cancelLimitOrder(id: string) {
  return mutate((s) => {
    const lo = s.limitOrders.find((x) => x.id === id);
    if (!lo) throw new Error("Limit order not found");
    if (lo.status !== "watching") return lo;
    const m = s.mandates.find((x) => x.id === lo.mandateId)!;
    releaseReserve(m, lo);
    lo.status = "cancelled";
    lo.statusNote = "Cancelled by you";
    logEvent(s, { mandateId: lo.mandateId, actor: "user", kind: "limit_order_cancelled", summary: `Cancelled limit order for "${lo.product.title}". Reservation released.` });
    return lo;
  });
}

/** Demo control: pretend the retailer dropped the price (clearly labelled in the UI). */
export async function simulatePriceDrop(id: string, price?: number) {
  return mutate((s) => {
    const lo = s.limitOrders.find((x) => x.id === id);
    if (!lo) throw new Error("Limit order not found");
    lo.demoPriceOverride = round2(price ?? lo.targetPrice);
    logEvent(s, { mandateId: lo.mandateId, actor: "system", kind: "demo_price_drop", summary: `DEMO: simulated price drop to $${lo.demoPriceOverride.toFixed(2)} for "${lo.product.title}".` });
    return lo;
  });
}

export type CheckSummary = {
  checked: number;
  triggered: number;
  details: string[];
  /** Where the live prices came from: a Render Workflows task run, or direct local calls. */
  via: "render-workflow" | "local";
  runId?: string;
};

/**
 * The watcher tick. Live prices are fetched as a Render Workflows task run (one parallel
 * `checkPrice` run per product) when configured, else directly (Channel3 detail is free).
 * Either way, a price that hits its target is re-read directly before any money moves.
 */
export async function checkLimitOrders(mandateId?: string): Promise<CheckSummary> {
  const summary: CheckSummary = { checked: 0, triggered: 0, details: [], via: "local" };
  const watching = readStore().limitOrders.filter((l) => l.status === "watching" && (!mandateId || l.mandateId === mandateId));

  const active: LimitOrder[] = [];
  for (const order of watching) {
    summary.checked++;
    if (Date.now() > new Date(order.expiresAt).getTime()) {
      await mutate((s) => {
        const lo = s.limitOrders.find((x) => x.id === order.id)!;
        const m = s.mandates.find((x) => x.id === lo.mandateId)!;
        releaseReserve(m, lo);
        lo.status = "expired";
        lo.statusNote = "Mandate expired before the price dropped";
        logEvent(s, { mandateId: lo.mandateId, actor: "system", kind: "limit_order_expired", summary: `Limit order for "${lo.product.title}" expired.` });
      });
      continue;
    }
    active.push(order);
  }
  if (active.length === 0) return summary;

  const remote = await checkPricesViaWorkflow(active.map((o) => ({ productId: o.product.id, merchant: o.product.merchant })));
  if (remote) {
    summary.via = "render-workflow";
    summary.runId = remote.runId;
    const byMandate = new Set(active.map((o) => o.mandateId));
    await mutate((s) => {
      for (const id of byMandate) {
        logEvent(s, {
          mandateId: id,
          actor: "system",
          kind: "workflow_price_check",
          summary: `Checked ${active.length} watched price(s) as Render Workflows task run ${remote.runId} (one parallel task per product).`,
        });
      }
    });
  }

  for (const order of active) {
    const fresh = readStore().limitOrders.find((x) => x.id === order.id)!;
    let live: ProductSnapshot | null = null;
    let price: number | null = null;

    if (remote) {
      const q = remote.quotes.find((x) => x.productId === order.product.id);
      price = q?.price ?? null;
      if (q?.error) summary.details.push(`${order.product.title}: workflow price check failed (${q.error})`);
    } else {
      try {
        live = await getProduct(order.product.id, order.product.merchant);
        price = live?.price ?? null;
      } catch (e) {
        summary.details.push(`${order.product.title}: price check failed (${(e as Error).message})`);
      }
    }

    const demo = fresh.demoPriceOverride;
    const effective = demo ?? price ?? fresh.currentPrice;
    await mutate((s) => {
      const lo = s.limitOrders.find((x) => x.id === order.id)!;
      lo.currentPrice = effective;
      lo.lastCheckedAt = new Date().toISOString();
    });
    if ((price === null && demo === undefined) || effective > fresh.targetPrice) {
      summary.details.push(`${order.product.title}: $${effective.toFixed(2)}, target $${fresh.targetPrice.toFixed(2)}`);
      continue;
    }

    // Target hit. Never trust a remote number with money: re-read the price directly first.
    if (!live) {
      try {
        live = await getProduct(order.product.id, order.product.merchant);
      } catch {
        live = null;
      }
    }
    let product: ProductSnapshot;
    if (demo !== undefined) {
      product = { ...(live ?? order.product), price: effective }; // demo control: simulated drop
    } else if (live && live.price <= fresh.targetPrice) {
      product = live;
    } else {
      summary.details.push(`${order.product.title}: reported $${effective.toFixed(2)} but the direct re-check did not confirm it`);
      continue;
    }
    summary.triggered++;
    summary.details.push(`${order.product.title}: hit target at $${product.price.toFixed(2)}`);
    await triggerLimitOrder(fresh, product);
  }
  return summary;
}

async function triggerLimitOrder(order: LimitOrder, product: ProductSnapshot) {
  const m = mandateOrThrow(order.mandateId);
  await mutate((s) => {
    logEvent(s, { mandateId: order.mandateId, actor: "system", kind: "limit_order_triggered", summary: `Price hit $${product.price.toFixed(2)} (target $${order.targetPrice.toFixed(2)}) for "${product.title}". Running the same checks as any purchase.` });
  });
  const rules = checkRules(m, product, { secret: readStore().signingSecret, reservedForThis: order.targetPrice });
  const release = (status: LimitOrder["status"], note: string) =>
    mutate((s) => {
      const lo = s.limitOrders.find((x) => x.id === order.id)!;
      const mm = s.mandates.find((x) => x.id === lo.mandateId)!;
      if (status !== "escalated") releaseReserve(mm, lo);
      lo.status = status;
      lo.statusNote = note;
    });

  if (rules.decision === "block") {
    await recordReview(m.id, product, rules, undefined, "block");
    await release("blocked", rules.checks.filter((c) => !c.ok).map((c) => c.message).join("; "));
    return;
  }
  const auditor = await audit(m, product, `Limit order triggered at $${product.price}: ${order.product.title}`);
  const final = strictest(rules.decision, auditor.verdict);
  await recordReview(m.id, product, rules, auditor, final);
  if (final === "block") return void (await release("blocked", `Auditor blocked: ${auditor.reasons.join(" ")}`));
  if (final === "escalate") {
    await createApproval(m.id, product, "limit_order", rules.checks, auditor, [
      ...rules.checks.filter((c) => !c.ok).map((c) => c.message),
      ...(auditor.verdict === "escalate" ? auditor.reasons : []),
    ], order.id);
    await release("escalated", "Waiting for your approval");
    return;
  }
  await settle(m.id, product, "limit_order", { reservedForThis: order.targetPrice, limitOrderId: order.id });
}

/* ------------------------------------------------------------------ */
/* Read model for the UI                                               */
/* ------------------------------------------------------------------ */

export function getState(mandateId?: string) {
  const s = readStore();
  const mandates = [...s.mandates].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = mandates.find((m) => m.id === mandateId) ?? mandates[0];
  const scoped = <T extends { mandateId: string }>(xs: T[]) => (active ? xs.filter((x) => x.mandateId === active.id) : []);
  return {
    mandates: mandates.map((m) => ({ id: m.id, name: m.name, status: m.status, budget: m.budget })),
    mandate: active
      ? {
          ...active,
          // Only an active mandate has anything left to spend; a closed one's unspent money went back to the buyer.
          remaining: active.status === "active" ? remainingBudget(active) : 0,
          // Whether closing really voided the PayPal hold (it can fail, in which case nothing was released).
          holdReleased: holdWasReleased(s.events, active.id),
          signatureValid: verifyMandate(active, s.signingSecret),
        }
      : null,
    purchases: scoped(s.purchases)
      .map((p) => ({ ...p, refunded: refundedTotal(p), refundable: refundable(p) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    approvals: scoped(s.approvals).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    limitOrders: scoped(s.limitOrders).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    events: scoped(s.events).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80),
  };
}
