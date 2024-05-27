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
    'USD',
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
    'MATIC'
]

const pairs = {
    pairs: [
        new Pair(getAsset('BTC'), getAsset('USD')),
        new Pair(getAsset('ETH'), getAsset('USD')),
        new Pair(getAsset('SOL'), getAsset('USD')),
        new Pair(getAsset('ADA'), getAsset('USD')),
        new Pair(getAsset('AVAX'), getAsset('USD')),
        new Pair(getAsset('DOT'), getAsset('USD')),
        new Pair(getAsset('MATIC'), getAsset('USD')),
        new Pair(getAsset('LINK'), getAsset('USD')),
        new Pair(getAsset('DAI'), getAsset('USD')),
        new Pair(getAsset('ATOM'), getAsset('USD')),
        new Pair(getAsset('XLM'), getAsset('USD')),
        new Pair(getAsset('UNI'), getAsset('USD')),
        new Pair(getAsset('XRP'), getAsset('USD')),
        new Pair(getAsset('EURC'), getAsset('USD'))
    ],
    invertedPair: new Pair(getAsset('USD'), getAsset('BTC')),
    invalidPair: new Pair(
        getAsset('UASC'),
        getAsset('SOME')
    ),
    selfPair: new Pair(getAsset('BTC'), getAsset('BTC'))
}

module.exports = {getPriceTest, loadMarkets, getTimestamp, pairs, assets}