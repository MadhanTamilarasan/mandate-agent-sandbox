"use client";

import { useState } from "react";
import { Thinking } from "./ui";

type Draft = {
  name: string;
  goal: string;
  budget: number;
  maxPerItem: number;
  autoApproveBelow: number;
  blockedTerms: string;
  allowedMerchants: string;
  days: number;
};

const EXAMPLES = [
  "Birthday gift for my sister who runs. Up to $80 total, nothing over $50 each, no fast fashion.",
  "Work-from-home desk upgrades under $150 total. Only bestbuy.com or amazon.com. No gaming gear.",
  "Cozy winter essentials for my parents, $120 budget, $40 max per item, wool or cotton only.",
];

const blank: Draft = {
  name: "",
  goal: "",
  budget: 80,
  maxPerItem: 50,
  autoApproveBelow: 30,
  blockedTerms: "",
  allowedMerchants: "",
  days: 7,
};

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function Onboarding({ onCancel }: { onCancel?: () => void }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"" | "parse" | "create">("");
  const [error, setError] = useState("");

  async function parse() {
    setError("");
    setBusy("parse");
    try {
      const res = await fetch("/api/mandates/parse", { method: "POST", body: JSON.stringify({ text }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setDraft({
        name: j.name,
        goal: j.goal,
        budget: j.budget,
        maxPerItem: j.maxPerItem,
        autoApproveBelow: j.autoApproveBelow,
        blockedTerms: (j.blockedTerms ?? []).join(", "),
        allowedMerchants: (j.allowedMerchants ?? []).join(", "),
        days: j.days,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function create() {
    if (!draft) return;
    setError("");
    setBusy("create");
    try {
      const res = await fetch("/api/mandates", {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          blockedTerms: list(draft.blockedTerms),
          allowedMerchants: list(draft.allowedMerchants),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      window.location.href = j.approveUrl; // buyer approves the budget in PayPal
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const num = (k: "budget" | "maxPerItem" | "autoApproveBelow" | "days") => (
    <input
      className="input"
      type="number"
      min={0}
      step="0.01"
      value={draft?.[k] ?? 0}
      onChange={(e) => set(k, Number(e.target.value))}
    />
  );

  return (
    <div className="card mx-auto max-w-2xl p-6">
      <h2 className="text-xl font-bold">Create a spending mandate</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        Describe what the agent may buy. We turn it into signed rules, then you approve the budget once in PayPal. The
        agent can never spend more than that, and can never edit its own rules.
      </p>

      {!draft && (
        <>
          <textarea
            className="input mt-4"
            rows={4}
            placeholder="e.g. Birthday gift for my sister who runs. Up to $80 total, nothing over $50 each, no fast fashion."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} className="btn btn-sm" onClick={() => setText(ex)}>
                {ex.slice(0, 38)}…
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button className="btn btn-primary" disabled={!text.trim() || busy !== ""} onClick={parse}>
              Draft my mandate
            </button>
            <button className="btn" onClick={() => setDraft({ ...blank })}>
              Fill in manually
            </button>
            {onCancel && (
              <button className="btn" onClick={onCancel}>
                Cancel
              </button>
            )}
            {busy === "parse" && <Thinking label="Reading your request…" />}
          </div>
        </>
      )}

      {draft && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs" style={{ color: "var(--muted)" }}>
              Name
              <input className="input mt-1" value={draft.name} onChange={(e) => set("name", e.target.value)} />
            </label>
            <label className="text-xs" style={{ color: "var(--muted)" }}>
              Lasts (days, max 28)
              <div className="mt-1">{num("days")}</div>
            </label>
          </div>
          <label className="block text-xs" style={{ color: "var(--muted)" }}>
            Goal (the auditor checks every purchase against this)
            <textarea className="input mt-1" rows={2} value={draft.goal} onChange={(e) => set("goal", e.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs" style={{ color: "var(--muted)" }}>
              Total budget (USD)
              <div className="mt-1">{num("budget")}</div>
            </label>
            <label className="text-xs" style={{ color: "var(--muted)" }}>
              Max per item
              <div className="mt-1">{num("maxPerItem")}</div>
            </label>
            <label className="text-xs" style={{ color: "var(--muted)" }}>
              Auto-approve below
              <div className="mt-1">{num("autoApproveBelow")}</div>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs" style={{ color: "var(--muted)" }}>
              Never buy (comma separated)
              <input className="input mt-1" value={draft.blockedTerms} onChange={(e) => set("blockedTerms", e.target.value)} />
            </label>
            <label className="text-xs" style={{ color: "var(--muted)" }}>
              Only these merchants (blank = any)
              <input className="input mt-1" placeholder="bestbuy.com, macys.com" value={draft.allowedMerchants} onChange={(e) => set("allowedMerchants", e.target.value)} />
            </label>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button className="btn btn-primary" disabled={busy !== ""} onClick={create}>
              Approve budget with PayPal →
            </button>
            <button className="btn" disabled={busy !== ""} onClick={() => setDraft(null)}>
              Back
            </button>
            {busy === "create" && <Thinking label="Opening PayPal…" />}
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            PayPal sandbox only. You approve a hold for the budget, and money moves only when the agent&apos;s purchases
            pass the checks. Unspent funds are released when you close the mandate.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg p-2 text-sm" style={{ background: "#3d1717", color: "var(--bad)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
