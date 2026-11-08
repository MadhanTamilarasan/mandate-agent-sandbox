import { body, fail, ok } from "@/lib/http";
import { createMandate, type MandateInput } from "@/lib/service";

export async function POST(req: Request) {
  try {
    const input = await body<MandateInput>(req);
    const m = await createMandate({
      name: String(input.name ?? ""),
      goal: String(input.goal ?? ""),
      budget: Number(input.budget),
      maxPerItem: Number(input.maxPerItem),
      autoApproveBelow: Number(input.autoApproveBelow),
      blockedTerms: Array.isArray(input.blockedTerms) ? input.blockedTerms.map(String) : [],
      allowedMerchants: Array.isArray(input.allowedMerchants) ? input.allowedMerchants.map(String) : [],
      days: input.days ? Number(input.days) : 7,
    });
    return ok({ id: m.id, approveUrl: m.paypal.approveUrl });
  } catch (e) {
    return fail(e);
  }
}
