"use client";

import { useState } from "react";
import type { AgentEvent } from "@/lib/agent";
import type { Outcome } from "@/lib/service";
import type { AuditorVerdict, Decision, ProductSnapshot, RuleCheck } from "@/lib/types";
import { Icon, type IconName } from "./icons";

export const money = (n: number | undefined) =>
  n === undefined ? "-" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "pending_funding" -> "Pending funding" */
export const sentence = (s: string) => {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export type Tone = "good" | "warn" | "bad" | "info" | "muted";

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

export const decisionTone = (d: Decision): Tone => (d === "allow" ? "good" : d === "escalate" ? "warn" : "bad");

export function CardHead({
  eyebrow,
  title,
  note,
  aside,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  note?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h2 className="title-3">{title}</h2>
        {note && <p className="footnote mt-0.5">{note}</p>}
      </div>
      {aside}
    </div>
  );
}

export function Thinking({ label }: { label: string }) {
  return (
    <div className="footnote flex items-center gap-2.5" role="status">
      <span className="typing" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span>{label}</span>
    </div>
  );
}

export function ProductThumb({ p, size = 56 }: { p: ProductSnapshot; size?: number }) {
  return p.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" width={size} height={size} className="thumb" style={{ width: size, height: size }} />
  ) : (
    <div className="thumb thumb-empty" style={{ width: size, height: size }}>
      <Icon name="bag" size={Math.round(size * 0.4)} />
    </div>
  );
}

export function ProductCard({ p }: { p: ProductSnapshot }) {
  return (
    <div className="product">
      <ProductThumb p={p} />
      <div className="min-w-0 flex-1 self-center">
        <div className="truncate text-[0.875rem] font-semibold" title={p.title}>
          {p.title}
        </div>
        <div className="caption truncate">
          {p.brand ? `${p.brand} · ` : ""}
          {p.merchant}
        </div>
        <div className="num serif mt-0.5 text-[1.125rem] leading-tight">{money(p.price)}</div>
      </div>
    </div>
  );
}

export function Checks({ checks, auditor }: { checks: RuleCheck[]; auditor?: AuditorVerdict }) {
  const [open, setOpen] = useState(false);
  if (!checks.length && !auditor) return null;
  const auditorTone: Tone = auditor ? decisionTone(auditor.verdict) : "muted";
  return (
    <div className="mt-3">
      <button className="disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={12} strokeWidth={2.4} />
        How it was checked
        <span className="faint">
          · {checks.length} rules{auditor ? " + auditor" : ""}
        </span>
      </button>
      {open && (
        <ul className="checks rise mt-2.5 space-y-1.5 text-[0.8125rem]">
          {checks.map((c) => (
            <li key={c.rule}>
              <span className={`tone-${c.ok ? "good" : "bad"}`} style={{ color: "var(--tone)" }}>
                <Icon name={c.ok ? "check" : "x"} size={14} strokeWidth={2.4} />
              </span>
              <span style={{ color: c.ok ? "var(--muted)" : "var(--text)" }}>{c.message}</span>
            </li>
          ))}
          {auditor && (
            <li className="mt-2 border-t pt-2.5" style={{ borderColor: "var(--line)" }}>
              <span className={`tone-${auditorTone}`} style={{ color: "var(--tone)" }}>
                <Icon name={auditor.verdict === "allow" ? "check" : auditor.verdict === "escalate" ? "alert" : "x"} size={14} strokeWidth={2.4} />
              </span>
              <span>
                <b className="font-semibold">Auditor</b>{" "}
                <span className="caption">
                  fit {auditor.fitScore}/100{auditor.injectionSuspected ? " · prompt injection suspected" : ""}
                </span>
                <br />
                {auditor.reasons.join(" ")}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

const OUTCOME: Record<Outcome["outcome"], { label: string; tone: "good" | "warn" | "bad"; icon: IconName }> = {
  purchased: { label: "Purchased", tone: "good", icon: "check" },
  needs_approval: { label: "Needs your approval", tone: "warn", icon: "clock" },
  blocked: { label: "Blocked", tone: "bad", icon: "lock" },
  failed: { label: "Payment failed", tone: "bad", icon: "alert" },
};

export type ApprovalStatus = "pending" | "approved" | "rejected";

export function OutcomeCard({ o, approvalStatus }: { o: Outcome; approvalStatus?: ApprovalStatus }) {
  // A "needs approval" card goes stale once the human has acted, so reflect the live status.
  let meta = OUTCOME[o.outcome];
  let message = o.message;
  if (o.outcome === "needs_approval" && approvalStatus === "approved") {
    meta = { label: "Approved & purchased", tone: "good", icon: "check" };
    message = "You approved this purchase and PayPal captured the payment.";
  } else if (o.outcome === "needs_approval" && approvalStatus === "rejected") {
    meta = { label: "Rejected by you", tone: "bad", icon: "x" };
    message = "You rejected this purchase. Nothing was charged.";
  }
  return (
    <div className={`tile tone-${meta.tone}`} style={{ boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--tone) 40%, transparent)" }}>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="glyph" style={{ width: 24, height: 24, background: "color-mix(in srgb, var(--tone) 14%, transparent)", color: "var(--tone)" }}>
          <Icon name={meta.icon} size={13} strokeWidth={2.4} />
        </span>
        <span className="text-[0.875rem] font-semibold tracking-[-0.01em]" style={{ color: "var(--tone)" }}>
          {meta.label}
        </span>
        {o.product && <span className="caption ml-auto truncate">{o.product.merchant}</span>}
      </div>
      {o.product && <ProductCard p={o.product} />}
      <p className="mt-2.5 text-[0.875rem] leading-snug">{message}</p>
      <Checks checks={o.checks} auditor={o.auditor} />
    </div>
  );
}

export function EventView({ e, approvals }: { e: AgentEvent; approvals?: { id: string; status: ApprovalStatus }[] }) {
  if (e.type === "search") {
    return (
      <div>
        <div className="footnote mb-2 flex items-center gap-1.5">
          <Icon name="search" size={13} strokeWidth={2.2} />
          <span>
            Searched Channel3 for “{e.query}” · {e.products.length} results
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {e.products.slice(0, 4).map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
      </div>
    );
  }
  if (e.type === "purchase") {
    const status = approvals?.find((a) => a.id === e.outcome.approvalId)?.status;
    return <OutcomeCard o={e.outcome} approvalStatus={status} />;
  }
  return (
    <div className="tile">
      <div className="mb-2.5">
        <Badge tone={e.ok ? "info" : "bad"}>{e.ok ? "Limit order set" : "Limit order refused"}</Badge>
      </div>
      {e.product && <ProductCard p={e.product} />}
      <p className="mt-2.5 text-[0.875rem] leading-snug">{e.message}</p>
    </div>
  );
}
