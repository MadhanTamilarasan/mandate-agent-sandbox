// The AG Studio assistant. The adapter posts each model turn to this app's own /api/ai/llm route,
// which holds the API key and runs the turn on the same Gemini failover pool as the shopping agent.

import { createAiHarness, type AgStudioApi, type AgAiEvent, type AgAiHarnessSetup, type AgAiOutputItem, type AgAiPromptStarter, type AgLlmAdapter, type AgLlmResponse } from "ag-studio";

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "Summarise this page", prompt: "Summarise what this page shows: every widget, the fields it reads, and what stands out." },
  { label: "Which rule stops the most?", prompt: "Which rule or finding stops the most purchases, and how much money did that keep safe?" },
  { label: "Protected money by day", prompt: "Add a chart of money kept safe (protected) by day." },
];

const failed = (message: string, cancelled = false): AgLlmResponse => ({
  id: `err_${Date.now()}`,
  createdAt: Date.now(),
  status: cancelled ? "cancelled" : "failed",
  output: [],
  error: { code: cancelled ? "cancelled" : "request_failed", message },
});

/** Browser-side adapter for a server route that returns Studio-shaped output items (non-streaming). */
export function proxyAdapter(endpoint: string): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const complete: Promise<AgLlmResponse> = fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: options?.signal,
      })
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          if (!res.ok) return failed(json?.error ?? `The assistant is unavailable (HTTP ${res.status}).`);
          return json as AgLlmResponse;
        })
        .catch((e: Error) => (e?.name === "AbortError" ? failed("Cancelled", true) : failed(e?.message ?? "Network error")));

      // The route answers whole turns, so replay each output item as AG-UI events.
      async function* events(): AsyncGenerator<AgAiEvent> {
        const res = await complete;
        for (const item of res.output as AgAiOutputItem[]) {
          if (item.type === "message") {
            const delta = item.content.map((c) => (c.type === "text" ? c.text : "")).join("");
            if (!delta) continue;
            yield { type: "TEXT_MESSAGE_START", messageId: item.id, role: "assistant" };
            yield { type: "TEXT_MESSAGE_CONTENT", messageId: item.id, delta };
            yield { type: "TEXT_MESSAGE_END", messageId: item.id };
          } else if (item.type === "function_call") {
            yield { type: "TOOL_CALL_START", toolCallId: item.callId, toolCallName: item.name };
            yield { type: "TOOL_CALL_ARGS", toolCallId: item.callId, delta: item.arguments };
            yield { type: "TOOL_CALL_END", toolCallId: item.callId };
          }
        }
      }

      return { stream: { [Symbol.asyncIterator]: () => events() }, complete };
    },
  };
}

export function buildAi(): AgAiHarnessSetup {
  const adapter = proxyAdapter("/api/ai/llm");
  // At runtime the setup callback receives the full Studio API; its declared type is the narrower core API.
  return ({ api }) => createAiHarness(api as unknown as AgStudioApi, { adapter, promptStarters: PROMPT_STARTERS });
}
