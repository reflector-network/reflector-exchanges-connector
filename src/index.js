const BinancePriceProvider = require('./providers/binance-price-provider')
const BybitPriceProvider = require('./providers/bybit-price-provider')
const OkxPriceProvider = require('./providers/okx-price-provider')
const KrakenPriceProvider = require('./providers/kraken-price-provider')
const CoinbasePriceProvider = require('./providers/coinbase-price-provider')
const GatePriceProvider = require('./providers/gate-price-provider')
const Pair = require('./models/pair')
const {getAsset} = require('./assets-cache')
const {getMedianPrice} = require('./price-utils')

/**
 * @typedef {import('./models/asset')} Asset
 * @typedef {import('./providers/price-provider-base')} PriceProviderBase
 */

/**
 * @typedef {Object} PriceData
 * @property {BigInt} price
 * @property {string[]} sources
 */

const providers = [
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
    for (const asset of assets) {
        if (asset.name === base.name)
            continue
        pairs.push(new Pair(base, asset))
    }
    return pairs
}

/**
 * Gets aggregated prices from multiple providers
 * @param {string[]} assets - list of asset names
 * @param {string} baseAsset - base asset name
 * @param {number} timestamp - timestamp UNIX in seconds
 * @param {number} timeframe - timeframe in seconds
 * @param {number} decimals - number of decimals for the price
 * @returns {Promise<BigInt[]>}
 */
async function getPrices(assets, baseAsset, timestamp, timeframe, decimals) {
    const ohlcvs = await getOHLCVs(assets, baseAsset, timestamp, timeframe, decimals)
    /**
     * @type {{[key: string]: Price}}
     */
    const prices = []
    for (const asset of assets) {
        const ohlcv = ohlcvs[asset]
        if (!ohlcv) {
            prices.push(0n)
            continue
        }
        prices.push(getMedianPrice(ohlcv))
    }
    return prices
}

/**
 * Gets aggregated prices from multiple providers
 * @param {string[]} assets - list of asset names
 * @param {string} baseAsset - base asset name
 * @param {number} timestamp - timestamp UNIX in seconds
 * @param {number} timeframe - timeframe in seconds
 * @param {number} decimals - number of decimals for the price
 * @returns {Promise<{[key: string]: OHLCV[]}>}
 */
async function getOHLCVs(assets, baseAsset, timestamp, timeframe, decimals) {
    const pairs = getPairs(assets, baseAsset)
    if (timeframe % 60 !== 0) {
        throw new Error('Timeframe should be whole minutes')
    }
    timeframe = timeframe / 60
    if (timeframe > 60) {
        throw new Error('Timeframe should be less than or equal to 60 minutes')
    }
    const ohlcvs = {}
    const fetchPromises = []
    for (const provider of providers) {
        const fetchOHLCVs = async () => {
            try {
                if (Date.now() - provider.marketsLoadedAt > 1000 * 60 * 60 * 6) { //reload markets if older than 6 hours
                    try {
                        await provider.loadMarkets()
                    } catch (error) {
                        console.warn(`Error loading markets for ${provider.name}: ${error.message}`)
                        return
                    }
                }
                for (const pair of pairs) {
                    try {
                        const ohlcv = await provider.getOHLCV(pair, timestamp, timeframe, decimals)
                        if (!ohlcv) {
                            continue
                        }
                        ohlcvs[pair.quote.name] = ohlcvs[pair.quote.name] || []
                        ohlcvs[pair.quote.name].push(ohlcv)
                    } catch (error) {
                        console.warn(`Error getting price for ${pair.name} from ${provider.name}: ${error.message}`)
                    }
                }
            } catch (error) {
                console.error(`Error fetching data from ${provider.name}: ${error.message}`)
            }
        }
        fetchPromises.push(fetchOHLCVs())
    }
    await Promise.all(fetchPromises)

    return ohlcvs
}

module.exports = {getPrices, getOHLCVs}