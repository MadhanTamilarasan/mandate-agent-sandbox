import assert from "node:assert/strict";
import { test } from "node:test";
import { storeBackend } from "../lib/store";

const URL = "postgresql://user:pw@host/db";

test("production with a database URL uses Postgres", () => {
  assert.equal(storeBackend({ DATABASE_URL: URL, NODE_ENV: "production" }), "postgres");
});

test("local development keeps using the JSON file even if a database URL is in .env", () => {
  assert.equal(storeBackend({ DATABASE_URL: URL, NODE_ENV: "development" }), "file", "so running locally never touches the hosted data");
  assert.equal(storeBackend({ DATABASE_URL: URL }), "file");
});

test("no database URL means the JSON file, even in production", () => {
  assert.equal(storeBackend({ NODE_ENV: "production" }), "file");
  assert.equal(storeBackend({}), "file");
});

test("STORE overrides the default both ways", () => {
  assert.equal(storeBackend({ STORE: "postgres", DATABASE_URL: URL, NODE_ENV: "development" }), "postgres");
  assert.equal(storeBackend({ STORE: "file", DATABASE_URL: URL, NODE_ENV: "production" }), "file");
  assert.equal(storeBackend({ STORE: " Postgres ", DATABASE_URL: URL }), "postgres");
});

test("STORE=postgres without a database URL is an error, not a silent fallback", () => {
  assert.throws(() => storeBackend({ STORE: "postgres" }), /needs DATABASE_URL/);
});
