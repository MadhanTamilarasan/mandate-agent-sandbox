import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import type { AuditEvent, Store } from "./types";

/**
 * A tiny JSON-file store. Zero setup so judges can run the project with
 * `npm install && npm run dev`. All writes go through one in-process queue.
 * (On Render's free tier the disk is ephemeral, so state resets on redeploy -
 * fine for a demo; swap this module for Postgres to persist.)
 */

const globalForStore = globalThis as unknown as {
  __mandateStore?: Store;
  __mandateQueue?: Promise<unknown>;
};

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

function load(): Store {
  if (globalForStore.__mandateStore) return globalForStore.__mandateStore;
  let store: Store;
  try {
    store = { ...emptyStore(), ...JSON.parse(fs.readFileSync(file(), "utf8")) };
  } catch {
    store = emptyStore();
  }
  backfillRefunds(store);
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

/** Read-only snapshot (do not mutate the result). */
export function readStore(): Store {
  return load();
}

/** Serialized read-modify-write. */
export function mutate<T>(fn: (s: Store) => T | Promise<T>): Promise<T> {
  const prev = globalForStore.__mandateQueue ?? Promise.resolve();
  const run = prev.then(async () => {
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
