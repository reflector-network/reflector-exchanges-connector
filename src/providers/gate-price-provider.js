const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseUrl = 'https://api.gateio.ws/api/v4'

class GatePriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'gate'

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseUrl}/spot/currency_pairs`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = response.data
        return markets
            .filter(market => market.trade_status.toUpperCase() === 'TRADABLE')
            .map(market => market.id)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        const normalizedTimeframe = timeframe === 60 ? '1h' : `${timeframe}m`
        const klinesUrl = `${baseUrl}/spot/candlesticks?currency_pair=${symbolInfo.symbol}&interval=${normalizedTimeframe}&from=${timestamp}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = response.data
        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        return new TradeData({
            ts: Number(kline[0]),
            volume: kline[6],
            quoteVolume: kline[1],
            inversed,
            source: this.name,
            completed: kline[7].toUpperCase() === 'TRUE'
        })
    }

    __formatSymbol(base, quote) {
        return `${quote}_${base}`
    }
}

module.exports = GatePriceProvider