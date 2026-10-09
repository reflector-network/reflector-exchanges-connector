/*eslint-disable class-methods-use-this */
const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.bybit.com/v5'

class BybitPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'bybit'

    /**
     * @param {any} data - response payload; retCode 0 is success
     * @returns {any[]} result.list
     */
    __requireList(data) {
        if (!data || data.retCode !== 0)
            throw new Error(`bybit: ${data?.retCode} ${data?.retMsg}`)
        return this.__requireArray(data.result?.list)
    }

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/market/instruments-info?category=spot`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = this.__requireList(response.data)
        return markets
            .filter(market => market.status.toUpperCase() === 'TRADING')
            .map(market => market.symbol)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        const klinesUrl = `${baseApiUrl}/market/kline?category=spot&symbol=${symbolInfo.symbol}&interval=${timeframe}&start=${timestamp * 1000}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = this.__requireList(response.data)
        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        return new TradeData({
            ts: PriceProviderBase.toNumber(kline[0], 'timestamp') / 1000,
            volume: PriceProviderBase.validateAmount(kline[5], 'volume'),
            quoteVolume: PriceProviderBase.validateAmount(kline[6], 'quote volume'),
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }
}

module.exports = BybitPriceProvider
