# @reflector/reflector-exchanges-connector

Spot candles from Binance, Bybit, Coinbase, Gate, Kraken and OKX for the Reflector oracle, aggregated per asset and minute.

## Requests

Every exchange call goes through `PriceProviderBase.__makeRequest`: 10 s total deadline (a provider's own timeout is capped), 5 MiB body cap, no redirects, 2xx only. Failures throw `RequestError` (`host`, `status`, `code`, `retryable`); logs carry the host and status, never URLs or headers. The `x-gateway-validation` header is sent to gateways only.

`setGateway(urls, validationKey, useCurrentProvider)` puts the connector into one of three states, and only the first of them issues a direct request:

- **No gateways configured** (`null`, `undefined` or an empty list): direct is the only route. An explicitly empty list counts as unconfigured rather than failed, because `reflector-node` writes `{urls: []}` the first time a node boots without a `gateways.json`.
- **At least one usable gateway**: the rotated gateway is tried first, then the remaining configured gateways in order. The walk never ends in a direct request — when every gateway fails, the request fails and the provider contributes zero-volume candles for that tick. `useCurrentProvider` puts the local host in the list as one more route of its own, walked last; that is a choice by the operator, not a fall-back, and it is the only thing that can put a direct route in the list — an `undefined` arriving in the configured list is rejected like any other non-string.
- **Gateways configured and none of them usable**: no route at all. An entry is usable only when it is a string that parses to a URL with a host, so `null`, `undefined`, an array hole, a number, an object, an array, a boolean, an empty or whitespace-only string and a url with no host (`mailto:`, `data:`, `foo:bar`) are all rejected; the log reason distinguishes them (`not-a-string (undefined)`, `not-a-string (object)`, `unparseable`, `no-host`). `setGateway` logs an error naming how many were configured and why each was dropped — never the entries themselves — and every request then fails with `RequestError` code `ERR_NO_GATEWAY` before any transport call.

A provider cannot loosen these limits: per-request `maxRedirects`, `maxContentLength`, `maxBodyLength` and `validateStatus` are overridden. A failure after a 2xx status (a connection dropped mid-body) is retryable; TLS certificate failures are not. Binance's market list is requested as `exchangeInfo?showPermissionSets=false&symbolStatus=TRADING` (about 2.4 MiB; the unfiltered list exceeds the body cap).

## Data shape

`getPriceData({assets, baseAsset, from, period, count, options})` returns `count` slots of `assets.length` arrays of `TradeData`. The matrix is dense: a pair or provider that produced nothing contributes zero-volume candles, which the node treats as no data. Candles are placed by their own timestamp, so a minute an exchange omitted is zero and later minutes stay aligned. Unconfirmed candles (OKX, Gate) are attempted up to three times (two retries) with a back-off and then blanked; confirmed candles are kept. Exchange error envelopes returned with HTTP 200 are rejected and every numeric field is validated before it is parsed.

Market lists refresh in 6-hour wall-clock windows so all nodes reload after the same boundary and select the same symbol for a pair.

## Asset aliases

`src/assets-glossary.json` maps `USD` to `USD`, `USDT` and `USDC` and `EURC` to `EUR`, `EURC` and `EURT`.

## Tests

- `npm test`: offline (local HTTP server and stubbed requests).
- `npm run test:integration`: live exchanges.

