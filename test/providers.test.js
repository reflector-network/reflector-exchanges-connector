/*eslint-disable no-undef */
const BinancePriceProvider = require('../src/providers/binance-price-provider')
const BybitPriceProvider = require('../src/providers/bybit-price-provider')
const OkxPriceProvider = require('../src/providers/okx-price-provider')
const KrakenPriceProvider = require('../src/providers/kraken-price-provider')
const CoinbasePriceProvider = require('../src/providers/coinbase-price-provider')
const GatePriceProvider = require('../src/providers/gate-price-provider')
const BitstampPriceProvider = require('../src/providers/bitstamp-price-provider')
const CryptoComPriceProvider = require('../src/providers/cryptocom-price-provider')
const KucoinPriceProvider = require('../src/providers/kucoin-price-provider')
const BitgetPriceProvider = require('../src/providers/bitget-price-provider')
const WhitebitPriceProvider = require('../src/providers/whitebit-price-provider')

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

    test('kucoin', async () => {
        await expect(answering(new KucoinPriceProvider(), {msg: 'Unsupported trading pair.', code: '400100'}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('kucoin: 400100 Unsupported trading pair.')
        await expect(answering(new KucoinPriceProvider(), {code: '200000', data: {}}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('kucoin: unexpected klines payload')
        await expect(answering(new KucoinPriceProvider(), {msg: 'Too Many Requests', code: '429000'}).__loadMarkets(100)).rejects.toThrow('kucoin: 429000 Too Many Requests')
    })

    test('bitget', async () => {
        const unknown = {code: '40034', msg: 'Parameter XYZUSDT does not exist', requestTime: 1794218410801, data: null}
        await expect(answering(new BitgetPriceProvider(), unknown).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('bitget: 40034 Parameter XYZUSDT does not exist')
        await expect(answering(new BitgetPriceProvider(), {code: '00000', msg: 'success', requestTime: 0, data: null}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('bitget: unexpected klines payload')
        await expect(answering(new BitgetPriceProvider(), unknown).__loadMarkets(100)).rejects.toThrow('bitget: 40034 Parameter XYZUSDT does not exist')
    })

    test('whitebit', async () => {
        const unavailable = {success: false, message: {market: ['Market is not available.']}, result: null}
        await expect(answering(new WhitebitPriceProvider(), unavailable).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('whitebit: Market is not available.')
        await expect(answering(new WhitebitPriceProvider(), {success: false, message: 'Too many requests', result: null}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('whitebit: Too many requests')
        await expect(answering(new WhitebitPriceProvider(), {success: true, message: null, result: null}).__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('whitebit: unexpected klines payload')
        await expect(answering(new WhitebitPriceProvider(), {success: false, message: 'Maintenance', code: 0}).__loadMarkets(100)).rejects.toThrow('whitebit: Maintenance')
    })
})

/**
 * @param {string} symbol - market symbol
 * @param {boolean} enableTrading - whether the market trades
 * @returns {object} one entry of KuCoin's /api/v2/symbols
 */
function kucoinMarket(symbol, enableTrading) {
    return {
        symbol,
        name: symbol,
        baseCurrency: 'BTC',
        quoteCurrency: 'USDT',
        feeCurrency: 'USDT',
        market: 'USDS',
        baseMinSize: '0.00001',
        quoteMinSize: '0.1',
        baseMaxSize: '10000000000',
        quoteMaxSize: '99999999',
        baseIncrement: '0.00000001',
        quoteIncrement: '0.000001',
        priceIncrement: '0.1',
        priceLimitRate: '0.01',
        minFunds: '0.1',
        isMarginEnabled: true,
        enableTrading,
        feeCategory: 1,
        makerFeeCoefficient: '1.00',
        takerFeeCoefficient: '1.00',
        st: false,
        callauctionIsEnabled: false,
        callauctionPriceFloor: null,
        callauctionPriceCeiling: null,
        callauctionFirstStageStartTime: null,
        callauctionSecondStageStartTime: null,
        callauctionThirdStageStartTime: null,
        tradingStartTime: null
    }
}

/**
 * @param {string} symbol - market symbol
 * @param {string} status - online or halt
 * @returns {object} one entry of Bitget's /api/v2/spot/public/symbols
 */
function bitgetMarket(symbol, status) {
    return {
        symbol,
        baseCoin: 'BTC',
        quoteCoin: 'USDT',
        minTradeAmount: '0',
        maxTradeAmount: '900000000000000000000',
        takerFeeRate: '0.002',
        makerFeeRate: '0.002',
        pricePrecision: '2',
        quantityPrecision: '6',
        quotePrecision: '8',
        status,
        minTradeUSDT: '1',
        buyLimitPriceRatio: '0.02',
        sellLimitPriceRatio: '0.02',
        areaSymbol: 'no',
        orderQuantity: '200',
        openTime: '1532454360000',
        offTime: '',
        maxLimitOrderValue: '20000000',
        maxMarketOrderValue: '1000000'
    }
}

/**
 * @param {string} name - market name
 * @param {string} type - spot or futures
 * @param {boolean} tradesEnabled - whether the market trades
 * @returns {object} one entry of WhiteBIT's /api/v4/public/markets
 */
function whitebitMarket(name, type, tradesEnabled) {
    return {
        name,
        stock: 'BTC',
        money: 'USDT',
        stockPrec: '6',
        moneyPrec: '2',
        feePrec: '6',
        makerFee: '0.1',
        takerFee: '0.1',
        minAmount: '0.00001',
        minTotal: '1',
        tradesEnabled,
        type,
        isCollateral: true,
        maxTotal: '10000000',
        isTradFiFutures: false,
        delistedAt: null,
        tickSize: '0.01',
        stepSize: '0.000001'
    }
}

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

    test('kucoin', async () => {
        const urls = []
        const provider = new KucoinPriceProvider()
        provider.__makeRequest = url => {
            urls.push(url)
            return Promise.resolve({data: {code: '200000', data: [kucoinMarket('BTC-USDT', true), kucoinMarket('XYZ-USDT', false)]}})
        }
        expect(await provider.__loadMarkets(100)).toEqual(['BTC-USDT'])
        expect(urls).toEqual(['https://api.kucoin.com/api/v2/symbols'])
    })

    test('bitget', async () => {
        const urls = []
        const provider = new BitgetPriceProvider()
        provider.__makeRequest = url => {
            urls.push(url)
            return Promise.resolve({data: {code: '00000', msg: 'success', requestTime: 0, data: [bitgetMarket('BTCUSDT', 'online'), bitgetMarket('WEETHUSDT', 'halt')]}})
        }
        expect(await provider.__loadMarkets(100)).toEqual(['BTCUSDT'])
        expect(urls).toEqual(['https://api.bitget.com/api/v2/spot/public/symbols'])
    })

    test('whitebit', async () => {
        const urls = []
        const provider = new WhitebitPriceProvider()
        provider.__makeRequest = url => {
            urls.push(url)
            return Promise.resolve({data: [
                whitebitMarket('BTC_USDT', 'spot', true),
                whitebitMarket('XYZ_USDT', 'spot', false),
                whitebitMarket('BTC_PERP', 'futures', true)
            ]})
        }
        expect(await provider.__loadMarkets(100)).toEqual(['BTC_USDT'])
        expect(urls).toEqual(['https://whitebit.com/api/v4/public/markets'])
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

    //kucoin: startAt is inclusive, endAt exclusive, both in seconds
    test.each([
        [1, 3, {type: '1min', symbol: 'BTC-USDT', startAt: '1700000000', endAt: '1700000180'}],
        [5, 2, {type: '5min', symbol: 'BTC-USDT', startAt: '1700000000', endAt: '1700000600'}],
        [60, 1, {type: '1hour', symbol: 'BTC-USDT', startAt: '1700000000', endAt: '1700003600'}]
    ])('kucoin, %i-minute candles, %i of them', async (timeframe, count, params) => {
        const provider = new KucoinPriceProvider()
        const requested = recording(provider, {code: '200000', data: []})
        await provider.__getTradeData({symbol: 'BTC-USDT', inversed: true}, start, timeframe, count, 100)
        expect(requested).toHaveLength(1)
        expect(requested[0].origin + requested[0].pathname).toBe('https://api.kucoin.com/api/v1/market/candles')
        expect(Object.fromEntries(requested[0].searchParams)).toEqual(params)
    })

    //bitget: startTime is exclusive and endTime inclusive, in ms; endTime with limit returns the last `limit` candles up to it
    test.each([
        [1, 3, {symbol: 'BTCUSDT', granularity: '1min', endTime: '1700000120000', limit: '3'}],
        [5, 2, {symbol: 'BTCUSDT', granularity: '5min', endTime: '1700000300000', limit: '2'}],
        [60, 1, {symbol: 'BTCUSDT', granularity: '1h', endTime: '1700000000000', limit: '1'}]
    ])('bitget, %i-minute candles, %i of them', async (timeframe, count, params) => {
        const provider = new BitgetPriceProvider()
        const requested = recording(provider, {code: '00000', msg: 'success', requestTime: 0, data: []})
        await provider.__getTradeData({symbol: 'BTCUSDT', inversed: true}, start, timeframe, count, 100)
        expect(requested).toHaveLength(1)
        expect(requested[0].origin + requested[0].pathname).toBe('https://api.bitget.com/api/v2/spot/market/candles')
        expect(Object.fromEntries(requested[0].searchParams)).toEqual(params)
    })

    //whitebit: the answer is the last `limit` closed candles that end by `end`, so end is the close of the last minute
    test.each([
        [1, 3, {market: 'BTC_USDT', interval: '1m', start: '1700000000', end: '1700000180', limit: '3'}],
        [5, 2, {market: 'BTC_USDT', interval: '5m', start: '1700000000', end: '1700000600', limit: '2'}],
        [60, 1, {market: 'BTC_USDT', interval: '1h', start: '1700000000', end: '1700003600', limit: '1'}]
    ])('whitebit, %i-minute candles, %i of them', async (timeframe, count, params) => {
        const provider = new WhitebitPriceProvider()
        const requested = recording(provider, {success: true, message: null, result: []})
        await provider.__getTradeData({symbol: 'BTC_USDT', inversed: true}, start, timeframe, count, 100)
        expect(requested).toHaveLength(1)
        expect(requested[0].origin + requested[0].pathname).toBe('https://whitebit.com/api/v1/public/kline')
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

    //each reports the quote volume itself; an inversed market turns it into the pair's volume
    test('kucoin reads its newest-first candles and leaves a minute without trades blank', async () => {
        const provider = answering(new KucoinPriceProvider(), {code: '200000', data: [
            [String(start + 120), '1', '1', '1', '1', '2', '7'],
            [String(start), '3', '2', '4', '1', '10', '25']
        ]})
        const trades = await provider.__getTradeData(market, start, 1, 3, 100)
        expect(trades.map(trade => trade.ts)).toEqual([start, start + 60, start + 120])
        expect(trades.map(trade => trade.volume)).toEqual([250000000n, 0n, 70000000n])
        expect(trades.map(trade => trade.quoteVolume)).toEqual([100000000n, 0n, 20000000n])
        expect(trades.every(trade => trade.source === 'kucoin' && trade.completed)).toBe(true)
    })

    test('bitget reads times in ms and its quote volume', async () => {
        const provider = answering(new BitgetPriceProvider(), {code: '00000', msg: 'success', requestTime: 0, data: [
            [String(start * 1000), '3', '4', '1', '2', '10', '24', '25']
        ]})
        const [trade] = await provider.__getTradeData(market, start, 1, 1, 100)
        expect(trade.ts).toBe(start)
        expect(trade.volume).toBe(250000000n) //the quote volume, not the USDT volume next to it
        expect(trade.quoteVolume).toBe(100000000n)
        expect(trade.source).toBe('bitget')
        expect(trade.completed).toBe(true)
    })

    test('whitebit reads its quote volume', async () => {
        const provider = answering(new WhitebitPriceProvider(), {success: true, message: null, result: [
            [start, '3', '2', '4', '1', '10', '25']
        ]})
        const [trade] = await provider.__getTradeData(market, start, 1, 1, 100)
        expect(trade.ts).toBe(start)
        expect(trade.volume).toBe(250000000n)
        expect(trade.quoteVolume).toBe(100000000n)
        expect(trade.source).toBe('whitebit')
        expect(trade.completed).toBe(true)
    })

    test('kucoin, bitget and whitebit reject a non-numeric volume', async () => {
        const kucoin = answering(new KucoinPriceProvider(), {code: '200000', data: [[String(start), '1', '1', '1', '1', 'abc', '1']]})
        await expect(kucoin.__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('Invalid volume: abc')
        const bitget = answering(new BitgetPriceProvider(), {code: '00000', data: [[String(start * 1000), '1', '1', '1', '1', 'abc', '1', '1']]})
        await expect(bitget.__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('Invalid volume: abc')
        const whitebit = answering(new WhitebitPriceProvider(), {success: true, result: [[start, '1', '1', '1', '1', 'abc', '1']]})
        await expect(whitebit.__getTradeData(market, start, 1, 1, 100)).rejects.toThrow('Invalid volume: abc')
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
