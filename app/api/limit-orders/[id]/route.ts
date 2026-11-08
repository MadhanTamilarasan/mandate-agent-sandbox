import { body, fail, ok } from "@/lib/http";
import { cancelLimitOrder, simulatePriceDrop } from "@/lib/service";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { action, price } = await body<{ action?: string; price?: number }>(req);
    if (action === "cancel") return ok(await cancelLimitOrder(id));
    if (action === "simulate_drop") return ok(await simulatePriceDrop(id, price));
    throw new Error("Unknown action");
  } catch (e) {
    return fail(e);
  }
}
