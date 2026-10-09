/*eslint-disable no-undef */
const TradeData = require('../src/models/trade-data')
const Pair = require('../src/models/pair')
const RequestError = require('../src/providers/request-error')
const {getAsset} = require('../src/assets-cache')
const ExchangesPriceProvider = require('../src')

const pair = new Pair(getAsset('USD'), getAsset('BTC'))
const start = 1700000000

/**
 * @param {string} name - provider name
 * @param {Function} getTradesData - stubbed getTradesData
 * @returns {object} provider-shaped stub
 */
function stubProvider(name, getTradesData) {
    return {name, marketsLoadedAt: Date.now(), markets: ['BTCUSDT'], loadMarkets: jest.fn(), getTradesData: jest.fn(getTradesData)}
}

/**
 * @param {number} ts - candle timestamp
 * @param {boolean} completed - confirmation flag
 * @returns {TradeData}
 */
function candle(ts, completed) {
    return new TradeData({ts, volume: '100', quoteVolume: '200', inversed: false, source: 'test', completed})
}

const {fetchPairTradesData, ensureMarketLoaded} = ExchangesPriceProvider

beforeAll(() => {
    jest.spyOn(console, 'debug').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterAll(() => {
    jest.restoreAllMocks()
})

describe('fetchPairTradesData', () => {
    test('returns confirmed data on the first attempt', async () => {
        const provider = stubProvider('test', () => [candle(start, true), candle(start + 60, true)])
        const result = await fetchPairTradesData(provider, pair, start, 1, 2, 100)
        expect(result).toHaveLength(2)
        expect(provider.getTradesData).toHaveBeenCalledTimes(1)
    })

    test('keeps confirmed candles and blanks the unconfirmed tail after three attempts', async () => {
        const provider = stubProvider('test', () => [candle(start, true), candle(start + 60, false)])
        const result = await fetchPairTradesData(provider, pair, start, 1, 2, 100)
        expect(provider.getTradesData).toHaveBeenCalledTimes(3)
        expect(result).toHaveLength(2)
        expect(result[0].volume).toBe(1000000000n)
        expect(result[1].volume).toBe(0n)
        expect(result[1].ts).toBe(start + 60)
        expect(result[1].completed).toBe(true)
    })

    test('returns the confirmed window as soon as a retry confirms it', async () => {
        let calls = 0
        const provider = stubProvider('test', () => {
            calls++
            return [candle(start, calls > 1)]
        })
        const result = await fetchPairTradesData(provider, pair, start, 1, 1, 100)
        expect(result[0].completed).toBe(true)
        expect(provider.getTradesData).toHaveBeenCalledTimes(2)
    })

    test('a null result yields count placeholders without retrying', async () => {
        const provider = stubProvider('test', () => null)
        const result = await fetchPairTradesData(provider, pair, start, 5, 3, 100)
        expect(result.map(t => t.ts)).toEqual([start, start + 300, start + 600])
        expect(result.every(t => t.volume === 0n && t.completed)).toBe(true)
        expect(provider.getTradesData).toHaveBeenCalledTimes(1)
    })

    test('retries a retryable request error with back-off, then yields placeholders', async () => {
        const provider = stubProvider('test', () => {
            throw new RequestError('api.example', {status: 503})
        })
        const started = Date.now()
        const result = await fetchPairTradesData(provider, pair, start, 1, 2, 100)
        expect(result).toHaveLength(2)
        expect(provider.getTradesData).toHaveBeenCalledTimes(3)
        expect(Date.now() - started).toBeGreaterThanOrEqual(500)
        expect(console.warn).toHaveBeenCalled()
    })

    test('does not retry a deterministic failure', async () => {
        const provider = stubProvider('test', () => {
            throw new Error('okx: 51001 Instrument ID does not exist')
        })
        const result = await fetchPairTradesData(provider, pair, start, 1, 2, 100)
        expect(result).toHaveLength(2)
        expect(provider.getTradesData).toHaveBeenCalledTimes(1)
    })
})

describe('getPriceData is dense under partial failure', () => {
    test('a pair that fails everywhere still occupies its slot', async () => {
        const [binance] = ExchangesPriceProvider.providers.filter(p => p.name === 'binance')
        const loadMarkets = jest.spyOn(binance, 'loadMarkets').mockImplementation(() => {
            binance.markets = ['BTCUSDT']
            binance.marketsLoadedAt = Date.now()
        })
        const getTradesData = jest.spyOn(binance, 'getTradesData').mockImplementation(p => {
            if (p.quote.name === 'ETH')
                throw new RequestError('api.binance.com', {status: 404})
            return [candle(start, true), candle(start + 60, true)]
        })
        try {
            const matrix = await new ExchangesPriceProvider().getPriceData({assets: ['BTC', 'ETH'], baseAsset: 'USD', from: start, period: 60, count: 2, options: {sources: ['binance'], batchSize: 0, batchDelay: 0, timeout: 100}})
            expect(matrix).toHaveLength(2)
            expect(matrix[0]).toHaveLength(2)
            expect(matrix[1]).toHaveLength(2)
            expect(matrix[0][0][0].volume).toBe(1000000000n)
            expect(matrix[0][1][0].volume).toBe(0n)
            expect(JSON.parse(JSON.stringify(matrix, (_, v) => typeof v === 'bigint' ? v.toString() : v))[1][1]).toHaveLength(1)
        } finally {
            loadMarkets.mockRestore()
            getTradesData.mockRestore()
        }
    })
})

describe('market refresh is aligned to 6-hour windows', () => {
    const window = 6 * 60 * 60 * 1000

    test('does not reload inside the current window, reloads after a boundary', async () => {
        const now = Date.now()
        const currentWindow = Math.floor(now / window) * window
        const fresh = stubProvider('a', () => [])
        fresh.marketsLoadedAt = currentWindow + 1
        await ensureMarketLoaded(fresh, 100)
        expect(fresh.loadMarkets).not.toHaveBeenCalled()
        const stale = stubProvider('b', () => [])
        stale.marketsLoadedAt = currentWindow - 1
        await ensureMarketLoaded(stale, 100)
        expect(stale.loadMarkets).toHaveBeenCalledTimes(1)
        const empty = stubProvider('c', () => [])
        empty.markets = []
        empty.marketsLoadedAt = now
        await ensureMarketLoaded(empty, 100)
        expect(empty.loadMarkets).toHaveBeenCalledTimes(1)
    })
})
