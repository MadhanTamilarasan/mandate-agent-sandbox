import { body, fail, ok } from "@/lib/http";
import { checkLimitOrders } from "@/lib/service";

export const maxDuration = 120;

/** Called by the UI ("Check prices now"), the in-process scheduler, or the Render worker. */
export async function POST(req: Request) {
  try {
    const { mandateId } = await body<{ mandateId?: string }>(req);
    return ok(await checkLimitOrders(mandateId));
  } catch (e) {
    return fail(e);
  }
}
