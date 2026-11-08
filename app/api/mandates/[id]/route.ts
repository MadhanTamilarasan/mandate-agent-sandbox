import { body, fail, ok } from "@/lib/http";
import { closeMandate, toggleTamper } from "@/lib/service";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { action } = await body<{ action?: string }>(req);
    if (action === "close") return ok(await closeMandate(id));
    if (action === "tamper") return ok(await toggleTamper(id));
    throw new Error("Unknown action");
  } catch (e) {
    return fail(e);
  }
}
