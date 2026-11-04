import { test } from "node:test";
import assert from "node:assert/strict";
import { Printags, PrintagsError } from "../src/index.js";

/** A fetch that records the calls and answers with the queued responses. */
function fakeFetch(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift() || { status: 200, body: {} };
    return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
      status: next.status, headers: { "content-type": "application/json", ...(next.headers || {}) }
    });
  };
  return { fetch, calls };
}

test("sends the key as a Bearer token to the production server by default", async () => {
  const { fetch, calls } = fakeFetch({ status: 200, body: { id: "acc_1" } });
  const printags = new Printags({ apiKey: "sk_live_x", fetch });
  assert.deepEqual(await printags.getCurrentAccount(), { id: "acc_1" });
  assert.equal(calls[0].url, "https://api.printags.com/v2/accounts/@me");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk_live_x");
});

test("sandbox mode targets the sandbox host and refuses a live key before any request", () => {
  const { fetch, calls } = fakeFetch();
  assert.equal(new Printags({ apiKey: "sk_test_x", sandbox: true, fetch }).baseUrl, "https://sandbox-api.printags.com");
  assert.throws(() => new Printags({ apiKey: "sk_live_x", sandbox: true, fetch }), /test API keys/);
  assert.equal(calls.length, 0);
});

test("listOrders maps perPage to per_page and drops empty filters", async () => {
  const { fetch, calls } = fakeFetch({ status: 200, body: { orders: [] } });
  await new Printags({ apiKey: "k", fetch }).listOrders("@me", { page: 2, perPage: 5, status: "validated,shipped", search: "" });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v2/accounts/@me/orders");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "5");
  assert.equal(url.searchParams.get("status"), "validated,shipped");
  assert.equal(url.searchParams.has("search"), false);
});

test("createOrder posts JSON and sends the Idempotency-Key header only when given", async () => {
  const { fetch, calls } = fakeFetch({ status: 200, body: { success: true, orderId: "o1" } }, { status: 200, body: { success: true, orderId: "o2" } });
  const printags = new Printags({ apiKey: "k", fetch });
  await printags.createOrder("acc 1", { isDraft: true }, { idempotencyKey: "retry-key-0001" });
  await printags.createOrder("acc 1", { isDraft: true });
  assert.equal(calls[0].url, "https://api.printags.com/v2/accounts/acc%201/orders");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Idempotency-Key"], "retry-key-0001");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ isDraft: true }));
  assert.equal(calls[1].init.headers["Idempotency-Key"], undefined);
});

test("reads both error shapes of the API and the Retry-After header", async () => {
  const flat = fakeFetch({ status: 403, body: { success: false, status: 403, code: "INACTIVE_API_KEY", message: "The key is inactive" } });
  await assert.rejects(new Printags({ apiKey: "k", fetch: flat.fetch }).getCurrentAccount(), (error) => {
    assert.ok(error instanceof PrintagsError);
    assert.equal(error.status, 403);
    assert.equal(error.code, "INACTIVE_API_KEY");
    assert.equal(error.message, "The key is inactive");
    return true;
  });

  const nested = fakeFetch({ status: 429, body: { success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } }, headers: { "retry-after": "12" } });
  await assert.rejects(new Printags({ apiKey: "k", fetch: nested.fetch }).listProducts(), (error) => {
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.retryAfter, 12);
    return true;
  });
});

test("a non-JSON error body still becomes a PrintagsError", async () => {
  const { fetch } = fakeFetch({ status: 502, body: "Bad gateway" });
  await assert.rejects(new Printags({ fetch }).listOrderStatuses(), (error) => error.status === 502 && error.message === "Bad gateway");
});

test("public operations work without a key and carriers take an ISO country", async () => {
  const { fetch, calls } = fakeFetch({ status: 200, body: { carriers: [] } });
  await new Printags({ fetch }).listShippingCarriers({ toCountry: "FR", weight: 200 });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v2/shipping/carriers");
  assert.equal(url.searchParams.get("to_country"), "FR");
  assert.equal(url.searchParams.get("weight"), "200");
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("uploadFile sends a multipart body with the file field", async () => {
  const { fetch, calls } = fakeFetch({ status: 200, body: { id: "f1" } });
  await new Printags({ apiKey: "k", fetch }).uploadFile("@me", new Uint8Array([1, 2, 3]), "visual.png");
  const form = calls[0].init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("file").name, "visual.png");
  assert.equal(calls[0].init.headers["Content-Type"], undefined);
});
