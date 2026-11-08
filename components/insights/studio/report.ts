// The built-in Insights report: three pages as AG Studio report state. Field ids ('reviews.outcome')
// refer to the data sources in ./data.ts. Layout is on a 24-column canvas, in rows of
// studioCanvasRowHeight.

import type { AgPageState, AgReportState, AgResponsiveLayoutBreakpoint, AgWidgetLayoutState } from "ag-studio";

export const PAGES = [
  { id: "overview", title: "Overview", blurb: "What the agent tried, and what stopped it" },
  { id: "guardrails", title: "Guardrails", blurb: "How the rules and the auditor behave" },
  { id: "ledger", title: "Ledger", blurb: "Money that actually moved" },
] as const;

// --- Helpers ----------------------------------------------------------------------

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const avg = (id: string) => ({ id, aggregation: "avg" as const });
const countd = (id: string) => ({ id, aggregation: "countd" as const });

const SERIF = "var(--display)";
const SANS = "var(--font)";

const typography = (fontSize: number, fontFamily = SANS, fontWeight: "normal" | "bold" = "normal") => ({
  fontFamily,
  fontSize,
  fontWeight,
  fontStyle: "normal" as const,
});

// A KPI tile: small caption, large serif value, optional sparkline along `sparklineX`.
const kpi = (text: string, value: { id: string; aggregation?: "sum" | "avg" | "countd" }, sparklineX?: string) => ({
  type: "value" as const,
  dataMapping: {
    value: [value],
    ...(sparklineX && { sparklineX: [{ id: sparklineX }] }),
  },
  format: {
    title: { enabled: true, text, typography: typography(13, SANS, "bold") },
    caption: { enabled: true, text: "", typography: typography(0) },
    style: { typography: typography(34, SERIF) },
  },
});

const legend = { style: { theme: { common: { legend: { enabled: true } } } } };

// --- Pages ------------------------------------------------------------------------

const overview: AgPageState = {
  id: "overview",
  layout: { minWidth: 320 },
  widgets: {
    "kpi-protected": kpi("Money kept safe", sum("reviews.protectedAmount"), "calendar::day"),
    "kpi-reviewed": kpi("Purchases reviewed", sum("reviews.count"), "calendar::day"),
    "kpi-block-rate": kpi("Block rate", { id: "blockRate" }),
    "kpi-spent": kpi("Spent by the agent", sum("purchases.amount"), "calendar::day"),
    "data-source": {
      type: "button-filter",
      dataMapping: { value: [{ id: "mandates.source" }] },
      format: {
        ...title("Data"),
        style: { selection: { type: "multiple" }, dimensions: { height: 28, minWidth: 48 } },
      },
    },
    "reviews-by-day": {
      type: "column-chart-stacked",
      dataMapping: {
        // Use the review date itself, not the calendar, so days with no reviews do not add a blank category.
        categoryKey: [{ id: "reviews.date" }],
        valueKey: [sum("reviews.count")],
        legendKey: [{ id: "reviews.outcome" }],
      },
      format: { ...title("Reviews by day, by outcome"), ...legend },
    },
    "outcome-split": {
      type: "donut-chart",
      dataMapping: {
        categoryKey: [{ id: "reviews.outcome" }],
        valueKey: [sum("reviews.count")],
      },
      format: { ...title("How reviews ended"), ...legend },
    },
    "stopped-by": {
      type: "bar-chart-grouped",
      dataMapping: {
        categoryKey: [{ id: "reviews.stoppedBy" }],
        valueKey: [sum("reviews.count")],
      },
      format: title("What decided each review"),
    },
    "budget-burn": {
      type: "bar-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "mandates.name" }],
        valueKey: [sum("mandates.spent"), sum("mandates.reserved"), sum("mandates.remaining"), sum("mandates.released")],
      },
      format: { ...title("Budget by mandate: spent, reserved, remaining, released"), ...legend },
    },
    "recent-reviews": {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "reviews.at" },
          { id: "reviews.title" },
          { id: "reviews.merchant" },
          sum("reviews.amount"),
          { id: "reviews.outcome" },
          { id: "reviews.stoppedBy" },
          avg("reviews.fitScore"),
        ],
      },
      sort: [{ field: { id: "reviews.at" }, direction: "desc" }],
      format: title("Latest purchase reviews"),
    },
  },
  widgetLayout: {
    "kpi-protected": at(0, 0, 5, 7),
    "kpi-reviewed": at(5, 0, 5, 7),
    "kpi-block-rate": at(10, 0, 5, 7),
    "kpi-spent": at(15, 0, 5, 7),
    "data-source": at(20, 0, 4, 7),
    "reviews-by-day": at(0, 7, 16, 17),
    "outcome-split": at(16, 7, 8, 17),
    "stopped-by": at(0, 24, 12, 17),
    "budget-burn": at(12, 24, 12, 17),
    "recent-reviews": at(0, 41, 24, 19),
  },
};

const guardrails: AgPageState = {
  id: "guardrails",
  layout: { minWidth: 320 },
  widgets: {
    "kpi-injections": kpi("Prompt injections caught", sum("reviews.injectionCaught")),
    "kpi-clear-rate": kpi("Cleared without a human", { id: "clearRate" }),
    "kpi-fit": kpi("Average auditor fit", avg("reviews.fitScore")),
    "kpi-decide": kpi("Hours to decide", avg("approvals.hoursToDecide")),
    "rule-results": {
      type: "column-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "ruleChecks.rule" }],
        valueKey: [countd("ruleChecks.id")],
        legendKey: [{ id: "ruleChecks.result" }],
      },
      format: { ...title("Rule checks: passed and failed"), ...legend },
    },
    "fit-by-verdict": {
      type: "column-chart-grouped",
      dataMapping: {
        categoryKey: [{ id: "reviews.auditorVerdict" }],
        valueKey: [avg("reviews.fitScore")],
      },
      format: title("Auditor fit score by verdict"),
    },
    "approval-split": {
      type: "donut-chart",
      dataMapping: {
        categoryKey: [{ id: "approvals.status" }],
        valueKey: [countd("approvals.id")],
      },
      format: { ...title("Human approvals"), ...legend },
    },
    "limit-orders": {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "limitOrders.title" },
          { id: "limitOrders.merchant" },
          sum("limitOrders.currentPrice"),
          sum("limitOrders.targetPrice"),
          sum("limitOrders.gapToTarget"),
          { id: "limitOrders.status" },
        ],
      },
      format: title("Limit orders"),
    },
  },
  widgetLayout: {
    "kpi-injections": at(0, 0, 6, 7),
    "kpi-clear-rate": at(6, 0, 6, 7),
    "kpi-fit": at(12, 0, 6, 7),
    "kpi-decide": at(18, 0, 6, 7),
    "rule-results": at(0, 7, 14, 18),
    "fit-by-verdict": at(14, 7, 10, 18),
    "approval-split": at(0, 25, 8, 17),
    "limit-orders": at(8, 25, 16, 17),
  },
};

const ledger: AgPageState = {
  id: "ledger",
  layout: { minWidth: 320 },
  widgets: {
    "purchases-grid": {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "purchases.date" },
          { id: "purchases.title" },
          { id: "purchases.brand" },
          { id: "purchases.merchant" },
          { id: "purchases.via" },
          { id: "purchases.status" },
          sum("purchases.amount"),
        ],
      },
      sort: [{ field: { id: "purchases.date" }, direction: "desc" }],
      format: title("Captured purchases (PayPal sandbox)"),
    },
    "spend-treemap": {
      type: "treemap-chart",
      dataMapping: {
        categoryKey: [{ id: "purchases.merchant" }, { id: "purchases.brand" }],
        valueKey: [sum("purchases.amount")],
      },
      format: title("Spend by merchant and brand"),
    },
    "approved-via": {
      type: "donut-chart",
      dataMapping: {
        categoryKey: [{ id: "purchases.via" }],
        valueKey: [sum("purchases.amount")],
      },
      format: { ...title("How purchases were approved"), ...legend },
    },
  },
  widgetLayout: {
    "purchases-grid": at(0, 0, 24, 19),
    "spend-treemap": at(0, 19, 14, 18),
    "approved-via": at(14, 19, 10, 18),
  },
};

const ALL_PAGES = [overview, guardrails, ledger];

export const defaultReport = (selectedPageId = "overview"): AgReportState => ({
  pages: ALL_PAGES,
  selectedPageId,
});

// On a narrow canvas (phones), stack every widget full-width in authored order instead of scrolling sideways.
export const RESPONSIVE_BREAKPOINTS: AgResponsiveLayoutBreakpoint[] = [
  {
    maxWidth: 760,
    layout: (layouts, { columns }) => {
      let y = 0;
      return layouts.map(({ layout, minSize }) => {
        const ySpan = Math.max(layout.ySpan, minSize.ySpan, 7);
        const placed = { xTrack: 0, yTrack: y, xSpan: columns, ySpan };
        y += ySpan;
        return placed;
      });
    },
  },
];
