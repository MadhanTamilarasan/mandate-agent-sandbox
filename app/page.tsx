"use client";

import { useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { Icon } from "@/components/icons";
import { Onboarding } from "@/components/Onboarding";
import { SiteNav } from "@/components/SiteNav";
import { Approvals, AuditLog, DemoControls, LimitOrders, MandateCard, Purchases, type AppState } from "@/components/Panels";
import { sentence } from "@/components/ui";

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
    if (q.get("cancelled"))
      setToast({
        tone: "bad",
        text: "PayPal didn't complete the approval, so the mandate isn't funded yet. If it said “Transaction declined”, copy the approval link from the mandate card and open it in a new private window.",
      });
    if (q.get("error")) setToast({ tone: "bad", text: q.get("error")! });
    if (q.toString()) window.history.replaceState({}, "", window.location.pathname);
    refresh(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // Toasts are transient: they settle on their own.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const m = state?.mandate;
  const showOnboarding = state && (!m || creating);

  return (
    <>
      <SiteNav active="agent">
        {/* Full notice only where it fits; a short one in between, so it never sits on top of the tabs. */}
        <span className="badge tone-warn hidden shrink-0 whitespace-nowrap min-[1400px]:inline-flex">PayPal sandbox · no real money</span>
        <span className="badge tone-warn hidden shrink-0 whitespace-nowrap md:max-[1399px]:inline-flex">Sandbox</span>
        {state && <span className="chip hidden shrink-0 whitespace-nowrap min-[1560px]:inline-flex">{state.model}</span>}
        {state && state.mandates.length > 0 && !creating && (
          <>
            <select
              className="input min-w-0 max-w-[9.5rem] shrink text-ellipsis sm:max-w-[16rem]"
              aria-label="Mandate"
              value={m?.id}
              onChange={(e) => {
                setMandateId(e.target.value);
                refresh(e.target.value);
              }}
            >
              {state.mandates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({sentence(x.status).toLowerCase()})
                </option>
              ))}
            </select>
            <button className="btn btn-sm" onClick={() => setCreating(true)} aria-label="New mandate">
              <Icon name="plus" size={14} strokeWidth={2.4} />
              <span className="hidden sm:inline">New mandate</span>
            </button>
          </>
        )}
      </SiteNav>

      {toast && (
        <div className={`toast tone-${toast.tone}`} role="status">
          <span className="glyph" style={{ width: 26, height: 26, background: "color-mix(in srgb, var(--tone) 15%, transparent)", color: "var(--tone)" }}>
            <Icon name={toast.tone === "good" ? "check" : "alert"} size={14} strokeWidth={2.4} />
          </span>
          <span className="min-w-0 flex-1 tracking-[-0.008em]">{toast.text}</span>
          <button className="btn btn-sm" onClick={() => setToast(null)}>
            Dismiss
          </button>
        </div>
      )}

      <main className="mx-auto max-w-[1360px] px-4 pb-10 pt-5 sm:px-6">
        {loadError && (
          <p className="tone-bad mb-4 rounded-xl px-4 py-3 text-[0.875rem]" style={{ background: "color-mix(in srgb, var(--tone) 12%, transparent)", color: "var(--tone)" }}>
            {loadError}
          </p>
        )}

        {!state && !loadError && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)_360px]" aria-busy="true" aria-label="Loading">
            <div className="skeleton h-[420px]" />
            <div className="skeleton hidden h-[560px] lg:block" />
            <div className="skeleton hidden h-[300px] lg:block" />
          </div>
        )}

        {showOnboarding && <Onboarding onCancel={m ? () => setCreating(false) : undefined} />}

        {state && m && !creating && (
          <div className="rise grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <MandateCard m={m} onChange={refresh} />
              <DemoControls m={m} onChange={refresh} />
            </div>
            <Chat mandateId={m.id} active={m.status === "active"} approvals={state.approvals} onChange={refresh} />
            <div className="min-w-0 space-y-5 lg:col-span-2 xl:col-span-1">
              <Approvals items={state.approvals} onChange={refresh} />
              <LimitOrders items={state.limitOrders} mandateId={m.id} onChange={refresh} />
              <Purchases items={state.purchases} onChange={refresh} />
              <AuditLog events={state.events} />
            </div>
          </div>
        )}
      </main>
    </>
  );
}
