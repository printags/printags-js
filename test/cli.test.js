import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, run, HELP } from "../src/cli.js";

const okFetch = (log) => async (url, init) => {
  log.push({ url: String(url), init });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

test("parseArgs splits words and options, with --flag alone as true and --name=value", () => {
  const { positional, options } = parseArgs(["orders", "list", "--per-page", "5", "--sandbox", "--status=shipped"]);
  assert.deepEqual(positional, ["orders", "list"]);
  assert.deepEqual(options, { "per-page": "5", sandbox: true, status: "shipped" });
});

test("no command or help prints the usage", async () => {
  assert.equal(await run([], {}), HELP);
  assert.equal(await run(["help"], {}), HELP);
});

test("statuses needs no key", async () => {
  const log = [];
  assert.deepEqual(await run(["statuses"], {}, { fetch: okFetch(log) }), { ok: true });
  assert.equal(log[0].url, "https://api.printags.com/v2/statuses");
});

test("orders list needs a key, takes it from the environment and passes the filters", async () => {
  await assert.rejects(run(["orders", "list"], {}), /needs an API key/);
  const log = [];
  await run(["orders", "list", "--per-page", "3", "--status", "shipped"], { PRINTAGS_API_KEY: "sk_live_k" }, { fetch: okFetch(log) });
  const url = new URL(log[0].url);
  assert.equal(url.searchParams.get("per_page"), "3");
  assert.equal(url.searchParams.get("status"), "shipped");
  assert.equal(log[0].init.headers.Authorization, "Bearer sk_live_k");
});

test("--sandbox points to the sandbox host and refuses a live key", async () => {
  const log = [];
  await run(["account", "--sandbox"], { PRINTAGS_API_KEY: "sk_test_k" }, { fetch: okFetch(log) });
  assert.equal(log[0].url, "https://sandbox-api.printags.com/v2/accounts/@me");
  await assert.rejects(run(["account", "--sandbox"], { PRINTAGS_API_KEY: "sk_live_k" }, { fetch: okFetch([]) }), /test API keys/);
});

test("orders create reads the file and passes the idempotency key", async () => {
  const log = [];
  const readFile = async () => JSON.stringify({ isDraft: true, reference: "R1" });
  await run(["orders", "create", "--file", "order.json", "--idempotency-key", "retry-key-0001"], { PRINTAGS_API_KEY: "k" }, { fetch: okFetch(log), readFile });
  assert.equal(log[0].init.method, "POST");
  assert.equal(log[0].init.headers["Idempotency-Key"], "retry-key-0001");
  assert.equal(log[0].init.body, JSON.stringify({ isDraft: true, reference: "R1" }));
});

test("misuse is reported, not guessed", async () => {
  await assert.rejects(run(["carriers"], {}), /--to-country/);
  await assert.rejects(run(["orders", "get"], { PRINTAGS_API_KEY: "k" }), /order id/);
  await assert.rejects(run(["nope"], {}), /Unknown command/);
});
