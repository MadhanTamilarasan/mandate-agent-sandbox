import { body, fail, ok } from "@/lib/http";
import { parseMandate } from "@/lib/parse-mandate";

export async function POST(req: Request) {
  try {
    const { text } = await body<{ text?: string }>(req);
    if (!text?.trim()) throw new Error("Describe what you want the agent to buy.");
    return ok(await parseMandate(text));
  } catch (e) {
    return fail(e);
  }
}
