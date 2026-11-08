"use client";

import { useState } from "react";
import type { getState } from "@/lib/service";
import { Badge, Checks, decisionTone, money, ProductThumb } from "./ui";

export type AppState = ReturnType<typeof getState> & { model: string };
type MandateView = NonNullable<AppState["mandate"]>;

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "Request failed");
  return j;
}

export function MandateCard({ m, onChange }: { m: MandateView; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const pct = (n: number) => `${Math.min(100, (n / m.budget) * 100)}%`;
  const statusTone = m.status === "active" ? "good" : m.status === "pending_funding" ? "warn" : "muted";

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
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-bold">{m.name}</div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{m.goal}</div>
        </div>
        <Badge tone={statusTone}>{m.status.replace("_", " ")}</Badge>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="text-2xl font-extrabold">{money(m.remaining)}</div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>left of {money(m.budget)}</div>
        </div>
        <div className="text-right text-xs" style={{ color: "var(--muted)" }}>
          <div>Spent {money(m.spent)}</div>
          <div>Reserved {money(m.reserved)}</div>
        </div>
      </div>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--bg)" }}>
        <div style={{ width: pct(m.spent), background: "var(--accent)" }} />
        <div style={{ width: pct(m.reserved), background: "var(--warn)" }} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt style={{ color: "var(--muted)" }}>Per-item cap</dt>
        <dd className="text-right">{money(m.maxPerItem)}</dd>
        <dt style={{ color: "var(--muted)" }}>Auto-approve below</dt>
        <dd className="text-right">{money(m.autoApproveBelow)}</dd>
        <dt style={{ color: "var(--muted)" }}>Never buy</dt>
        <dd className="text-right">{m.blockedTerms.join(", ") || "-"}</dd>
        <dt style={{ color: "var(--muted)" }}>Merchants</dt>
        <dd className="text-right">{m.allowedMerchants.join(", ") || "any"}</dd>
        <dt style={{ color: "var(--muted)" }}>Expires</dt>
        <dd className="text-right">{new Date(m.expiresAt).toLocaleDateString()}</dd>
        <dt style={{ color: "var(--muted)" }}>Signature</dt>
        <dd className="text-right">
          {m.signatureValid ? <Badge tone="good">valid</Badge> : <Badge tone="bad">tampered</Badge>}
        </dd>
        {m.paypal.authorizationId && (
          <>
            <dt style={{ color: "var(--muted)" }}>PayPal hold</dt>
            <dd className="truncate text-right font-mono" title={m.paypal.authorizationId}>{m.paypal.authorizationId}</dd>
          </>
        )}
      </dl>

      {m.status === "pending_funding" && m.paypal.approveUrl && (
        <a className="btn btn-primary mt-4 w-full" href={m.paypal.approveUrl}>
          Approve {money(m.budget)} in PayPal →
        </a>
      )}
      {m.status === "active" && (
        <button className="btn btn-sm mt-4 w-full" disabled={busy} onClick={close}>
          Close mandate &amp; release unspent funds
        </button>
      )}
    </div>
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
    <div className="card p-4" style={{ borderColor: "var(--warn)" }}>
      <div className="mb-3 flex items-center gap-2 font-bold">
        <Badge tone="warn">Needs you</Badge> Approvals
      </div>
      <div className="space-y-3">
        {pending.map((a) => (
          <div key={a.id} className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
            <div className="flex gap-3">
              <ProductThumb p={a.product} size={48} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{a.product.title}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {a.product.merchant} · {a.via === "limit_order" ? "limit order triggered" : "agent proposal"}
                </div>
                <div className="text-sm font-bold">{money(a.product.price)}</div>
              </div>
            </div>
            <ul className="mt-2 list-disc pl-5 text-xs" style={{ color: "var(--muted)" }}>
              {a.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <Checks checks={a.checks} auditor={a.auditor} />
            <div className="mt-3 flex gap-2">
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
      {err && <p className="mt-2 text-xs" style={{ color: "var(--bad)" }}>{err}</p>}
    </div>
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

  const tone = (s: string) => (s === "purchased" ? "good" : s === "watching" ? "info" : s === "escalated" ? "warn" : s === "blocked" ? "bad" : "muted");

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-bold">Limit orders</div>
        <button
          className="btn btn-sm"
          disabled={busy === "check"}
          onClick={() => run("check", async () => {
            const r = await post("/api/limit-orders/check", { mandateId });
            const where = r.via === "render-workflow" ? `Render Workflows run ${r.runId}` : "direct price lookups";
            setNote(`Checked ${r.checked} order(s) via ${where}; ${r.triggered} triggered.`);
          })}
        >
          {busy === "check" ? "Checking…" : "Check prices now"}
        </button>
      </div>
      <div className="space-y-3">
        {items.map((o) => {
          const progress = Math.max(0, Math.min(100, ((o.product.price - o.currentPrice) / Math.max(o.product.price - o.targetPrice, 0.01)) * 100));
          return (
            <div key={o.id} className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
              <div className="flex gap-3">
                <ProductThumb p={o.product} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{o.product.title}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    now {money(o.currentPrice)} → buys at ≤ {money(o.targetPrice)}
                  </div>
                </div>
                <Badge tone={tone(o.status)}>{o.status}</Badge>
              </div>
              {o.status === "watching" && (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--bg)" }}>
                    <div style={{ width: `${progress}%`, background: "var(--accent)", height: "100%" }} />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="btn btn-sm flex-1"
                      title="Demo control: pretends the retailer dropped the price so you can see the trigger"
                      disabled={!!busy}
                      onClick={() => run(o.id, async () => {
                        await post(`/api/limit-orders/${o.id}`, { action: "simulate_drop" });
                        await post("/api/limit-orders/check", { mandateId });
                      })}
                    >
                      ⚡ Simulate price drop (demo)
                    </button>
                    <button className="btn btn-sm" disabled={!!busy} onClick={() => run(o.id, () => post(`/api/limit-orders/${o.id}`, { action: "cancel" }))}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
              {o.statusNote && o.status !== "watching" && (
                <div className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>{o.statusNote}</div>
              )}
            </div>
          );
        })}
      </div>
      {note && <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>{note}</p>}
    </div>
  );
}

export function Purchases({ items }: { items: AppState["purchases"] }) {
  if (items.length === 0) return null;
  return (
    <div className="card p-4">
      <div className="mb-3 font-bold">Purchases <span style={{ color: "var(--muted)" }} className="text-xs font-normal">(PayPal sandbox captures)</span></div>
      <div className="space-y-2">
        {items.map((p) => (
          <div key={p.id} className="flex gap-3 rounded-xl p-2.5" style={{ background: "var(--panel-2)" }}>
            <ProductThumb p={p.product} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{p.product.title}</div>
              <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
                {p.product.merchant} · via {p.via.replace("_", " ")}
                {p.captureId ? ` · capture ${p.captureId}` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold">{money(p.amount)}</div>
              <Badge tone={p.status === "captured" ? "good" : "bad"}>{p.status}</Badge>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        Sandbox demo: the payment is real PayPal sandbox money; no retailer order is placed.
      </p>
    </div>
  );
}

const ACTOR: Record<string, string> = { user: "🧑", agent: "🤖", rules: "📏", auditor: "🕵️", paypal: "💳", system: "⚙️" };

export function AuditLog({ events }: { events: AppState["events"] }) {
  return (
    <div className="card p-4">
      <div className="mb-3 font-bold">Audit log</div>
      {events.length === 0 && <p className="text-xs" style={{ color: "var(--muted)" }}>Every rule check, auditor verdict and PayPal call is recorded here.</p>}
      <ol className="max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
        {events.map((e) => (
          <li key={e.id} className="flex gap-2 text-xs">
            <span>{ACTOR[e.actor] ?? "•"}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span style={{ color: "var(--muted)" }}>{new Date(e.at).toLocaleTimeString()}</span>
                {e.decision && <Badge tone={decisionTone(e.decision)}>{e.decision}</Badge>}
              </div>
              <div>{e.summary}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function DemoControls({ m, onChange }: { m: MandateView; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const tampered = m.tamperedFrom !== undefined;
  return (
    <div className="card p-4">
      <div className="mb-1 font-bold">Demo controls</div>
      <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
        For demos only. Edit the budget without re-signing, then ask the agent to buy: every purchase is refused until the
        signed value is restored.
      </p>
      <button
        className={`btn btn-sm w-full ${tampered ? "btn-good" : "btn-bad"}`}
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
    </div>
  );
}
