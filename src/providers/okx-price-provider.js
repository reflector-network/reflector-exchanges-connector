/*eslint-disable class-methods-use-this */
const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://www.okx.com/api/v5'

class OkxPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'okx'

    /**
     * @param {any} data - response payload; code '0' is success
     * @returns {any[]} data list
     */
    __requireList(data) {
        if (!data || data.code !== '0')
            throw new Error(`okx: ${data?.code} ${data?.msg}`)
        return this.__requireArray(data.data)
    }

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/public/instruments?instType=SPOT`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = this.__requireList(response.data)
        return markets
            .filter(market => market.state.toUpperCase() === 'LIVE')
            .map(market => market.instId)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        const timestampInMs = timestamp * 1000
        const timeframeInMs = timeframe * 60000
        const before = timestampInMs - timeframeInMs
        const after = timestampInMs + (count * timeframeInMs)
        const bar = timeframe === 60 ? '1h' : `${timeframe}m`
        //https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks
        const klinesUrl = `${baseApiUrl}/market/candles?instId=${symbolInfo.symbol}&bar=${bar}&before=${before}&after=${after}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = this.__requireList(response.data)
        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        return new TradeData({
            ts: PriceProviderBase.toNumber(kline[0], 'timestamp') / 1000,
            volume: PriceProviderBase.validateAmount(kline[5], 'volume'),
            quoteVolume: PriceProviderBase.validateAmount(kline[7], 'quote volume'),
            inversed,
            source: this.name,
            completed: kline[8] === '1'
        })
    }

    __formatSymbol(base, quote) {
        return `${base}-${quote}`
    }
}

module.exports = OkxPriceProvider
