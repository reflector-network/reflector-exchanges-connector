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
 * @param {boolean} expectNull
 * @returns {Promise<void>}
 */
async function getPriceTest(provider, pair, expectNull = false) {
    const ts = getTimestamp()
    const ohlcv = await provider.getOHLCV(pair, ts, timeframe, 8)
    if (expectNull) {
        expect(ohlcv).toBeNull()
        return null
    }
    const price = ohlcv?.price() || 0n
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
    normalPair: new Pair(getAsset('BTC'), getAsset('USD')),
    invertedPair: new Pair(getAsset('USD'), getAsset('BTC')),
    invalidPair: new Pair(
        getAsset('UASC'),
        getAsset('SOME')
    ),
    selfPair: new Pair(getAsset('BTC'), getAsset('BTC'))
}

module.exports = {getPriceTest, loadMarkets, getTimestamp, pairs, assets}