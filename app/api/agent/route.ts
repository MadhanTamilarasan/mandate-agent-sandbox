import { runAgent, type ChatMessage } from "@/lib/agent";
import { body, fail, ok } from "@/lib/http";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { mandateId, messages } = await body<{ mandateId?: string; messages?: ChatMessage[] }>(req);
    if (!mandateId) throw new Error("mandateId is required");
    const clean = (messages ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-12);
    if (clean.length === 0 || clean[clean.length - 1].role !== "user") throw new Error("Send a message first.");
    return ok(await runAgent(mandateId, clean));
  } catch (e) {
    return fail(e);
  }
}
