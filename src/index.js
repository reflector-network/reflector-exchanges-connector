/*eslint-disable class-methods-use-this */
const BinancePriceProvider = require('./providers/binance-price-provider')
const BybitPriceProvider = require('./providers/bybit-price-provider')
const OkxPriceProvider = require('./providers/okx-price-provider')
const KrakenPriceProvider = require('./providers/kraken-price-provider')
const CoinbasePriceProvider = require('./providers/coinbase-price-provider')
const GatePriceProvider = require('./providers/gate-price-provider')
const Pair = require('./models/pair')
const TradeData = require('./models/trade-data')
const {getAsset} = require('./assets-cache')
const PriceProviderBase = require('./providers/price-provider-base')
const RequestError = require('./providers/request-error')

/**
 * @typedef {import('./models/asset')} Asset
 * @typedef {import('./models/trade-data')} TradeData
 * @typedef {import('./providers/price-provider-base')} PriceProviderBase
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
 */

const defaultFetchOptions = {batchSize: 10, batchDelay: 2000, sources: ['binance', 'bybit', 'coinbase', 'kraken', 'okx']} //ignore gate for now

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
    new CoinbasePriceProvider()
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
 * Splits pairs into batches
 * @param {Pair[]} pairs - list of pairs
 * @param {number} batchSize - batch size
 * @returns {Array<Pair[]>} list of pairs batches
 */
function getPairsBatches(pairs, batchSize) {
    if (batchSize <= 0)
        return [pairs]
    const pairsBatches = []
    for (let i = 0; i < pairs.length; i += batchSize) {
        pairsBatches.push(pairs.slice(i, i + batchSize))
    }
    return pairsBatches
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
 * Fetches one pair from one provider. Always resolves to `count` candles: retries only retryable transport failures and
 * unconfirmed candles (with a linear back-off); after the last attempt unconfirmed candles are blanked, failures yield
 * placeholders, so the aggregated matrix stays dense.
 * @param {PriceProviderBase} provider - provider to query
 * @param {Pair} pair - pair to fetch
 * @param {number} timestamp - first candle timestamp in seconds
 * @param {number} timeframe - timeframe in minutes
 * @param {number} count - number of candles
 * @param {number} timeout - request timeout in milliseconds
 * @returns {Promise<TradeData[]>}
 */
async function fetchPairTradesData(provider, pair, timestamp, timeframe, count, timeout) {
    const errors = []
    let lastTradesData = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const tradesData = await provider.getTradesData(pair, timestamp, timeframe, count, timeout)
            if (!tradesData) {
                console.debug(`No data for ${pair.name} from ${provider.name}`)
                return emptyCandles(provider, timestamp, timeframe, count)
            }
            if (tradesData.every(trade => trade.completed))
                return tradesData
            lastTradesData = tradesData
            console.debug(`Incomplete data for ${pair.name} from ${provider.name}. ${attempt < maxAttempts ? 'Retrying...' : 'Keeping the confirmed candles.'}`)
        } catch (error) {
            errors.push(error.message)
            if (!(error instanceof RequestError) || !error.retryable)
                break
        }
        if (attempt < maxAttempts)
            await sleep(retryDelay * attempt)
    }
    if (errors.length > 0)
        console.warn(`Failed to get data for ${pair.name} from ${provider.name}: ${errors.join(', ')}`)
    if (lastTradesData)
        return lastTradesData.map(trade => trade.completed ? trade : emptyCandle(provider, trade.ts))
    return emptyCandles(provider, timestamp, timeframe, count)
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
 * @param {Array<Pair[]>} pairsBatches - pairs split into batches
 * @param {number} timestamp - first candle timestamp in seconds
 * @param {number} timeframe - timeframe in minutes
 * @param {number} count - number of candles
 * @param {number} batchDelay - delay between batches in milliseconds
 * @param {number} timeout - request timeout in milliseconds
 * @returns {Promise<Array<TradeData[]>>} trades data for every pair, or null if the provider failed
 */
async function getProviderTradesData(provider, pairsBatches, timestamp, timeframe, count, batchDelay, timeout) {
    const allTradesData = []
    //defence in depth: every callee swallows its own failures today, so this cannot fire unless a future provider throws synchronously
    try {
        await ensureMarketLoaded(provider, timeout)
        for (const pairsBatch of pairsBatches) {
            const batchStart = Date.now()
            const tradesDataPromises = []
            for (const pair of pairsBatch) {
                const fetchPromise = fetchPairTradesData(provider, pair, timestamp, timeframe, count, timeout)
                tradesDataPromises.push(fetchPromise)
            }
            allTradesData.push(...(await Promise.all(tradesDataPromises)))
            if (batchDelay > 0) { //delay between batches
                const elapsed = Date.now() - batchStart
                if (elapsed < batchDelay) {
                    await new Promise(resolve => setTimeout(resolve, batchDelay - elapsed))
                }
            }
        }
    } catch (error) {
        console.error(`Error fetching data from ${provider.name}: ${error.message}`)
        return null
    }
    return allTradesData
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

        const {batchSize, sources, batchDelay, timeout} = {...defaultFetchOptions, ...options}

        const fetchPromises = []
        const pairsBatches = getPairsBatches(pairs, batchSize)
        const providers = getSupportedProviders(sources)
        for (const provider of providers) {
            const providerTradesDataPromise = getProviderTradesData(provider, pairsBatches, from, period, count, batchDelay, timeout)
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
ExchangesPriceProvider.fetchPairTradesData = fetchPairTradesData
ExchangesPriceProvider.ensureMarketLoaded = ensureMarketLoaded
ExchangesPriceProvider.providers = supportedProviders

module.exports = ExchangesPriceProvider