// The AG Studio assistant. The adapter posts each model turn to this app's own /api/ai/llm route, which holds the API key and
// runs the turn on the same Gemini failover pool as the shopping agent.
//
// The team is AG Studio's five built-in agents plus a custom one of ours, "guardrail", that can check a purchase against a
// mandate with the app's real rules engine and auditor. The built-in lead is re-declared so it can delegate to it.

import {
  createAiHarness,
  directLlmRunner,
  type AgAiEvent,
  type AgAiHarnessSetup,
  type AgAiOutputItem,
  type AgAiTool,
  type AgAiPromptStarter,
  type AgLlmAdapter,
  type AgLlmResponse,
  type AgStudioApi,
} from "ag-studio";
import { GUARDRAIL_DESCRIPTION, GUARDRAIL_ID, GUARDRAIL_INSTRUCTIONS, LEAD_ADDENDUM, defineCheckTool, type MandateRef } from "./guardrail";

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

/**
 * AG Studio's delegate_to wants the target as an OBJECT, `type: { id: "guardrail" }`. Gemini often sends the plain string
 * `type: "guardrail"`, which Studio rejects ("no target agent specified"); the model then repeats the same call. Accept the string
 * form by converting it, so delegation works on Gemini.
 */
function tolerantDelegate(inner: AgAiTool): AgAiTool {
  return {
    ...inner,
    execute: inner.execute
      ? (call, ctx) => {
          const args = (call.args ?? {}) as Record<string, unknown>;
          return inner.execute!(typeof args.type === "string" ? { ...call, args: { ...args, type: { id: args.type } } } : call, ctx);
        }
      : undefined,
  };
}

/** Suggestions built from the user's own mandates, so they never mention something that isn't there. */
function promptStarters(mandates: MandateRef[]): AgAiPromptStarter[] {
  const starters: AgAiPromptStarter[] = [
    { label: "Summarise this page", prompt: "Summarise what this page shows: every widget, the fields it reads, and what stands out." },
    { label: "Which rule stops the most?", prompt: "Which rule or finding stops the most purchases, and how much money did that keep safe?" },
  ];
  if (mandates.length > 0) {
    const m = mandates[0];
    starters.push({
      label: "Would this purchase pass?",
      prompt: `Would a $200 item from amazon.com pass my "${m.name}" mandate? Use the guardrail check, not a guess.`,
    });
  }
  return starters;
}

export function buildAi(mandates: MandateRef[]): AgAiHarnessSetup {
  const adapter = proxyAdapter("/api/ai/llm");

  // At runtime the setup callback receives the full Studio API; its declared type is the narrower core API.
  return ({ api }) => {
    const studio = api as unknown as AgStudioApi;
    return createAiHarness(studio, ({ builtIn, tools }) => {
      const checkTool = defineCheckTool(studio, mandates);
      const lead = builtIn.lead;

      const specialists = Object.values(builtIn)
        .filter((d) => d.id !== "lead")
        .map((d) => directLlmRunner({ ...d, adapter }));

      const guardrail = checkTool
        ? [
            directLlmRunner({
              id: GUARDRAIL_ID,
              name: "Guardrail",
              adapter,
              description: GUARDRAIL_DESCRIPTION,
              schema: (s) => s.undefined(),
              instructions: () => GUARDRAIL_INSTRUCTIONS,
              tools: () => [checkTool],
            }),
          ]
        : [];

      // Same lead as AG Studio's, with the new specialist added to who it can hand work to.
      const delegates = [...Object.keys(builtIn).filter((id) => id !== "lead"), ...(checkTool ? [GUARDRAIL_ID] : [])];
      const extendedLead = directLlmRunner({
        ...lead,
        adapter,
        instructions: (ctx: any, params: any) => `${lead.instructions?.(ctx, params) ?? ""}${checkTool ? LEAD_ADDENDUM : ""}`,
        tools: (ctx: any, params: any) => [...(lead.tools?.(ctx, params) ?? []).filter((t) => t.name !== "delegate_to"), tolerantDelegate(tools.delegateTo(delegates))],
      } as any);

      return {
        agents: [...specialists, ...guardrail, extendedLead],
        primary: "lead",
        promptStarters: promptStarters(mandates),
      } as any;
    });
  };
}
