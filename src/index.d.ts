export interface PrintagsOptions {
  /** `sk_live_...` for real orders, `sk_test_...` for test orders (sandbox). */
  apiKey?: string;
  /** Use https://sandbox-api.printags.com, which only accepts `sk_test_` keys. */
  sandbox?: boolean;
  /** Another server (overrides `sandbox`). */
  baseUrl?: string;
  /** A `fetch` implementation (defaults to the global one). */
  fetch?: typeof fetch;
  userAgent?: string;
}

/** JSON body of the API: the shapes are those of the OpenAPI document https://www.printags.com/openapi.json. */
export type Json = Record<string, unknown>;

export class PrintagsError extends Error {
  constructor(status: number, body: unknown);
  status: number;
  code: string | null;
  body: unknown;
  /** Seconds to wait before retrying, when the API answered 429 with a Retry-After header. */
  retryAfter: number | null;
}

export class Printags {
  constructor(options?: PrintagsOptions);
  apiKey?: string;
  baseUrl: string;

  getCurrentAccount(): Promise<Json>;
  getAccount(accountId: string): Promise<Json>;

  listOrders(accountId: string, filters?: { page?: number; perPage?: number; status?: string; search?: string }): Promise<Json>;
  findOrders(accountId: string, filters?: { metadata?: string; reference?: string; fields?: string }): Promise<Json>;
  getOrder(accountId: string, orderId: string): Promise<Json>;
  createOrder(accountId: string, order: Json, options?: { idempotencyKey?: string }): Promise<{ success: boolean; orderId: string }>;
  validateOrder(accountId: string, orderId: string): Promise<Json>;
  simulateOrderStatus(accountId: string, orderId: string, status: string): Promise<Json>;

  uploadFile(accountId: string, file: Blob | ArrayBuffer | Uint8Array, filename?: string): Promise<Json>;
  getFile(accountId: string, fileId: string): Promise<{ data: Uint8Array; contentType: string | null }>;

  listOrderStatuses(): Promise<Json>;
  listShippingCarriers(destination: { toCountry: string; toPostalCode?: string; weight?: number }): Promise<Json>;
  calculateShippingRates(request: Json): Promise<Json>;
  listProducts(): Promise<Json>;
}

export default Printags;
