"use client";

// A custom AG Studio widget: the Mandate seal. It reads three numbers from the reviews data (purchases stopped, purchases
// reviewed, money kept safe) and shows them on a wax-seal. The seal geometry is the same as the app's logo.

import { useEffect, useId, useState } from "react";
import { sealPath } from "@/components/icons";

type FieldRef = { id: string; aggregation?: string };
type Mapping = Partial<Record<"blocked" | "reviewed" | "kept", FieldRef[]>>;
type Totals = { blocked: number; reviewed: number; kept: number };

const SEAL = sealPath(100, 100, 88, 6.5, 18, 216);
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function GuardrailSeal({ widgetApi, dataMapping }: { widgetApi: any; dataMapping: Mapping }) {
  const ringId = useId();
  const [totals, setTotals] = useState<Totals | null>(null);
  const mappingKey = JSON.stringify(dataMapping);

  useEffect(() => {
    const fields = [dataMapping.blocked?.[0], dataMapping.reviewed?.[0], dataMapping.kept?.[0]];
    if (fields.some((f) => !f)) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    let live = true;

    // One aggregated row comes back: read each number by its field id, falling back to column order.
    const read = (resp: { results: { rows: Record<string, unknown>[] } }) => {
      const row = resp.results.rows[0] ?? {};
      const byOrder = Object.values(row);
      const num = (i: number) => Number((row as Record<string, unknown>)[(fields[i] as FieldRef).id] ?? byOrder[i] ?? 0) || 0;
      const t = { blocked: num(0), reviewed: num(1), kept: num(2) };
      setTotals(t);
      widgetApi.setDisplayState(t.reviewed === 0 ? "noData" : "displayed");
    };

    widgetApi.setDisplayState("loading");
    widgetApi
      .getData({ fields }, { queryId: "guardrail-seal", onDataUpdated: (r: never) => live && read(r) })
      .then((r: { replaced?: boolean; results: { rows: Record<string, unknown>[] } }) => {
        if (live && !r.replaced) read(r);
      })
      .catch(() => live && widgetApi.setDisplayState("noData"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingKey]);

  if (!totals || totals.reviewed === 0) return null; // the display-state overlay (loading / no data) is shown by Studio

  const share = Math.round((totals.blocked / totals.reviewed) * 100);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, height: "100%", padding: "4px 6px", overflow: "hidden" }}>
      <svg viewBox="0 0 200 200" role="img" aria-label={`${totals.blocked} of ${totals.reviewed} purchases stopped`} style={{ flex: "0 1 170px", width: "clamp(110px, 42%, 170px)", minWidth: 0, height: "auto" }}>
        <defs>
          <path id={ringId} d="M100,100 m-70,0 a70,70 0 1,1 140,0 a70,70 0 1,1 -140,0" />
        </defs>
        <path d={SEAL} fill="var(--accent)" />
        <circle cx="100" cy="100" r="77" fill="none" stroke="var(--on-accent)" strokeOpacity=".45" strokeWidth="1.2" />
        <circle cx="100" cy="100" r="53" fill="none" stroke="var(--on-accent)" strokeOpacity=".3" strokeWidth="1" />
        <text fill="var(--on-accent)" fillOpacity=".85" fontSize="9.5" fontWeight="600" letterSpacing="3.4" style={{ fontFamily: "var(--font)" }}>
          <textPath href={`#${ringId}`} startOffset="2%">
            GUARDRAILS HELD · SIGNED RULES · NOTHING SPENT OUTSIDE THEM ·
          </textPath>
        </text>
        <text x="100" y="112" textAnchor="middle" fill="var(--on-accent)" fontSize="52" style={{ fontFamily: "var(--display)", fontVariantNumeric: "lining-nums" }}>
          {totals.blocked}
        </text>
        <text x="100" y="132" textAnchor="middle" fill="var(--on-accent)" fillOpacity=".85" fontSize="10" fontWeight="700" letterSpacing="3" style={{ fontFamily: "var(--font)" }}>
          STOPPED
        </text>
      </svg>

      <div style={{ flex: "1 1 130px", minWidth: 0 }}>
        <div className="eyebrow">Money kept safe</div>
        <div className="serif num" style={{ fontSize: "clamp(1.6rem, 3.4cqw + 1rem, 2.5rem)", lineHeight: 1.05, letterSpacing: "-0.03em" }}>
          {usd(totals.kept)}
        </div>
        <p className="footnote" style={{ marginTop: 6 }}>
          {totals.blocked} of {totals.reviewed} purchases stopped before a dollar moved ({share}%).
        </p>
        <div style={{ marginTop: 10, height: 6, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--line)", overflow: "hidden" }} aria-hidden>
          <div style={{ width: `${share}%`, height: "100%", background: "var(--accent)", transition: "width 900ms var(--ease)" }} />
        </div>
      </div>
    </div>
  );
}

const sum = (id: string) => ({ id, aggregation: "sum" as const });

/** The widget definition, registered through createWidgets in InsightsClient. */
export const guardrailSealWidget = {
  id: "guardrail-seal",
  label: "Guardrail seal",
  icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5.5"/><path d="M9.5 12.2l1.8 1.8 3.4-3.9"/></svg>',
  dataMapping: {
    blocked: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "A 0/1 flag per purchase review that is 1 when the purchase was blocked. It is summed to count purchases stopped." },
    reviewed: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "A count column that is 1 per purchase review. It is summed to count purchases reviewed." },
    kept: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "The amount of money kept safe by blocked purchases, in dollars. It is summed." },
  },
  form: (params: any) =>
    params.createDefaults({
      dataMappingItems: [
        { key: "blocked", label: "Purchases stopped" },
        { key: "reviewed", label: "Purchases reviewed" },
        { key: "kept", label: "Money kept safe" },
      ],
    }),
  // Out of the box it reads the Purchase Reviews table, so adding it from the menu just works.
  defaultState: {
    dataMapping: {
      blocked: [sum("reviews.isBlocked")],
      reviewed: [sum("reviews.count")],
      kept: [sum("reviews.protectedAmount")],
    },
  },
  comp: GuardrailSeal,
  defaultSize: { width: 8, height: 14 },
  minSize: { width: 5, height: 8 },
  ai: {
    label: "Guardrail seal",
    description: "A seal showing how many purchases the guardrails stopped, out of how many were reviewed, and how much money that kept safe.",
    usage: "Use it as the headline tile for the guardrails: one seal per page is plenty.",
    configuration: "Map Purchases stopped to the sum of Blocked, Purchases reviewed to the sum of Reviews, and Money kept safe to the sum of Protected.",
  },
};
