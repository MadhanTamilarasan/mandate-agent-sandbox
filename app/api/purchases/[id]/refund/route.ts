import { fail, ok, rejectCrossOrigin } from "@/lib/http";
import { refundPurchase } from "@/lib/service";

export const dynamic = "force-dynamic";

/** "Undo purchase". Moves money, so it is a human button only: the agent has no tool that reaches this. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const result = await refundPurchase(id);
    if (!result.ok) return fail(new Error(result.message));
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
