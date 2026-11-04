/**
 * Client for the Printags REST API (https://docs.printags.com), version 2.
 *
 * Zero dependencies: it uses the `fetch` of Node 18+ (or any `fetch` you pass). Every method maps to one operation of the
 * OpenAPI document https://www.printags.com/openapi.json, under the operation's own name.
 *
 * @example
 *   import { Printags } from "printags";
 *   const printags = new Printags({ apiKey: process.env.PRINTAGS_API_KEY });
 *   const { orders } = await printags.listOrders("@me", { perPage: 10 });
 */

const PRODUCTION_URL = "https://api.printags.com";
const SANDBOX_URL = "https://sandbox-api.printags.com";

/** An error answer of the API: `status` is the HTTP status, `code` the machine-readable code when the API gave one. */
export class PrintagsError extends Error {
  constructor(status, body) {
    // The API answers errors in two shapes: {code, message} and {error: {code, message}}.
    const detail = body && typeof body === "object" && body.error && typeof body.error === "object" ? body.error : body;
    super(detail?.message || `Printags API error ${ status }`);
    this.name = "PrintagsError";
    this.status = status;
    this.code = detail?.code ?? null;
    this.body = body;
    /** Seconds to wait before retrying, when the API answered 429 with a Retry-After header. */
    this.retryAfter = null;
  }
}

// "@" is valid in a path segment and is how the API writes the current account ("@me"): keep it as is.
const enc = (segment) => encodeURIComponent(segment).replace(/%40/g, "@");

export class Printags {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] `sk_live_...` for real orders, `sk_test_...` for test orders (sandbox).
   * @param {boolean} [options.sandbox] use https://sandbox-api.printags.com, which only accepts `sk_test_` keys.
   * @param {string} [options.baseUrl] another server (overrides `sandbox`).
   * @param {typeof fetch} [options.fetch] a `fetch` implementation (defaults to the global one).
   * @param {string} [options.userAgent] sent as `User-Agent`.
   */
  constructor({ apiKey, sandbox = false, baseUrl, fetch: fetchImpl, userAgent } = {}) {
    if (sandbox && apiKey && !String(apiKey).startsWith("sk_test_")) {
      // The sandbox host would refuse it with a 403: refusing here keeps a real key from leaving the machine.
      throw new TypeError("The sandbox only accepts test API keys (sk_test_...)");
    }
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || (sandbox ? SANDBOX_URL : PRODUCTION_URL)).replace(/\/+$/, "");
    this.fetch = fetchImpl || globalThis.fetch;
    this.userAgent = userAgent;
    if (typeof this.fetch !== "function") throw new TypeError("No fetch available: use Node 18+ or pass options.fetch");
  }

  async #request(method, path, { query, body, headers, form, raw = false } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const init = { method, headers: { Accept: "application/json", ...(headers || {}) } };
    if (this.apiKey) init.headers.Authorization = `Bearer ${ this.apiKey }`;
    if (this.userAgent) init.headers["User-Agent"] = this.userAgent;
    if (form) {
      init.body = form;
    } else if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await this.fetch(url, init);
    if (!response.ok) {
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = { message: text || undefined }; }
      const error = new PrintagsError(response.status, parsed);
      const retryAfter = Number.parseInt(response.headers?.get?.("retry-after"), 10);
      if (Number.isFinite(retryAfter)) error.retryAfter = retryAfter;
      throw error;
    }
    if (raw) return response;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  // --- Accounts

  /** The account the API key acts on. */
  getCurrentAccount() { return this.#request("GET", "/v2/accounts/@me"); }

  /** @param {string} accountId an account id, or `@me`. */
  getAccount(accountId) { return this.#request("GET", `/v2/accounts/${ enc(accountId) }`); }

  // --- Orders

  /**
   * One page of the account's orders, newest first.
   * @param {string} accountId
   * @param {{page?: number, perPage?: number, status?: string, search?: string}} [filters] `status` is a comma-separated list.
   */
  listOrders(accountId, { page, perPage, status, search } = {}) {
    return this.#request("GET", `/v2/accounts/${ enc(accountId) }/orders`, { query: { page, per_page: perPage, status, search } });
  }

  /** @param {{metadata?: string, reference?: string, fields?: string}} [filters] */
  findOrders(accountId, { metadata, reference, fields } = {}) {
    return this.#request("GET", `/v2/accounts/${ enc(accountId) }/orders/find`, { query: { metadata, reference, fields } });
  }

  getOrder(accountId, orderId) { return this.#request("GET", `/v2/accounts/${ enc(accountId) }/orders/${ enc(orderId) }`); }

  /**
   * Creates an order. `order.isDraft` defaults to what the API decides: set it to `true` to create a draft that prints and
   * charges nothing until it is validated.
   * @param {string} accountId
   * @param {object} order see the `createOrder` operation of the OpenAPI document.
   * @param {{idempotencyKey?: string}} [options] 8 to 100 characters. A retry with the same key returns the order already
   *   created instead of creating (and charging) a second one.
   */
  createOrder(accountId, order, { idempotencyKey } = {}) {
    const headers = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined;
    return this.#request("POST", `/v2/accounts/${ enc(accountId) }/orders`, { body: order, headers });
  }

  /** Validates a draft order: production starts and the balance is charged. */
  validateOrder(accountId, orderId) {
    return this.#request("POST", `/v2/accounts/${ enc(accountId) }/orders/${ enc(orderId) }/validate`);
  }

  /** Test keys only: moves a test order to any status of the life cycle (see `listOrderStatuses`). */
  simulateOrderStatus(accountId, orderId, status) {
    return this.#request("POST", `/v2/accounts/${ enc(accountId) }/orders/${ enc(orderId) }/simulate`, { body: { status } });
  }

  // --- Files

  /**
   * Uploads an artwork file. Returns the file's id, to cite in an order's visuals.
   * @param {string} accountId
   * @param {Blob | ArrayBuffer | Uint8Array} file
   * @param {string} [filename]
   */
  uploadFile(accountId, file, filename = "file") {
    const form = new FormData();
    form.append("file", file instanceof Blob ? file : new Blob([file]), filename);
    return this.#request("POST", `/v2/accounts/${ enc(accountId) }/files`, { form });
  }

  /** Downloads a file: `{ data, contentType }`. */
  async getFile(accountId, fileId) {
    const response = await this.#request("GET", `/v2/accounts/${ enc(accountId) }/files/${ enc(fileId) }`, { raw: true });
    return { data: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") };
  }

  // --- Reference data

  /** Every status an order goes through. No API key needed. */
  listOrderStatuses() { return this.#request("GET", "/v2/statuses"); }

  /**
   * The carriers that deliver to a country. No API key needed.
   * @param {{toCountry: string, toPostalCode?: string, weight?: number}} destination `toCountry`: ISO 2-letter code.
   */
  listShippingCarriers({ toCountry, toPostalCode, weight }) {
    return this.#request("GET", "/v2/shipping/carriers", { query: { to_country: toCountry, to_postal_code: toPostalCode, weight } });
  }

  /** Shipping prices for a destination and a list of items. No API key needed. @param {object} request see `calculateShippingRates`. */
  calculateShippingRates(request) { return this.#request("POST", "/v2/shipping/rates", { body: request }); }

  /** The catalogue of products (card models) your account can order. */
  listProducts() { return this.#request("GET", "/v2/products"); }
}

export default Printags;
