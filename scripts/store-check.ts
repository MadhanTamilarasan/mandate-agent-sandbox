/**
 * Live check of the Postgres store against the database in `.env`:
 *   npm run store:check
 * Uses a throwaway row (STORE_KEY=check-...) that is deleted at the end, so it never touches real data.
 */
import assert from "node:assert/strict";

try {
  process.loadEnvFile(".env");
} catch {}
process.env.STORE = "postgres";
process.env.STORE_KEY = `check-${Date.now()}`;

async function main() {
  const { env } = await import("../lib/env");
  const store = await import("../lib/store");
  const { default: pg } = await import("pg");
  const key = process.env.STORE_KEY!;
  const ok = (msg: string) => console.log(`ok  ${msg}`);

  await store.storeReady();
  const secret = store.readStore().signingSecret;
  assert.equal(secret.length, 64);
  assert.equal(store.readStore().events.length, 0);
  ok("a new row is created with a signing secret");

  await store.mutate((s) => void store.logEvent(s, { mandateId: "m", actor: "system", kind: "check", summary: "first" }));
  await store.closeStore(); // what a restart does: everything in memory is gone
  await store.storeReady();
  assert.equal(store.readStore().signingSecret, secret, "the signing secret survives a restart");
  assert.equal(store.readStore().events.length, 1);
  ok("data and the signing secret survive a restart");

  await Promise.all(
    Array.from({ length: 10 }, (_, i) => store.mutate((s) => void store.logEvent(s, { mandateId: "m", actor: "system", kind: "check", summary: `n${i}` }))),
  );
  assert.equal(store.readStore().events.length, 11);
  ok("10 simultaneous writes are all kept");

  await assert.rejects(
    store.mutate((s) => {
      store.logEvent(s, { mandateId: "m", actor: "system", kind: "check", summary: "should vanish" });
      throw new Error("boom");
    }),
    /boom/,
  );
  await store.closeStore();
  await store.storeReady();
  assert.equal(store.readStore().events.length, 11);
  ok("a write that throws changes nothing");

  // Another server instance writing to the same row: this one must see it, not overwrite it.
  const other = new pg.Client({ connectionString: env.databaseUrl });
  await other.connect();
  const row = await other.query(`SELECT data FROM mandate_state WHERE key = $1`, [key]);
  const data = row.rows[0].data;
  data.events.push({ id: "evt_other", at: new Date().toISOString(), mandateId: "m", actor: "system", kind: "check", summary: "from another instance" });
  await other.query(`UPDATE mandate_state SET data = $2 WHERE key = $1`, [key, JSON.stringify(data)]);
  await store.mutate((s) => void store.logEvent(s, { mandateId: "m", actor: "system", kind: "check", summary: "mine" }));
  const after = await other.query(`SELECT data FROM mandate_state WHERE key = $1`, [key]);
  const summaries = (after.rows[0].data.events as { summary: string }[]).map((e) => e.summary);
  assert.ok(summaries.includes("from another instance") && summaries.includes("mine"), "both writes are kept");
  ok("a write made by another instance is not overwritten");

  await other.query(`DELETE FROM mandate_state WHERE key = $1`, [key]);
  await other.end();
  await store.closeStore();
  ok(`cleaned up (${key})`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
