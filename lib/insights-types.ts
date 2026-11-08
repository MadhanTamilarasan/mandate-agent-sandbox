import type { Decision, RuleCheck } from "./types";

/**
 * Flat, analytics-friendly tables derived from the store. AG Studio treats each
 * array as a data source, so every row is a plain object and every enum is a
 * human label (they become axis labels and legends as-is).
 */

export type Source = "Live" | "Sample";

export type MandateRow = {
  id: string;
  name: string;
  status: string;
  budget: number;
  spent: number;
  reserved: number;
  remaining: number; // spendable now: only active mandates have any
  released: number; // unspent money returned to the buyer when the mandate was closed
  maxPerItem: number;
  autoApproveBelow: number;
  createdAt: string; // yyyy-mm-dd
  source: Source;
};

export type ReviewRow = {
  id: string;
  mandateId: string;
  at: string; // ISO date-time
  date: string; // yyyy-mm-dd
  title: string;
  merchant: string;
  amount: number;
  outcome: "Approved" | "Needs approval" | "Blocked";
  stoppedBy: string; // what decided it: a rule, the auditor, or "Cleared"
  auditorVerdict: string;
  fitScore: number | null;
  injectionSuspected: boolean;
  protectedAmount: number; // amount kept in the account because the purchase was blocked
  // 0/1 columns so a dashboard can sum them into counts and rates.
  count: 1;
  isBlocked: 0 | 1;
  isEscalated: 0 | 1;
  isCleared: 0 | 1;
  injectionCaught: 0 | 1;
  source: Source;
};

export type RuleCheckRow = {
  id: string;
  reviewId: string;
  mandateId: string;
  date: string;
  rule: string;
  result: "Passed" | "Failed";
  source: Source;
};

export type PurchaseRow = {
  id: string;
  mandateId: string;
  date: string;
  title: string;
  brand: string;
  merchant: string;
  amount: number;
  via: string;
  status: string;
  source: Source;
};

export type LimitOrderRow = {
  id: string;
  mandateId: string;
  title: string;
  merchant: string;
  targetPrice: number;
  currentPrice: number;
  gapToTarget: number;
  status: string;
  source: Source;
};

export type ApprovalRow = {
  id: string;
  mandateId: string;
  date: string;
  title: string;
  amount: number;
  status: string;
  hoursToDecide: number | null;
  source: Source;
};

export type InsightsData = {
  asOf: string;
  mandates: MandateRow[];
  reviews: ReviewRow[];
  ruleChecks: RuleCheckRow[];
  purchases: PurchaseRow[];
  limitOrders: LimitOrderRow[];
  approvals: ApprovalRow[];
  counts: { live: number; sample: number };
};

export const RULE_LABEL: Record<string, string> = {
  signature: "Signature",
  funded: "Funded",
  not_expired: "Not expired",
  currency: "Currency",
  in_stock: "In stock",
  per_item_cap: "Per-item cap",
  budget: "Budget",
  merchant: "Merchant allow-list",
  blocked_terms: "Blocked terms",
  price_drift: "Price drift",
  auto_approve: "Auto-approve limit",
};

export const ruleLabel = (rule: string) =>
  RULE_LABEL[rule] ?? rule.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const day = (iso: string) => iso.slice(0, 10);
export const round2 = (n: number) => Math.round(n * 100) / 100;
export function reviewFlags(final: Decision, injection: boolean) {
  return {
    count: 1 as const,
    isBlocked: (final === "block" ? 1 : 0) as 0 | 1,
    isEscalated: (final === "escalate" ? 1 : 0) as 0 | 1,
    isCleared: (final === "allow" ? 1 : 0) as 0 | 1,
    injectionCaught: (final === "block" && injection ? 1 : 0) as 0 | 1,
  };
}

export const OUTCOME = { allow: "Approved", escalate: "Needs approval", block: "Blocked" } as const;
export const VERDICT = { allow: "Allow", escalate: "Escalate", block: "Block" } as const;

/** What stopped (or cleared) a review, in words a dashboard legend can show. */
export function stoppedBy(final: Decision, checks: RuleCheck[], auditor?: { verdict: Decision; injection: boolean }): string {
  const failed = checks.filter((c) => !c.ok && c.rule !== "auto_approve");
  if (final === "allow") return "Cleared";
  if (failed.length) return ruleLabel(failed[0].rule);
  if (auditor && auditor.verdict !== "allow") return auditor.injection ? "Prompt injection" : "Auditor: poor fit";
  return final === "escalate" ? "Over auto-approve limit" : "Rules";
}

