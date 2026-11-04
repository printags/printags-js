import { readFile } from "node:fs/promises";
import { Printags, PrintagsError } from "./index.js";

export const HELP = `printags: command line for the Printags API (https://docs.printags.com)

Usage: printags <command> [options]

Commands
  statuses                          every status an order goes through (no key needed)
  carriers --to-country FR          carriers that deliver to a country (no key needed)
  products                          catalogue of products your account can order
  account                           the account the API key acts on
  orders list                       one page of orders, newest first
  orders get <orderId>              one order
  orders create --file order.json   create an order from a JSON file (a draft unless "isDraft" is false in the file)
  orders validate <orderId>         validate a draft: production starts and the balance is charged
  help                              this text

Options
  --api-key <key>        API key (or PRINTAGS_API_KEY). sk_live_... real orders, sk_test_... test orders
  --sandbox              use https://sandbox-api.printags.com, which only accepts sk_test_ keys (or PRINTAGS_SANDBOX=1)
  --base-url <url>       another server (or PRINTAGS_BASE_URL)
  --account <id>         account id, "@me" by default
  --page, --per-page, --status, --search      filters of "orders list"
  --to-country, --to-postal-code, --weight    destination of "carriers"
  --file <path>          JSON file of "orders create"
  --idempotency-key <k>  8 to 100 characters: a retry returns the order already created instead of a second one

Output is JSON on stdout; errors go to stderr with a non-zero exit code.
`;

/** Splits argv into positional words and --options (`--flag` alone is true). */
export function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (!word.startsWith("--")) { positional.push(word); continue; }
    const [name, inline] = word.slice(2).split("=", 2);
    if (inline !== undefined) options[name] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) options[name] = argv[++i];
    else options[name] = true;
  }
  return { positional, options };
}

const asInt = (value) => (value === undefined ? undefined : Number.parseInt(value, 10));

/** Runs a command and returns what to print (an object), or the help text. Throws on misuse and on API errors. */
export async function run(argv, env = process.env, deps = {}) {
  const { positional, options } = parseArgs(argv);
  const [command, sub] = positional;
  if (!command || command === "help" || options.help) return HELP;

  const printags = new Printags({
    apiKey: options["api-key"] || env.PRINTAGS_API_KEY,
    sandbox: options.sandbox === true || options.sandbox === "true" || env.PRINTAGS_SANDBOX === "1",
    baseUrl: options["base-url"] || env.PRINTAGS_BASE_URL,
    fetch: deps.fetch,
    userAgent: "printags-cli"
  });
  const account = options.account || "@me";
  const needKey = () => { if (!printags.apiKey) throw new Error("This command needs an API key: --api-key or PRINTAGS_API_KEY"); };

  switch (command) {
    case "statuses":
      return printags.listOrderStatuses();
    case "carriers":
      if (!options["to-country"]) throw new Error("carriers needs --to-country (ISO 2-letter code, e.g. FR)");
      return printags.listShippingCarriers({
        toCountry: options["to-country"], toPostalCode: options["to-postal-code"], weight: asInt(options.weight)
      });
    case "products":
      needKey();
      return printags.listProducts();
    case "account":
      needKey();
      return account === "@me" ? printags.getCurrentAccount() : printags.getAccount(account);
    case "orders":
      needKey();
      if (sub === "list") {
        return printags.listOrders(account, {
          page: asInt(options.page), perPage: asInt(options["per-page"]), status: options.status, search: options.search
        });
      }
      if (sub === "get") {
        if (!positional[2]) throw new Error("orders get needs an order id");
        return printags.getOrder(account, positional[2]);
      }
      if (sub === "validate") {
        if (!positional[2]) throw new Error("orders validate needs an order id");
        return printags.validateOrder(account, positional[2]);
      }
      if (sub === "create") {
        if (typeof options.file !== "string") throw new Error("orders create needs --file order.json");
        const order = JSON.parse(await (deps.readFile || readFile)(options.file, "utf8"));
        return printags.createOrder(account, order, { idempotencyKey: options["idempotency-key"] });
      }
      throw new Error("orders needs list, get, create or validate");
    default:
      throw new Error(`Unknown command "${ command }". Run "printags help".`);
  }
}

/** Entry point of bin/printags.js: prints the result, or the error and exit code 1. */
export async function main(argv) {
  try {
    const result = await run(argv);
    process.stdout.write(typeof result === "string" ? result : `${ JSON.stringify(result, null, 2) }\n`);
  } catch (error) {
    if (error instanceof PrintagsError) {
      process.stderr.write(`Error ${ error.status }${ error.code ? ` (${ error.code })` : "" }: ${ error.message }\n`);
      if (error.retryAfter) process.stderr.write(`Retry after ${ error.retryAfter } seconds.\n`);
    } else {
      process.stderr.write(`${ error.message }\n`);
    }
    process.exitCode = 1;
  }
}
