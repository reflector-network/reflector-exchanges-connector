/*eslint-disable no-undef */
const PriceProviderBase = require('../src/providers/price-provider-base')
const TradeData = require('../src/models/trade-data')
const Pair = require('../src/models/pair')
const {getAsset} = require('../src/assets-cache')

class TestProvider extends PriceProviderBase {
    name = 'test'

    __processSingleKline(kline, inversed) {
        return new TradeData({ts: PriceProviderBase.toNumber(kline[0], 'timestamp'), volume: PriceProviderBase.validateAmount(kline[1], 'volume'), quoteVolume: PriceProviderBase.validateAmount(kline[2], 'quote volume'), inversed, source: this.name, completed: true})
    }
}

const provider = new TestProvider()
const start = 1700000000
const minute = 60

describe('__processKlines aligns candles by timestamp', () => {
    test('a missing middle candle zeroes only its own slot', () => {
        const klines = [[start, '1', '10'], [start + 2 * minute, '3', '30'], [start + 3 * minute, '4', '40']]
        const trades = provider.__processKlines(klines, start, false, 1, 4)
        expect(trades.map(t => t.ts)).toEqual([start, start + minute, start + 2 * minute, start + 3 * minute])
        expect(trades.map(t => t.volume)).toEqual([10000000n, 0n, 30000000n, 40000000n])
        expect(trades[1].completed).toBe(true)
    })

    test('out-of-order and out-of-window klines are placed by their own timestamp or ignored', () => {
        const klines = [[start + minute, '2', '20'], [start - minute, '9', '90'], [start, '1', '10'], [start + 5 * minute, '9', '90']]
        const trades = provider.__processKlines(klines, start, false, 1, 2)
        expect(trades.map(t => t.volume)).toEqual([10000000n, 20000000n])
    })

    test('an empty or null list yields count placeholders', () => {
        expect(provider.__processKlines(null, start, true, 5, 3).map(t => t.ts)).toEqual([start, start + 300, start + 600])
        expect(provider.__processKlines([], start, true, 5, 3).every(t => t.volume === 0n && t.completed)).toBe(true)
    })
})

describe('numeric validation', () => {
    test('toNumber accepts numeric strings and rejects garbage, negatives and booleans', () => {
        expect(PriceProviderBase.toNumber('1700000000', 'timestamp')).toBe(1700000000)
        expect(PriceProviderBase.toNumber(12.5, 'volume')).toBe(12.5)
        for (const bad of ['abc', -1, true, null, undefined, '', NaN, Infinity])
            expect(() => PriceProviderBase.toNumber(bad, 'volume')).toThrow('Invalid volume')
    })

    test('validateAmount keeps the original representation', () => {
        expect(PriceProviderBase.validateAmount('123.4567891234', 'volume')).toBe('123.4567891234')
        expect(PriceProviderBase.validateAmount(0, 'volume')).toBe(0)
        expect(() => PriceProviderBase.validateAmount('4321', 'volume')).not.toThrow()
        expect(() => PriceProviderBase.validateAmount({}, 'volume')).toThrow('Invalid volume')
    })

    test('__requireArray names the provider', () => {
        expect(() => provider.__requireArray({code: -1121, msg: 'Invalid symbol.'})).toThrow('test: unexpected klines payload')
        expect(provider.__requireArray([1])).toEqual([1])
    })
})

describe('identity pairs', () => {
    test('return distinct completed candles with timestamps', () => {
        const pair = new Pair(getAsset('BTC'), getAsset('BTC'))
        const trades = provider.getTradesData(pair, start, 5, 3)
        expect(trades.map(t => t.ts)).toEqual([start, start + 300, start + 600])
        expect(trades.every(t => t.completed && t.volume === 10000000n && t.quoteVolume === 10000000n)).toBe(true)
        expect(new Set(trades).size).toBe(3)
    })
})
