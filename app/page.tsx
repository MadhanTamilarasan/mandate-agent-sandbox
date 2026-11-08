"use client";

import { useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { Onboarding } from "@/components/Onboarding";
import { Approvals, AuditLog, DemoControls, LimitOrders, MandateCard, Purchases, type AppState } from "@/components/Panels";

export default function Home() {
  const [state, setState] = useState<AppState | null>(null);
  const [mandateId, setMandateId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(
    async (id?: string) => {
      try {
        const res = await fetch(`/api/state${id ?? mandateId ? `?mandate=${id ?? mandateId}` : ""}`, { cache: "no-store" });
        setState(await res.json());
        setLoadError("");
      } catch {
        setLoadError("Can't reach the server.");
      }
    },
    [mandateId],
  );

  // Read the PayPal return parameters once, then clean the URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("mandate") || undefined;
    if (id) setMandateId(id);
    if (q.get("funded")) setToast({ tone: "good", text: "Budget approved in PayPal. The mandate is funded and the agent can start." });
    if (q.get("cancelled")) setToast({ tone: "bad", text: "You cancelled the PayPal approval. The mandate is not funded yet." });
    if (q.get("error")) setToast({ tone: "bad", text: q.get("error")! });
    if (q.toString()) window.history.replaceState({}, "", window.location.pathname);
    refresh(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const m = state?.mandate;
  const showOnboarding = state && (!m || creating);

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-10 pt-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl text-xl" style={{ background: "var(--accent)" }}>
            🛡️
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-tight">Mandate</h1>
            <p className="text-xs" style={{ color: "var(--muted)" }}>An AI shopping agent that can only spend inside your rules</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-warn">PayPal sandbox · no real money</span>
          {state && <span className="badge badge-muted">{state.model}</span>}
          {state && state.mandates.length > 0 && !creating && (
            <>
              <select
                className="input !w-auto"
                value={m?.id}
                onChange={(e) => {
                  setMandateId(e.target.value);
                  refresh(e.target.value);
                }}
              >
                {state.mandates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.status.replace("_", " ")})
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => setCreating(true)}>+ New mandate</button>
            </>
          )}
        </div>
      </header>

      {toast && (
        <div
          className="mb-4 flex items-center justify-between rounded-xl p-3 text-sm"
          style={{ background: toast.tone === "good" ? "#0f3d2e" : "#3d1717", color: toast.tone === "good" ? "var(--good)" : "var(--bad)" }}
        >
          <span>{toast.text}</span>
          <button className="btn btn-sm" onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}
      {loadError && <p className="mb-3 text-sm" style={{ color: "var(--bad)" }}>{loadError}</p>}

      {!state && !loadError && <p style={{ color: "var(--muted)" }}>Loading…</p>}

      {showOnboarding && <Onboarding onCancel={m ? () => setCreating(false) : undefined} />}

      {state && m && !creating && (
        <div className="grid gap-4 lg:grid-cols-[330px_minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <MandateCard m={m} onChange={refresh} />
            <DemoControls m={m} onChange={refresh} />
          </div>
          <Chat mandateId={m.id} active={m.status === "active"} onChange={refresh} />
          <div className="space-y-4">
            <Approvals items={state.approvals} onChange={refresh} />
            <LimitOrders items={state.limitOrders} mandateId={m.id} onChange={refresh} />
            <Purchases items={state.purchases} />
            <AuditLog events={state.events} />
          </div>
        </div>
      )}
    </main>
  );
}
