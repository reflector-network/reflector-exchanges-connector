/*eslint-disable no-undef */
const BinancePriceProvider = require('../src/providers/binance-price-provider')
const BybitPriceProvider = require('../src/providers/bybit-price-provider')
const OkxPriceProvider = require('../src/providers/okx-price-provider')
const KrakenPriceProvider = require('../src/providers/kraken-price-provider')
const CoinbasePriceProvider = require('../src/providers/coinbase-price-provider')
const GatePriceProvider = require('../src/providers/gate-price-provider')
const BitstampPriceProvider = require('../src/providers/bitstamp-price-provider')
const CryptoComPriceProvider = require('../src/providers/cryptocom-price-provider')

const market = {symbol: 'BTCUSDT', inversed: true}
const start = 1700000000

/**
 * @param {PriceProviderBase} provider - provider under test
 * @param {any} data - payload `__makeRequest` should answer with
 * @returns {PriceProviderBase}
 */
function answering(provider, data) {
    provider.__makeRequest = () => Promise.resolve({data})
    return provider
}

describe('exchange error envelopes are rejected', () => {
    test('binance', async () => {
        await expect(answering(new BinancePriceProvider(), {code: -1121, msg: 'Invalid symbol.'}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('binance: -1121 Invalid symbol.')
        await expect(answering(new BinancePriceProvider(), {symbols: 'nope'}).__loadMarkets(100)).rejects.toThrow('binance: unexpected klines payload')
    })

    test('bybit', async () => {
        await expect(answering(new BybitPriceProvider(), {retCode: 10001, retMsg: 'params error', result: {}}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('bybit: 10001 params error')
    })

    test('okx', async () => {
        await expect(answering(new OkxPriceProvider(), {code: '51001', msg: 'Instrument ID does not exist', data: []}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('okx: 51001 Instrument ID does not exist')
    })

    test('kraken', async () => {
        await expect(answering(new KrakenPriceProvider(), {error: ['EQuery:Unknown asset pair'], result: {}}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('kraken: EQuery:Unknown asset pair')
    })

    test('coinbase', async () => {
        await expect(answering(new CoinbasePriceProvider(), {message: 'NotFound'}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('coinbase: NotFound')
    })

    test('gate', async () => {
        await expect(answering(new GatePriceProvider(), {label: 'INVALID_CURRENCY_PAIR', message: 'Invalid currency pair'}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('gate: INVALID_CURRENCY_PAIR Invalid currency pair')
    })

    test('bitstamp', async () => {
        const validationError = {code: 'validation-error', errors: [{code: 'validation-error', message: 'Not a valid choice.', field: 'step'}]}
        await expect(answering(new BitstampPriceProvider(), validationError).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('bitstamp: validation-error Not a valid choice.')
        await expect(answering(new BitstampPriceProvider(), {data: {pair: 'BTC/USDT'}}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('bitstamp: unexpected klines payload')
        await expect(answering(new BitstampPriceProvider(), validationError).__loadMarkets(100)).rejects.toThrow('bitstamp: validation-error Not a valid choice.')
    })

    test('cryptocom', async () => {
        await expect(answering(new CryptoComPriceProvider(), {code: 40004, message: 'Invalid instrument_name'}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('cryptocom: 40004 Invalid instrument_name')
        await expect(answering(new CryptoComPriceProvider(), {id: -1, method: 'public/get-candlestick', code: 0, result: {}}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('cryptocom: unexpected klines payload')
        await expect(answering(new CryptoComPriceProvider(), {code: 40003, message: 'Invalid request'}).__loadMarkets(100)).rejects.toThrow('cryptocom: 40003 Invalid request')
    })
})

/**
 * @param {string} symbol - market symbol
 * @param {string} trading - Enabled or Disabled
 * @param {string} type - SPOT or PERPETUAL
 * @returns {object} one entry of Bitstamp's /api/v2/markets/
 */
function bitstampMarket(symbol, trading, type) {
    return {
        name: 'BTC/USD',
        market_symbol: symbol,
        base_currency: 'BTC',
        base_decimals: 8,
        counter_currency: 'USD',
        counter_decimals: 0,
        minimum_order_value: '10.00000',
        trading,
        instant_order_counter_decimals: 2,
        instant_and_market_orders: trading,
        description: 'Bitcoin / U.S. dollar',
        market_type: type
    }
}

/**
 * @param {string} symbol - instrument name
 * @param {string} type - CCY_PAIR, PERPETUAL_SWAP or FUTURE
 * @param {boolean} tradable - whether the instrument trades
 * @returns {object} one entry of Crypto.com's public/get-instruments
 */
function cryptoComInstrument(symbol, type, tradable) {
    return {
        symbol,
        inst_type: type,
        display_name: 'BTC/USD',
        base_ccy: 'BTC',
        quote_ccy: 'USD',
        quote_decimals: 2,
        quantity_decimals: 5,
        price_tick_size: '0.01',
        qty_tick_size: '0.00001',
        max_leverage: '50',
        tradable,
        expiry_timestamp_ms: 0,
        beta_product: false,
        product_type: 'DIGITAL_CURRENCIES',
        margin_buy_enabled: false,
        margin_sell_enabled: false
    }
}

describe('market lists hold the spot markets that trade', () => {
    test('bitstamp', async () => {
        const urls = []
        const provider = new BitstampPriceProvider()
        provider.__makeRequest = url => {
            urls.push(url)
            return Promise.resolve({data: [
                bitstampMarket('btcusd', 'Enabled', 'SPOT'),
                bitstampMarket('xyzusd', 'Disabled', 'SPOT'),
                bitstampMarket('btcusd-perp', 'Enabled', 'PERPETUAL')
            ]})
        }
        expect(await provider.__loadMarkets(100)).toEqual(['btcusd'])
        expect(urls).toEqual(['https://www.bitstamp.net/api/v2/markets/'])
    })

    test('cryptocom', async () => {
        const urls = []
        const provider = new CryptoComPriceProvider()
        provider.__makeRequest = url => {
            urls.push(url)
            return Promise.resolve({data: {id: 1, method: 'public/get-instruments', code: 0, result: {data: [
                cryptoComInstrument('BTC_USD', 'CCY_PAIR', true),
                cryptoComInstrument('ETH_USD', 'CCY_PAIR', false),
                cryptoComInstrument('BTCUSD-PERP', 'PERPETUAL_SWAP', true)
            ]}}})
        }
        expect(await provider.__loadMarkets(100)).toEqual(['BTC_USD'])
        expect(urls).toEqual(['https://api.crypto.com/exchange/v1/public/get-instruments'])
    })
})

describe('requests ask for exactly the requested minutes', () => {
    /**
     * @param {PriceProviderBase} provider - provider under test
     * @param {any} data - payload to answer with
     * @returns {URL[]} requested urls, filled as the provider sends them
     */
    function recording(provider, data) {
        const urls = []
        provider.__makeRequest = url => {
            urls.push(new URL(url))
            return Promise.resolve({data})
        }
        return urls
    }

    //bitstamp: end is inclusive and, when given, the answer is the last `limit` candles up to it
    test.each([
        [1, 3, {step: '60', start: '1700000000', end: '1700000120', limit: '3'}],
        [5, 2, {step: '300', start: '1700000000', end: '1700000300', limit: '2'}],
        [60, 1, {step: '3600', start: '1700000000', end: '1700000000', limit: '1'}]
    ])('bitstamp, %i-minute candles, %i of them', async (timeframe, count, params) => {
        const provider = new BitstampPriceProvider()
        const requested = recording(provider, {data: {pair: 'BTC/USD', ohlc: []}})
        await provider.__getTradeData({symbol: 'btcusd', inversed: true}, start, timeframe, count, 100)
        expect(requested).toHaveLength(1)
        expect(requested[0].origin + requested[0].pathname).toBe('https://www.bitstamp.net/api/v2/ohlc/btcusd/')
        expect(Object.fromEntries(requested[0].searchParams)).toEqual(params)
    })

    //crypto.com: end_ts is exclusive, times are in ms, and count keeps the newest candles of the window
    test.each([
        [1, 3, {instrument_name: 'BTC_USD', timeframe: '1m', start_ts: '1700000000000', end_ts: '1700000180000', count: '3'}],
        [5, 2, {instrument_name: 'BTC_USD', timeframe: '5m', start_ts: '1700000000000', end_ts: '1700000600000', count: '2'}],
        [60, 1, {instrument_name: 'BTC_USD', timeframe: '1h', start_ts: '1700000000000', end_ts: '1700003600000', count: '1'}]
    ])('cryptocom, %i-minute candles, %i of them', async (timeframe, count, params) => {
        const provider = new CryptoComPriceProvider()
        const requested = recording(provider, {id: -1, method: 'public/get-candlestick', code: 0, result: {interval: '1m', data: [], instrument_name: 'BTC_USD'}})
        await provider.__getTradeData({symbol: 'BTC_USD', inversed: true}, start, timeframe, count, 100)
        expect(requested).toHaveLength(1)
        expect(requested[0].origin + requested[0].pathname).toBe('https://api.crypto.com/exchange/v1/public/get-candlestick')
        expect(Object.fromEntries(requested[0].searchParams)).toEqual(params)
    })
})

describe('kline fields are validated, not concatenated', () => {
    test('coinbase computes the quote volume from numbers even when the gateway stringifies them', async () => {
        const provider = answering(new CoinbasePriceProvider(), [[String(start), '1', '4', '3', '2', '10']])
        const [trade] = await provider.__getTradeData(market, start, 1, 1, 100)
        //inversed pair: TradeData swaps volume and quoteVolume; the quote volume is 10 * (2 + 3 + 4 + 1) / 4 = 25
        expect(trade.volume).toBe(250000000n)
        expect(trade.quoteVolume).toBe(100000000n)
    })

    test('bitstamp computes the quote volume from the average price, as coinbase does', async () => {
        const provider = answering(new BitstampPriceProvider(), {data: {pair: 'BTC/USDT', ohlc: [
            {timestamp: String(start), open: '3', high: '4', low: '1', close: '2', volume: '10'}
        ]}})
        const [trade] = await provider.__getTradeData(market, start, 1, 1, 100)
        //inversed pair: TradeData swaps volume and quoteVolume; the quote volume is 10 * (3 + 4 + 1 + 2) / 4 = 25
        expect(trade.ts).toBe(start)
        expect(trade.volume).toBe(250000000n)
        expect(trade.quoteVolume).toBe(100000000n)
        expect(trade.source).toBe('bitstamp')
        expect(trade.completed).toBe(true) //no confirmation flag; a closed minute is final
    })

    test('cryptocom computes the quote volume from the average price and reads times in ms', async () => {
        const provider = answering(new CryptoComPriceProvider(), {id: -1, method: 'public/get-candlestick', code: 0, result: {interval: '1m', instrument_name: 'BTC_USDT', data: [
            {o: '3', h: '4', l: '1', c: '2', v: '10', t: start * 1000}
        ]}})
        const [trade] = await provider.__getTradeData(market, start, 1, 1, 100)
        expect(trade.ts).toBe(start)
        expect(trade.volume).toBe(250000000n)
        expect(trade.quoteVolume).toBe(100000000n)
        expect(trade.source).toBe('cryptocom')
        expect(trade.completed).toBe(true) //no confirmation flag; a closed minute is final
    })

    test('bitstamp and cryptocom reject a non-numeric volume', async () => {
        const bitstamp = answering(new BitstampPriceProvider(), {data: {pair: 'BTC/USDT', ohlc: [
            {timestamp: String(start), open: '1', high: '1', low: '1', close: '1', volume: 'abc'}
        ]}})
        await expect(bitstamp.__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('Invalid volume: abc')
        const cryptoCom = answering(new CryptoComPriceProvider(), {code: 0, result: {data: [{o: '1', h: '1', l: '1', c: '1', v: 'abc', t: start * 1000}]}})
        await expect(cryptoCom.__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('Invalid volume: abc')
    })

    test('binance rejects a non-numeric volume', async () => {
        const provider = answering(new BinancePriceProvider(), [[start * 1000, '1', '1', '1', '1', 'abc', 0, '2']])
        await expect(provider.__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('Invalid volume: abc')
    })

    test('okx and gate honour their confirmation flags', async () => {
        const okx = answering(new OkxPriceProvider(), {code: '0', data: [[String(start * 1000), '1', '1', '1', '1', '5', '5', '7', '0']]})
        const [okxTrade] = await okx.__getTradeData(market, start, 1, 1, 100)
        expect(okxTrade.completed).toBe(false)
        const gate = answering(new GatePriceProvider(), [[String(start), '7', '1', '1', '1', '1', '5', 'true']])
        const [gateTrade] = await gate.__getTradeData(market, start, 1, 1, 100)
        expect(gateTrade.completed).toBe(true)
    })
})
