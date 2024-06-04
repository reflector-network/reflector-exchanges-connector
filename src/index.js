/*eslint-disable*/
const BinancePriceProvider = require('./providers/binance-price-provider')
const BybitPriceProvider = require('./providers/bybit-price-provider')
const OkxPriceProvider = require('./providers/okx-price-provider')
const KrakenPriceProvider = require('./providers/kraken-price-provider')
const CoinbasePriceProvider = require('./providers/coinbase-price-provider')
const GatePriceProvider = require('./providers/gate-price-provider')
const Pair = require('./models/pair')
const { getAsset } = require('./assets-cache')
const { getMedianPrice } = require('./price-utils')

/**
 * @typedef {import('./models/asset')} Asset
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
 * Gets aggregated prices from multiple providers
 * @param {string[]} assets - list of asset names
 * @param {string} baseAsset - base asset name
 * @param {number} timestamp - timestamp UNIX in seconds
 * @param {number} timeframe - timeframe in seconds
 * @param {number} decimals - number of decimals for the price
 * @param {FetchOptions} [options] - fetch options
 * @returns {Promise<BigInt[]>}
 */
async function getPrices(assets, baseAsset, timestamp, timeframe, decimals, options = null) {
    const ohlcvs = await getOHLCVs(assets, baseAsset, timestamp, timeframe, decimals, options)
    const res = ohlcvs.map(ohlcv => getMedianPrice(ohlcv) || 0n)

    return res
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
 * @param {number} decimals
 * @param {number} timeout
 * @returns {Promise<OHLCV>}
 */
async function fetchSingleOHLCV(provider, pair, timestamp, timeframe, decimals, timeout) {
    let tries = 3
    while (tries > 0) {
        try {
            const ohlcv = await provider.getOHLCV(pair, timestamp, timeframe, decimals, timeout)
            if (!ohlcv) {
                console.debug(`No data for ${pair.name} from ${provider.name}`)
                break
            } else if (!ohlcv.completed) {
                console.debug(`Incomplete data for ${pair.name} from ${provider.name}, ${tries > 0 ? 'retrying...' : 'skipping...'}`)
                continue
            }
            return ohlcv
        } catch (error) {
            console.warn(`Error getting price for ${pair.name} from ${provider.name}: ${error.message}`)
            if (error.name != 'AxiosError' && !error.message.includes('timeout'))
                break
        } finally {
            tries--
        }
    }
    return null
}

/**
 * @param {PriceProviderBase} provider
 * @param {Pair[][]} pairsBatches
 * @param {number} timestamp
 * @param {number} timeframe
 * @param {number} decimals
 * @param {number} batchDelay
 * @returns {Promise<OHLCV[]>}
 */
async function fetchOHLCVs(provider, pairsBatches, timestamp, timeframe, decimals, batchDelay, timeout) {
    const allOhlcv = []
    try {
        if (Date.now() - provider.marketsLoadedAt > 1000 * 60 * 60 * 6) { //reload markets if older than 6 hours
            try {
                await provider.loadMarkets(timeout)
            } catch (error) {
                console.warn(`Error loading markets for ${provider.name}: ${error.message}`)
                return
            }
        }
        for (const pairsBatch of pairsBatches) {
            const batchStart = Date.now()
            const ohlcvPromises = []
            for (const pair of pairsBatch) {
                const ohlcvPromise = fetchSingleOHLCV(provider, pair, timestamp, timeframe, decimals, timeout)
                ohlcvPromises.push(ohlcvPromise)
            }
            allOhlcv.push(...(await Promise.all(ohlcvPromises)))
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
    return allOhlcv
}

/**
 * Gets aggregated prices from multiple providers
 * @param {string[]} assets - list of asset names
 * @param {string} baseAsset - base asset name
 * @param {number} timestamp - timestamp UNIX in seconds
 * @param {number} timeframe - timeframe in seconds
 * @param {number} decimals - number of decimals for the price
 * @param {FetchOptions} options - fetch options
 * @returns {Promise<OHLCV[][]>}
 */
async function getOHLCVs(assets, baseAsset, timestamp, timeframe, decimals, options = null) {
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
        const providerOhlcvsPromise = fetchOHLCVs(provider, pairsBatches, timestamp, timeframe, decimals, batchDelay, timeout)
        fetchPromises.push(providerOhlcvsPromise)
    }
    const providersResult = await Promise.all(fetchPromises)
    const ohlcvs = []
    for (let i = 0; i < assets.length; i++) {
        ohlcvs[i] = providersResult
            .map(ohlcvs => ohlcvs[i])
            .filter(ohlcv => ohlcv)
            .sort((a, b) => a.source.localeCompare(b.source))
    }

    console.debug({
        timestamp,
        baseAsset,
        result: ohlcvs.map(assetOhlcvs => assetOhlcvs.map(ohlcv => ({ source: ohlcv.source, price: ohlcv.price(), completed: ohlcv.completed, asset: ohlcv.quote })))
    })

    return ohlcvs
}

function getProvider(name) {
    return supportedProviders.find(provider => provider.name === name)
}

module.exports = { getPrices, getOHLCVs, getProvider }