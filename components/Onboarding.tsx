"use client";

import { useState } from "react";
import { Icon } from "./icons";
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

const STEPS = [
  { n: "i.", title: "Describe it", body: "Say what the agent may buy, in plain words." },
  { n: "ii.", title: "We sign the rules", body: "They're locked. The agent can't edit them." },
  { n: "iii.", title: "Approve in PayPal", body: "One hold for the budget. Never more." },
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  );
}

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
  const money = (k: "budget" | "maxPerItem" | "autoApproveBelow") => (
    <div className="affix">
      <span>$</span>
      <input className="input num" type="number" min={0} step="0.01" value={draft?.[k] ?? 0} onChange={(e) => set(k, Number(e.target.value))} />
    </div>
  );

  return (
    <div className="rise mx-auto grid max-w-[1180px] gap-12 pb-6 pt-4 sm:pt-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16">
      <div className="lg:pt-6">
        <p className="eyebrow">A spending mandate</p>
        <h1 className="display mt-5">
          Set the rules.
          <br />
          Let the agent <em>shop</em>.
        </h1>
        <p className="lede mt-6 max-w-[30rem]">
          Describe what it may buy. You approve the budget once in PayPal, and the agent can never spend past it.
        </p>
        <ol className="mt-10 max-w-[30rem]" style={{ boxShadow: "inset 0 1px 0 var(--line-strong)" }}>
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-5 py-4" style={{ boxShadow: "inset 0 -1px 0 var(--line)" }}>
              <span className="serif num w-7 flex-none text-[1.5rem] italic leading-none" style={{ color: "var(--accent)" }}>
                {s.n}
              </span>
              <div>
                <h3 className="title-3">{s.title}</h3>
                <p className="footnote mt-0.5">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="card pad self-start sm:p-8">
        {!draft && (
          <>
            <textarea
              className="input"
              rows={4}
              placeholder="e.g. Birthday gift for my sister who runs. Up to $80 total, nothing over $50 each, no fast fashion."
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Describe your mandate"
            />
            <div className="mt-3.5 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" onClick={() => setText(ex)}>
                  {ex.slice(0, 38)}…
                </button>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <button className="btn btn-primary btn-lg" disabled={!text.trim() || busy !== ""} onClick={parse}>
                Draft my mandate
              </button>
              <button className="btn btn-lg" onClick={() => setDraft({ ...blank })}>
                Fill in manually
              </button>
              {onCancel && (
                <button className="btn btn-lg btn-plain" onClick={onCancel}>
                  Cancel
                </button>
              )}
              {busy === "parse" && <Thinking label="Reading your request…" />}
            </div>
          </>
        )}

        {draft && (
          <div className="space-y-5">
            <div>
              <h2 className="title-2">Review the rules</h2>
              <p className="footnote mt-1">Adjust anything. These become the signed limits for the agent.</p>
            </div>
            <div className="grid items-end gap-4 sm:grid-cols-[1fr_160px]">
              <Field label="Name">
                <input className="input" value={draft.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Lasts (days)" hint="Up to 28">
                <input className="input num" type="number" min={1} max={28} value={draft.days} onChange={(e) => set("days", Number(e.target.value))} />
              </Field>
            </div>
            <Field label="Goal" hint="The auditor checks every purchase against this.">
              <textarea className="input" rows={2} value={draft.goal} onChange={(e) => set("goal", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Total budget">{money("budget")}</Field>
              <Field label="Max per item">{money("maxPerItem")}</Field>
              <Field label="Auto-approve below">{money("autoApproveBelow")}</Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Never buy" hint="Comma separated">
                <input className="input" value={draft.blockedTerms} onChange={(e) => set("blockedTerms", e.target.value)} />
              </Field>
              <Field label="Only these merchants" hint="Leave blank for any">
                <input className="input" placeholder="bestbuy.com, macys.com" value={draft.allowedMerchants} onChange={(e) => set("allowedMerchants", e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button className="btn btn-primary btn-lg" disabled={busy !== ""} onClick={create}>
                Approve budget with PayPal
                <Icon name="arrowRight" size={16} strokeWidth={2.2} />
              </button>
              <button className="btn btn-lg btn-plain" disabled={busy !== ""} onClick={() => setDraft(null)}>
                Back
              </button>
              {busy === "create" && <Thinking label="Opening PayPal…" />}
            </div>
            <p className="caption flex gap-2">
              <Icon name="lock" size={13} className="mt-0.5 flex-none" />
              <span>
                PayPal sandbox only. You approve a hold for the budget, and money moves only when the agent&apos;s purchases pass the checks.
                Unspent funds are released when you close the mandate.
              </span>
            </p>
          </div>
        )}

        {error && (
          <p className="tone-bad mt-4 rounded-xl px-3.5 py-2.5 text-[0.875rem]" style={{ background: "color-mix(in srgb, var(--tone) 12%, transparent)", color: "var(--tone)" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
