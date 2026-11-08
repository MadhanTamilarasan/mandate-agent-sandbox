/**
 * Optional standalone price watcher (e.g. a Render background worker or cron):
 *   APP_BASE_URL=https://your-app.onrender.com npm run worker
 * It just asks the web app to check active limit orders on a timer. The web app
 * also runs the same check in-process (see instrumentation.ts), so this is only
 * needed if you want the watcher to keep running independently of web traffic.
 */
try {
  process.loadEnvFile(".env");
} catch {}

const base = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const everySeconds = Number(process.env.LIMIT_ORDER_POLL_SECONDS || 60);

async function tick() {
  try {
    const res = await fetch(`${base}/api/limit-orders/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = (await res.json()) as { checked?: number; triggered?: number; error?: string };
    console.log(new Date().toISOString(), res.status, j.error ?? `checked ${j.checked}, triggered ${j.triggered}`);
  } catch (e) {
    console.error(new Date().toISOString(), "tick failed:", (e as Error).message);
  }
}

console.log(`Watching limit orders at ${base} every ${everySeconds}s`);
void tick();
setInterval(tick, everySeconds * 1000);
