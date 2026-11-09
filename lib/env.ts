/** Typed, lazy access to environment variables (server-side only). */

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  get paypalBase() {
    return opt("PAYPAL_ENV", "sandbox") === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  },
  get paypalClientId() {
    return req("PAYPAL_CLIENT_ID");
  },
  get paypalClientSecret() {
    return req("PAYPAL_CLIENT_SECRET");
  },
  get channel3Key() {
    return req("CHANNEL3_API_KEY");
  },
  get llmProvider() {
    return opt("LLM_PROVIDER", "gemini").toLowerCase();
  },
  get geminiKey() {
    return req("GEMINI_API_KEY");
  },
  get anthropicKey() {
    return req("ANTHROPIC_API_KEY");
  },
  get llmModel() {
    return opt("LLM_MODEL");
  },
  /** Public base URL used for PayPal return/cancel links. */
  get appUrl() {
    return (
      opt("APP_BASE_URL") ||
      opt("RENDER_EXTERNAL_URL") ||
      `http://localhost:${opt("PORT", "3000")}`
    ).replace(/\/$/, "");
  },
  /** Id of the webhook registered in PayPal (see `npm run webhook:register`). Empty = webhooks are off. */
  get paypalWebhookId() {
    return opt("PAYPAL_WEBHOOK_ID");
  },
  get dataDir() {
    return opt("DATA_DIR", "./data");
  },
  get workerSecret() {
    return opt("WORKER_SECRET");
  },
};
