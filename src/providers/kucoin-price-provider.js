/*eslint-disable class-methods-use-this */
const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.kucoin.com/api'

class KucoinPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'kucoin'

    quoteOrder = ['USDT', 'USDC', 'USD']

    /**
     * KuCoin answers {code, data}; any code other than '200000' is a failure, sent with {code, msg}.
     * @param {any} data - response payload
     * @returns {any[]} data list
     */
    __requireList(data) {
        if (!data || data.code !== '200000')
            throw new Error(`kucoin: ${data?.code} ${data?.msg}`)
        return this.__requireArray(data.data)
    }

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/v2/symbols`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = this.__requireList(response.data)
        return markets
            .filter(market => market.enableTrading === true)
            .map(market => market.symbol)
    }

    async __getTradeData(market, timestamp, timeframe, count, timeout) {
        const type = timeframe === 60 ? '1hour' : `${timeframe}min`
        const endAt = timestamp + count * timeframe * 60 //exclusive
        //candles come newest first, and a minute without trades is left out
        const klinesUrl = `${baseApiUrl}/v1/market/candles?type=${type}&symbol=${market.symbol}&startAt=${timestamp}&endAt=${endAt}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = this.__requireList(response.data)
        return this.__processKlines(klines, timestamp, market.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        //[time, open, close, high, low, volume, turnover]
        return new TradeData({
            ts: PriceProviderBase.toNumber(kline[0], 'timestamp'),
            volume: PriceProviderBase.validateAmount(kline[5], 'volume'),
            quoteVolume: PriceProviderBase.validateAmount(kline[6], 'quote volume'),
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }

    __formatSymbol(base, quote) {
        return `${base}-${quote}`
    }
}

module.exports = KucoinPriceProvider
