"use client";

import { useState } from "react";
import type { AgentEvent } from "@/lib/agent";
import type { Outcome } from "@/lib/service";
import type { AuditorVerdict, Decision, ProductSnapshot, RuleCheck } from "@/lib/types";

export const money = (n: number | undefined) =>
  n === undefined ? "-" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Badge({ tone, children }: { tone: "good" | "warn" | "bad" | "info" | "muted"; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export const decisionTone = (d: Decision) => (d === "allow" ? "good" : d === "escalate" ? "warn" : "bad");

export function Thinking({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
      <span>{label}</span>
    </div>
  );
}

export function ProductThumb({ p, size = 56 }: { p: ProductSnapshot; size?: number }) {
  return p.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={p.imageUrl}
      alt=""
      referrerPolicy="no-referrer"
      width={size}
      height={size}
      className="shrink-0 rounded-lg object-contain"
      style={{ width: size, height: size, background: "#fff" }}
    />
  ) : (
    <div className="shrink-0 rounded-lg" style={{ width: size, height: size, background: "var(--panel-2)" }} />
  );
}

export function ProductCard({ p }: { p: ProductSnapshot }) {
  return (
    <div className="flex gap-3 rounded-xl p-2.5" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
      <ProductThumb p={p} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" title={p.title}>
          {p.title}
        </div>
        <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
          {p.brand ? `${p.brand} · ` : ""}
          {p.merchant}
        </div>
        <div className="mt-0.5 text-sm font-bold">{money(p.price)}</div>
      </div>
    </div>
  );
}

export function Checks({ checks, auditor }: { checks: RuleCheck[]; auditor?: AuditorVerdict }) {
  const [open, setOpen] = useState(false);
  if (!checks.length && !auditor) return null;
  return (
    <div className="mt-2">
      <button className="text-xs underline" style={{ color: "var(--muted)" }} onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} how it was checked ({checks.length} rules{auditor ? " + auditor" : ""})
      </button>
      {open && (
        <ul className="mt-2 space-y-1 text-xs">
          {checks.map((c) => (
            <li key={c.rule} className="flex gap-2">
              <span style={{ color: c.ok ? "var(--good)" : "var(--bad)" }}>{c.ok ? "✓" : "✗"}</span>
              <span style={{ color: c.ok ? "var(--muted)" : "var(--text)" }}>{c.message}</span>
            </li>
          ))}
          {auditor && (
            <li className="flex gap-2 pt-1" style={{ borderTop: "1px dashed var(--line)" }}>
              <span style={{ color: `var(--${auditor.verdict === "allow" ? "good" : auditor.verdict === "escalate" ? "warn" : "bad"})` }}>
                {auditor.verdict === "allow" ? "✓" : auditor.verdict === "escalate" ? "!" : "✗"}
              </span>
              <span>
                <b>Auditor</b> (fit {auditor.fitScore}/100
                {auditor.injectionSuspected ? ", prompt injection suspected" : ""}): {auditor.reasons.join(" ")}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

const OUTCOME: Record<Outcome["outcome"], { label: string; tone: "good" | "warn" | "bad" }> = {
  purchased: { label: "Purchased", tone: "good" },
  needs_approval: { label: "Needs your approval", tone: "warn" },
  blocked: { label: "Blocked", tone: "bad" },
  failed: { label: "Payment failed", tone: "bad" },
};

export function OutcomeCard({ o }: { o: Outcome }) {
  const meta = OUTCOME[o.outcome];
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--panel-2)", border: `1px solid var(--${meta.tone === "good" ? "good" : meta.tone === "warn" ? "warn" : "bad"})55` }}>
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {o.product && <span className="truncate text-xs" style={{ color: "var(--muted)" }}>{o.product.merchant}</span>}
      </div>
      {o.product && <ProductCard p={o.product} />}
      <p className="mt-2 text-sm">{o.message}</p>
      <Checks checks={o.checks} auditor={o.auditor} />
    </div>
  );
}

export function EventView({ e }: { e: AgentEvent }) {
  if (e.type === "search") {
    return (
      <div>
        <div className="mb-1.5 text-xs" style={{ color: "var(--muted)" }}>
          🔎 Searched Channel3 for “{e.query}” — {e.products.length} results
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {e.products.slice(0, 4).map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
      </div>
    );
  }
  if (e.type === "purchase") return <OutcomeCard o={e.outcome} />;
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
      <div className="mb-2">
        <Badge tone={e.ok ? "info" : "bad"}>{e.ok ? "Limit order set" : "Limit order refused"}</Badge>
      </div>
      {e.product && <ProductCard p={e.product} />}
      <p className="mt-2 text-sm">{e.message}</p>
    </div>
  );
}
