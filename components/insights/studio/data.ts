// AG Studio data sources for the Insights dashboard: one table per row type in lib/insights-types.ts,
// the relationships between them, a shared calendar and a few calculated rates.

import type { AgDataSourcesDefinition, AgExpressionFieldDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from "ag-studio";
import type { InsightsData } from "@/lib/insights-types";

const CALENDAR_ID = "calendar";

// [id, name, format, hide?]
type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];

const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split(".");
  const [targetTable, targetField] = target.split(".");
  return {
    id,
    source: { tableId: sourceTable, fieldId: sourceField },
    target: { tableId: targetTable, fieldId: targetField },
    type: "many-to-one",
  };
};

const onCalendar = (tableId: string, fieldId: string): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
});

const sumOf = (id: string) => ({ id, aggregation: "sum" as const });

const ratio = (id: string, name: string, description: string, numerator: string, denominator: string): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  format: "percentageFormat",
  isMeasure: true,
  expression: { operator: "divide", inputs: [sumOf(numerator), sumOf(denominator)] },
});

export const hasData = (d: InsightsData) => d.reviews.length + d.purchases.length + d.mandates.length > 0;

export function buildStudioData(d: InsightsData): AgDataSourcesDefinition {
  const dates = [...d.reviews.map((r) => r.date), ...d.purchases.map((p) => p.date), ...d.approvals.map((a) => a.date)].filter(Boolean).sort();
  const today = d.asOf.slice(0, 10);

  return {
    description:
      "Mandate is an AI shopping agent that may only spend inside a signed budget. Every purchase the agent proposes is reviewed by a " +
      "deterministic rules engine and an independent auditor model; the strictest verdict wins (Approved, Needs approval, Blocked). " +
      "Money amounts are USD." +
      "Use Protected for money kept safe by blocked purchases, and Block rate for how often the guardrails said no.",
    sources: [
      {
        id: "mandates",
        description: "Spending mandates: the signed budgets the agent works inside.",
        data: d.mandates,
        fields: fields([
          ["id", "Mandate ID", "textFormat", true],
          ["name", "Mandate", "textFormat"],
          ["status", "Mandate Status", "textFormat"],
          ["budget", "Budget", "currencyFormat"],
          ["spent", "Spent", "currencyFormat"],
          ["reserved", "Reserved", "currencyFormat"],
          ["remaining", "Remaining", "currencyFormat"],
          ["released", "Released to Buyer", "currencyFormat"],
          ["maxPerItem", "Per-item Cap", "currencyFormat"],
          ["autoApproveBelow", "Auto-approve Below", "currencyFormat"],
          ["createdAt", "Created", "dateFormat"],
        ]),
      },
      {
        id: "reviews",
        name: "Purchase Reviews",
        description:
          "One row per purchase the agent proposed. Outcome is the strictest verdict of the rules engine and the auditor. " +
          "Stopped by names the rule or auditor finding that decided it, or Cleared if nothing objected.",
        data: d.reviews,
        fields: fields([
          ["id", "Review ID", "textFormat", true],
          ["mandateId", "Mandate ID", "textFormat", true],
          ["at", "Reviewed At", "dateTimeFormat"],
          ["date", "Review Date", "dateFormat"],
          ["title", "Product", "textFormat"],
          ["merchant", "Merchant", "textFormat"],
          ["amount", "Price", "currencyFormat"],
          ["outcome", "Outcome", "textFormat"],
          ["stoppedBy", "Stopped By", "textFormat"],
          ["auditorVerdict", "Auditor Verdict", "textFormat"],
          ["fitScore", "Auditor Fit Score", "integerFormat"],
          ["injectionSuspected", "Injection Suspected", "booleanFormat"],
          ["protectedAmount", "Protected", "currencyFormat"],
          ["count", "Reviews", "integerFormat"],
          ["isBlocked", "Blocked", "integerFormat"],
          ["isEscalated", "Needs Approval", "integerFormat"],
          ["isCleared", "Cleared", "integerFormat"],
          ["injectionCaught", "Injections Caught", "integerFormat"],
        ]),
      },
      {
        id: "ruleChecks",
        name: "Rule Checks",
        description: "One row per deterministic rule evaluated in a review, with whether it passed.",
        data: d.ruleChecks,
        fields: fields([
          ["id", "Check ID", "textFormat"],
          ["reviewId", "Review ID", "textFormat", true],
          ["mandateId", "Mandate ID", "textFormat", true],
          ["date", "Check Date", "dateFormat"],
          ["rule", "Rule", "textFormat"],
          ["result", "Result", "textFormat"],
        ]),
      },
      {
        id: "purchases",
        description: "Purchases that were captured against the PayPal authorization (sandbox).",
        data: d.purchases,
        fields: fields([
          ["id", "Purchase ID", "textFormat", true],
          ["mandateId", "Mandate ID", "textFormat", true],
          ["date", "Purchase Date", "dateFormat"],
          ["title", "Purchased Item", "textFormat"],
          ["brand", "Brand", "textFormat"],
          ["merchant", "Purchase Merchant", "textFormat"],
          ["amount", "Amount", "currencyFormat"],
          ["refunded", "Refunded", "currencyFormat"],
          ["net", "Net Spend", "currencyFormat"],
          ["via", "Approved Via", "textFormat"],
          ["status", "Payment Status", "textFormat"],
        ]),
      },
      {
        id: "approvals",
        description: "Purchases that needed a human decision, and how long the human took.",
        data: d.approvals,
        fields: fields([
          ["id", "Approval ID", "textFormat", true],
          ["mandateId", "Mandate ID", "textFormat", true],
          ["date", "Approval Date", "dateFormat"],
          ["title", "Approval Item", "textFormat"],
          ["amount", "Approval Amount", "currencyFormat"],
          ["status", "Approval Status", "textFormat"],
          ["hoursToDecide", "Hours to Decide", "decimalFormat"],
        ]),
      },
      {
        id: "limitOrders",
        name: "Limit Orders",
        description: "Standing orders where the agent waits for a price to fall to a target.",
        data: d.limitOrders,
        fields: fields([
          ["id", "Order ID", "textFormat", true],
          ["mandateId", "Mandate ID", "textFormat", true],
          ["title", "Watched Item", "textFormat"],
          ["merchant", "Order Merchant", "textFormat"],
          ["targetPrice", "Target Price", "currencyFormat"],
          ["currentPrice", "Current Price", "currencyFormat"],
          ["gapToTarget", "Gap to Target", "currencyFormat"],
          ["status", "Order Status", "textFormat"],
        ]),
      },
    ],
    relationships: [
      manyToOne("review-mandate", "reviews.mandateId", "mandates.id"),
      manyToOne("check-review", "ruleChecks.reviewId", "reviews.id"),
      manyToOne("purchase-mandate", "purchases.mandateId", "mandates.id"),
      manyToOne("approval-mandate", "approvals.mandateId", "mandates.id"),
      manyToOne("order-mandate", "limitOrders.mandateId", "mandates.id"),
      onCalendar("reviews", "date"),
      onCalendar("purchases", "date"),
      onCalendar("approvals", "date"),
      onCalendar("ruleChecks", "date"),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: "Calendar",
        range: {
          from: { type: "date", value: dates[0] ?? today },
          to: { type: "date", value: dates.at(-1) ?? today },
        },
        fragments: ["year", "quarter", "month", "week", "day", "dayOfWeek"],
      },
    ],
    expressions: [
      ratio("blockRate", "Block Rate", "Share of reviewed purchases that were blocked.", "reviews.isBlocked", "reviews.count"),
      ratio("clearRate", "Auto-clear Rate", "Share of reviewed purchases cleared with no human needed.", "reviews.isCleared", "reviews.count"),
      ratio("budgetUsed", "Budget Used", "Spent divided by total budget across the selected mandates.", "mandates.spent", "mandates.budget"),
    ],
  };
}
