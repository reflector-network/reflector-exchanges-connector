/*eslint-disable no-undef */
const Pair = require('../src/models/pair')
const {getAsset} = require('../src/assets-cache')

/**
 * @typedef {import('../src/providers/price-provider-base')} PriceProviderBase
 */

function normalizeTimestamp(timestamp, timeframe) {
    return Math.floor(timestamp / timeframe) * timeframe
}


/**
 * @param {PriceProviderBase} provider
 * @returns {Promise<void>}
 */
async function loadMarkets(provider) {
    await provider.loadMarkets()
    //markets length should be greater than 0
    expect(provider.markets.length).toBeGreaterThan(0)
}

const timeframe = 5

/**
 * @param {PriceProviderBase} provider
 * @param {Pair} pair
 * @param {number} count
 * @param {boolean} expectNull
 * @returns {Promise<void>}
 */
async function getPriceTest(provider, pair, count = 5, expectNull = false) {
    const ts = getTimestamp() - timeframe * 60 * count
    const tradesData = await provider.getTradesData(pair, ts, timeframe, count)
    if (expectNull) {
        expect(tradesData.filter(d => d.quoteVolume !== 0n && d.volume !== 0n).length).toBe(0)
        return null
    }
    expect(tradesData.length).toBe(count)
    const lastTrade = tradesData[tradesData.length - 1]
    const price = (lastTrade.quoteVolume === 0n || lastTrade.volume === 0n)
        ? 0n
        : (lastTrade.quoteVolume * (10n ** BigInt(7 * 2))) / lastTrade.volume  //10^7 is the default precision
    expect(price).toBeGreaterThan(0n)
    return price
}

function getTimestamp() {
    return normalizeTimestamp(Date.now() - timeframe * 2 * 60000, timeframe * 60000) / 1000
}

const assets = [
    'BTC',
    'USDT',
    'ETH',
    'SOL',
    'ADA',
    'DOT',
    'DAI',
    'XLM',
    'UNI',
    'XRP',
    'LINK',
    'ATOM',
    'EURC',
    'AVAX',
    'MATIC',
    'NON_EXISTENT'
]

const pairs = {
    normalPair: new Pair(getAsset('USD'), getAsset('BTC')),
    invertedPair: new Pair(getAsset('BTC'), getAsset('USD')),
    invalidPair: new Pair(
        getAsset('UASC'),
        getAsset('SOME')
    ),
    selfPair: new Pair(getAsset('BTC'), getAsset('BTC'))
}

module.exports = {getPriceTest, loadMarkets, getTimestamp, pairs, assets}