/*eslint-disable*/
const BinancePriceProvider = require('./providers/binance-price-provider')
const BybitPriceProvider = require('./providers/bybit-price-provider')
const OkxPriceProvider = require('./providers/okx-price-provider')
const KrakenPriceProvider = require('./providers/kraken-price-provider')
const CoinbasePriceProvider = require('./providers/coinbase-price-provider')
const GatePriceProvider = require('./providers/gate-price-provider')
const Pair = require('./models/pair')
const { getAsset } = require('./assets-cache')
const PriceProviderBase = require('./providers/price-provider-base')

/**
 * @typedef {import('./models/asset')} Asset
 * @typedef {import('./models/trade-data')} TradeData
 * @typedef {import('./providers/price-provider-base')} PriceProviderBase
 */

/**
 * @typedef {Object} FetchOptions
 * @property {number} [batchSize] - force fetch data from provider
 * @property {number} [batchDelay] - delay between batches
 * @property {string[]} [sources] - list of sources to fetch data from
 * @property {number} [timeout] - request timeout
 */

const defaultFetchOptions = { batchSize: 10, batchDelay: 2000, sources: ['binance', 'bybit', 'coinbase', 'kraken', 'okx'] } //ignore gate for now

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
 * @returns {Pair[][]} - list of pairs batches
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
 * @param {string[]} sources
 * @returns {PriceProviderBase[]}
 */
function getSupportedProviders(sources) {
    return supportedProviders.filter(provider => sources.includes(provider.name))
}


/**
 * @param {PriceProviderBase} provider
 * @param {Pair} pair
 * @param {number} timestamp
 * @param {number} timeframe
 * @param {number} count
 * @param {number} timeout
 * @returns {Promise<TradeData[]>}
 */
async function fetchPairTradesData(provider, pair, timestamp, timeframe, count, timeout) {
    let tries = 3
    const errors = []
    while (tries > 0) {
        try {
            const tradesData = await provider.getTradesData(pair, timestamp, timeframe, count, timeout)
            if (!tradesData) {
                console.debug(`No data for ${pair.name} from ${provider.name}`)
                break
            } else if (tradesData.some(trade => !trade.completed)) {
                console.debug(`Incomplete data for ${pair.name} from ${provider.name}. ${tries > 0 ? 'Retrying...' : 'Skipping...'}`)
                continue
            }
            return tradesData
        } catch (error) {
            errors.push(error.message)
        } finally {
            tries--
        }
    }
    if (errors.length > 0)
        console.warn(`Failed to get data for ${pair.name} from ${provider.name}: ${errors.join(', ')}`)
    return null
}

/**
 * @param {PriceProviderBase} provider
 * @param {number} timeout
 * @returns {Promise<void>}
 */
async function ensureMarketLoaded(provider, timeout) {
    if (Date.now() - provider.marketsLoadedAt < 1000 * 60 * 60 * 6)
        return
    let tries = 3
    const errors = []
    while (tries > 0) {
        try {
            await provider.loadMarkets(timeout)
            return
        } catch (error) {
            errors.push(error.message)
        } finally {
            tries--
        }
    }
    console.warn(`Failed to load markets for ${provider.name}: ${errors.join(', ')}`)
}

/**
 * @param {PriceProviderBase} provider
 * @param {Pair[][]} pairsBatches
 * @param {number} timestamp
 * @param {number} timeframe
 * @param {number} count
 * @param {number} batchDelay
 * @returns {Promise<TradeData[][]>}
 */
async function getProviderTradesData(provider, pairsBatches, timestamp, timeframe, count, batchDelay, timeout) {
    const allTradesData = []
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

/**
 * Gets aggregated prices from multiple providers
 * @param {string[]} assets - list of asset names
 * @param {string} baseAsset - base asset name
 * @param {number} timestamp - timestamp UNIX in seconds
 * @param {number} timeframe - timeframe in seconds
 * @param {number} count - number of candles to get before the timestamp
 * @param {FetchOptions} options - fetch options
 * @returns {Promise<TradeData[][]>}
 */
async function getTradesData(assets, baseAsset, timestamp, timeframe, count, options = null) {
    if (assets.length === 0)
        return []
    const pairs = getPairs(assets, baseAsset)
    if (timeframe % 60 !== 0) {
        throw new Error('Timeframe should be whole minutes')
    }
    timeframe = timeframe / 60
    if (timeframe > 60) {
        throw new Error('Timeframe should be less than or equal to 60 minutes')
    }

    const { batchSize, sources, batchDelay, timeout } = { ...defaultFetchOptions, ...options }

    const fetchPromises = []
    const pairsBatches = getPairsBatches(pairs, batchSize)
    const providers = getSupportedProviders(sources)
    for (const provider of providers) {
        const providerTradesDataPromise = getProviderTradesData(provider, pairsBatches, timestamp, timeframe, count, batchDelay, timeout)
        fetchPromises.push(providerTradesDataPromise)
    }
    const providersResult = await Promise.all(fetchPromises)
    const tradesData = []
    for (let i = 0; i < assets.length; i++) {
        tradesData[i] = providersResult
            .filter(result => result)
            .map(t => t[i])
            .filter(t => t)
    }

    return tradesData
}

function setProxy(proxyOptions, useCurrentProvider = false) {
    PriceProviderBase.setProxy(proxyOptions, useCurrentProvider)
}

module.exports = { getTradesData, setProxy }