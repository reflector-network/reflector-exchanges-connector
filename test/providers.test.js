/*eslint-disable no-undef */
const Pair = require('../src/models/pair')
const {getAsset} = require('../src/assets-cache')
const BinancePriceProvider = require('../src/providers/binance-price-provider')
const BybitPriceProvider = require('../src/providers/bybit-price-provider')
const OkxPriceProvider = require('../src/providers/okx-price-provider')
const KrakenPriceProvider = require('../src/providers/kraken-price-provider')
const CoinbasePriceProvider = require('../src/providers/coinbase-price-provider')
const GatePriceProvider = require('../src/providers/gate-price-provider')

const pair = new Pair(getAsset('USD'), getAsset('BTC'))
const start = 1700000000

/**
 * @param {PriceProviderBase} provider - provider under test
 * @param {any} data - payload `__makeRequest` should answer with
 * @returns {PriceProviderBase}
 */
function answering(provider, data) {
    provider.__makeRequest = () => Promise.resolve({data})
    provider.cachedSymbols[pair.name] = {symbol: 'BTCUSDT', inversed: true}
    return provider
}

describe('exchange error envelopes are rejected', () => {
    test('binance', async () => {
        await expect(answering(new BinancePriceProvider(), {code: -1121, msg: 'Invalid symbol.'}).__getTradeData(pair, start, 1, 1, 100)).rejects.toThrow('binance: -1121 Invalid symbol.')
        await expect(answering(new BinancePriceProvider(), {symbols: 'nope'}).__loadMarkets(100)).rejects.toThrow('binance: unexpected klines payload')
    })

    test('bybit', async () => {
        await expect(answering(new BybitPriceProvider(), {retCode: 10001, retMsg: 'params error', result: {}}).__getTradeData(pair, start, 1, 1, 100)).rejects.toThrow('bybit: 10001 params error')
    })

    test('okx', async () => {
        await expect(answering(new OkxPriceProvider(), {code: '51001', msg: 'Instrument ID does not exist', data: []}).__getTradeData(pair, start, 1, 1, 100)).rejects.toThrow('okx: 51001 Instrument ID does not exist')
    })

    test('kraken', async () => {
        await expect(answering(new KrakenPriceProvider(), {error: ['EQuery:Unknown asset pair'], result: {}}).__getTradeData(pair, start, 1, 1, 100)).rejects.toThrow('kraken: EQuery:Unknown asset pair')
    })

    test('coinbase', async () => {
        await expect(answering(new CoinbasePriceProvider(), {message: 'NotFound'}).__getTradeData(pair, start, 1, 1, 100)).rejects.toThrow('coinbase: NotFound')
    })

    test('gate', async () => {
        await expect(answering(new GatePriceProvider(), {label: 'INVALID_CURRENCY_PAIR', message: 'Invalid currency pair'}).__getTradeData(pair, start, 1, 1, 100)).rejects.toThrow('gate: INVALID_CURRENCY_PAIR Invalid currency pair')
    })
})

describe('kline fields are validated, not concatenated', () => {
    test('coinbase computes the quote volume from numbers even when the gateway stringifies them', async () => {
        const provider = answering(new CoinbasePriceProvider(), [[String(start), '1', '4', '3', '2', '10']])
        const [trade] = await provider.__getTradeData(pair, start, 1, 1, 100)
        //inversed pair: TradeData swaps volume and quoteVolume; the quote volume is 10 * (2 + 3 + 4 + 1) / 4 = 25
        expect(trade.volume).toBe(250000000n)
        expect(trade.quoteVolume).toBe(100000000n)
    })

    test('binance rejects a non-numeric volume', async () => {
        const provider = answering(new BinancePriceProvider(), [[start * 1000, '1', '1', '1', '1', 'abc', 0, '2']])
        await expect(provider.__getTradeData(pair, start, 1, 1, 100)).rejects.toThrow('Invalid volume: abc')
    })

    test('okx and gate honour their confirmation flags', async () => {
        const okx = answering(new OkxPriceProvider(), {code: '0', data: [[String(start * 1000), '1', '1', '1', '1', '5', '5', '7', '0']]})
        const [okxTrade] = await okx.__getTradeData(pair, start, 1, 1, 100)
        expect(okxTrade.completed).toBe(false)
        const gate = answering(new GatePriceProvider(), [[String(start), '7', '1', '1', '1', '1', '5', 'true']])
        const [gateTrade] = await gate.__getTradeData(pair, start, 1, 1, 100)
        expect(gateTrade.completed).toBe(true)
    })
})
