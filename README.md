# @reflector/reflector-exchanges-connector

Spot candles from Binance, Bitstamp, Bybit, Coinbase, Crypto.com, Gate, Kraken and OKX for the Reflector oracle, aggregated per asset and minute.

## Sources

`options.sources` names the exchanges to read. Without it the connector reads `binance`, `bybit`, `coinbase`, `kraken`, `okx`, `bitstamp` and `cryptocom`; `gate` is implemented but read only when named. Every node must read the same sources, since each one adds its own candles to the matrix.

Bitstamp, Coinbase and Crypto.com report base volume only, so their quote volume is the base volume times the average of the candle's open, high, low and close. Neither Bitstamp nor Crypto.com flags an unconfirmed candle, and both return the minute that is still open when the window covers it, so callers ask for closed minutes only; `reflector-node` asks at T+15 s for the minute that closed at T.

## Requests

Every exchange call goes through `PriceProviderBase.__makeRequest`: 10 s total deadline (a provider's own timeout is capped), 5 MiB body cap, no redirects, 2xx only. Failures throw `RequestError` (`host`, `status`, `code`, `retryable`); logs carry the host and status, never URLs or headers. The `x-gateway-validation` header is sent to gateways only.

`setGateway(urls, validationKey, useCurrentProvider)` puts the connector into one of three states, and only the first of them issues a direct request:

- **No gateways configured** (`null`, `undefined` or an empty list): direct is the only route. An explicitly empty list counts as unconfigured rather than failed, because `reflector-node` writes `{urls: []}` the first time a node boots without a `gateways.json`.
- **At least one usable gateway**: the rotated gateway is tried first, then the remaining configured gateways in order. The walk never ends in a direct request — when every gateway fails, the request fails and the provider contributes zero-volume candles for that tick. `useCurrentProvider` puts the local host in the list as one more route of its own, walked last; that is a choice by the operator, not a fall-back, and it is the only thing that can put a direct route in the list — an `undefined` arriving in the configured list is rejected like any other non-string.
- **Gateways configured and none of them usable**: no route at all. An entry is usable only when it is a string that parses to a URL with a host, so `null`, `undefined`, an array hole, a number, an object, an array, a boolean, an empty or whitespace-only string and a url with no host (`mailto:`, `data:`, `foo:bar`) are all rejected; the log reason distinguishes them (`not-a-string (undefined)`, `not-a-string (object)`, `unparseable`, `no-host`). `setGateway` logs an error naming how many were configured and why each was dropped — never the entries themselves — and every request then fails with `RequestError` code `ERR_NO_GATEWAY` before any transport call.

A provider cannot loosen these limits: per-request `maxRedirects`, `maxContentLength`, `maxBodyLength` and `validateStatus` are overridden. A failure after a 2xx status (a connection dropped mid-body) is retryable; TLS certificate failures are not. Binance's market list is requested as `exchangeInfo?showPermissionSets=false&symbolStatus=TRADING` (about 2.4 MiB; the unfiltered list exceeds the body cap).

## Data shape

`getPriceData({assets, baseAsset, from, period, count, options})` returns `count` slots of `assets.length` arrays of `TradeData`. The matrix is dense: a pair or provider that produced nothing contributes zero-volume candles, which the node treats as no data. Candles are placed by their own timestamp, so a minute an exchange omitted is zero and later minutes stay aligned. Unconfirmed candles (OKX, Gate) are attempted up to three times (two retries) with a back-off and then blanked; confirmed candles are kept. Exchange error envelopes returned with HTTP 200 are rejected and every numeric field is validated before it is parsed.

Market lists refresh in 6-hour wall-clock windows so all nodes reload after the same boundary and select the same markets for a pair.

## Market selection

Each provider tries its quote currencies in its own order (`quoteOrder`), most liquid first:

| Providers | Order |
| --- | --- |
| Binance, Bybit, OKX, Gate | USDT, USDC, USD |
| Bitstamp, Coinbase, Crypto.com, Kraken | USD, USDT, USDC |

The order applies to the aliases of the base asset. Aliases it does not list follow in glossary order, so a base asset other than USD keeps its glossary order. `getMarkets(pair)` returns at most one market per quote currency, in that order. For each quote currency a direct market is preferred over an inverted one, and the asset's aliases are tried in glossary order. A quote currency the asset itself trades as is skipped, so an asset is never priced against itself. `getSymbolInfo(pair)` is the first of them.

`options.marketMode` decides how many of those markets a provider reads:

- `first` (default): only the first market, one request per pair.
- `combine`: every market, one request each. For each minute the volumes and quote volumes of the markets that returned data are summed exactly (BigInt) into one candle labelled with the provider's name. A market that fails after its retries, or a candle still unconfirmed after them, is left out of the sum; a minute with nothing left is zero. A node that missed a market reports a smaller sum, which the other nodes do not confirm, just as they would not confirm zeros. When every node misses the same market, for example one delisted between market reloads, their smaller sums agree and the provider still counts.

Any other value throws. Every node must use the same mode, since it changes the volumes the node reports. A failed market is logged with its symbol.

## Batches

`batchSize` counts requests, not pairs, and a pair without a market (or an identity pair) is answered without a request, so it takes no slot. Each batch's requests are sent at once. A provider's batches start at least `batchDelay` apart, also across calls, so a call that follows another one right away, or runs next to it, waits its turn; nothing waits after a call's last batch. `reflector-node` passes its number of gateways as `batchSize` and 1.5 s as `batchDelay`, and gateways rotate per exchange host, so each gateway sends each exchange about one request per 1.5 s.

`combine` mode, with up to three markets per pair, takes up to three times as many batches as `first` mode. `reflector-node` estimates its fetch timeout from the number of pairs, so turning `combine` on there also needs that estimate to count markets.

## Asset aliases

`src/assets-glossary.json` maps `USD` to `USD`, `USDT` and `USDC` and `EURC` to `EUR`, `EURC` and `EURT`.

## Tests

- `npm test`: offline (local HTTP server and stubbed requests).
- `npm run test:integration`: live exchanges.

