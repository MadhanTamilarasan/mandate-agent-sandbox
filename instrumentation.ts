/**
 * In-process price watcher: every LIMIT_ORDER_POLL_SECONDS (default 60) it
 * checks live Channel3 prices for active limit orders. On Render you can also
 * run `npm run worker` as a separate background worker (see render.yaml).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Load the saved state from the database before the server takes requests. If it can't be reached this throws,
  // the deploy fails its start-up, and the previous version keeps serving instead of a broken one going live.
  const { storeReady } = await import("./lib/store");
  await storeReady();

  const g = globalThis as unknown as { __mandateWatcher?: boolean };
  if (g.__mandateWatcher) return;
  g.__mandateWatcher = true;

  const seconds = Number(process.env.LIMIT_ORDER_POLL_SECONDS ?? 60);
  if (!seconds || seconds < 0) return;

  setInterval(async () => {
    try {
      const { readStore } = await import("./lib/store");
      if (!readStore().limitOrders.some((l) => l.status === "watching")) return;
      const { checkLimitOrders } = await import("./lib/service");
      await checkLimitOrders();
    } catch (e) {
      console.error("[watcher]", (e as Error).message);
    }
  }, seconds * 1000).unref?.();
}
