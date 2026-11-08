import { Render } from "@renderinc/sdk";

export type PriceQuote = {
  productId: string;
  merchant: string;
  price: number | null;
  inStock: boolean;
  checkedAt: string;
  error?: string;
};

export type WorkflowCheck = { runId: string; quotes: PriceQuote[] };

/** True when the app is configured to run price checks on Render Workflows. */
export function workflowEnabled(): boolean {
  return !!(process.env.RENDER_WORKFLOW_SLUG?.trim() && process.env.RENDER_API_KEY?.trim());
}

/**
 * Fan the price checks out as a Render Workflows task run (one parallel run per product).
 * Returns null when Workflows is not configured or the run fails, so callers fall back to
 * checking locally. Nothing here moves money: the caller re-verifies prices before paying.
 */
export async function checkPricesViaWorkflow(
  items: { productId: string; merchant: string }[],
): Promise<WorkflowCheck | null> {
  if (!workflowEnabled() || items.length === 0) return null;
  const slug = process.env.RENDER_WORKFLOW_SLUG!.trim();
  try {
    const render = new Render();
    const signal = AbortSignal.timeout(60_000);
    const started = await render.workflows.startTask(`${slug}/checkPrices`, [items], { signal });
    const run = await started.get();
    if (run.status !== "succeeded" && run.status !== "completed") {
      console.error("[workflow] run did not succeed:", run.status, run.error);
      return null;
    }
    // Task results come back as an array of return values; ours is a single PriceQuote[].
    const raw = Array.isArray(run.results) ? run.results[0] : run.results;
    const quotes = Array.isArray(raw) ? (raw as PriceQuote[]) : null;
    if (!quotes) {
      console.error("[workflow] unexpected result shape:", JSON.stringify(run.results)?.slice(0, 200));
      return null;
    }
    return { runId: started.taskRunId, quotes };
  } catch (e) {
    console.error("[workflow] price check via Render Workflows failed, using local checks:", (e as Error).message);
    return null;
  }
}
