import {
  day,
  OUTCOME,
  round2,
  ruleLabel,
  stoppedBy,
  reviewFlags,
  VERDICT,
  type InsightsData,
  type MandateRow,
  type ReviewRow,
  type RuleCheckRow,
} from "./insights-types";
import { budgetView, holdWasReleased } from "./mandate";
import { readStore } from "./store";
import type { AuditEvent, Decision, Mandate, RuleCheck } from "./types";

export * from "./insights-types";

function mandateRow(m: Mandate, released: boolean): MandateRow {
  const view = budgetView(m, released);
  return {
    id: m.id,
    name: m.name,
    status: m.status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    budget: m.budget,
    spent: m.spent,
    reserved: m.reserved,
    remaining: view.spendable,
    released: view.released,
    maxPerItem: m.maxPerItem,
    autoApproveBelow: m.autoApproveBelow,
    createdAt: day(m.createdAt),
  };
}

function liveInsights(): Omit<InsightsData, "asOf"> {
  const s = readStore();
  const rulesEvents = s.events.filter((e) => e.kind === "rules_review");
  const auditorByTime = s.events.filter((e) => e.kind === "auditor_review");

  const reviews: ReviewRow[] = [];
  const ruleChecks: RuleCheckRow[] = [];

  for (const e of rulesEvents) {
    const checks = Array.isArray(e.details) ? (e.details as RuleCheck[]) : [];
    const r = e.review;
    // Older events predate structured facts: fall back to the summary text.
    const title = r?.title ?? /"(.+?)"/.exec(e.summary)?.[1] ?? "Unknown product";
    const final: Decision = r?.final ?? e.decision ?? "block";
    const auditor = r?.auditorVerdict
      ? { verdict: r.auditorVerdict, injection: !!r.injectionSuspected }
      : legacyAuditor(e, auditorByTime);
    const amount = r?.amount ?? 0;
    reviews.push({
      id: e.id,
      mandateId: e.mandateId,
      at: e.at,
      date: day(e.at),
      title,
      merchant: r?.merchant ?? "unknown",
      amount,
      outcome: OUTCOME[final],
      stoppedBy: stoppedBy(final, checks, auditor),
      auditorVerdict: auditor ? VERDICT[auditor.verdict] : "Not run",
      fitScore: r?.fitScore ?? null,
      injectionSuspected: !!r?.injectionSuspected,
      protectedAmount: final === "block" ? amount : 0,
      ...reviewFlags(final, !!r?.injectionSuspected),
    });
    for (const c of checks) {
      if (c.rule === "auto_approve") continue;
      ruleChecks.push({
        id: `${e.id}:${c.rule}`,
        reviewId: e.id,
        mandateId: e.mandateId,
        date: day(e.at),
        rule: ruleLabel(c.rule),
        result: c.ok ? "Passed" : "Failed",
      });
    }
  }

  return {
    mandates: s.mandates.map((m) => mandateRow(m, holdWasReleased(s.events, m.id))),
    reviews,
    ruleChecks,
    purchases: s.purchases.map((p) => ({
      id: p.id,
      mandateId: p.mandateId,
      date: day(p.createdAt),
      title: p.product.title,
      brand: p.product.brand || "Unbranded",
      merchant: p.product.merchant,
      amount: p.amount,
      via: { agent: "Agent", limit_order: "Limit order", human_approval: "Human approval" }[p.via],
      status: p.status.replace(/^./, (c) => c.toUpperCase()),
    })),
    limitOrders: s.limitOrders.map((o) => ({
      id: o.id,
      mandateId: o.mandateId,
      title: o.product.title,
      merchant: o.product.merchant,
      targetPrice: o.targetPrice,
      currentPrice: o.currentPrice,
      gapToTarget: round2(Math.max(0, o.currentPrice - o.targetPrice)),
      status: o.status.replace(/^./, (c) => c.toUpperCase()),
    })),
    approvals: s.approvals.map((a) => ({
      id: a.id,
      mandateId: a.mandateId,
      date: day(a.createdAt),
      title: a.product.title,
      amount: a.product.price,
      status: a.status.replace(/^./, (c) => c.toUpperCase()),
      hoursToDecide: a.resolvedAt ? round2((Date.parse(a.resolvedAt) - Date.parse(a.createdAt)) / 3_600_000) : null,
    })),
  };
}

/** Pairs an old rules event with the auditor event logged right after it, if any. */
function legacyAuditor(rules: AuditEvent, auditorEvents: AuditEvent[]) {
  const next = auditorEvents.find((a) => a.mandateId === rules.mandateId && a.at >= rules.at && Date.parse(a.at) - Date.parse(rules.at) < 120_000);
  const d = next?.details as { verdict?: Decision; injectionSuspected?: boolean } | undefined;
  return d?.verdict ? { verdict: d.verdict, injection: !!d.injectionSuspected } : undefined;
}

/** Everything the dashboard shows is read straight from the store: real mandates, reviews, purchases and approvals. */
export function buildInsights(): InsightsData {
  return { asOf: new Date().toISOString(), ...liveInsights() };
}
