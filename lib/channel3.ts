import { env } from "./env";
import type { ProductSnapshot } from "./types";

const BASE = "https://api.trychannel3.com/v1";

type RawOffer = {
  url: string;
  domain: string;
  price: { price: number; currency: string; compare_at_price?: number | null };
  availability: string;
};

type RawProduct = {
  id: string;
  title: string;
  description?: string | null;
  brands?: { name: string }[];
  images?: { url: string; cleaned_url?: string | null; is_main_image?: boolean }[];
  offers?: RawOffer[];
};

async function c3<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "x-api-key": env.channel3Key, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`Channel3 ${path} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Pick the best offer: in-stock first, then cheapest. Optionally pin a merchant. */
export function toSnapshot(p: RawProduct, merchant?: string): ProductSnapshot | null {
  const offers = (p.offers ?? []).filter((o) => o.price && typeof o.price.price === "number");
  if (offers.length === 0) return null;
  const pinned = merchant ? offers.find((o) => o.domain === merchant) : undefined;
  const best =
    pinned ??
    [...offers].sort((a, b) => {
      const as = a.availability === "InStock" ? 0 : 1;
      const bs = b.availability === "InStock" ? 0 : 1;
      return as - bs || a.price.price - b.price.price;
    })[0];
  const img = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  return {
    id: p.id,
    title: p.title,
    brand: p.brands?.[0]?.name ?? "",
    description: (p.description ?? "").slice(0, 1500),
    imageUrl: img?.cleaned_url ?? img?.url ?? null,
    merchant: best.domain,
    buyUrl: best.url,
    price: best.price.price,
    currency: best.price.currency,
    inStock: best.availability === "InStock",
  };
}

export async function searchProducts(query: string, opts: { maxPrice?: number; limit?: number } = {}) {
  const filters: Record<string, unknown> = { availability: ["InStock"] };
  if (opts.maxPrice && opts.maxPrice > 0) filters.price = { min_price: 1, max_price: opts.maxPrice };
  const res = await c3<{ products: RawProduct[] }>("/search", {
    method: "POST",
    body: JSON.stringify({ query, filters, limit: opts.limit ?? 6 }),
  });
  return (res.products ?? []).map((p) => toSnapshot(p)).filter((p): p is ProductSnapshot => !!p);
}

/** Product detail by ID is free on Channel3, so it is used for live price checks. */
export async function getProduct(id: string, merchant?: string): Promise<ProductSnapshot | null> {
  const p = await c3<RawProduct>(`/products/${encodeURIComponent(id)}`);
  return toSnapshot(p, merchant);
}
