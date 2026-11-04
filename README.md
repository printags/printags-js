# printags

SDK and command line for the [Printags API](https://docs.printags.com): price, order and track printed PVC, NFC and wooden cards, shipped white-label.

Zero dependencies, Node 18 or later.

```sh
npm install printags
```

## SDK

```js
import { Printags } from "printags";

const printags = new Printags({ apiKey: process.env.PRINTAGS_API_KEY });

const { orders, pagination } = await printags.listOrders("@me", { perPage: 10 });

// A draft prints and charges nothing until it is validated. The idempotency key makes a retry safe:
// the same key returns the order already created instead of creating (and charging) a second one.
const { orderId } = await printags.createOrder("@me", { isDraft: true, reference: "Order-2026-001" /* ... */ }, {
  idempotencyKey: "order-2026-001-attempt"
});
```

Each method is one operation of the [OpenAPI document](https://www.printags.com/openapi.json), under the operation's name: `getCurrentAccount`, `getAccount`, `listOrders`, `findOrders`, `getOrder`, `createOrder`, `validateOrder`, `simulateOrderStatus`, `uploadFile`, `getFile`, `listOrderStatuses`, `listShippingCarriers`, `calculateShippingRates`, `listProducts`. Errors are `PrintagsError` with `status`, `code` and, on a 429, `retryAfter`.

## Sandbox

A test key (`sk_test_...`) creates test orders that are neither charged nor manufactured. `sandbox: true` targets `https://sandbox-api.printags.com`, which only accepts test keys: a real key is refused before any request leaves your machine.

```js
const printags = new Printags({ apiKey: process.env.PRINTAGS_TEST_KEY, sandbox: true });
await printags.simulateOrderStatus("@me", orderId, "shipped");
```

## Command line

```sh
export PRINTAGS_API_KEY=sk_test_...
export PRINTAGS_SANDBOX=1

npx printags statuses
npx printags carriers --to-country FR
npx printags orders list --per-page 5
npx printags orders create --file order.json --idempotency-key order-2026-001
```

`printags help` lists every command and option. Output is JSON on stdout.

## License

[MIT](LICENSE), © Printags SAS.

## Links

- Documentation: https://docs.printags.com
- OpenAPI document: https://www.printags.com/openapi.json
- MCP server and agent skills: https://github.com/printags/agent-skills
- Website: https://www.printags.com
