/*eslint-disable class-methods-use-this */
const BinancePriceProvider = require('./providers/binance-price-provider')
const BybitPriceProvider = require('./providers/bybit-price-provider')
const OkxPriceProvider = require('./providers/okx-price-provider')
const KrakenPriceProvider = require('./providers/kraken-price-provider')
const CoinbasePriceProvider = require('./providers/coinbase-price-provider')
const GatePriceProvider = require('./providers/gate-price-provider')
const BitstampPriceProvider = require('./providers/bitstamp-price-provider')
const CryptoComPriceProvider = require('./providers/cryptocom-price-provider')
const Pair = require('./models/pair')
const TradeData = require('./models/trade-data')
const {getAsset} = require('./assets-cache')
const PriceProviderBase = require('./providers/price-provider-base')
const RequestError = require('./providers/request-error')

/**
 * @typedef {import('./models/asset')} Asset
 * @typedef {import('./models/trade-data')} TradeData
 * @typedef {import('./providers/price-provider-base')} PriceProviderBase
 * @typedef {import('./providers/price-provider-base').Market} Market
 */

/**
 * @typedef {TradeData[]} AssetTradeData
 * An array of trades from multiple sources for a single asset.
 */

/**
 * @typedef {AssetTradeData[]} TimestampTradeData
 * An array of asset trade data for a single timestamp.
 */

/**
 * @typedef {TimestampTradeData[]} AggregatedTradeData
 * An array of timestamped trade data for multiple assets.
 */

/**
 * @typedef {Object} FetchOptions
 * @property {number} [batchSize] - force fetch data from provider
 * @property {number} [batchDelay] - delay between batches
 * @property {string[]} [sources] - list of sources to fetch data from
 * @property {number} [timeout] - request timeout
 * @property {('first'|'combine')} [marketMode] - read only the first market a source has for a pair (default), or sum
 * the volumes of all its markets for the pair, one per quote currency
 */

const defaultFetchOptions = {
    batchSize: 10,
    batchDelay: 2000,
    sources: ['binance', 'bybit', 'coinbase', 'kraken', 'okx', 'bitstamp', 'cryptocom'], //ignore gate for now
    marketMode: 'first'
}

const marketModes = ['first', 'combine']

/**
 * @typedef {Object} PriceData
 * @property {BigInt} price
 * @property {string[]} sources
 */

const supportedProviders = [
    new BinancePriceProvider(),
    new BybitPriceProvider(),
    new OkxPriceProvider(),
    new KrakenPriceProvider(),
    new GatePriceProvider(),
    new CoinbasePriceProvider(),
    new BitstampPriceProvider(),
    new CryptoComPriceProvider()
]

/**
 * @param {string[]} assets - list of asset names
 * @param {string} baseAsset - base asset name
 * @returns {Pair[]}
 */
function getPairs(assets, baseAsset) {
    const pairs = []
    const base = getAsset(baseAsset)
    assets = assets.map(asset => getAsset(asset))
    for (const asset of assets)
        pairs.push(new Pair(base, asset))
    return pairs
}

/**
 * Splits requests into batches
 * @template T
 * @param {T[]} items - list of requests
 * @param {number} batchSize - batch size
 * @returns {Array<T[]>} list of batches
 */
function getBatches(items, batchSize) {
    if (items.length === 0)
        return []
    if (batchSize <= 0)
        return [items]
    const batches = []
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize))
    }
    return batches
}

/**
 * @typedef {Object} MarketRequest
 * @property {number} pairIndex - index of the pair in the requested list
 * @property {Pair} pair - pair the market belongs to
 * @property {Market|null} market - market to read; null when the source has none for the pair, which costs no request
 */

/**
 * One request per pair in `first` mode, one per market in `combine` mode. A pair without a market gets one entry with a
 * null market, which is answered without a request.
 * @param {PriceProviderBase} provider - provider with loaded markets
 * @param {Pair[]} pairs - pairs to fetch
 * @param {string} marketMode - first or combine
 * @returns {MarketRequest[]}
 */
function getMarketRequests(provider, pairs, marketMode) {
    const requests = []
    pairs.forEach((pair, pairIndex) => {
        const markets = provider.getMarkets(pair)
        const selected = marketMode === 'combine' ? markets : markets.slice(0, 1)
        if (selected.length === 0)
            requests.push({pairIndex, pair, market: null})
        for (const market of selected)
            requests.push({pairIndex, pair, market})
    })
    return requests
}

/**
 * @param {string[]} sources - list of provider names to include
 * @returns {PriceProviderBase[]} matching provider instances
 */
function getSupportedProviders(sources) {
    return supportedProviders.filter(provider => sources.includes(provider.name))
}


const maxAttempts = 3
const retryDelay = 200
const marketsWindow = 6 * 60 * 60 * 1000

//start of each provider's latest batch, reserved in advance, so batches stay apart across calls too
const batchStarts = new Map()

/**
 * @param {number} ms - delay in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * @param {PriceProviderBase} provider - source of the candle
 * @param {number} ts - candle timestamp in seconds
 * @returns {TradeData} a zero-volume completed candle, the node's representation of "no data"
 */
function emptyCandle(provider, ts) {
    return new TradeData({ts, volume: 0, quoteVolume: 0, inversed: false, source: provider.name, completed: true})
}

/**
 * @param {PriceProviderBase} provider - source
 * @param {number} timestamp - first candle timestamp in seconds
 * @param {number} timeframe - timeframe in minutes
 * @param {number} count - number of candles
 * @returns {TradeData[]}
 */
function emptyCandles(provider, timestamp, timeframe, count) {
    return Array.from({length: count}, (_, i) => emptyCandle(provider, timestamp + i * timeframe * 60))
}

/**
 * Fetches one market of a pair from one provider. Retries only retryable transport failures and unconfirmed candles
 * (with a linear back-off).
 * @param {PriceProviderBase} provider - provider to query
 * @param {Pair} pair - pair to fetch
 * @param {Market|null} [market] - market to read; see `getTradesData`
 * @param {number} timestamp - first candle timestamp in seconds
 * @param {number} timeframe - timeframe in minutes
 * @param {number} count - number of candles
 * @param {number} timeout - request timeout in milliseconds
 * @returns {Promise<TradeData[]|null>} `count` candles, those still unconfirmed after the last attempt left unconfirmed;
 * null when no attempt returned data
 */
async function fetchMarketTradesData(provider, pair, market, timestamp, timeframe, count, timeout) {
    const label = market ? `${pair.name} (${market.symbol})` : pair.name
    const errors = []
    let lastTradesData = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const tradesData = await provider.getTradesData(pair, timestamp, timeframe, count, timeout, market)
            if (!tradesData) {
                console.debug(`No data for ${label} from ${provider.name}`)
                return emptyCandles(provider, timestamp, timeframe, count)
            }
            if (tradesData.every(trade => trade.completed))
                return tradesData
            lastTradesData = tradesData
            console.debug(`Incomplete data for ${label} from ${provider.name}. ${attempt < maxAttempts ? 'Retrying...' : 'Keeping the confirmed candles.'}`)
        } catch (error) {
            errors.push(error.message)
            if (!(error instanceof RequestError) || !error.retryable)
                break
        }
        if (attempt < maxAttempts)
            await sleep(retryDelay * attempt)
    }
    if (errors.length > 0)
        console.warn(`Failed to get data for ${label} from ${provider.name}: ${errors.join(', ')}`)
    return lastTradesData
}

/**
 * Turns the candles of a pair's markets into the provider's `count` candles for the pair, so the aggregated matrix
 * stays dense. Each minute is the exact sum of the confirmed candles of the markets that returned data: a market that
 * failed, or a candle still unconfirmed, is left out, and a minute with nothing left is blank. A node that missed a
 * market reports a smaller sum that the other nodes do not confirm, just as they would not confirm a blank one; when
 * every node missed the same market, their smaller sums agree and the source still counts.
 * @param {PriceProviderBase} provider - source of the candles
 * @param {Array<TradeData[]|null>} marketsTradesData - candles of each market, as `fetchMarketTradesData` returns them
 * @param {number} timestamp - first candle timestamp in seconds
 * @param {number} timeframe - timeframe in minutes
 * @param {number} count - number of candles
 * @returns {TradeData[]}
 */
function mergeMarketsTradesData(provider, marketsTradesData, timestamp, timeframe, count) {
    const fetched = marketsTradesData.filter(tradesData => tradesData)
    if (fetched.length === 0)
        return emptyCandles(provider, timestamp, timeframe, count)
    if (fetched.length === 1)
        return fetched[0].map(trade => trade.completed ? trade : emptyCandle(provider, trade.ts))
    return Array.from({length: count}, (_, i) => {
        const ts = timestamp + i * timeframe * 60
        const trades = fetched
            .map(tradesData => tradesData[i])
            .filter(trade => trade && trade.completed && trade.ts === ts)
        if (trades.length === 0)
            return emptyCandle(provider, ts)
        let volume = 0n
        let quoteVolume = 0n
        for (const trade of trades) {
            volume += trade.volume
            quoteVolume += trade.quoteVolume
        }
        return new TradeData({ts, volume, quoteVolume, inversed: false, source: provider.name, completed: true})
    })
}

/**
 * Waits for the provider's next batch slot. Batches of one provider start at least `batchDelay` apart whichever call
 * they belong to, so a call that follows another one right away, or runs next to it, does not double the request rate.
 * The slot is reserved before the wait, so concurrent calls take turns. Nothing waits after a call's last batch.
 * @param {PriceProviderBase} provider - provider about to send a batch
 * @param {number} batchDelay - minimum milliseconds between the starts of two batches
 * @returns {Promise<void>}
 */
async function waitForBatchSlot(provider, batchDelay) {
    const now = Date.now()
    const previous = batchStarts.get(provider)
    const slot = previous === undefined || !(batchDelay > 0) ? now : Math.max(now, previous + batchDelay)
    batchStarts.set(provider, slot)
    if (slot > now)
        await sleep(slot - now)
}

/**
 * Reloads the market list when the provider has none or its list was loaded in an earlier 6-hour wall-clock window, so
 * every node refreshes in the first tick after the same boundary and picks the same symbols.
 * @param {PriceProviderBase} provider - provider whose markets may be stale
 * @param {number} timeout - request timeout in milliseconds
 * @returns {Promise<void>}
 */
async function ensureMarketLoaded(provider, timeout) {
    const currentWindow = Math.floor(Date.now() / marketsWindow)
    if (provider.markets.length > 0 && Math.floor(provider.marketsLoadedAt / marketsWindow) === currentWindow)
        return
    const errors = []
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await provider.loadMarkets(timeout)
            return
        } catch (error) {
            errors.push(error.message)
            if (!(error instanceof RequestError) || !error.retryable)
                break
            if (attempt < maxAttempts)
                await sleep(retryDelay * attempt)
        }
    }
    console.warn(`Failed to load markets for ${provider.name}: ${errors.join(', ')}`)
}

/**
 * @param {PriceProviderBase} provider - provider to fetch from
 * @param {Pair[]} pairs - pairs to fetch
 * @param {number} timestamp - first candle timestamp in seconds
 * @param {number} timeframe - timeframe in minutes
 * @param {number} count - number of candles
 * @param {{batchSize: number, batchDelay: number, timeout: number, marketMode: string}} options - batch size in
 * requests, minimum milliseconds between batch starts, request timeout in milliseconds, market mode
 * @returns {Promise<Array<TradeData[]>>} trades data for every pair, or null if the provider failed
 */
async function getProviderTradesData(provider, pairs, timestamp, timeframe, count, {batchSize, batchDelay, timeout, marketMode}) {
    //defence in depth: every callee swallows its own failures today, so this cannot fire unless a future provider throws synchronously
    try {
        await ensureMarketLoaded(provider, timeout)
        const requests = getMarketRequests(provider, pairs, marketMode)
        const results = new Array(requests.length)
        const fetchRequest = async index => {
            const {pair, market} = requests[index]
            results[index] = await fetchMarketTradesData(provider, pair, market, timestamp, timeframe, count, timeout)
        }
        const indexes = requests.map((_, index) => index)
        //a pair without a market is answered without a request (zero or identity candles), so it takes no batch slot
        await Promise.all(indexes.filter(index => !requests[index].market).map(fetchRequest))
        for (const batch of getBatches(indexes.filter(index => requests[index].market), batchSize)) {
            await waitForBatchSlot(provider, batchDelay)
            await Promise.all(batch.map(fetchRequest))
        }
        const marketsTradesData = pairs.map(() => [])
        requests.forEach(({pairIndex}, i) => marketsTradesData[pairIndex].push(results[i]))
        return marketsTradesData.map(pairMarkets => mergeMarketsTradesData(provider, pairMarkets, timestamp, timeframe, count))
    } catch (error) {
        console.error(`Error fetching data from ${provider.name}: ${error.message}`)
        return null
    }
}

class ExchangesPriceProvider {
    /**
     * Gets aggregated prices from multiple providers
     * @param {{assets: string[], baseAsset: string, from: number, period: number, count: number, options: [FetchOptions]}} options - fetch options
     * @returns {Promise<AggregatedTradeData>}
     */
    async getPriceData({assets, baseAsset, from, period, count, options = {}}) {
        if (assets.length === 0)
            return []
        const pairs = getPairs(assets, baseAsset)
        if (period % 60 !== 0) {
            throw new Error('Timeframe should be whole minutes')
        }
        period = period / 60
        if (period > 60) {
            throw new Error('Timeframe should be less than or equal to 60 minutes')
        }

        const {batchSize, sources, batchDelay, timeout, marketMode = defaultFetchOptions.marketMode} = {...defaultFetchOptions, ...options}
        if (!marketModes.includes(marketMode))
            throw new Error(`Unknown market mode: ${marketMode}`)

        const fetchPromises = []
        const fetchOptions = {batchSize, batchDelay, timeout, marketMode}
        const providers = getSupportedProviders(sources)
        for (const provider of providers) {
            const providerTradesDataPromise = getProviderTradesData(provider, pairs, from, period, count, fetchOptions)
            fetchPromises.push(providerTradesDataPromise)
        }
        const providersResult = await Promise.all(fetchPromises)
        //dense matrix: every timestamp has assets.length slots even when a pair or a provider produced nothing
        const tradesData = Array.from({length: count}, () => pairs.map(() => []))
        for (const providerResult of providersResult) {
            //defence in depth: getProviderTradesData cannot return null today (see the comment on its try)
            if (!providerResult)
                continue
            for (let assetIndex = 0; assetIndex < pairs.length; assetIndex++) {
                const assetTradeData = providerResult[assetIndex] ?? []
                for (let timestampIndex = 0; timestampIndex < count; timestampIndex++) {
                    const trade = assetTradeData[timestampIndex]
                    if (trade)
                        tradesData[timestampIndex][assetIndex].push(trade)
                }
            }
        }
        return tradesData
    }

    /**
     * @param {object} gatewayOptions - gateway configuration
     * @param {string} gatewayValidationKey - key used to validate gateway responses
     * @param {boolean} [useCurrentProvider] - reuse the currently configured provider instead of creating a new one
     * @returns {void}
     */
    setGateway(gatewayOptions, gatewayValidationKey, useCurrentProvider = false) {
        PriceProviderBase.setGateway(gatewayOptions, gatewayValidationKey, useCurrentProvider)
    }
}

//exposed for tests
ExchangesPriceProvider.fetchMarketTradesData = fetchMarketTradesData
ExchangesPriceProvider.mergeMarketsTradesData = mergeMarketsTradesData
ExchangesPriceProvider.ensureMarketLoaded = ensureMarketLoaded
ExchangesPriceProvider.providers = supportedProviders

module.exports = ExchangesPriceProvider