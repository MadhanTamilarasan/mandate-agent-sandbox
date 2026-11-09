import { env } from "./env";

/**
 * Minimal PayPal REST client (sandbox by default). Covers the order-authorize
 * -> multi-capture -> void/refund lifecycle that the mandate model relies on.
 */

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public debugId?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let cachedToken: { value: string; exp: number } | null = null;

async function token(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const basic = Buffer.from(`${env.paypalClientId}:${env.paypalClientSecret}`).toString("base64");
  const res = await fetch(`${env.paypalBase}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new PayPalError(`PayPal auth failed: ${json.error_description ?? res.status}`, res.status);
  }
  cachedToken = { value: json.access_token, exp: Date.now() + (json.expires_in ?? 3000) * 1000 };
  return cachedToken.value;
}

async function call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token()}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await fetch(`${env.paypalBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const issue = json?.details?.[0]?.issue ?? json?.name ?? "PAYPAL_ERROR";
    const desc = json?.details?.[0]?.description ?? json?.message ?? "";
    throw new PayPalError(`PayPal ${method} ${path} failed (${res.status} ${issue}) ${desc}`.trim(), res.status, json?.debug_id, json);
  }
  return json as T;
}

type Link = { rel: string; href: string };

export type FundingOrder = { orderId: string; approveUrl: string };

/** Create an AUTHORIZE-intent order: the mandate's budget, approved once by the buyer. */
export async function createFundingOrder(opts: {
  mandateId: string;
  amount: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<FundingOrder> {
  const order = await call<{ id: string; links: Link[] }>(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: opts.mandateId,
          description: opts.description.slice(0, 120),
          custom_id: opts.mandateId,
          amount: { currency_code: "USD", value: opts.amount.toFixed(2) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Mandate",
            user_action: "CONTINUE",
            shipping_preference: "NO_SHIPPING",
            payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
            return_url: opts.returnUrl,
            cancel_url: opts.cancelUrl,
          },
        },
      },
    },
    `fund-${opts.mandateId}`,
  );
  const link = order.links.find((l) => l.rel === "payer-action") ?? order.links.find((l) => l.rel === "approve");
  if (!link) throw new PayPalError("PayPal did not return an approval link", 502, undefined, order);
  return { orderId: order.id, approveUrl: link.href };
}

export type AuthorizedOrder = { authorizationId: string; amount: number; payerEmail?: string; status: string };

/** After the buyer approves, place the hold. */
export async function authorizeOrder(orderId: string): Promise<AuthorizedOrder> {
  const res = await call<any>("POST", `/v2/checkout/orders/${orderId}/authorize`, {}, `auth-${orderId}`);
  const auth = res?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth?.id) throw new PayPalError("Order was not authorized", 502, res?.debug_id, res);
  return {
    authorizationId: auth.id,
    amount: Number(auth.amount?.value ?? 0),
    payerEmail: res?.payer?.email_address,
    status: auth.status,
  };
}

export type CaptureResult = { captureId: string; status: string; amount: number };

/** Partial capture against the mandate's authorization (does not close it). */
export async function captureAuthorization(opts: {
  authorizationId: string;
  amount: number;
  invoiceId: string;
  note: string;
  requestId: string;
}): Promise<CaptureResult> {
  const res = await call<any>(
    "POST",
    `/v2/payments/authorizations/${opts.authorizationId}/capture`,
    {
      amount: { currency_code: "USD", value: opts.amount.toFixed(2) },
      invoice_id: opts.invoiceId,
      note_to_payer: opts.note.slice(0, 255),
      final_capture: false,
    },
    opts.requestId,
  );
  return { captureId: res.id, status: res.status, amount: Number(res.amount?.value ?? opts.amount) };
}

export async function voidAuthorization(authorizationId: string): Promise<void> {
  await call("POST", `/v2/payments/authorizations/${authorizationId}/void`, {});
}

export async function getAuthorization(authorizationId: string) {
  return call<any>("GET", `/v2/payments/authorizations/${authorizationId}`);
}

export type RefundResult = { refundId: string; status: string; amount: number };

/** Refund a capture: in full, or `amount` if only part of it is left to refund. */
export async function refundCapture(captureId: string, amount?: number): Promise<RefundResult> {
  const res = await call<any>(
    "POST",
    `/v2/payments/captures/${captureId}/refund`,
    amount ? { amount: { currency_code: "USD", value: amount.toFixed(2) } } : {},
    `refund-${captureId}-${amount ?? "full"}`,
  );
  if (!res?.id) throw new PayPalError("PayPal did not return a refund id", 502, res?.debug_id, res);
  return { refundId: res.id, status: String(res.status ?? "COMPLETED"), amount: Number(res.amount?.value ?? amount ?? 0) };
}

/**
 * Ask PayPal whether a webhook request really came from PayPal. Never act on an unverified event: anyone can POST
 * to a public URL.
 */
export async function verifyWebhook(headers: Headers, event: unknown, webhookId: string): Promise<boolean> {
  const h = (name: string) => headers.get(name) ?? "";
  const res = await call<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: event,
  });
  return res.verification_status === "SUCCESS";
}

/** Register this app's webhook URL for the given event types (used by scripts/register-webhook.ts). */
export async function createWebhook(url: string, eventTypes: readonly string[]) {
  return call<{ id: string; url: string }>("POST", "/v1/notifications/webhooks", {
    url,
    event_types: eventTypes.map((name) => ({ name })),
  });
}

export async function listWebhooks() {
  return call<{ webhooks?: { id: string; url: string }[] }>("GET", "/v1/notifications/webhooks");
}

export async function getOrder(orderId: string) {
  return call<any>("GET", `/v2/checkout/orders/${orderId}`);
}
