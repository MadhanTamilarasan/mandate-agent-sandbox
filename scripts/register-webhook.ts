/**
 * Register this app's webhook with PayPal (sandbox by default) and print the id to put in PAYPAL_WEBHOOK_ID:
 *   APP_BASE_URL=https://your-app.onrender.com npm run webhook:register
 * PayPal must be able to reach the URL, so run it against the deployed app (not localhost).
 */
try {
  process.loadEnvFile(".env");
} catch {}

async function main() {
  const { env } = await import("../lib/env");
  const { createWebhook, listWebhooks, PayPalError } = await import("../lib/paypal");
  const { WEBHOOK_EVENTS } = await import("../lib/webhook");

  const url = `${env.appUrl}/api/paypal/webhook`;
  if (!url.startsWith("https://")) {
    throw new Error(`PayPal only accepts https webhook URLs, got ${url}. Set APP_BASE_URL to your deployed app.`);
  }
  try {
    const created = await createWebhook(url, WEBHOOK_EVENTS);
    console.log(`Registered ${created.url}\nPAYPAL_WEBHOOK_ID=${created.id}`);
  } catch (e) {
    if (!(e instanceof PayPalError) || !/WEBHOOK_URL_ALREADY_EXISTS/.test(e.message)) throw e;
    const existing = (await listWebhooks()).webhooks?.find((w) => w.url === url);
    console.log(`Already registered: ${url}\nPAYPAL_WEBHOOK_ID=${existing?.id ?? "(not found: check the PayPal dashboard)"}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
