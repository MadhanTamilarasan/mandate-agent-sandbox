"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/agent";
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
    <div className="card flex h-[calc(100vh-130px)] min-h-[520px] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {msgs.length === 0 && (
          <div className="mx-auto max-w-md pt-10 text-center">
            <div className="text-3xl">🛍️</div>
            <h3 className="mt-2 font-bold">Tell the agent what to do</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              It searches real products, but every purchase has to clear your rules and an independent auditor first.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn text-left" disabled={!active} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
            {!active && (
              <p className="mt-3 text-sm" style={{ color: "var(--warn)" }}>
                Approve the budget in PayPal first. The agent can&apos;t act until the mandate is funded.
              </p>
            )}
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div
              className={`max-w-[92%] space-y-3 rounded-2xl px-4 py-3 text-sm ${m.role === "user" ? "" : "w-full"}`}
              style={{
                background: m.role === "user" ? "var(--accent)" : m.error ? "#3d1717" : "var(--panel-2)",
                color: m.error ? "var(--bad)" : "var(--text)",
              }}
            >
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.events?.map((e, k) => <EventView key={k} e={e} approvals={approvals} />)}
            </div>
          </div>
        ))}
        {busy && (
          <div className="rounded-2xl px-4 py-3" style={{ background: "var(--panel-2)" }}>
            <Thinking label="Agent is searching and checking… this can take 20–40s" />
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        className="flex gap-2 border-t p-3"
        style={{ borderColor: "var(--line)" }}
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
        <button className="btn btn-primary" disabled={!active || busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
