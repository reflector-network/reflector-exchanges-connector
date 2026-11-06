/*eslint-disable class-methods-use-this */
const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://www.bitstamp.net/api/v2'

class BitstampPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'bitstamp'

    quoteOrder = ['USD', 'USDT', 'USDC']

    /**
     * Bitstamp answers errors with an object {code, errors: [{message}]}.
     * @param {any} data - response payload
     * @param {Function} pick - picks the expected list out of the payload
     * @returns {any[]}
     */
    __requireList(data, pick) {
        if (data && data.code !== undefined && Array.isArray(data.errors))
            throw new Error(`bitstamp: ${data.code} ${data.errors.map(error => error.message).join(', ')}`)
        return this.__requireArray(pick(data))
    }

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/markets/`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = this.__requireList(response.data, data => data)
        return markets
            .filter(market => market.market_type === 'SPOT' && market.trading === 'Enabled')
            .map(market => market.market_symbol)
    }

    async __getTradeData(market, timestamp, timeframe, count, timeout) {
        const step = timeframe * 60
        //end is inclusive; with end given Bitstamp returns the last `limit` candles up to it, so the window is exact
        const end = timestamp + (count - 1) * step
        const klinesUrl = `${baseApiUrl}/ohlc/${market.symbol}/?step=${step}&start=${timestamp}&end=${end}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = this.__requireList(response.data, data => data?.data?.ohlc)
        return this.__processKlines(klines, timestamp, market.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        const volume = PriceProviderBase.toNumber(kline.volume, 'volume')
        const open = PriceProviderBase.toNumber(kline.open, 'open')
        const high = PriceProviderBase.toNumber(kline.high, 'high')
        const low = PriceProviderBase.toNumber(kline.low, 'low')
        const close = PriceProviderBase.toNumber(kline.close, 'close')
        return new TradeData({
            ts: PriceProviderBase.toNumber(kline.timestamp, 'timestamp'),
            volume: PriceProviderBase.validateAmount(kline.volume, 'volume'),
            quoteVolume: volume * ((open + high + low + close) / 4), //volume * average price; bitstamp has no quote volume
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }

    __formatSymbol(base, quote) {
        return `${base}${quote}`.toLowerCase()
    }
}

module.exports = BitstampPriceProvider
