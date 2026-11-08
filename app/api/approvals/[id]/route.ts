import { body, fail, ok } from "@/lib/http";
import { resolveApproval } from "@/lib/service";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { action } = await body<{ action?: string }>(req);
    if (action !== "approve" && action !== "reject") throw new Error("Unknown action");
    return ok(await resolveApproval(id, action));
  } catch (e) {
    return fail(e);
  }
}
