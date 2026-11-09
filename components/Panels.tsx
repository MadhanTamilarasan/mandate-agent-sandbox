"use client";

import { useState } from "react";
import type { getState } from "@/lib/service";
import { Icon, type IconName } from "./icons";
import { Badge, CardHead, Checks, decisionTone, money, ProductThumb, sentence, type Tone } from "./ui";

export type AppState = ReturnType<typeof getState> & { model: string };
type MandateView = NonNullable<AppState["mandate"]>;

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "Request failed");
  return j;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function MandateCard({ m, onChange }: { m: MandateView; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / m.budget) * 100))}%`;
  // While active, money refunded to the buyer is free to spend again, so it leaves the "spent" bar. Once the
  // mandate is over, "spent" is what PayPal actually captured from the hold.
  const over = m.status === "closed" || m.status === "expired";
  const spent = over ? m.spent : m.netSpent;
  const statusTone: Tone = m.status === "active" ? "good" : m.status === "pending_funding" ? "warn" : "muted";
  // Once the mandate is over, what mattered is what PayPal actually held (the budget field can have been edited
  // by the "tamper" demo control), and what is left of it is unspent (released, if the void went through).
  const authorised = m.paypal.fundedAmount ?? m.budget;
  const unspent = Math.max(0, Math.round((authorised - m.spent - m.reserved) * 100) / 100);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked (permissions, insecure origin): let the person copy it by hand.
      window.prompt("Copy this approval link:", url);
    }
  }

  async function close() {
    if (!confirm("Close this mandate and release the unspent PayPal hold?")) return;
    setBusy(true);
    try {
      await post(`/api/mandates/${m.id}`, { action: "close" });
    } finally {
      setBusy(false);
      onChange();
    }
  }

  return (
    <section className="card pad">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">The mandate</p>
        <Badge tone={statusTone}>{sentence(m.status)}</Badge>
      </div>
      <h2 className="title-2 mt-3">{m.name}</h2>
      <p className="footnote mt-1.5">{m.goal}</p>

      {/* What the big figure means depends on the mandate's state: only an active mandate has money to spend. */}
      <div className="mt-7">
        {m.status === "active" && (
          <>
            <div className="eyebrow">Available to spend</div>
            <div className="figure num mt-2">{money(m.remaining)}</div>
            <div className="serif mt-2 text-[0.9375rem] italic" style={{ color: "var(--muted)" }}>
              of {money(m.budget)} authorised
              {m.refundFreed > 0 ? `, including ${money(m.refundFreed)} freed by a refund` : ""}
            </div>
          </>
        )}
        {m.status === "pending_funding" && (
          <>
            <div className="eyebrow">Budget awaiting your approval</div>
            <div className="figure num mt-2">{money(m.budget)}</div>
            <div className="serif mt-2 text-[0.9375rem] italic" style={{ color: "var(--muted)" }}>
              nothing can be spent until you approve it in PayPal
            </div>
          </>
        )}
        {(m.status === "closed" || m.status === "expired") && (
          <>
            <div className="eyebrow">{unspent > 0 && m.holdReleased ? "Released back to the buyer" : "Left unspent"}</div>
            <div className="figure num mt-2">{money(unspent)}</div>
            <div className="serif mt-2 text-[0.9375rem] italic" style={{ color: "var(--muted)" }}>
              of {money(authorised)} authorised, {money(m.spent)} spent
              {(m.refunded ?? 0) > 0 ? ` (${money(m.refunded ?? 0)} of it refunded to the buyer)` : ""}. Closed: nothing more can be bought.
            </div>
          </>
        )}
      </div>

      <div className="meter mt-5" role="img" aria-label={`Spent ${money(spent)}, reserved ${money(m.reserved)} of ${money(m.budget)}`}>
        <i style={{ width: pct(spent) }} />
        <i style={{ width: pct(m.reserved) }} />
      </div>
      <div className="legend num">
        <span>
          <i style={{ background: "var(--ink)" }} />
          Spent {money(spent)}
        </span>
        {m.status === "closed" || m.status === "expired" ? (
          <span>
            <i style={{ background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--line-strong)" }} />
            {m.holdReleased ? "Released" : "Unspent"} {money(unspent)}
          </span>
        ) : (
          <span>
            <i style={{ background: "repeating-linear-gradient(135deg, var(--warn) 0 2px, transparent 2px 4px)", boxShadow: "inset 0 0 0 1px var(--warn)" }} />
            Reserved {money(m.reserved)}
          </span>
        )}
      </div>

      <dl className="group mt-6">
        <Row k="Per-item cap">
          <span className="num">{money(m.maxPerItem)}</span>
        </Row>
        <Row k="Auto-approve below">
          <span className="num">{money(m.autoApproveBelow)}</span>
        </Row>
        <Row k="Never buy">{m.blockedTerms.join(", ") || "None"}</Row>
        <Row k="Merchants">{m.allowedMerchants.join(", ") || "Any"}</Row>
        <Row k="Expires">{new Date(m.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</Row>
        <Row k="Signature">{m.signatureValid ? <Badge tone="good">Signed · verified</Badge> : <Badge tone="bad">Tampered</Badge>}</Row>
        {m.paypal.authorizationId && (
          <Row k="PayPal hold">
            <span className="mono" title={m.paypal.authorizationId}>
              {m.paypal.authorizationId}
            </span>
          </Row>
        )}
      </dl>

      {m.status === "pending_funding" && m.paypal.approveUrl && (
        <div className="mt-5 space-y-2.5">
          <a className="btn btn-primary btn-lg btn-block" href={m.paypal.approveUrl}>
            Approve {money(m.budget)} in PayPal
            <Icon name="arrowRight" size={16} strokeWidth={2.2} />
          </a>
          <button className="btn btn-sm btn-block" onClick={() => copyLink(m.paypal.approveUrl!)}>
            {copied ? "Link copied" : "Copy approval link"}
          </button>
          <p className="caption">
            If PayPal says &ldquo;Transaction declined&rdquo;, paste this link into a new private window and try again. In testing, a fresh
            browser session cleared it; you don&apos;t need a new mandate or account.
          </p>
        </div>
      )}
      {m.status === "active" && (
        <button className="btn btn-sm btn-block mt-5" disabled={busy} onClick={close}>
          Close mandate &amp; release unspent funds
        </button>
      )}
    </section>
  );
}

export function Approvals({ items, onChange }: { items: AppState["approvals"]; onChange: () => void }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const pending = items.filter((a) => a.status === "pending");
  if (pending.length === 0) return null;

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    setErr("");
    try {
      await post(`/api/approvals/${id}`, { action });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
      onChange();
    }
  }

  return (
    <section className="card card-alert pad rise">
      <CardHead
        eyebrow="Awaiting you"
        title="Needs your approval"
        note={`${pending.length} purchase${pending.length > 1 ? "s" : ""} waiting on you`}
        aside={<Badge tone="warn">Action</Badge>}
      />
      <div className="space-y-3">
        {pending.map((a) => (
          <div key={a.id} className="tile">
            <div className="flex gap-3">
              <ProductThumb p={a.product} size={48} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.875rem] font-semibold tracking-[-0.01em]">{a.product.title}</div>
                <div className="caption truncate">
                  {a.product.merchant} · {a.via === "limit_order" ? "limit order triggered" : "agent proposal"}
                </div>
                <div className="num text-[0.9375rem] font-semibold tracking-[-0.02em]">{money(a.product.price)}</div>
              </div>
            </div>
            <ul className="footnote mt-3 list-disc space-y-0.5 pl-4">
              {a.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <Checks checks={a.checks} auditor={a.auditor} />
            <div className="mt-3.5 flex gap-2">
              <button className="btn btn-good btn-sm flex-1" disabled={busy === a.id} onClick={() => act(a.id, "approve")}>
                Approve &amp; pay
              </button>
              <button className="btn btn-bad btn-sm flex-1" disabled={busy === a.id} onClick={() => act(a.id, "reject")}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
      {err && <p className="caption tone-bad mt-3" style={{ color: "var(--tone)" }}>{err}</p>}
    </section>
  );
}

export function LimitOrders({ items, mandateId, onChange }: { items: AppState["limitOrders"]; mandateId: string; onChange: () => void }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  if (items.length === 0) return null;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setNote("");
    try {
      await fn();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy("");
      onChange();
    }
  }

  const tone = (s: string): Tone => (s === "purchased" ? "good" : s === "watching" ? "info" : s === "escalated" ? "warn" : s === "blocked" ? "bad" : "muted");

  return (
    <section className="card pad">
      <CardHead
        eyebrow="Standing orders"
        title="Limit orders"
        note="Buys automatically when the price drops"
        aside={
          <button
            className="btn btn-sm"
            disabled={busy === "check"}
            onClick={() =>
              run("check", async () => {
                const r = await post("/api/limit-orders/check", { mandateId });
                const where = r.via === "render-workflow" ? `Render Workflows run ${r.runId}` : "direct price lookups";
                setNote(`Checked ${r.checked} order(s) via ${where}; ${r.triggered} triggered.`);
              })
            }
          >
            {busy === "check" ? "Checking…" : "Check prices"}
          </button>
        }
      />
      <div className="space-y-3">
        {items.map((o) => {
          const progress = Math.max(0, Math.min(100, ((o.product.price - o.currentPrice) / Math.max(o.product.price - o.targetPrice, 0.01)) * 100));
          return (
            <div key={o.id} className="tile">
              <div className="flex gap-3">
                <ProductThumb p={o.product} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.875rem] font-semibold tracking-[-0.01em]">{o.product.title}</div>
                  <div className="caption num">
                    Now {money(o.currentPrice)} · buys at {money(o.targetPrice)} or less
                  </div>
                </div>
                <Badge tone={tone(o.status)}>{sentence(o.status)}</Badge>
              </div>
              {o.status === "watching" && (
                <>
                  <div className="meter meter-sm meter-accent mt-3" role="img" aria-label={`${Math.round(progress)}% of the way to the target price`}>
                    <i style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="btn btn-sm flex-1"
                      title="Demo control: pretends the retailer dropped the price so you can see the trigger"
                      disabled={!!busy}
                      onClick={() =>
                        run(o.id, async () => {
                          await post(`/api/limit-orders/${o.id}`, { action: "simulate_drop" });
                          await post("/api/limit-orders/check", { mandateId });
                        })
                      }
                    >
                      <Icon name="bolt" size={13} strokeWidth={2.2} />
                      Simulate price drop
                    </button>
                    <button className="btn btn-sm" disabled={!!busy} onClick={() => run(o.id, () => post(`/api/limit-orders/${o.id}`, { action: "cancel" }))}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
              {o.statusNote && o.status !== "watching" && <div className="caption mt-2">{o.statusNote}</div>}
            </div>
          );
        })}
      </div>
      {note && <p className="caption mt-3">{note}</p>}
    </section>
  );
}

export function Purchases({ items, onChange }: { items: AppState["purchases"]; onChange: () => void }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  if (items.length === 0) return null;

  async function undo(p: AppState["purchases"][number]) {
    if (!confirm(`Refund ${money(p.refundable)} for "${p.product.title}" back to the buyer through PayPal?`)) return;
    setBusy(p.id);
    setNote("");
    try {
      const r = await post(`/api/purchases/${p.id}/refund`, {});
      setNote(r.message);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy("");
      onChange();
    }
  }

  const label = (p: AppState["purchases"][number]) => (p.status === "captured" && p.refunded > 0 ? "Partly refunded" : sentence(p.status));
  const tone = (p: AppState["purchases"][number]): Tone => (p.status === "captured" ? (p.refunded > 0 ? "warn" : "good") : p.status === "refunded" ? "muted" : "bad");

  return (
    <section className="card pad">
      <CardHead eyebrow="The ledger" title="Purchases" note="PayPal sandbox captures" />
      <div className="group">
        {items.map((p) => (
          <div key={p.id} className="py-3" style={{ boxShadow: "inset 0 -1px 0 var(--line)" }}>
            <div className="flex items-center gap-3">
              <ProductThumb p={p.product} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.875rem] font-semibold tracking-[-0.01em]">{p.product.title}</div>
                <div className="caption truncate">
                  {p.product.merchant} · via {p.via.replace("_", " ")}
                  {p.captureId ? ` · ${p.captureId}` : ""}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="num serif text-[1.125rem] leading-none" style={p.status === "refunded" ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                  {money(p.amount)}
                </div>
                <Badge tone={tone(p)}>{label(p)}</Badge>
              </div>
            </div>
            {p.refunded > 0 && (
              <div className="caption mt-2 pl-[52px]">
                {money(p.refunded)} went back to the buyer
                {p.refunds?.some((r) => r.source === "paypal") ? " (refunded in PayPal)" : ""}.
              </div>
            )}
            {p.refundable > 0 && (
              <div className="mt-2 pl-[52px]">
                <button
                  className="btn btn-sm"
                  disabled={!!busy}
                  title="Refunds this capture to the buyer through PayPal. The agent cannot do this; only you can."
                  onClick={() => undo(p)}
                >
                  {busy === p.id ? "Refunding…" : "Undo purchase"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {note && <p className="caption mt-3">{note}</p>}
      <p className="caption mt-3">
        Sandbox demo: the payment is real PayPal sandbox money; no retailer order is placed. Undo returns the money to the buyer and frees
        that budget again.
      </p>
    </section>
  );
}

const ACTOR: Record<string, { icon: IconName; tone: Tone; label: string }> = {
  user: { icon: "person", tone: "info", label: "You" },
  agent: { icon: "sparkle", tone: "info", label: "Agent" },
  rules: { icon: "sliders", tone: "muted", label: "Rules engine" },
  auditor: { icon: "eye", tone: "muted", label: "Auditor" },
  paypal: { icon: "card", tone: "info", label: "PayPal" },
  system: { icon: "info", tone: "muted", label: "System" },
};

export function AuditLog({ events }: { events: AppState["events"] }) {
  return (
    <section className="card pad">
      <CardHead eyebrow="The record" title="Audit log" note="Every check, verdict and PayPal call" />
      {events.length === 0 && <p className="footnote">Nothing yet. Activity appears here as the agent works.</p>}
      <ol className="timeline max-h-[380px] overflow-y-auto pr-1">
        {events.map((e) => {
          const a = ACTOR[e.actor] ?? ACTOR.system;
          return (
            <li key={e.id} className={`tone-${a.tone}`}>
              <span className="ico">
                <Icon name={a.icon} size={13} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <div className="caption flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold" style={{ color: "var(--text)" }}>
                    {a.label}
                  </span>
                  <span className="num">{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                  {e.decision && <Badge tone={decisionTone(e.decision)}>{sentence(e.decision)}</Badge>}
                </div>
                <div className="mt-0.5 text-[0.8125rem] leading-snug">{e.summary}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function DemoControls({ m, onChange }: { m: MandateView; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const tampered = m.tamperedFrom !== undefined;
  return (
    <section className="card pad">
      <CardHead eyebrow="Demo only" title="Demo controls" note="Not part of the product" />
      <p className="footnote mb-3.5">
        Edit the budget without re-signing, then ask the agent to buy. Every purchase is refused until the signed value is restored.
      </p>
      <button
        className={`btn btn-sm btn-block ${tampered ? "btn-good" : "btn-bad"}`}
        disabled={busy || m.status !== "active"}
        onClick={async () => {
          setBusy(true);
          try {
            await post(`/api/mandates/${m.id}`, { action: "tamper" });
          } finally {
            setBusy(false);
            onChange();
          }
        }}
      >
        {tampered ? "Restore signed budget" : "Tamper with the budget (×10)"}
      </button>
    </section>
  );
}
