import { task, type TaskContext } from "@renderinc/sdk/workflows";

/**
 * Mandate's limit-order watcher as Render Workflows tasks.
 *
 *  checkPrices(items)  fans out one `checkPrice` run per watched product. Each run
 *                      executes on its own Render instance, in parallel, with its own
 *                      retries and timeout, then rolls the quotes up into one result.
 *  checkPrice(...)     one live Channel3 lookup (product detail by ID is free).
 *
 * The web app triggers `checkPrices` through the Render SDK and still verifies the
 * price itself before any money moves, so this service only ever reads prices.
 */

export type PriceQuote = {
  productId: string;
  merchant: string;
  price: number | null;
  inStock: boolean;
  checkedAt: string;
  error?: string;
};

type Offer = { domain: string; price?: { price?: number }; availability?: string };

export const checkPrice = task(
  {
    name: "checkPrice",
    timeoutSeconds: 60,
    retry: { maxRetries: 2, waitDurationMs: 1000, backoffScaling: 2 },
  },
  async function checkPrice(ctx: TaskContext, productId: string, merchant: string): Promise<PriceQuote> {
    const key = process.env.CHANNEL3_API_KEY;
    if (!key) throw new Error("CHANNEL3_API_KEY is not set on the workflow service");

    const res = await fetch(`https://api.trychannel3.com/v1/products/${encodeURIComponent(productId)}`, {
      headers: { "x-api-key": key },
    });
    if (!res.ok) throw new Error(`Channel3 returned ${res.status} for ${productId}`);
    const product = (await res.json()) as { offers?: Offer[] };

    // Same rule as the web app: prefer the pinned merchant, else in-stock first, then cheapest.
    const offers = (product.offers ?? []).filter((o) => typeof o.price?.price === "number");
    const offer =
      offers.find((o) => o.domain === merchant) ??
      [...offers].sort((a, b) => {
        const as = a.availability === "InStock" ? 0 : 1;
        const bs = b.availability === "InStock" ? 0 : 1;
        return as - bs || (a.price!.price as number) - (b.price!.price as number);
      })[0];

    return {
      productId,
      merchant: offer?.domain ?? merchant,
      price: offer ? (offer.price!.price as number) : null,
      inStock: offer?.availability === "InStock",
      checkedAt: new Date().toISOString(),
    };
  },
);

export const checkPrices = task(
  { name: "checkPrices", timeoutSeconds: 120 },
  async function checkPrices(
    ctx: TaskContext,
    items: { productId: string; merchant: string }[],
  ): Promise<PriceQuote[]> {
    // One chained run per product, all in parallel on separate instances.
    const settled = await Promise.allSettled(items.map((i) => ctx.run(checkPrice, i.productId, i.merchant)));
    return settled.map((s, k) =>
      s.status === "fulfilled"
        ? s.value
        : {
            productId: items[k].productId,
            merchant: items[k].merchant,
            price: null,
            inStock: false,
            checkedAt: new Date().toISOString(),
            error: String((s.reason as Error)?.message ?? s.reason),
          },
    );
  },
);
