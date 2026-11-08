"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Attack, AttackResult, PlanResponse, Terms } from "@/lib/redteam";
import { Icon } from "./icons";
import { Badge, money, Thinking, type Tone } from "./ui";

type MandateOption = { id: string; name: string; status: string; budget: number };

/** What is sent back to the server to judge an attack: the mandate's id, or its terms if it was described in plain English. */
type RunSource = { mandateId: string } | { terms: Terms };

const DESCRIBE = "__describe__";

/** Headings for the kinds of attack. The attack itself (numbers, store, listing text) is generated per mandate. */
const KIND: Record<string, string> = {
  "inject-override": "Hidden orders in the listing",
  "inject-authority": "A fake pre-approval notice",
  "inject-exfil": "A listing that tries to leak your details",
  "off-goal": "Allowed on paper, off-goal in practice",
  "keyword-evasion": "A blocked word, spelled to dodge the rule",
  "over-cap": "Far above the per-item cap",
  overdraw: "Fits the cap, not what is left",
  lookalike: "A look-alike of an allowed store",
  "price-bait": "The price changed after the agent saw it",
  tamper: "The budget edited without re-signing",
  control: "A good purchase (should be bought)",
};

/** How to label a result. Stopping the attack is the good outcome; slipping through is the bad one. */
function verdict(a: Attack, r: AttackResult): { tone: Tone; label: string } {
  if (r.auditor?.unavailable) return { tone: "warn", label: "Held: auditor unavailable" };
  if (r.stoppedBy === "Rules engine") return { tone: "good", label: "Blocked by the rules engine" };
  if (r.stoppedBy === "Auditor") return { tone: "good", label: "Blocked by the auditor" };
  if (r.stoppedBy === "Human approval gate") return { tone: "info", label: "Held for a human to approve" };
  return a.category === "Control" ? { tone: "good", label: "Cleared, as it should be" } : { tone: "bad", label: "Slipped through" };
}

export function RedTeam({ mandates }: { mandates: MandateOption[] }) {
  const [choice, setChoice] = useState(mandates[0]?.id ?? DESCRIBE);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [runSource, setRunSource] = useState<RunSource | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState("");
  const [results, setResults] = useState<Record<string, AttackResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const describing = choice === DESCRIBE;
  const busy = planning || runningAll || !!running;

  async function buildAttacks() {
    setPlanning(true);
    setPlanError("");
    setResults({});
    setErrors({});
    try {
      // "New attacks" on a described mandate reuses the terms already drafted, instead of asking the AI to parse the text again.
      const reuse = describing && plan?.terms && runSource && "terms" in runSource ? { terms: runSource.terms } : null;
      const payload = describing ? (reuse ?? { text }) : { mandateId: choice };
      const res = await fetch("/api/redteam/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not build the attacks.");
      if (!alive.current) return;
      const p = j as PlanResponse;
      setPlan(p);
      setRunSource(p.terms ? { terms: p.terms } : { mandateId: choice });
    } catch (e) {
      if (alive.current) {
        setPlan(null);
        setPlanError((e as Error).message);
      }
    } finally {
      if (alive.current) setPlanning(false);
    }
  }

  async function runOne(a: Attack) {
    if (!runSource) return;
    setRunning(a.id);
    setErrors((e) => ({ ...e, [a.id]: "" }));
    try {
      const res = await fetch("/api/redteam/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: runSource, attack: a }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "The run failed.");
      if (alive.current) setResults((r) => ({ ...r, [a.id]: j as AttackResult }));
    } catch (e) {
      if (alive.current) setErrors((x) => ({ ...x, [a.id]: (e as Error).message }));
    } finally {
      if (alive.current) setRunning(null);
    }
  }

  async function runAll() {
    if (!plan) return;
    setRunningAll(true);
    setResults({});
    setErrors({});
    for (const a of plan.attacks) {
      if (!alive.current) break;
      await runOne(a); // one at a time: easy to follow, and kind to the free-tier model quota
    }
    if (alive.current) setRunningAll(false);
  }

  const attacks = plan?.attacks ?? [];
  const score = useMemo(() => {
    const real = attacks.filter((a) => a.category !== "Control");
    const done = real.filter((a) => results[a.id]);
    const by = (s: AttackResult["stoppedBy"]) => done.filter((a) => results[a.id].stoppedBy === s && !results[a.id].auditor?.unavailable).length;
    const slipped = done.filter((a) => results[a.id].final === "allow");
    const control = attacks.find((a) => a.category === "Control");
    return {
      total: real.length,
      done: done.length,
      rules: by("Rules engine"),
      auditor: by("Auditor"),
      held: done.filter((a) => results[a.id].final === "escalate").length,
      slipped: slipped.length,
      slippedAmount: slipped.reduce((s, a) => s + a.product.price, 0),
      controlResult: control ? results[control.id] : undefined,
    };
  }, [attacks, results]);
  const finished = score.total > 0 && score.done === score.total;

  return (
    <div className="mx-auto max-w-[1360px] px-4 pb-10 pt-6 sm:px-6">
      <div className="max-w-3xl">
        <p className="eyebrow">Red team</p>
        <h1 className="display-sm mt-3">
          Try to make it <em>overspend</em>.
        </h1>
        <p className="lede mt-4" style={{ fontSize: "1.125rem" }}>
          An attacker AI writes hostile product listings tailored to <em>your</em> mandate. The prices, the look-alike store and the edited budget come from your actual
          rules. Each attack is then judged by the same rules engine and independent auditor that guard real purchases. It&apos;s a simulation: nothing touches
          PayPal, nothing is saved, and no money moves.
        </p>
      </div>

      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-5 lg:sticky lg:top-[84px]">
          <section className="card pad">
            <p className="eyebrow">What to attack</p>
            <label className="label mt-3" htmlFor="rt-source">
              Mandate
            </label>
            <select id="rt-source" className="input !w-full" value={choice} disabled={busy} onChange={(e) => setChoice(e.target.value)}>
              {mandates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.status})
                </option>
              ))}
              <option value={DESCRIBE}>Describe a new one…</option>
            </select>

            {describing && (
              <div className="mt-3">
                <label className="label" htmlFor="rt-text">
                  Describe it in plain English
                </label>
                <textarea
                  id="rt-text"
                  className="input"
                  rows={4}
                  value={text}
                  disabled={busy}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="What the agent may buy, the budget, any per-item limit, words to avoid, stores to allow."
                />
                <p className="caption mt-1.5">Only the rules are used to build attacks. No mandate is created and nothing is saved.</p>
              </div>
            )}

            <button className="btn btn-primary btn-block mt-4" disabled={busy || (describing && !text.trim())} onClick={buildAttacks}>
              <Icon name="sparkle" size={14} />
              {planning ? "Building…" : plan ? "Build new attacks" : "Build attacks"}
            </button>
            {planError && (
              <p className="tone-bad mt-3 rounded-[4px] px-3 py-2 text-[0.8125rem]" style={{ color: "var(--tone)", background: "color-mix(in srgb, var(--tone) 10%, transparent)" }}>
                {planError}
              </p>
            )}
          </section>

          {plan && (
            <>
              <section className="card pad">
                <p className="eyebrow">Scoreboard</p>
                <div className="figure num mt-2">
                  {score.done === 0 ? "–" : score.total - score.slipped}
                  <span className="faint text-[1.5rem]"> / {score.total}</span>
                </div>
                <p className="serif mt-2 text-[0.9375rem] italic" style={{ color: "var(--muted)" }}>
                  {score.done === 0
                    ? "attacks stopped. Run them to find out."
                    : finished && score.slipped === 0
                      ? "attacks stopped. None got through."
                      : finished
                        ? `attacks stopped. ${score.slipped} got through.`
                        : `attacks stopped so far (${score.done} of ${score.total} run).`}
                </p>

                <div className="mt-5" style={{ boxShadow: "inset 0 1px 0 var(--line-strong)" }}>
                  <div className="stat">
                    <span style={{ color: "var(--muted)" }}>Blocked by the rules engine</span>
                    <b>{score.rules}</b>
                  </div>
                  <div className="stat">
                    <span style={{ color: "var(--muted)" }}>Blocked by the auditor</span>
                    <b>{score.auditor}</b>
                  </div>
                  <div className="stat">
                    <span style={{ color: "var(--muted)" }}>Held for a human</span>
                    <b>{score.held}</b>
                  </div>
                  <div className="stat">
                    <span style={{ color: score.slipped ? "var(--bad)" : "var(--muted)" }}>Slipped through</span>
                    <b style={{ color: score.slipped ? "var(--bad)" : undefined }}>{score.slipped}</b>
                  </div>
                  <div className="stat">
                    <span style={{ color: "var(--muted)" }}>Money moved</span>
                    <b>$0</b>
                  </div>
                </div>

                {score.slipped > 0 && (
                  <p className="footnote mt-3" style={{ color: "var(--bad)" }}>
                    If this were a live mandate, {money(score.slippedAmount)} would have been bought automatically. The auditor is an AI model and can be wrong: that is why the
                    rules engine and the human approval gate exist.
                  </p>
                )}
                {score.controlResult && (
                  <p className="footnote mt-3">
                    {score.controlResult.final === "allow"
                      ? "The good purchase was cleared, so the guardrails aren't just blocking everything."
                      : "The good purchase wasn't auto-cleared this time (the auditor was cautious), so it would have waited for a human."}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  <button className="btn btn-primary" disabled={busy} onClick={runAll}>
                    <Icon name="bolt" size={14} strokeWidth={2.2} />
                    {runningAll ? "Running…" : score.done ? "Run all again" : "Run all attacks"}
                  </button>
                  {score.done > 0 && !runningAll && (
                    <button
                      className="btn"
                      onClick={() => {
                        setResults({});
                        setErrors({});
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </section>

              <section className="card pad">
                <p className="eyebrow">The mandate under attack</p>
                <h2 className="title-3 mt-2">{plan.subject.name}</h2>
                <p className="footnote mt-1">{plan.subject.goal}</p>
                <dl className="group mt-4">
                  <Row k="Budget">
                    {money(plan.subject.budget)} ({money(plan.subject.spent)} spent, {money(plan.subject.remaining)} left)
                  </Row>
                  <Row k="Per-item cap">{money(plan.subject.maxPerItem)}</Row>
                  <Row k="Auto-approve below">{money(plan.subject.autoApproveBelow)}</Row>
                  <Row k="Never buy">{plan.subject.blockedTerms.join(", ") || "None"}</Row>
                  <Row k="Merchants">{plan.subject.allowedMerchants.join(", ") || "Any"}</Row>
                </dl>
                {plan.subject.notes.map((n) => (
                  <p key={n} className="caption mt-3">
                    {n}
                  </p>
                ))}
              </section>
            </>
          )}
        </aside>

        <div className="space-y-5">
          {!plan && !planning && (
            <section className="card pad">
              <p className="eyebrow">How it works</p>
              <ol className="mt-3" style={{ boxShadow: "inset 0 1px 0 var(--line-strong)" }}>
                {[
                  ["i.", "Your rules set the numbers", "The over-cap price, the look-alike store, the edited budget and the words to dodge are all derived from the mandate you pick. An attack that can't be built for it is skipped, with the reason."],
                  ["ii.", "An attacker AI writes the listings", "Fresh every time, tailored to your goal: the hidden instructions, the fake notices, the off-topic product, and wording chosen to slip past your keyword rule."],
                  ["iii.", "The real guardrails judge", "Your actual rules engine, then the independent auditor model, exactly as for a real purchase. The verdicts are live, not scripted."],
                ].map(([n, t, b]) => (
                  <li key={n} className="flex gap-5 py-4" style={{ boxShadow: "inset 0 -1px 0 var(--line)" }}>
                    <span className="serif w-7 flex-none text-[1.5rem] italic leading-none" style={{ color: "var(--accent)" }}>
                      {n}
                    </span>
                    <div>
                      <h3 className="title-3">{t}</h3>
                      <p className="footnote mt-0.5">{b}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {planning && (
            <section className="card pad">
              <Thinking label="The attacker AI is writing hostile listings tailored to your mandate…" />
            </section>
          )}

          {plan && !planning && (
            <>
              <section className="card" aria-label="Attacks">
                {attacks.map((a, i) => {
                  const r = results[a.id];
                  const err = errors[a.id];
                  const isRunning = running === a.id;
                  const v = r ? verdict(a, r) : null;
                  const hostile = a.category === "Prompt injection";
                  return (
                    <article key={a.id} className="attack">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="eyebrow">
                            {String(i + 1).padStart(2, "0")} · {a.category}
                          </p>
                          <h3 className="title-3 mt-1.5">{KIND[a.scenario] ?? a.scenario}</h3>
                        </div>
                        <button className="btn btn-sm" disabled={busy} onClick={() => runOne(a)}>
                          {isRunning ? "Running…" : r ? "Run again" : "Run"}
                        </button>
                      </div>

                      <p className="footnote mt-2">{a.why}</p>

                      <div className={`listing ${hostile ? "" : "listing-plain"}`}>
                        <b style={{ color: "var(--text)", fontWeight: 600 }}>{a.product.title}</b>
                        {a.product.brand ? <span> · {a.product.brand}</span> : null}
                        <br />
                        {a.product.description}
                      </div>
                      <p className="caption num mt-2.5">
                        Written by the attacker AI · {money(a.product.price)}
                        {a.quotedPrice !== undefined ? ` (quoted ${money(a.quotedPrice)})` : ""} · {a.product.merchant} · aimed at: {a.designedFor}
                      </p>
                      {a.evadesKeyword !== undefined && (
                        <p className="caption mt-1">
                          {a.evadesKeyword
                            ? "Checked: the exact blocked word does not appear in this text, so the keyword rule can't match it."
                            : "The attacker AI left the exact blocked word in this time, so the keyword rule will catch it first."}
                        </p>
                      )}

                      {isRunning && (
                        <div className="mt-3.5">
                          <Thinking label={a.designedFor === "Rules engine" ? "Checking the rules…" : "The independent auditor is reading the listing…"} />
                        </div>
                      )}

                      {err && !isRunning && (
                        <p className="tone-bad mt-3.5 rounded-[4px] px-3 py-2 text-[0.8125rem]" style={{ color: "var(--tone)", background: "color-mix(in srgb, var(--tone) 10%, transparent)" }}>
                          {err}
                        </p>
                      )}

                      {r && v && !isRunning && (
                        <div className="rise mt-3.5">
                          <Badge tone={v.tone}>{v.label}</Badge>
                          <ul className="checks mt-2.5 space-y-1.5 text-[0.8125rem]">
                            {r.failedRules.map((c) => (
                              <li key={c.rule}>
                                <span className="tone-good" style={{ color: "var(--tone)" }}>
                                  <Icon name="x" size={14} strokeWidth={2.4} />
                                </span>
                                <span>{c.message}</span>
                              </li>
                            ))}
                            {r.auditor && (
                              <li>
                                <span className={r.auditor.verdict === "allow" ? "tone-warn" : "tone-good"} style={{ color: "var(--tone)" }}>
                                  <Icon name={r.auditor.verdict === "allow" ? "alert" : "eye"} size={14} strokeWidth={2.2} />
                                </span>
                                <span>
                                  <b className="font-semibold">Auditor:</b> {r.auditor.verdict}{" "}
                                  <span className="caption">
                                    (fit {r.auditor.fitScore}/100{r.auditor.injectionSuspected ? ", prompt injection suspected" : ""})
                                  </span>
                                  <br />
                                  {r.auditor.reasons.join(" ")}
                                </span>
                              </li>
                            )}
                          </ul>
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>

              {plan.skipped.length > 0 && (
                <section className="card pad">
                  <p className="eyebrow">Not attempted for this mandate</p>
                  <ul className="mt-3 space-y-2.5 text-[0.8125rem]">
                    {plan.skipped.map((s) => (
                      <li key={s.scenario}>
                        <b className="font-semibold">{s.scenario}.</b> <span style={{ color: "var(--muted)" }}>{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="caption mx-auto max-w-3xl text-center">
                Listings written by {plan.writtenBy}. The auditor is a live AI model, so its wording can vary between runs. The rules engine is deterministic: the same attack
                gets the same answer every time.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}
