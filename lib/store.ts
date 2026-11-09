import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import type { AuditEvent, Store } from "./types";

/**
 * The app's state (mandates, purchases, approvals, limit orders, audit log and the signing secret) lives in one
 * `Store` object, kept in memory for reads and saved on every write. Two places to save it:
 *
 *  - **Postgres** (when `DATABASE_URL` is set and the app runs in production, or `STORE=postgres`): one jsonb row in
 *    `mandate_state`. This is what survives Render's restarts and redeploys. Each write runs in a transaction that
 *    locks the row, re-reads it, applies the change and saves it, so two server instances can't overwrite each other.
 *  - **A JSON file** (`DATA_DIR/store.json`): zero setup for `npm install && npm run dev`. Also the fallback for
 *    local development even when a database URL is in `.env`, so running locally never touches the hosted data
 *    unless you ask with `STORE=postgres`.
 *
 * `STORE_KEY` (default "main") names the row, so one database can hold several separate environments.
 */

type PgPool = import("pg").Pool;

const globalForStore = globalThis as unknown as {
  __mandateStore?: Store;
  __mandateQueue?: Promise<unknown>;
  __mandatePool?: PgPool;
  __mandateReady?: Promise<void>;
};

/** Which backend this process uses. Pure, so it can be tested. */
export function storeBackend(vars: { STORE?: string; DATABASE_URL?: string; NODE_ENV?: string } = {
  STORE: process.env.STORE,
  DATABASE_URL: env.databaseUrl,
  NODE_ENV: process.env.NODE_ENV,
}): "postgres" | "file" {
  const mode = vars.STORE?.trim().toLowerCase();
  if (mode === "file") return "file";
  if (mode === "postgres") {
    if (!vars.DATABASE_URL) throw new Error("STORE=postgres needs DATABASE_URL (see .env.example).");
    return "postgres";
  }
  return vars.DATABASE_URL && vars.NODE_ENV === "production" ? "postgres" : "file";
}

const rowKey = () => process.env.STORE_KEY?.trim() || "main";

function file() {
  return path.resolve(env.dataDir, "store.json");
}

function emptyStore(): Store {
  return {
    signingSecret: randomBytes(32).toString("hex"),
    mandates: [],
    purchases: [],
    approvals: [],
    limitOrders: [],
    events: [],
  };
}

/** Refunds recorded before mandates tracked `refunded`: add them up so older data frees its budget too. */
export function backfillRefunds(store: Store) {
  for (const m of store.mandates) {
    if (m.refunded !== undefined) continue;
    const total = store.purchases
      .filter((p) => p.mandateId === m.id)
      .reduce((sum, p) => sum + (p.refunds ?? []).reduce((a, r) => a + r.amount, 0), 0);
    if (total > 0) m.refunded = Math.round(total * 100) / 100;
  }
}

/** Fill in anything a stored copy lacks (older data) and apply one-time fixes. */
function normalize(raw: Partial<Store> | undefined): Store {
  const store: Store = { ...emptyStore(), ...(raw ?? {}) };
  backfillRefunds(store);
  return store;
}

/* ------------------------------------------------------------------ */
/* Postgres                                                            */
/* ------------------------------------------------------------------ */

async function pool(): Promise<PgPool> {
  if (globalForStore.__mandatePool) return globalForStore.__mandatePool;
  const { Pool } = await import("pg"); // loaded only when used, so file-mode runs and tests don't need it
  const p = new Pool({ connectionString: env.databaseUrl, max: 3, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
  p.on("error", (e) => console.error("[store] idle database connection error:", e.message)); // never crash on a dropped idle client
  globalForStore.__mandatePool = p;
  return p;
}

async function hydrate() {
  const db = await pool();
  await db.query(
    `CREATE TABLE IF NOT EXISTS mandate_state (key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
  );
  // First run creates the row (with a fresh signing secret that is then kept for good); later runs leave it alone.
  await db.query(`INSERT INTO mandate_state (key, data) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [rowKey(), JSON.stringify(emptyStore())]);
  const res = await db.query(`SELECT data FROM mandate_state WHERE key = $1`, [rowKey()]);
  globalForStore.__mandateStore = normalize(res.rows[0]?.data);
}

/**
 * Loads the saved state. Call it (and await it) once at server start: `instrumentation.ts` does, and the server
 * isn't ready for requests until it finishes. A no-op for the file backend.
 */
export function storeReady(): Promise<void> {
  if (storeBackend() !== "postgres") return Promise.resolve();
  globalForStore.__mandateReady ??= hydrate().catch((e) => {
    globalForStore.__mandateReady = undefined; // let the next call try again
    throw e;
  });
  return globalForStore.__mandateReady;
}

/** Closes the database connection pool (scripts and tests; the server never needs this). */
export async function closeStore() {
  await globalForStore.__mandatePool?.end();
  globalForStore.__mandatePool = undefined;
  globalForStore.__mandateReady = undefined;
  globalForStore.__mandateStore = undefined;
}

/* ------------------------------------------------------------------ */
/* File                                                                */
/* ------------------------------------------------------------------ */

function load(): Store {
  if (globalForStore.__mandateStore) return globalForStore.__mandateStore;
  if (storeBackend() === "postgres") {
    throw new Error("The database store is not loaded yet (storeReady() has not finished).");
  }
  let store: Store;
  try {
    store = normalize(JSON.parse(fs.readFileSync(file(), "utf8")));
  } catch {
    store = emptyStore();
  }
  globalForStore.__mandateStore = store;
  return store;
}

function persist(store: Store) {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, f);
}

/* ------------------------------------------------------------------ */
/* Reads and writes                                                    */
/* ------------------------------------------------------------------ */

/** Read-only snapshot (do not mutate the result). */
export function readStore(): Store {
  return load();
}

async function runInDatabase<T>(fn: (s: Store) => T | Promise<T>): Promise<T> {
  await storeReady();
  const client = await (await pool()).connect();
  try {
    await client.query("BEGIN");
    // Lock the row, then work on what is in the database right now (not on this process's possibly stale copy).
    const res = await client.query(`SELECT data FROM mandate_state WHERE key = $1 FOR UPDATE`, [rowKey()]);
    const store = normalize(res.rows[0]?.data);
    const result = await fn(store);
    await client.query(`UPDATE mandate_state SET data = $2, updated_at = now() WHERE key = $1`, [rowKey(), JSON.stringify(store)]);
    await client.query("COMMIT");
    globalForStore.__mandateStore = store;
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined); // the database keeps its last good state
    throw e;
  } finally {
    client.release();
  }
}

/** Serialized read-modify-write. */
export function mutate<T>(fn: (s: Store) => T | Promise<T>): Promise<T> {
  const prev = globalForStore.__mandateQueue ?? Promise.resolve();
  const run = prev.then(async () => {
    if (storeBackend() === "postgres") return runInDatabase(fn);
    const store = load();
    const result = await fn(store);
    persist(store);
    return result;
  });
  globalForStore.__mandateQueue = run.catch(() => undefined);
  return run;
}

export function newId(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function logEvent(
  store: Store,
  e: Omit<AuditEvent, "id" | "at"> & { at?: string },
): AuditEvent {
  const event: AuditEvent = { id: newId("evt"), at: e.at ?? new Date().toISOString(), ...e };
  store.events.push(event);
  return event;
}
