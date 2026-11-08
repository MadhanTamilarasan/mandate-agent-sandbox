"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/agent";
import { Icon } from "./icons";
import { EventView, Thinking } from "./ui";

type Msg = { role: "user" | "assistant"; content: string; events?: AgentEvent[]; error?: boolean };

const SUGGESTIONS = [
  "Find the best gift that fits my mandate and buy it.",
  "Find me options, but don't buy anything yet.",
  "Wait for a better price: set a limit order about 15% below the best option.",
];

export function Chat({
  mandateId,
  active,
  approvals,
  onChange,
}: {
  mandateId: string;
  active: boolean;
  approvals: { id: string; status: "pending" | "approved" | "rejected" }[];
  onChange: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMsgs([]);
  }, [mandateId]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        body: JSON.stringify({ mandateId, messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setMsgs([...next, { role: "assistant", content: j.text, events: j.events }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
      onChange();
    }
  }

  return (
    <section className="card flex h-[calc(100dvh-124px)] min-h-[560px] flex-col overflow-hidden">
      <header className="flex items-center justify-between px-6 py-4" style={{ boxShadow: "inset 0 -1px 0 var(--line)" }}>
        <div>
          <p className="eyebrow mb-1">Correspondence</p>
          <h2 className="title-3 whitespace-nowrap">The shopping agent</h2>
        </div>
        <span className={`caption flex items-center gap-2 whitespace-nowrap tone-${active ? "good" : "warn"}`}>
          <span className="pulse-dot" />
          {active ? "Ready" : "Waiting for funding"}
        </span>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
        {msgs.length === 0 && (
          <div className="rise max-w-xl pt-4">
            <h3 className="display-sm">
              What should we <em>find</em>?
            </h3>
            <p className="lede mt-4 max-w-md" style={{ fontSize: "1.125rem" }}>
              It searches real products. Every purchase has to clear your rules and an independent auditor first.
            </p>
            <div className="suggest-list mt-8">
              {SUGGESTIONS.map((s, i) => (
                <button key={s} className="suggest" disabled={!active} onClick={() => send(s)}>
                  <span className="no">{String(i + 1).padStart(2, "0")}</span>
                  <span>{s}</span>
                  <Icon name="arrowRight" size={15} strokeWidth={1.8} />
                </button>
              ))}
            </div>
            {!active && (
              <p className="footnote tone-warn mt-5 flex items-center gap-2" style={{ color: "var(--tone)" }}>
                <Icon name="lock" size={13} />
                Approve the budget in PayPal first. The agent can&apos;t act until the mandate is funded.
              </p>
            )}
          </div>
        )}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="rise flex justify-end">
              <div className="bubble-user whitespace-pre-wrap">{m.content}</div>
            </div>
          ) : m.error ? (
            <div key={i} className="rise bubble-error">
              {m.content}
            </div>
          ) : (
            <div key={i} className="rise space-y-3">
              <div className="prose-agent whitespace-pre-wrap">{m.content}</div>
              {m.events?.map((e, k) => <EventView key={k} e={e} approvals={approvals} />)}
            </div>
          ),
        )}
        {busy && (
          <div className="rise">
            <Thinking label="Searching and checking… this can take 20–40s" />
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="input"
          placeholder={active ? "Ask the agent to find, buy, or wait for a price…" : "Fund the mandate to start"}
          value={input}
          disabled={!active || busy}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="send" aria-label="Send" disabled={!active || busy || !input.trim()}>
          <Icon name="arrowUp" size={18} strokeWidth={2.4} />
        </button>
      </form>
    </section>
  );
}
