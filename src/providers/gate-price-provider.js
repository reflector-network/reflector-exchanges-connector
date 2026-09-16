/*eslint-disable class-methods-use-this */
const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseUrl = 'https://api.gateio.ws/api/v4'

class GatePriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'gate'

    /**
     * Gate answers errors with an object {label, message} where a list is expected.
     * @param {any} data - response payload
     * @returns {any[]}
     */
    __requireList(data) {
        if (data && !Array.isArray(data) && (data.label !== undefined || data.message !== undefined))
            throw new Error(`gate: ${data.label} ${data.message}`)
        return this.__requireArray(data)
    }

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseUrl}/spot/currency_pairs`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = this.__requireList(response.data)
        return markets
            .filter(market => market.trade_status.toUpperCase() === 'TRADABLE')
            .map(market => market.id)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        const normalizedTimeframe = timeframe === 60 ? '1h' : `${timeframe}m`
        const klinesUrl = `${baseUrl}/spot/candlesticks?currency_pair=${symbolInfo.symbol}&interval=${normalizedTimeframe}&from=${timestamp}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = this.__requireList(response.data)
        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        return new TradeData({
            ts: PriceProviderBase.toNumber(kline[0], 'timestamp'),
            volume: PriceProviderBase.validateAmount(kline[6], 'volume'),
            quoteVolume: PriceProviderBase.validateAmount(kline[1], 'quote volume'),
            inversed,
            source: this.name,
            completed: String(kline[7]).toUpperCase() === 'TRUE'
        })
    }

    __formatSymbol(base, quote) {
        return `${base}_${quote}`
    }
}

module.exports = GatePriceProvider
