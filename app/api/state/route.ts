import { ok } from "@/lib/http";
import { modelLabel } from "@/lib/llm";
import { getState } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("mandate") ?? undefined;
  return ok({ ...getState(id), model: modelLabel() });
}
