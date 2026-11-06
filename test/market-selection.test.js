/*eslint-disable no-undef */
const Asset = require('../src/models/asset')
const Pair = require('../src/models/pair')
const TradeData = require('../src/models/trade-data')
const RequestError = require('../src/providers/request-error')
const {getAsset} = require('../src/assets-cache')
const BinancePriceProvider = require('../src/providers/binance-price-provider')
const BybitPriceProvider = require('../src/providers/bybit-price-provider')
const OkxPriceProvider = require('../src/providers/okx-price-provider')
const KrakenPriceProvider = require('../src/providers/kraken-price-provider')
const CoinbasePriceProvider = require('../src/providers/coinbase-price-provider')
const GatePriceProvider = require('../src/providers/gate-price-provider')
const BitstampPriceProvider = require('../src/providers/bitstamp-price-provider')
const CryptoComPriceProvider = require('../src/providers/cryptocom-price-provider')
const ExchangesPriceProvider = require('../src')

const usd = getAsset('USD')
const start = 1700000000

/**
 * @param {PriceProviderBase} provider - provider under test
 * @param {string[]} markets - market list the exchange reports
 * @returns {PriceProviderBase}
 */
function withMarkets(provider, markets) {
    provider.markets = markets
    return provider
}

/**
 * @param {PriceProviderBase} provider - provider to ask
 * @param {Pair} pair - pair to resolve
 * @returns {string[]} resolved market symbols in order
 */
function symbols(provider, pair) {
    return provider.getMarkets(pair).map(market => market.symbol)
}

describe('each source tries its quote currencies in its own order', () => {
    const btc = new Pair(usd, getAsset('BTC'))

    test('binance, bybit, okx and gate try USDT, then USDC, then USD', () => {
        expect(symbols(withMarkets(new BinancePriceProvider(), ['BTCUSD', 'BTCUSDC', 'BTCUSDT']), btc)).toEqual(['BTCUSDT', 'BTCUSDC', 'BTCUSD'])
        expect(symbols(withMarkets(new BybitPriceProvider(), ['BTCUSD', 'BTCUSDC', 'BTCUSDT']), btc)).toEqual(['BTCUSDT', 'BTCUSDC', 'BTCUSD'])
        expect(symbols(withMarkets(new OkxPriceProvider(), ['BTC-USD', 'BTC-USDC', 'BTC-USDT']), btc)).toEqual(['BTC-USDT', 'BTC-USDC', 'BTC-USD'])
        expect(symbols(withMarkets(new GatePriceProvider(), ['BTC_USD', 'BTC_USDC', 'BTC_USDT']), btc)).toEqual(['BTC_USDT', 'BTC_USDC', 'BTC_USD'])
    })

    test('coinbase and kraken try USD, then USDT, then USDC', () => {
        expect(symbols(withMarkets(new CoinbasePriceProvider(), ['BTC-USDC', 'BTC-USDT', 'BTC-USD']), btc)).toEqual(['BTC-USD', 'BTC-USDT', 'BTC-USDC'])
        expect(symbols(withMarkets(new KrakenPriceProvider(), ['XBTUSDC', 'XBTUSDT', 'XBTUSD']), btc)).toEqual(['XBTUSD', 'XBTUSDT', 'XBTUSDC'])
    })

    test('bitstamp and cryptocom try USD, then USDT, then USDC', () => {
        expect(symbols(withMarkets(new BitstampPriceProvider(), ['btcusdc', 'btcusdt', 'btcusd']), btc)).toEqual(['btcusd', 'btcusdt', 'btcusdc'])
        expect(symbols(withMarkets(new CryptoComPriceProvider(), ['BTC_USDC', 'BTC_USDT', 'BTC_USD']), btc)).toEqual(['BTC_USD', 'BTC_USDT', 'BTC_USDC'])
    })

    test('bitstamp prices USDT on its USDT/USD market and USDC on USDC/USD', () => {
        const provider = withMarkets(new BitstampPriceProvider(), ['usdcusdt', 'usdtusd', 'usdcusd'])
        expect(provider.getMarkets(new Pair(usd, getAsset('USDT')))).toEqual([
            {symbol: 'usdtusd', inversed: true},
            {symbol: 'usdcusdt', inversed: false}
        ])
        expect(symbols(provider, new Pair(usd, getAsset('USDC')))).toEqual(['usdcusd', 'usdcusdt'])
    })

    test('the first market is the one getSymbolInfo returns', () => {
        const provider = withMarkets(new BinancePriceProvider(), ['BTCUSD', 'BTCUSDT'])
        expect(provider.getSymbolInfo(btc)).toEqual({symbol: 'BTCUSDT', inversed: true})
    })

    test('a quote currency without a market is skipped', () => {
        expect(symbols(withMarkets(new BinancePriceProvider(), ['BTCUSD', 'ETHUSDT']), btc)).toEqual(['BTCUSD'])
    })
})

describe('one market per quote currency', () => {
    test('a direct market wins over an inverted one for the same quote currency', () => {
        const provider = withMarkets(new BinancePriceProvider(), ['BTCUSDT', 'USDTBTC'])
        expect(provider.getMarkets(new Pair(usd, getAsset('BTC')))).toEqual([{symbol: 'USDTBTC', inversed: false}])
    })

    test('the first alias of the asset that has a market is used', () => {
        const provider = withMarkets(new KrakenPriceProvider(), ['EURCUSD', 'EURUSD', 'USDTEUR', 'USDTEURC'])
        expect(provider.getMarkets(new Pair(usd, getAsset('EURC')))).toEqual([
            {symbol: 'EURUSD', inversed: true},
            {symbol: 'USDTEUR', inversed: false}
        ])
    })

    test('a quote currency the asset itself trades as is skipped', () => {
        const wrapped = new Asset('USDT0', ['USDT0', 'USDT'])
        const provider = withMarkets(new BinancePriceProvider(), ['USDT0USDT', 'USDT0USDC'])
        expect(symbols(provider, new Pair(usd, wrapped))).toEqual(['USDT0USDC'])
    })

    test('a base asset whose aliases are not in the order keeps the glossary order', () => {
        const provider = withMarkets(new BinancePriceProvider(), ['BTCEURC', 'BTCEUR'])
        expect(symbols(provider, new Pair(getAsset('EURC'), getAsset('BTC')))).toEqual(['BTCEUR', 'BTCEURC'])
    })

    test('an identity pair and a pair without markets resolve to nothing', () => {
        const provider = withMarkets(new BinancePriceProvider(), ['USDCUSDT', 'BTCUSDT'])
        expect(provider.getMarkets(new Pair(usd, usd))).toEqual([])
        expect(provider.getSymbolInfo(new Pair(usd, usd))).toBeNull()
        expect(provider.getMarkets(new Pair(usd, getAsset('NON_EXISTENT')))).toEqual([])
        expect(provider.getSymbolInfo(new Pair(usd, getAsset('NON_EXISTENT')))).toBeNull()
    })

    test('reloading the market list drops the resolved markets', async () => {
        const provider = new BinancePriceProvider()
        const btc = new Pair(usd, getAsset('BTC'))
        provider.__loadMarkets = () => Promise.resolve(['BTCUSD'])
        await provider.loadMarkets()
        expect(symbols(provider, btc)).toEqual(['BTCUSD'])
        provider.__loadMarkets = () => Promise.resolve(['BTCUSD', 'BTCUSDT'])
        await provider.loadMarkets()
        expect(symbols(provider, btc)).toEqual(['BTCUSDT', 'BTCUSD'])
    })
})

describe('TradeData', () => {
    test('keeps a BigInt amount as it is', () => {
        const trade = new TradeData({ts: start, volume: 123456789012345678901n, quoteVolume: 5n, inversed: false, source: 'test', completed: true})
        expect(trade.volume).toBe(123456789012345678901n)
        expect(trade.quoteVolume).toBe(5n)
    })
})

/**
 * Binance kline: open time in ms, volume at 5, quote volume at 7.
 * @param {number} ts - candle timestamp in seconds
 * @param {string} volume - asset volume
 * @param {string} quoteVolume - quote currency volume
 * @returns {any[]}
 */
function binanceKline(ts, volume, quoteVolume) {
    return [ts * 1000, '1', '1', '1', '1', volume, 0, quoteVolume]
}

/**
 * OKX kline: open time in ms, volume at 5, quote volume at 7, confirmation flag at 8.
 * @param {number} ts - candle timestamp in seconds
 * @param {string} volume - asset volume
 * @param {string} quoteVolume - quote currency volume
 * @param {boolean} confirmed - whether the candle is closed
 * @returns {any[]}
 */
function okxKline(ts, volume, quoteVolume, confirmed) {
    return [String(ts * 1000), '1', '1', '1', '1', volume, volume, quoteVolume, confirmed ? '1' : '0']
}

/**
 * Answers the provider's requests from a table instead of the network and records them.
 * @param {string} name - provider name
 * @param {string[]} markets - market list the exchange reports
 * @param {Function} answer - response payload for a market symbol; may throw
 * @returns {{provider: PriceProviderBase, requested: string[], startedAt: number[], maxInFlight: Function}}
 */
function stubExchange(name, markets, answer) {
    const [provider] = ExchangesPriceProvider.providers.filter(p => p.name === name)
    provider.markets = [] //forces a reload through the stub, which also drops markets resolved by an earlier test
    jest.spyOn(provider, '__loadMarkets').mockResolvedValue(markets)
    const requested = []
    const startedAt = []
    let inFlight = 0
    let maxInFlight = 0
    jest.spyOn(provider, '__makeRequest').mockImplementation(async url => {
        const params = new URL(url).searchParams
        const symbol = params.get('symbol') ?? params.get('instId')
        requested.push(symbol)
        startedAt.push(Date.now())
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        try {
            await new Promise(resolve => setTimeout(resolve, 5))
            return {data: answer(symbol)}
        } finally {
            inFlight--
        }
    })
    return {provider, requested, startedAt, maxInFlight: () => maxInFlight}
}

/**
 * @param {string[]} assets - asset names
 * @param {object} options - fetch options
 * @returns {Promise<AggregatedTradeData>}
 */
function getPriceData(assets, options) {
    return new ExchangesPriceProvider().getPriceData({assets, baseAsset: 'USD', from: start, period: 60, count: 2, options: {batchSize: 0, batchDelay: 0, timeout: 100, ...options}})
}

const binanceKlines = {
    BTCUSDT: [binanceKline(start, '1', '100'), binanceKline(start + 60, '2', '200')],
    BTCUSDC: [binanceKline(start, '0.5', '50.0000001'), binanceKline(start + 60, '0', '0')],
    BTCUSD: [binanceKline(start, '0.25', '25'), binanceKline(start + 60, '0.125', '12.5')]
}

describe('market mode', () => {
    beforeEach(() => {
        jest.spyOn(console, 'debug').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('first is the default and reads only the first market', async () => {
        const {requested} = stubExchange('binance', Object.keys(binanceKlines), symbol => binanceKlines[symbol])
        const matrix = await getPriceData(['BTC'], {sources: ['binance']})
        expect(requested).toEqual(['BTCUSDT'])
        //inverted market: the quote currency volume becomes the pair's volume
        expect(matrix.map(slot => slot[0][0].volume)).toEqual([1000000000n, 2000000000n])
        expect(matrix.map(slot => slot[0][0].quoteVolume)).toEqual([10000000n, 20000000n])
    })

    test('without a source list every default source answers, and gate stays off', async () => {
        for (const provider of ExchangesPriceProvider.providers)
            stubExchange(provider.name, [], () => [])
        const matrix = await getPriceData(['BTC'], {})
        expect(matrix[0][0].map(trade => trade.source).sort()).toEqual(['binance', 'bitstamp', 'bybit', 'coinbase', 'cryptocom', 'kraken', 'okx'])
    })

    test('an unknown mode is rejected', async () => {
        await expect(getPriceData(['BTC'], {sources: ['binance'], marketMode: 'sum'})).rejects.toThrow('Unknown market mode: sum')
    })

    test('combine sums the volumes of every market, minute by minute', async () => {
        const {requested} = stubExchange('binance', Object.keys(binanceKlines), symbol => binanceKlines[symbol])
        const matrix = await getPriceData(['BTC'], {sources: ['binance'], marketMode: 'combine'})
        expect([...requested].sort()).toEqual(['BTCUSD', 'BTCUSDC', 'BTCUSDT'])
        expect(matrix.map(slot => slot[0])).toHaveLength(2)
        const [first, second] = matrix.map(slot => slot[0][0])
        expect(first.volume).toBe(1750000001n) //100 + 50.0000001 + 25
        expect(first.quoteVolume).toBe(17500000n) //1 + 0.5 + 0.25
        expect(second.volume).toBe(2125000000n) //200 + 0 + 12.5
        expect(second.quoteVolume).toBe(21250000n) //2 + 0 + 0.125
        expect(first.source).toBe('binance')
        expect(first.ts).toBe(start)
        expect(second.ts).toBe(start + 60)
        expect(first.completed && second.completed).toBe(true)
    })

    test('combine sums the markets that returned data when one of them fails', async () => {
        const klines = {...binanceKlines, ETHUSDT: [binanceKline(start, '3', '300'), binanceKline(start + 60, '4', '400')]}
        stubExchange('binance', Object.keys(klines), symbol => {
            if (symbol === 'BTCUSDC')
                throw new RequestError('api.binance.com', {status: 400})
            return klines[symbol]
        })
        const matrix = await getPriceData(['BTC', 'ETH'], {sources: ['binance'], marketMode: 'combine'})
        expect(matrix.map(slot => slot[0][0].volume)).toEqual([1250000000n, 2125000000n]) //100 + 25, 200 + 12.5
        expect(matrix.map(slot => slot[0][0].quoteVolume)).toEqual([12500000n, 21250000n]) //1 + 0.25, 2 + 0.125
        expect(matrix.map(slot => slot[1][0].volume)).toEqual([3000000000n, 4000000000n])
    })

    test('combine sends no data for a pair when every market fails', async () => {
        stubExchange('binance', Object.keys(binanceKlines), () => {
            throw new RequestError('api.binance.com', {status: 400})
        })
        const matrix = await getPriceData(['BTC'], {sources: ['binance'], marketMode: 'combine'})
        expect(matrix.map(slot => slot[0][0].volume)).toEqual([0n, 0n])
        expect(matrix.map(slot => slot[0][0].quoteVolume)).toEqual([0n, 0n])
        expect(matrix.every(slot => slot[0][0].completed && slot[0][0].source === 'binance')).toBe(true)
    })

    test('a failed market is named in the warning', async () => {
        stubExchange('binance', Object.keys(binanceKlines), symbol => {
            if (symbol === 'BTCUSDC')
                throw new RequestError('api.binance.com', {status: 400})
            return binanceKlines[symbol]
        })
        await getPriceData(['BTC'], {sources: ['binance'], marketMode: 'combine'})
        expect(console.warn).toHaveBeenCalledTimes(1)
        expect(console.warn.mock.calls[0][0]).toContain('BTCUSDC')
    })

    test('combine leaves a candle that is still unconfirmed out of its minute', async () => {
        const klines = {
            'BTC-USDT': [okxKline(start, '1', '100', true), okxKline(start + 60, '2', '200', true)],
            'BTC-USDC': [okxKline(start, '1', '100', true), okxKline(start + 60, '3', '300', false)]
        }
        const {requested} = stubExchange('okx', Object.keys(klines), symbol => ({code: '0', data: klines[symbol]}))
        const matrix = await getPriceData(['BTC'], {sources: ['okx'], marketMode: 'combine'})
        expect(requested.filter(symbol => symbol === 'BTC-USDC')).toHaveLength(3) //retried until the last attempt
        const [first, second] = matrix.map(slot => slot[0][0])
        expect(first.volume).toBe(2000000000n) //100 + 100
        expect(second.volume).toBe(2000000000n) //200; the unconfirmed 300 is left out
        expect(second.ts).toBe(start + 60)
        expect(second.completed).toBe(true)
    })

    test('a minute every market left unconfirmed is blank', async () => {
        const klines = {
            'BTC-USDT': [okxKline(start, '1', '100', true), okxKline(start + 60, '2', '200', false)],
            'BTC-USDC': [okxKline(start, '1', '100', true), okxKline(start + 60, '3', '300', false)]
        }
        stubExchange('okx', Object.keys(klines), symbol => ({code: '0', data: klines[symbol]}))
        const matrix = await getPriceData(['BTC'], {sources: ['okx'], marketMode: 'combine'})
        const [first, second] = matrix.map(slot => slot[0][0])
        expect(first.volume).toBe(2000000000n)
        expect(second.volume).toBe(0n)
        expect(second.ts).toBe(start + 60)
        expect(second.completed).toBe(true)
    })

    test('a pair without a market still occupies its slot in combine mode', async () => {
        stubExchange('binance', Object.keys(binanceKlines), symbol => binanceKlines[symbol])
        const matrix = await getPriceData(['NON_EXISTENT', 'BTC'], {sources: ['binance'], marketMode: 'combine'})
        expect(matrix.map(slot => slot[0][0].volume)).toEqual([0n, 0n])
        expect(matrix.map(slot => slot[1][0].volume)).toEqual([1750000001n, 2125000000n])
    })
})

describe('batches count requests, not pairs', () => {
    const markets = ['BTCUSDT', 'BTCUSDC', 'BTCUSD', 'ETHUSDT', 'ETHUSDC', 'ETHUSD', 'SOLUSDT', 'SOLUSDC', 'SOLUSD']

    beforeEach(() => {
        jest.spyOn(console, 'debug').mockImplementation(() => {})
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('first mode sends one request per pair', async () => {
        const exchange = stubExchange('binance', markets, () => [])
        await getPriceData(['BTC', 'ETH', 'SOL'], {sources: ['binance'], batchSize: 2})
        expect(exchange.requested).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])
        expect(exchange.maxInFlight()).toBe(2)
    })

    test('combine mode keeps the batch size when a pair needs several requests', async () => {
        const exchange = stubExchange('binance', markets, () => [])
        await getPriceData(['BTC', 'ETH', 'SOL'], {sources: ['binance'], batchSize: 2, marketMode: 'combine'})
        expect(exchange.requested).toHaveLength(9)
        expect(exchange.maxInFlight()).toBe(2)
    })
})

describe('batch pacing', () => {
    const batchDelay = 300
    //Windows timers can fire up to a tick early, so spacing is checked with a small margin
    const margin = 20

    beforeEach(async () => {
        jest.spyOn(console, 'debug').mockImplementation(() => {})
        //let the spacing left over from earlier tests run out
        await new Promise(resolve => setTimeout(resolve, batchDelay + 50))
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('a pair without a market takes no batch slot', async () => {
        const exchange = stubExchange('binance', ['BTCUSDT'], () => [])
        const called = Date.now()
        const matrix = await getPriceData(['MATIC', 'DAI', 'BTC'], {sources: ['binance'], batchSize: 1, batchDelay})
        expect(exchange.requested).toEqual(['BTCUSDT'])
        expect(exchange.startedAt[0] - called).toBeLessThan(batchDelay / 2)
        expect(matrix.map(slot => slot.map(asset => asset.length))).toEqual([[1, 1, 1], [1, 1, 1]])
    })

    test('an identity pair keeps its candles without a request', async () => {
        const exchange = stubExchange('binance', ['BTCUSDT'], () => [])
        const matrix = await getPriceData(['USD'], {sources: ['binance'], batchSize: 1, batchDelay})
        expect(exchange.requested).toEqual([])
        expect(matrix.map(slot => slot[0][0].volume)).toEqual([10000000n, 10000000n])
    })

    test('the last batch is not followed by a wait', async () => {
        const exchange = stubExchange('binance', ['BTCUSDT', 'ETHUSDT'], () => [])
        const called = Date.now()
        await getPriceData(['BTC', 'ETH'], {sources: ['binance'], batchSize: 1, batchDelay})
        const elapsed = Date.now() - called
        expect(exchange.startedAt[1] - exchange.startedAt[0]).toBeGreaterThanOrEqual(batchDelay - margin)
        expect(elapsed).toBeLessThan(2 * batchDelay - 100)
    })

    test('the first batch of the next call keeps its distance from the previous one', async () => {
        const exchange = stubExchange('binance', ['BTCUSDT'], () => [])
        await getPriceData(['BTC'], {sources: ['binance'], batchSize: 1, batchDelay})
        await getPriceData(['BTC'], {sources: ['binance'], batchSize: 1, batchDelay})
        expect(exchange.startedAt).toHaveLength(2)
        expect(exchange.startedAt[1] - exchange.startedAt[0]).toBeGreaterThanOrEqual(batchDelay - margin)
    })

    test('concurrent calls take turns', async () => {
        const exchange = stubExchange('binance', ['BTCUSDT'], () => [])
        await Promise.all([
            getPriceData(['BTC'], {sources: ['binance'], batchSize: 1, batchDelay}),
            getPriceData(['BTC'], {sources: ['binance'], batchSize: 1, batchDelay})
        ])
        expect(exchange.startedAt).toHaveLength(2)
        expect(Math.abs(exchange.startedAt[1] - exchange.startedAt[0])).toBeGreaterThanOrEqual(batchDelay - margin)
    })
})

describe('providers build the request from the market they are given', () => {
    const market = {symbol: 'XYZQUOTE', inversed: false}

    test.each([
        ['binance', new BinancePriceProvider(), []],
        ['bybit', new BybitPriceProvider(), {retCode: 0, result: {list: []}}],
        ['okx', new OkxPriceProvider(), {code: '0', data: []}],
        ['kraken', new KrakenPriceProvider(), {error: [], result: {XYZQUOTE: [], last: 0}}],
        ['coinbase', new CoinbasePriceProvider(), []],
        ['gate', new GatePriceProvider(), []],
        ['bitstamp', new BitstampPriceProvider(), {data: {pair: 'XYZ/QUOTE', ohlc: []}}],
        ['cryptocom', new CryptoComPriceProvider(), {id: -1, method: 'public/get-candlestick', code: 0, result: {interval: '1m', data: [], instrument_name: 'XYZQUOTE'}}]
    ])('%s', async (name, provider, data) => {
        const urls = []
        provider.__makeRequest = url => {
            urls.push(url)
            return Promise.resolve({data})
        }
        const trades = await provider.getTradesData(new Pair(usd, getAsset('BTC')), start, 1, 1, 100, market)
        expect(trades).toHaveLength(1)
        expect(urls).toHaveLength(1)
        expect(urls[0]).toContain('XYZQUOTE')
    })
})
