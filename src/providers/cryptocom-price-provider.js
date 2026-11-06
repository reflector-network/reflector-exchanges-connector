/*eslint-disable class-methods-use-this */
const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.crypto.com/exchange/v1/public'

class CryptoComPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'cryptocom'

    quoteOrder = ['USD', 'USDT', 'USDC']

    /**
     * Crypto.com answers {code, result: {data: [...]}}; any code other than 0 is a failure.
     * @param {any} data - response payload
     * @returns {any[]} data list
     */
    __requireList(data) {
        if (!data || data.code !== 0)
            throw new Error(`cryptocom: ${data?.code} ${data?.message}`)
        return this.__requireArray(data.result?.data)
    }

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/get-instruments`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = this.__requireList(response.data)
        return markets
            .filter(market => market.inst_type === 'CCY_PAIR' && market.tradable === true)
            .map(market => market.symbol)
    }

    async __getTradeData(market, timestamp, timeframe, count, timeout) {
        const timeframeInMs = timeframe * 60000
        const start = timestamp * 1000
        const end = start + count * timeframeInMs //exclusive
        const interval = timeframe === 60 ? '1h' : `${timeframe}m`
        //count keeps the newest candles of the window, so it must cover the whole window
        const klinesUrl = `${baseApiUrl}/get-candlestick?instrument_name=${market.symbol}&timeframe=${interval}&start_ts=${start}&end_ts=${end}&count=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = this.__requireList(response.data)
        return this.__processKlines(klines, timestamp, market.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        const volume = PriceProviderBase.toNumber(kline.v, 'volume')
        const open = PriceProviderBase.toNumber(kline.o, 'open')
        const high = PriceProviderBase.toNumber(kline.h, 'high')
        const low = PriceProviderBase.toNumber(kline.l, 'low')
        const close = PriceProviderBase.toNumber(kline.c, 'close')
        return new TradeData({
            ts: PriceProviderBase.toNumber(kline.t, 'timestamp') / 1000,
            volume: PriceProviderBase.validateAmount(kline.v, 'volume'),
            quoteVolume: volume * ((open + high + low + close) / 4), //volume * average price; crypto.com has no quote volume
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }

    __formatSymbol(base, quote) {
        return `${base}_${quote}`
    }
}

module.exports = CryptoComPriceProvider
