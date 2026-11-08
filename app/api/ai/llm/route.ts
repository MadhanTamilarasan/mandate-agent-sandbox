import { Output, generateText, jsonSchema, tool, type ModelMessage, type ToolSet } from "ai";
import { NextResponse } from "next/server";
import { friendlyLlmError, getModel, timeoutSignal, withRetry } from "@/lib/llm";

/**
 * Server side of the AG Studio assistant. Studio's browser-side adapter posts one
 * conversation turn here; we run it on the same Gemini failover pool the shopping
 * agent uses (or Claude, if LLM_PROVIDER=anthropic) and answer with Studio's output
 * items. The API key never leaves the server, and Studio executes the tools itself:
 * we only relay the model's tool calls back.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const MAX_BODY = 600_000; // characters: a conversation plus the data schema
const MAX_TOOLS = 80;

type TextPart = { type: string; text?: string };
type Item = {
  type: string;
  role?: string;
  content?: TextPart[];
  callId?: string;
  name?: string;
  arguments?: string;
  output?: string;
};

type StudioRequest = {
  input?: Item[];
  instructions?: string;
  tools?: { name: string; description?: string; parameters?: Record<string, unknown>; kind?: string }[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  responseFormat?: { type: "text" } | { type: "json"; name?: string; description?: string; schema: Record<string, unknown> };
};

const text = (parts?: TextPart[]) =>
  (parts ?? [])
    .filter((p) => p.type === "text" || p.type === "output_text")
    .map((p) => p.text ?? "")
    .join("");

function parseJson(s: string | undefined): unknown {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

/** Studio's conversation items -> AI SDK messages. */
function toMessages(items: Item[]): { system: string; messages: ModelMessage[] } {
  const system: string[] = [];
  const messages: ModelMessage[] = [];
  const names = new Map<string, string>(); // callId -> tool name, needed on results

  let assistantParts: any[] = [];
  const flushAssistant = () => {
    if (assistantParts.length) messages.push({ role: "assistant", content: assistantParts } as ModelMessage);
    assistantParts = [];
  };

  let results: any[] = [];
  const flushResults = () => {
    if (results.length) messages.push({ role: "tool", content: results } as ModelMessage);
    results = [];
  };

  for (const it of items) {
    if (it.type === "message") {
      const t = text(it.content);
      if (it.role === "system") {
        system.push(t);
        continue;
      }
      if (it.role === "user") {
        flushAssistant();
        flushResults();
        messages.push({ role: "user", content: t || " " });
      } else if (t) {
        flushResults();
        assistantParts.push({ type: "text", text: t });
      }
    } else if (it.type === "function_call" && it.callId && it.name) {
      flushResults();
      names.set(it.callId, it.name);
      assistantParts.push({ type: "tool-call", toolCallId: it.callId, toolName: it.name, input: parseJson(it.arguments) });
    } else if (it.type === "function_call_output" && it.callId) {
      flushAssistant();
      results.push({
        type: "tool-result",
        toolCallId: it.callId,
        toolName: names.get(it.callId) ?? "tool",
        output: { type: "text", value: it.output ?? "" },
      });
    }
    // Reasoning items are not replayed to the model.
  }
  flushAssistant();
  flushResults();
  return { system: system.join("\n\n"), messages };
}

export async function POST(req: Request) {
  // Same-origin only: this route spends the project's LLM quota.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Request too large." }, { status: 413 });

  let body: StudioRequest;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const defs = (body.tools ?? []).filter((t) => t.name && t.kind !== "provided").slice(0, MAX_TOOLS);
  const tools: ToolSet = {};
  for (const t of defs) {
    tools[t.name] = tool({
      description: t.description ?? "",
      inputSchema: jsonSchema((t.parameters as any) ?? { type: "object", properties: {} }),
    });
  }

  const { system, messages } = toMessages(body.input ?? []);
  const instructions = [body.instructions, system].filter(Boolean).join("\n\n");
  const hasTools = defs.length > 0;
  const choice = body.toolChoice;
  const toolChoice = !hasTools
    ? undefined
    : typeof choice === "object" && choice
      ? ({ type: "tool", toolName: choice.name } as const)
      : (choice ?? "auto");

  const json = body.responseFormat?.type === "json" ? body.responseFormat : undefined;

  try {
    const result = await withRetry(
      () =>
        generateText({
          model: getModel(),
          system: instructions || undefined,
          messages: messages.length ? messages : [{ role: "user", content: "Hello" }],
          ...(hasTools ? { tools, toolChoice: toolChoice as any } : {}),
          ...(json ? { output: Output.object({ schema: jsonSchema(json.schema as any), name: json.name, description: json.description }) } : {}),
          temperature: 0.2,
          maxOutputTokens: 4096,
          abortSignal: AbortSignal.any([req.signal, timeoutSignal(75_000)]),
        } as any),
      2,
    );

    const output: unknown[] = [];
    if (result.text) {
      output.push({
        id: `msg_${crypto.randomUUID()}`,
        kind: "output",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "text", text: result.text, annotations: [] }],
      });
    }
    for (const tc of (result as any).toolCalls ?? []) {
      output.push({
        id: `fc_${tc.toolCallId}`,
        kind: "output",
        type: "function_call",
        callId: tc.toolCallId,
        name: tc.toolName,
        arguments: JSON.stringify(tc.input ?? {}),
        status: "completed",
      });
    }

    return NextResponse.json({
      id: `resp_${crypto.randomUUID()}`,
      createdAt: Date.now(),
      status: "completed",
      output,
    });
  } catch (e) {
    return NextResponse.json({ error: friendlyLlmError(e) }, { status: 502 });
  }
}
